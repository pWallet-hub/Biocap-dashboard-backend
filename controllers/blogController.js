const Blog = require('../models/Blog');
const User = require('../models/User');
const Notification = require('../models/Notification');
const cloudinary = require('../config/cloudinary');
const blogEventBus = require('../config/eventBus');
const { REVIEWERS, CREATORS, isReviewer, ROLES } = require('../constants/roles');
const { parsePagination, paginatedResponse } = require('../utils/pagination');
const { generateSlug } = require('../utils/slugify');
const { writeAuditLog } = require('../utils/auditLogger');
const {
  sendBlogApprovalEmail,
  sendBlogRejectionEmail,
  sendBlogPublishedEmail,
  sendEditorProposalDecisionEmail,
} = require('../utils/sendEmail');
const { htmlToBlocks } = require('../utils/htmlToBlocks');
const { cacheGet, cacheSet, cacheDel } = require('../utils/cache');
const { diffSnapshots, summarizeChanges, canDecideProposal, buildConsentDecision } = require('../utils/editorProposal');
const { notifyUsers, notifyUsersByRole } = require('../utils/notify');

// Public news list cache (page 1, no filters). Kept in process memory for a short time.
const PUBLIC_CACHE_KEY = 'cache:public-blogs:page1';
const PUBLIC_CACHE_TTL_SECONDS = 60;

const invalidatePublicBlogsCache = () => cacheDel(PUBLIC_CACHE_KEY);

/**
 * Map uploaded files (req.files.images) into blocks or excerptBlocks.
 */
const applyUploadedImagesToBlocks = (blocks = [], uploadedFiles = []) => {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks;
  if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) return blocks;

  const byOriginalName = new Map();
  uploadedFiles.forEach((f) => {
    if (f.originalname) byOriginalName.set(f.originalname, f);
  });

  let fileIndex = 0;

  return blocks.map((blk) => {
    if (!blk || typeof blk !== 'object') return blk;

    if (blk.type === 'image' || blk.type === 'hero' || blk.type === 'embed' || blk.type === 'html') {
      const fileKey = blk.fileKey || blk.uploadKey || blk.src || blk.source;
      let matched = null;

      if (fileKey && byOriginalName.has(fileKey)) {
        matched = byOriginalName.get(fileKey);
      } else if (blk.src && byOriginalName.has(blk.src)) {
        matched = byOriginalName.get(blk.src);
      }

      if (!matched && uploadedFiles[fileIndex]) {
        matched = uploadedFiles[fileIndex];
      }

      if (matched) {
        fileIndex++;
        const newBlk = { ...blk };
        newBlk.src = matched.path || matched.location || matched.url || matched.secure_url || blk.src;
        newBlk.source = matched.filename || matched.public_id || matched.key || newBlk.source;
        return newBlk;
      }
    }

    return blk;
  });
};

// ─── Private Helpers ──────────────────────────────────────────────────────────

const destroyAsset = (publicId, resourceType = 'image') => {
  if (!publicId) return;
  cloudinary.uploader
    .destroy(publicId, { resource_type: resourceType })
    .catch((err) => console.error(`Failed to remove Cloudinary asset (${resourceType}):`, err.message));
};

const buildBlogFilter = (query, user) => {
  const filter = { isDeleted: false };

  if (!isReviewer(user.role)) {
    filter.$or = [{ originalAuthor: user.id }, { author: user.id }];
  }

  if (query.status) filter.status = query.status;
  if (query.author && isReviewer(user.role)) filter.author = query.author;

  if (query.search?.trim()) {
    filter.$text = { $search: query.search.trim() };
  }

  return filter;
};

const findCommentById = (blog, commentId) => {
  if (!blog || !commentId) return null;

  const direct = blog.comments?.find((comment) => comment._id.toString() === commentId.toString());
  if (direct) return { comment: direct, parent: null };

  for (const comment of blog.comments || []) {
    const nested = (comment.replies || []).find((reply) => reply._id.toString() === commentId.toString());
    if (nested) return { comment: nested, parent: comment };
  }

  return null;
};

// ─── Public Endpoints (No Auth Required) ───────────────────────────────────────

