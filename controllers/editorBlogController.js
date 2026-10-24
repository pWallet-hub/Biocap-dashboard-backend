const Blog = require('../models/Blog');
const User = require('../models/User');
const { writeAuditLog } = require('../utils/auditLogger');
const { htmlToBlocks } = require('../utils/htmlToBlocks');
const { snapshotOf, diffSnapshots, summarizeChanges } = require('../utils/editorProposal');
const { sendEditorProposalEmail } = require('../utils/sendEmail');

const PENDING_PROPOSAL_MESSAGE = "An editor proposal is already awaiting the writer's decision.";

const isWriterOf = (blog, userId) =>
  blog.originalAuthor?.toString() === userId || blog.author?.toString() === userId;

// Returns a plain-object copy of each record with its editor replaced by a { firstName, lastName, username } summary.
const withEditorNames = async (records) => {
  const ids = [...new Set(records.map((record) => String(record.editor)))];
  const users = await User.find({ _id: { $in: ids } }).select('firstName lastName username').lean();
  const byId = new Map(users.map((user) => [String(user._id), { firstName: user.firstName, lastName: user.lastName, username: user.username }]));
  return records.map((record) => ({ ...record, editor: byId.get(String(record.editor)) || null }));
};

/**
 * PUT /api/editor/blogs/:id
 * Editor proposes a new version. The live story is not changed; the writer decides whether to accept it.
 */