exports.getPublicBlogs = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const cacheable = !req.query.tag && !req.query.search && page === 1;

    if (cacheable) {
      const cached = await cacheGet(PUBLIC_CACHE_KEY);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }
    }

    const filter = { status: 'published', isDeleted: false };
    if (req.query.tag) filter.tag = { $regex: req.query.tag.trim(), $options: 'i' };
    if (req.query.search?.trim()) filter.$text = { $search: req.query.search.trim() };

    const [blogs, total] = await Promise.all([
      Blog.find(filter)
        .select('title slug img tag excerpt views documentUrl documentName publishedAt originalAuthor author socialHandle organizationLink')
        .sort({ publishedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('originalAuthor', 'firstName lastName username jobTitle socialHandle organizationLink organization')
        .populate('author', 'firstName lastName username jobTitle socialHandle organizationLink organization')
        .lean(),
      Blog.countDocuments(filter),
    ]);

    const formatted = blogs.map((b) => {
      const creator = b.originalAuthor || b.author;
      const authorName = creator ? `${creator.firstName || ''} ${creator.lastName || ''}`.trim() || creator.username : 'Contributor';
      const publishedDate = b.publishedAt ? new Date(b.publishedAt).toLocaleDateString('en-GB') : '';

      return {
        _id: b._id,
        slug: b.slug,
        title: b.title,
        img: b.img,
        tag: b.tag,
        excerpt: b.excerpt,
        views: b.views,
        documentUrl: b.documentUrl || null,
        documentName: b.documentName || null,
        originalAuthor: creator,
        publishedWith: `${authorName} on ${publishedDate}`,
        link: b.originalAuthorRole === ROLES.BROADCAST_CONTENT_CREATOR 
          ? (b.organizationLink || creator?.organizationLink) 
          : (b.socialHandle || creator?.socialHandle),
        publishedAt: b.publishedAt,
      };
    });

    const responsePayload = paginatedResponse(formatted, total, { page, limit });

    if (cacheable) {
      await cacheSet(PUBLIC_CACHE_KEY, responsePayload, PUBLIC_CACHE_TTL_SECONDS);
    }

    res.setHeader('X-Cache', 'MISS');
    res.json(responsePayload);
  } catch (error) {
    next(error);
  }
};

exports.getPublicBlogBySlug = async (req, res, next) => {
  try {
    const blog = await Blog.findOneAndUpdate(
      { slug: req.params.slug, status: 'published', isDeleted: false },
      { $inc: { views: 1 } },
      { returnDocument: 'after' }
    )
      .populate('originalAuthor', 'firstName lastName username jobTitle socialHandle organization organizationLink')
      .populate('author', 'firstName lastName username jobTitle socialHandle organization organizationLink')
      .populate('comments.user', 'firstName lastName username email role jobTitle')
      .populate('comments.replies.user', 'firstName lastName username email role jobTitle')
      .lean();

    if (!blog) return res.status(404).json({ error: 'Blog not found' });

    if (blog.author && blog.originalAuthor && blog.author._id.toString() !== blog.originalAuthor._id.toString()) {
      delete blog.author;
    }

    blog.comments = (blog.comments || [])
      .filter((comment) => comment && !comment.isDeleted && comment.isVisible !== false)
      .map((comment) => ({
        ...comment,
        replies: (comment.replies || []).filter((reply) => !reply.isDeleted && reply.isVisible !== false),
      }));

    res.json(blog);
  } catch (error) {
    next(error);
  }
};

/**
 * 🟢 PUBLIC AUDIENCE COMMENTS (For website visitors on published articles)
 */
exports.addPublicComment = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { name, email, phone, content, parentComment } = req.body || {};

    if (!name?.trim() || !email?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'Name, email, and comment content are required.' });
    }

    const blog = await Blog.findOne({ slug, status: 'published', isDeleted: false });
    if (!blog) return res.status(404).json({ error: 'Blog not found' });

    const payload = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone?.trim() || '',
      role: req.user?.role || 'guest',
      user: req.user?.id || null,
      content: content.trim(),
      parentComment: parentComment || null,
      isVisible: true,
      isDeleted: false,
      replies: [],
      createdAt: new Date(),
    };

    if (parentComment) {
      const target = findCommentById(blog, parentComment);
      if (!target) {
        return res.status(404).json({ error: 'Parent comment not found' });
      }

      if (target.parent) {
        target.parent.replies.push(payload);
      } else {
        target.comment.replies.push(payload);
      }
    } else {
      blog.comments.push(payload);
    }

    await blog.save();

    res.status(201).json({ message: 'Comment added successfully', comment: parentComment ? payload : blog.comments[blog.comments.length - 1] });

    setImmediate(async () => {
      try {
        const reviewers = await User.find({ role: { $in: [ROLES.ADMIN, ROLES.COMMUNICATION_OFFICER, ROLES.EDITOR] }, isActive: true })
          .select('_id')
          .lean();

        if (reviewers.length > 0) {
          const notifications = reviewers.map((reviewer) => ({
            recipient: reviewer._id,
            sender: req.user?._id || null,
            type: 'ARTICLE_COMMENT',
            message: `New public comment on "${blog.title}" from ${payload.name}.`,
            article: blog._id,
          }));
          await Notification.insertMany(notifications);
        }
      } catch (asyncErr) {
        console.error('Comment notification failed:', asyncErr.message);
      }
    });

  } catch (error) {
    next(error);
  }
};

// ─── Internal Editorial Review Notes & Revision Discussions ─────────────────

/**
 * GET /api/blogs/public/:slug/comments
 * Visible comments on a published article, with their visible replies.
 * Only the commenter's name is returned. Email and phone are never exposed.
 */
exports.getPublicComments = async (req, res, next) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug, status: 'published', isDeleted: false })
      .select('comments')
      .lean();
    if (!blog) return res.status(404).json({ error: 'Blog not found' });

    const shape = (comment) => ({
      _id: comment._id,
      name: comment.name || 'Guest',
      content: comment.content,
      parentComment: comment.parentComment || null,
      createdAt: comment.createdAt,
    });

    const visible = (comments = []) => comments.filter((c) => c.isVisible !== false && !c.isDeleted);

    const comments = visible(blog.comments).map((comment) => ({
      ...shape(comment),
      replies: visible(comment.replies).map(shape),
    }));

    res.json({ count: comments.length, comments });
  } catch (error) {
    next(error);
  }
};

/**
 * 🟢 GET INTERNAL ARTICLE COMMENTS / REVISION NOTES
 * Allows Editors, Officers, Admins, and story authors/creators to view review notes.
 */
exports.getArticleComments = async (req, res, next) => {
  try {
    const blogId = req.params.articleId || req.params.id;
    const blog = await Blog.findOne({ _id: blogId, isDeleted: false })
      .populate('comments.user', 'firstName lastName username email role jobTitle')
      .populate('comments.replies.user', 'firstName lastName username email role jobTitle')
      .lean();

    if (!blog) return res.status(404).json({ error: 'Blog not found' });

    const isOwner =
      (blog.originalAuthor && blog.originalAuthor.toString() === req.user.id) ||
      (blog.author && blog.author.toString() === req.user.id);

    if (!isReviewer(req.user.role) && !isOwner) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions to view review notes.' });
    }

    const activeComments = (blog.comments || []).filter((c) => c && !c.isDeleted);
    res.json(activeComments);
  } catch (error) {
    next(error);
  }
};

/**
 * 🟢 POST INTERNAL REVISION NOTE / EDITORIAL DISCUSSION
 * Allows reviewers or authors to communicate change requests before publishing.
 */
exports.addInternalReviewNote = async (req, res, next) => {
  try {
    const blogId = req.params.articleId || req.params.id;
    const { content } = req.body || {};

    if (!content?.trim()) {
      return res.status(400).json({ error: 'Note content is required.' });
    }

    const blog = await Blog.findOne({ _id: blogId, isDeleted: false });
    if (!blog) return res.status(404).json({ error: 'Blog not found' });

    const isOwner =
      (blog.originalAuthor && blog.originalAuthor.toString() === req.user.id) ||
      (blog.author && blog.author.toString() === req.user.id);

    if (!isReviewer(req.user.role) && !isOwner) {
      return res.status(403).json({ error: 'Forbidden: Cannot post internal notes on this story.' });
    }

    const notePayload = {
      name: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.username,
      email: req.user.email,
      role: req.user.role,
      user: req.user.id,
      content: content.trim(),
      isVisible: true,
      isDeleted: false,
      replies: [],
      createdAt: new Date(),
    };

    blog.comments.push(notePayload);
    await blog.save();

    const createdNote = blog.comments[blog.comments.length - 1];
    res.status(201).json({ message: 'Internal review note added successfully', comment: createdNote });
  } catch (error) {
    next(error);
  }
};

/**
 * 🟢 MARK CHANGE REQUEST AS IMPLEMENTED (Fixes 404 Error on Mark Button)
 */
exports.markChangeImplemented = async (req, res, next) => {
  try {
    const { changeId, implementationNote } = req.body || {};
    const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });

    if (!blog) {
      return res.status(404).json({ error: 'Blog story not found' });
    }

    const isOwner =
      (blog.originalAuthor && blog.originalAuthor.toString() === req.user.id) ||
      (blog.author && blog.author.toString() === req.user.id);

    if (!isReviewer(req.user.role) && !isOwner) {
      return res.status(403).json({ error: 'Forbidden: You can only update your own story changes.' });
    }

    // Search and update changeRequests array
    if (Array.isArray(blog.changeRequests) && blog.changeRequests.length > 0) {
      if (changeId) {
        const item = blog.changeRequests.id(changeId);
        if (item) {
          item.implemented = true;
          item.implementedAt = new Date();
          if (implementationNote) item.implementationNote = implementationNote;
        }
      } else {
        // Fallback: Mark latest open change request as implemented
        const lastIdx = blog.changeRequests.length - 1;
        blog.changeRequests[lastIdx].implemented = true;
        blog.changeRequests[lastIdx].implementedAt = new Date();
        if (implementationNote) {
          blog.changeRequests[lastIdx].implementationNote = implementationNote;
        }
      }
    }

    await blog.save();

    writeAuditLog({
      req,
      action: 'blog.mark_change_implemented',
      targetModel: 'Blog',
      targetId: blog._id,
      targetLabel: blog.title,
    });

    res.json({
      message: 'Change request marked as implemented successfully',
      blog,
    });
  } catch (error) {
    next(error);
  }
};

// ─── Comment Moderation Endpoints ─────────────────────────────────────────────

exports.hideComment = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const target = findCommentById(blog, req.params.commentId);
  if (!target) return res.status(404).json({ error: 'Comment not found' });

  const comment = target.comment;
  comment.isVisible = false;
  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.comment_hide',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json({ message: 'Comment hidden successfully', comment });
};