exports.updateBlogByEditor = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, excerpt, blocks, tag, bodyHtml, img, imgPublicId } = req.body;

    const blog = await Blog.findOne({ _id: id, isDeleted: false }).select('+editorProposals');
    if (!blog) {
      return res.status(404).json({ error: 'Article not found' });
    }

    if (blog.publishConsentStatus === 'pending') {
      return res.status(409).json({ error: PENDING_PROPOSAL_MESSAGE });
    }

    // Safely parse blocks if sent as stringified JSON from FormData
    let parsedBlocks = blog.blocks;
    if (blocks) {
      if (typeof blocks === 'string') {
        try {
          parsedBlocks = JSON.parse(blocks);
        } catch (err) {
          return res.status(400).json({ error: 'Invalid JSON format for blocks payload.' });
        }
      } else if (Array.isArray(blocks)) {
        parsedBlocks = blocks;
      }
    }

    // 🟢 Cover Image Support: Handles both direct Cloudinary JSON payloads and multipart uploads
    let updatedImg = blog.img;
    let updatedImgPublicId = blog.imgPublicId;

    if (img && typeof img === 'string') {
      updatedImg = img;
      if (imgPublicId) updatedImgPublicId = imgPublicId;
    } else if (req.files && req.files.img && req.files.img[0]) {
      updatedImg = req.files.img[0].path || req.files.img[0].secure_url || req.files.img[0].location;
    }

    // If blocks are empty but bodyHtml provided, parse to structured blocks
    if ((!parsedBlocks || parsedBlocks.length === 0) && bodyHtml && typeof bodyHtml === 'string') {
      try {
        const parsed = htmlToBlocks(bodyHtml);
        if (parsed && parsed.length) parsedBlocks = parsed;
      } catch (e) {
        console.error('htmlToBlocks parse failed in editor update:', e.message);
      }
    }

    const baseline = snapshotOf(blog);
    const proposal = snapshotOf({
      title: title?.trim() || blog.title,
      excerpt: excerpt?.trim() || blog.excerpt,
      tag: tag?.trim() || blog.tag,
      img: updatedImg,
      imgPublicId: updatedImgPublicId,
      bodyHtml: typeof bodyHtml === 'string' ? bodyHtml : baseline.bodyHtml,
      blocks: parsedBlocks,
    });

    const changes = diffSnapshots(baseline, proposal);
    if (changes.length === 0) {
      return res.status(400).json({ error: 'No changes to propose.' });
    }

    const now = new Date();
    const version = (blog.editorProposals?.length || 0) + 1;

    // Conditional write so two editors cannot both open a proposal on the same story.
    const updated = await Blog.findOneAndUpdate(
      { _id: id, isDeleted: false, publishConsentStatus: { $ne: 'pending' } },
      {
        $set: {
          editorModifications: { ...proposal, editor: req.user.id, version, modifiedAt: now },
          publishConsentStatus: 'pending',
          publishConsentRequestedAt: now,
          publishConsentNote: 'Awaiting writer approval before publishing the editor changes.',
          officerAcceptedChanges: false,
        },
        $push: {
          editorProposals: {
            version,
            editor: req.user.id,
            status: 'pending',
            baseline,
            proposal,
            proposedAt: now,
          },
        },
      },
      { new: true }
    ).select('+editorProposals');

    if (!updated) {
      return res.status(409).json({ error: PENDING_PROPOSAL_MESSAGE });
    }

    res.json({
      message: 'Editor proposal saved. The writer has been emailed to accept or reject the changes.',
      blog: updated,
    });

    // 🟢 NON-BLOCKING ASYNC TASKS: email the writer and record the audit entry after responding
    setImmediate(async () => {
      try {
        const editor = await User.findById(req.user.id).select('firstName lastName username');
        const editorName =
          [editor?.firstName, editor?.lastName].filter(Boolean).join(' ') || editor?.username || 'An editor';

        const writers = await User.find({
          _id: { $in: [updated.originalAuthor, updated.author] },
        }).select('email firstName');

        const changeLabels = summarizeChanges(changes);
        const reviewLink = `${process.env.FRONTEND_URL}/dashboard/my-submissions`;

        await Promise.allSettled(
          writers
            .filter((writer) => writer.email)
            .map((writer) =>
              sendEditorProposalEmail(writer.email, writer.firstName, updated.title, {
                editorName,
                changeLabels,
                reviewLink,
              })
            )
        );

        writeAuditLog({
          req,
          action: 'blog.editor_proposal',
          targetModel: 'Blog',
          targetId: updated._id,
          targetLabel: updated.title,
          detail: { version, changes: changeLabels },
        });
      } catch (asyncErr) {
        console.error('Non-blocking editor proposal email/audit failed:', asyncErr);
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/editor/blogs/:id/revisions
 * Editor sees every proposal with its decision, plus what changed since the last proposal
 * (the current submitted story compared with the last proposed version).
 */
exports.getEditorRevisions = async (req, res, next) => {
  try {
    const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false })
      .select('+editorProposals title tag excerpt img imgPublicId bodyHtml blocks status publishConsentStatus')
      .lean();

    if (!blog) return res.status(404).json({ error: 'Article not found' });

    const current = snapshotOf(blog);
    const proposals = await withEditorNames(blog.editorProposals || []);
    const latest = proposals[proposals.length - 1];

    res.json({
      status: blog.status,
      publishConsentStatus: blog.publishConsentStatus,
      current,
      changesSinceLastProposal: latest ? diffSnapshots(latest.proposal, current) : [],
      proposals: proposals.map((record) => ({
        version: record.version,
        status: record.status,
        editor: record.editor,
        proposedAt: record.proposedAt,
        decidedAt: record.decidedAt,
        decisionNote: record.decisionNote,
        changes: diffSnapshots(record.baseline, record.proposal),
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/contributor/blogs/:id/editor-revision
 * Writer compares the editor's latest proposal with the version it was based on.
 */
exports.getEditorRevisionForWriter = async (req, res, next) => {
  try {
    const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false })
      .select('+editorProposals originalAuthor author status publishConsentStatus editorModifications');

    if (!blog) return res.status(404).json({ error: 'Blog not found' });
    if (!isWriterOf(blog, req.user.id)) {
      return res.status(403).json({ error: 'You can only view revisions of your own blog.' });
    }

    const latest = blog.editorProposals[blog.editorProposals.length - 1];
    if (!latest) {
      return res.status(404).json({ error: 'No editor revision exists for this blog.' });
    }
    const [latestWithEditor] = await withEditorNames([latest.toObject()]);

    res.json({
      status: blog.status,
      publishConsentStatus: blog.publishConsentStatus,
      pending: blog.publishConsentStatus === 'pending' && Boolean(blog.editorModifications),
      version: latest.version,
      recordStatus: latest.status,
      editor: latestWithEditor.editor,
      proposedAt: latest.proposedAt,
      decidedAt: latest.decidedAt,
      decisionNote: latest.decisionNote,
      baseline: latest.baseline,
      proposal: latest.proposal,
      changes: diffSnapshots(latest.baseline, latest.proposal),
    });
  } catch (error) {
    next(error);
  }
};