exports.unhideComment = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const target = findCommentById(blog, req.params.commentId);
  if (!target) return res.status(404).json({ error: 'Comment not found' });

  const comment = target.comment;
  comment.isVisible = true;
  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.comment_unhide',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json({ message: 'Comment unhidden successfully', comment });
};

exports.deleteComment = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const target = findCommentById(blog, req.params.commentId);
  if (!target) return res.status(404).json({ error: 'Comment not found' });

  const comment = target.comment;
  comment.isDeleted = true;
  comment.isVisible = false;
  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.comment_delete',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json({ message: 'Comment deleted successfully' });
};

/**
 * PATCH /api/blogs/:id/consent (and /api/contributor/blogs/:id/consent)
 * Writer accepts or rejects the editor's pending proposal.
 * Accept applies the proposal and moves the story to approved (publisher step next).
 * Reject returns the story to draft. Either way the proposal is kept in history and the live proposal is cleared.
 */
exports.respondToEditorConsent = async (req, res, next) => {
  try {
    const { approved, note } = req.body || {};

    if (approved === undefined || approved === null || approved === '') {
      return res.status(400).json({ error: 'approved is required' });
    }
    const isApproved = approved === true || approved === 'true';
    const decisionNote = note?.trim() || '';

    const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false })
      .select('+editorProposals')
      .populate('originalAuthor', 'firstName lastName email username jobTitle')
      .populate('author', 'firstName lastName email username jobTitle');

    if (!blog) return res.status(404).json({ error: 'Blog not found' });

    if (blog.publishConsentStatus !== 'pending' || !blog.editorModifications) {
      return res.status(409).json({ error: 'No editor proposal is awaiting a decision.' });
    }

    const proposal = blog.editorModifications.toObject();
    const decision = canDecideProposal({ blog, userId: req.user.id, proposal });
    if (!decision.allowed) {
      return res.status(403).json({ error: decision.reason });
    }

    const now = new Date();
    const { set, unset } = buildConsentDecision({
      proposal,
      approved: isApproved,
      note: decisionNote,
      decidedBy: req.user.id,
      now,
      currentStatus: blog.status,
    });

    // Conditional write: fails if the proposal was already decided or replaced since it was read.
    const updated = await Blog.findOneAndUpdate(
      {
        _id: blog._id,
        isDeleted: false,
        publishConsentStatus: 'pending',
        'editorModifications.modifiedAt': proposal.modifiedAt,
      },
      { $set: set, $unset: unset },
      {
        returnDocument: 'after',
        arrayFilters: [{ 'p.version': proposal.version ?? null, 'p.status': 'pending' }],
      }
    ).select('+editorProposals');

    if (!updated) {
      return res.status(409).json({ error: 'This proposal was already decided or changed. Reload and try again.' });
    }

    res.json({
      message: isApproved
        ? 'Editor changes accepted and applied. The blog is ready for publishing.'
        : 'Editor changes rejected. The blog has been returned to draft.',
      blog: updated,
    });

    setImmediate(async () => {
      try {
        const editorUser = await User.findById(proposal.editor).select('email firstName');
        const writerName =
          [blog.originalAuthor?.firstName, blog.originalAuthor?.lastName].filter(Boolean).join(' ') || 'The writer';

        const record = updated.editorProposals.find((p) => p.version === proposal.version);
        const changeLabels = record ? summarizeChanges(diffSnapshots(record.baseline, record.proposal)) : [];

        await notifyUsers([proposal.editor], {
          type: 'PROPOSAL_DECIDED',
          message: `${writerName} ${isApproved ? 'accepted' : 'rejected'} your changes to "${updated.title}".`,
          article: updated._id,
          sender: req.user.id,
        });

        if (editorUser?.email) {
          await sendEditorProposalDecisionEmail(editorUser.email, editorUser.firstName, updated.title, {
            approved: isApproved,
            writerName,
            note: decisionNote,
            changeLabels,
          });
        }

        writeAuditLog({
          req,
          action: isApproved ? 'blog.editor_changes_accepted' : 'blog.editor_changes_rejected',
          targetModel: 'Blog',
          targetId: blog._id,
          targetLabel: blog.title,
          detail: { version: proposal.version ?? null, note: decisionNote || null },
        });
      } catch (asyncErr) {
        console.error('Non-blocking editor decision email/audit failed:', asyncErr.message);
      }
    });
  } catch (error) {
    next(error);
  }
};

// ─── Authenticated List / Detail ──────────────────────────────────────────────

exports.getBlogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = buildBlogFilter(req.query, req.user);

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .select('-blocks -editorModifications -bodyHtml')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('originalAuthor', 'username email role firstName lastName jobTitle socialHandle organization organizationLink')
      .populate('author', 'username email role firstName lastName jobTitle socialHandle organization organizationLink')
      .populate('publishedBy', 'username firstName lastName jobTitle')
      .populate('reviewHistory.reviewer', 'username firstName lastName jobTitle')
      .populate('changeRequests.commenter', 'username firstName lastName role jobTitle')
      .lean(),
    Blog.countDocuments(filter),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

exports.getMySubmissions = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {
    $or: [{ originalAuthor: req.user.id }, { author: req.user.id }],
    isDeleted: false,
  };
  if (req.query.status) filter.status = req.query.status;

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .select('title slug status lastRejectionNote submittedAt publishedAt views createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Blog.countDocuments(filter),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

exports.getBlogById = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false })
    .populate('originalAuthor', 'username email role firstName lastName jobTitle socialHandle organization organizationLink')
    .populate('author', 'username email role firstName lastName jobTitle socialHandle organization organizationLink')
    .populate('publishedBy', 'username firstName lastName jobTitle')
    .populate('reviewHistory.reviewer', 'username firstName lastName role jobTitle')
    .populate('changeRequests.commenter', 'username firstName lastName role jobTitle')
    .lean();

  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const isOwner =
    (blog.originalAuthor && blog.originalAuthor._id.toString() === req.user.id) ||
    (blog.author && blog.author._id.toString() === req.user.id);

  if (!isReviewer(req.user.role) && !isOwner) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.json(blog);
};

// ─── Blog Statistics ──────────────────────────────────────────────────────────

exports.getBlogStats = async (req, res) => {
  const baseFilter = isReviewer(req.user.role)
    ? { isDeleted: false }
    : { $or: [{ originalAuthor: req.user.id }, { author: req.user.id }], isDeleted: false };

  const [stats, deletedCount] = await Promise.all([
    Blog.aggregate([
      { $match: baseFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    isReviewer(req.user.role) ? Blog.countDocuments({ isDeleted: true }) : Promise.resolve(0),
  ]);

  const byStatus = Object.fromEntries(stats.map((s) => [s._id, s.count]));

  res.json({
    draft: byStatus.draft || 0,
    pending_review: byStatus.pending_review || 0,
    approved: byStatus.approved || 0,
    published: byStatus.published || 0,
    deleted: deletedCount,
    total: (byStatus.draft || 0) + (byStatus.pending_review || 0) + (byStatus.approved || 0) + (byStatus.published || 0),
  });
};

// ─── CRUD Operations ──────────────────────────────────────────────────────────

exports.createBlog = async (req, res) => {
  const imgFile = req.files?.img?.[0];
  const docFile = req.files?.document?.[0];

  const bodyData = req.parsedBody || req.body || {};
  let { title, tag, excerpt, excerptBlocks, socialHandle, organizationLink, modal, blocks, bodyHtml, img: bodyImgUrl } = bodyData;

  const coverImageUrl = imgFile ? imgFile.path : (typeof bodyImgUrl === 'string' && bodyImgUrl.trim() ? bodyImgUrl.trim() : null);

  if (!coverImageUrl) {
    return res.status(400).json({ error: 'A cover image is required' });
  }

  if (typeof blocks === 'string') {
    try { blocks = JSON.parse(blocks); } catch (e) { blocks = []; }
  }
  if (typeof excerptBlocks === 'string') {
    try { excerptBlocks = JSON.parse(excerptBlocks); } catch (e) { excerptBlocks = []; }
  }
  if (typeof modal === 'string') {
    try { modal = JSON.parse(modal); } catch (e) { modal = {}; }
  }

  if (!title || !tag || (!(excerpt && excerpt.trim()) && (!Array.isArray(excerptBlocks) || excerptBlocks.length === 0) && (!Array.isArray(blocks) || blocks.length === 0))) {
    return res.status(400).json({ error: 'title, tag, and at least one of excerpt/excerptBlocks/blocks is required' });
  }

  const author = await User.findById(req.user.id).select('socialHandle organizationLink role jobTitle').lean();
  const slug = await generateSlug(title);

  const imgPublicId = imgFile ? (imgFile.filename || imgFile.public_id || '') : (req.body.imgPublicId || '');
  const docPublicId = docFile ? (docFile.filename || docFile.public_id || '') : (req.body.documentPublicId || '');

  const inlineFiles = req.files?.images || [];
  const finalBlocks = applyUploadedImagesToBlocks(Array.isArray(blocks) ? blocks : [], inlineFiles);
  const finalExcerptBlocks = applyUploadedImagesToBlocks(Array.isArray(excerptBlocks) ? excerptBlocks : [], inlineFiles);

  const blog = await Blog.create({
    title,
    slug,
    tag,
    excerpt,
    excerptBlocks: finalExcerptBlocks || [],
    blocks: finalBlocks || [],
    modal: modal || {},
    socialHandle: socialHandle || author?.socialHandle,
    organizationLink: organizationLink || author?.organizationLink,
    img: coverImageUrl,
    imgPublicId,
    bodyHtml: bodyHtml || '',
    ...(docFile && {
      documentUrl: docFile.path,
      documentPublicId: docPublicId,
      documentName: docFile.originalname,
    }),
    ...(!docFile && req.body.documentUrl && {
      documentUrl: req.body.documentUrl,
      documentPublicId: req.body.documentPublicId || '',
      documentName: req.body.documentName || '',
    }),
    originalAuthor: req.user.id,
    originalAuthorRole: req.user.role,
    author: req.user.id,
    authorRole: req.user.role,
    status: 'draft',
  });

  writeAuditLog({
    req,
    action: 'blog.create',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  if ((!blog.blocks || blog.blocks.length === 0) && bodyHtml) {
    try {
      const parsed = htmlToBlocks(bodyHtml);
      if (parsed && parsed.length) {
        blog.blocks = applyUploadedImagesToBlocks(parsed, req.files?.images || []);
        await blog.save();
      }
    } catch (e) {
      console.error('htmlToBlocks parse failed:', e.message);
    }
  }

  res.status(201).json({ message: 'Created successfully', blog });
};

exports.updateBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  // Editors never change a writer's story directly. Their changes go through PUT /api/editor/blogs/:id
  // as a proposal, which the writer accepts or rejects.
  const isOwnStory = [blog.originalAuthor, blog.author].some((ref) => String(ref) === req.user.id);
  if (req.user.role === ROLES.EDITOR && !isOwnStory) {
    return res.status(403).json({
      error: 'Editors propose changes to a writer\'s story instead of editing it directly.',
    });
  }

  const isReviewerUser = isReviewer(req.user.role);

  if (!isReviewerUser && !blog.canBeEditedBy(req.user)) {
    return res.status(403).json({
      error:
        blog.status === 'published'
          ? 'Published blogs can only be edited by an admin. Unpublish first or contact admin.'
          : `Cannot edit a blog in "${blog.status}" status. Only review actions are available now.`,
    });
  }

  const bodyData = req.parsedBody || req.body || {};
  let { title, tag, excerpt, excerptBlocks, socialHandle, organizationLink, modal, blocks, bodyHtml, img: bodyImgUrl } = bodyData;

  if (typeof blocks === 'string') {
    try { blocks = JSON.parse(blocks); } catch (e) {}
  }
  if (typeof excerptBlocks === 'string') {
    try { excerptBlocks = JSON.parse(excerptBlocks); } catch (e) {}
  }
  if (typeof modal === 'string') {
    try { modal = JSON.parse(modal); } catch (e) {}
  }

  const prevTitle = blog.title;
  if (title) {
    blog.title = title;
    if (title !== prevTitle) {
      blog.slug = await generateSlug(title, blog._id);
    }
  }
  if (tag) blog.tag = tag;
  if (excerpt !== undefined) blog.excerpt = excerpt;
  if (excerptBlocks) blog.excerptBlocks = Array.isArray(excerptBlocks) ? excerptBlocks : blog.excerptBlocks;
  if (socialHandle) blog.socialHandle = socialHandle;
  if (organizationLink) blog.organizationLink = organizationLink;
  if (modal) blog.modal = modal;
  if (blocks) blog.blocks = Array.isArray(blocks) ? blocks : blog.blocks;

  if (typeof bodyHtml === 'string') {
    blog.bodyHtml = bodyHtml;
  }

  // Only the writer's own saves make them the current author. An editor or admin who saves the story never takes it over.
  if (String(blog.originalAuthor) === req.user.id) {
    blog.author = req.user.id;
    blog.authorRole = req.user.role;
  }

  const imgFile = req.files?.img?.[0] || req.file;
  const docFile = req.files?.document?.[0];

  if (imgFile) {
    destroyAsset(blog.imgPublicId, 'image');
    blog.img = imgFile.path;
    blog.imgPublicId = imgFile.filename || imgFile.public_id || '';
  } else if (typeof bodyImgUrl === 'string' && bodyImgUrl.trim()) {
    blog.img = bodyImgUrl.trim();
    if (req.body.imgPublicId) {
      blog.imgPublicId = req.body.imgPublicId;
    }
  }

  if (docFile) {
    destroyAsset(blog.documentPublicId, 'raw');
    blog.documentUrl = docFile.path;
    blog.documentPublicId = docFile.filename || docFile.public_id || '';
    blog.documentName = docFile.originalname;
  } else if (req.body.documentUrl) {
    blog.documentUrl = req.body.documentUrl;
    if (req.body.documentPublicId) blog.documentPublicId = req.body.documentPublicId;
    if (req.body.documentName) blog.documentName = req.body.documentName;
  }

  const inlineFiles = req.files?.images || [];
  if (inlineFiles.length > 0) {
    try {
      blog.blocks = applyUploadedImagesToBlocks(Array.isArray(blog.blocks) ? blog.blocks : [], inlineFiles);
      blog.excerptBlocks = applyUploadedImagesToBlocks(Array.isArray(blog.excerptBlocks) ? blog.excerptBlocks : [], inlineFiles);
    } catch (e) {
      console.error('Failed to apply uploaded inline images:', e.message);
    }
  }

  if ((!blog.blocks || blog.blocks.length === 0) && bodyHtml) {
    try {
      const parsed = htmlToBlocks(bodyHtml);
      if (parsed && parsed.length) blog.blocks = parsed;
    } catch (e) {
      console.error('htmlToBlocks parse failed during update:', e.message);
    }
  }

  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.update',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json({ message: 'Blog updated successfully', blog });
};

exports.deleteBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  if (!blog.canBeDeletedBy(req.user)) {
    return res.status(403).json({
      error:
        blog.status === 'published'
          ? 'Only an admin can delete a published blog'
          : 'You are not permitted to delete this blog',
    });
  }

  blog.isDeleted = true;
  blog.deletedAt = new Date();
  blog.deletedBy = req.user.id;
  await blog.save();

  await invalidatePublicBlogsCache();

  writeAuditLog({
    req,
    action: 'blog.delete',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
    detail: { previousStatus: blog.status },
  });

  res.json({ message: 'Blog removed. It can be restored by an admin.' });
};

exports.restoreBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: true });
  if (!blog) return res.status(404).json({ error: 'Blog not found in trash' });

  blog.isDeleted = false;
  blog.deletedAt = undefined;
  blog.deletedBy = undefined;

  if (blog.status === 'published') blog.status = 'approved';

  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.restore',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json({ message: 'Blog restored successfully', blog });
};

exports.hardDeleteBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: true });
  if (!blog) {
    return res.status(404).json({ error: 'Blog not found in trash. Soft-delete it first.' });
  }

  destroyAsset(blog.imgPublicId, 'image');
  destroyAsset(blog.documentPublicId, 'raw');
  await blog.deleteOne();

  writeAuditLog({
    req,
    action: 'blog.hard_delete',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json({ message: 'Blog permanently deleted' });
};

exports.getDeletedBlogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const [blogs, total] = await Promise.all([
    Blog.find({ isDeleted: true })
      .select('-blocks -editorModifications -bodyHtml')
      .sort({ deletedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('originalAuthor', 'username firstName lastName jobTitle')
      .populate('deletedBy', 'username firstName lastName jobTitle')
      .lean(),
    Blog.countDocuments({ isDeleted: true }),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

// ─── Workflow Actions ──────────────────────────────────────────────────────────

exports.submitBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const isCreator =
    blog.originalAuthor.toString() === req.user.id || blog.author.toString() === req.user.id;
  if (!isCreator) {
    return res.status(403).json({ error: 'You can only submit your own blog' });
  }
  if (blog.status !== 'draft') {
    return res.status(400).json({ error: `Cannot submit a blog in "${blog.status}" status` });
  }

  const wasRejectedBefore = blog.reviewHistory.some((r) => r.decision === 'rejected');

  blog.status = 'pending_review';
  blog.submittedAt = new Date();
  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.submit',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
    detail: { resubmission: wasRejectedBefore },
  });

  notifyUsersByRole([ROLES.EDITOR, ROLES.ADMIN], {
    type: 'STORY_SUBMITTED',
    message: `"${blog.title}" was ${wasRejectedBefore ? 'resubmitted' : 'submitted'} for review.`,
    article: blog._id,
    sender: req.user.id,
  });

  res.json({
    message: wasRejectedBefore ? 'Blog resubmitted for review' : 'Blog submitted for review',
    blog,
  });
};

exports.reviewBlog = async (req, res, next) => {
  try {
    const { decision, note } = req.body;

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
    }
    if (decision === 'rejected' && !note?.trim()) {
      return res.status(400).json({ error: 'A comment explaining the rejection is required' });
    }

    const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false }).populate(
      'originalAuthor',
      'email firstName jobTitle'
    );
    if (!blog) return res.status(404).json({ error: 'Blog not found' });
    if (blog.status !== 'pending_review') {
      return res.status(400).json({ error: 'Blog is not awaiting review' });
    }

    blog.reviewHistory.push({ decision, reviewer: req.user.id, note: note || '' });

    if (decision === 'approved') {
      blog.status = 'approved';
      blog.lastRejectionNote = undefined;
    } else {
      blog.status = 'draft';
      blog.lastRejectionNote = note;
      blog.submittedAt = undefined;
      if (!blog.changeRequests) blog.changeRequests = [];
      blog.changeRequests.push({
        commenter: req.user.id,
        role: req.user.role,
        comment: note,
        requestedAt: new Date(),
        implemented: false,
      });
    }

    await blog.save();

    // Email the author before responding, so a failed send is reported to the reviewer instead of only logged.
    // The decision is already saved, so a failed email does not undo it.
    let authorNotified = false;
    let authorEmailError = null;
    if (blog.originalAuthor?.email) {
      try {
        if (decision === 'approved') {
          await sendBlogApprovalEmail(blog.originalAuthor.email, blog.originalAuthor.firstName, blog.title);
        } else {
          await sendBlogRejectionEmail(blog.originalAuthor.email, blog.originalAuthor.firstName, blog.title, note);
        }
        authorNotified = true;
      } catch (emailErr) {
        authorEmailError = emailErr.message;
        console.error(`Author review email failed for blog ${blog._id}:`, emailErr.message);
      }
    } else {
      authorEmailError = 'The author has no email address on file.';
    }

    const baseMessage =
      decision === 'approved'
        ? 'Blog approved. It now awaits publishing by an authorized publisher.'
        : 'Blog rejected and returned to draft with your comment.';

    res.json({
      message: authorNotified
        ? baseMessage
        : `${baseMessage} The author was not emailed (${authorEmailError}). Please tell them directly.`,
      authorNotified,
      authorEmailError,
      blog,
    });

    setImmediate(async () => {
      try {
        if (decision === 'approved') {
          const officers = await User.find({ role: ROLES.COMMUNICATION_OFFICER, isActive: true }).select('_id').lean();
          const alerts = officers.map((off) => ({
            recipient: off._id,
            sender: req.user.id,
            type: 'BLOG_APPROVED',
            message: `Article "${blog.title}" has been approved and is ready to be published live.`,
            article: blog._id,
          }));
          if (alerts.length > 0) await Notification.insertMany(alerts);
          await notifyUsers([blog.originalAuthor?._id || blog.originalAuthor], {
            type: 'REVIEW_APPROVED',
            message: `"${blog.title}" was approved and is waiting to be published.`,
            article: blog._id,
            sender: req.user.id,
          });
        }

        if (decision === 'rejected' && blog.originalAuthor) {
          await Notification.create({
            recipient: blog.originalAuthor._id || blog.originalAuthor,
            sender: req.user.id,
            type: 'CHANGE_REQUEST',
            message: `Reviewer asked for changes on "${blog.title}": ${note}`,
            article: blog._id,
          });
        }

        writeAuditLog({
          req,
          action: 'blog.review',
          targetModel: 'Blog',
          targetId: blog._id,
          targetLabel: blog.title,
          detail: { decision, note: note || null },
        });
      } catch (asyncErr) {
        console.error('Non-blocking review side-effects error:', asyncErr.message);
      }
    });

  } catch (error) {
    next(error);
  }
};

// 🟢 ATOMIC FAST PUBLISH
exports.publishBlog = async (req, res, next) => {
  try {
    // Editors publish stories. Other roles, including admins, can approve but not put a story live.
    if (req.user.role !== ROLES.EDITOR) {
      return res.status(403).json({ error: 'Only an editor can publish a story.' });
    }
    const existing = await Blog.findOne({ _id: req.params.id, isDeleted: false }).select('status title originalAuthor slug').populate('originalAuthor', 'email firstName');
    if (!existing) return res.status(404).json({ error: 'Blog not found' });
    if (existing.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved blogs can be published' });
    }

    const blog = await Blog.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      {
        $set: {
          status: 'published',
          publishedAt: new Date(),
          publishedBy: req.user.id,
        },
      },
      { returnDocument: 'after' }
    ).select('-blocks -editorModifications -bodyHtml').lean();

    await invalidatePublicBlogsCache();

    res.json({ message: 'Blog is now live on the website', blog });

    setImmediate(async () => {
      try {
        if (existing.originalAuthor?.email) {
          await sendBlogPublishedEmail(existing.originalAuthor.email, existing.originalAuthor.firstName, existing.title, existing.slug);
        }

        writeAuditLog({
          req,
          action: 'blog.publish',
          targetModel: 'Blog',
          targetId: existing._id,
          targetLabel: existing.title,
        });

        blogEventBus.emit('blog:published', { blog: existing, userId: req.user.id });
      } catch (asyncErr) {
        console.error('Non-blocking publish side-effects error:', asyncErr.message);
      }
    });

  } catch (error) {
    next(error);
  }
};

// 🟢 ATOMIC FAST UNPUBLISH
exports.unpublishBlog = async (req, res, next) => {
  try {
    const { note } = req.body;
    const existing = await Blog.findOne({ _id: req.params.id, isDeleted: false }).select('status title author originalAuthor');
    if (!existing) return res.status(404).json({ error: 'Blog not found' });
    if (existing.status !== 'published') {
      return res.status(400).json({ error: 'Only published blogs can be unpublished' });
    }

    const updatePayload = {
      $set: { status: 'approved' },
      $unset: { publishedAt: 1, publishedBy: 1 },
    };

    if (note?.trim()) {
      updatePayload.$push = {
        reviewHistory: {
          decision: 'rejected',
          reviewer: req.user.id,
          note: `Unpublished: ${note.trim()}`,
        },
      };
    }

    const blog = await Blog.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      updatePayload,
      { returnDocument: 'after' }
    ).select('-blocks -editorModifications -bodyHtml').lean();

    await invalidatePublicBlogsCache();

    res.json({
      message: 'Blog removed from the public website. It is back in approved status.',
      blog,
    });

    setImmediate(() => {
      try {
        writeAuditLog({
          req,
          action: 'blog.unpublish',
          targetModel: 'Blog',
          targetId: existing._id,
          targetLabel: existing.title,
          detail: { note: note || null },
        });

        blogEventBus.emit('blog:unpublished', { blog: existing, userId: req.user.id });
      } catch (asyncErr) {
        console.error('Non-blocking unpublish side-effects error:', asyncErr.message);
      }
    });

  } catch (error) {
    next(error);
  }
};

exports.invalidatePublicBlogsCache = invalidatePublicBlogsCache;
exports.REVIEWERS = REVIEWERS;
exports.CREATORS = CREATORS;