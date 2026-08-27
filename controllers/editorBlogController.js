const Blog = require('../models/Blog');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { writeAuditLog } = require('../utils/auditLogger');
const { ROLES } = require('../constants/roles');
const { htmlToBlocks } = require('../utils/htmlToBlocks');

/**
 * PUT /api/editor/blogs/:id
 * Editor updates an article — saves modifications and alerts Communication Officers asynchronously.
 */
exports.updateBlogByEditor = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, excerpt, blocks, tag, bodyHtml, img, imgPublicId } = req.body;

    const blog = await Blog.findOne({ _id: id, isDeleted: false });
    if (!blog) {
      return res.status(404).json({ error: 'Article not found' });
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

    // 1. Record proposed editor modifications
    blog.editorModifications = {
      editor: req.user.id,
      title: title?.trim() || blog.title,
      excerpt: excerpt?.trim() || blog.excerpt,
      blocks: parsedBlocks,
      img: updatedImg,
      imgPublicId: updatedImgPublicId,
      bodyHtml: typeof bodyHtml === 'string' ? bodyHtml : '',
      modifiedAt: new Date(),
    };

    blog.publishConsentStatus = 'pending';
    blog.publishConsentRequestedAt = new Date();
    blog.publishConsentNote = 'Awaiting writer approval before publishing the editor changes.';
    blog.officerAcceptedChanges = false;

    // Update minor fields directly if provided
    if (tag) {
      blog.tag = tag.trim();
    }

    // Save database state (Critical path)
    await blog.save();

    // 🟢 FAST RESPONSE: Send 200 JSON back to the client immediately (~30ms)
    res.json({
      message: 'Article updated successfully. Communication Officers have been notified to accept changes.',
      blog,
    });

    // 🟢 NON-BLOCKING ASYNC TASKS: Delegate notifications and logging after responding to client
    setImmediate(async () => {
      try {
        const editorName = (await User.findById(req.user.id).select('firstName lastName username')) || {
          firstName: '',
          lastName: '',
          username: req.user.username || 'Editor',
        };
        const editorDisplayName =
          [editorName.firstName, editorName.lastName].filter(Boolean).join(' ') ||
          editorName.username ||
          'Editor';

        // Fetch active Communication Officers
        const communicationOfficers = await User.find({
          role: ROLES.COMMUNICATION_OFFICER,
          isActive: true,
        }).select('_id');

        const tasks = [];

        // Notify original author if defined
        if (blog.originalAuthor && Notification) {
          tasks.push(
            Notification.create({
              recipient: blog.originalAuthor,
              sender: req.user.id,
              type: 'EDITOR_EDIT_PROMPT',
              message: `${editorDisplayName} changed the blog "${blog.title}". Please review the update and confirm whether the article can proceed to publishing.`,
              article: blog._id,
            })
          );
        }

        // Notify all active Communication Officers
        if (Notification && communicationOfficers.length > 0) {
          const notifications = communicationOfficers.map((officer) => ({
            recipient: officer._id,
            sender: req.user.id,
            type: 'EDITOR_EDIT_PROMPT',
            message: `Editor ${editorDisplayName} made changes to the article "${blog.title}". Please review and accept changes.`,
            article: blog._id,
          }));

          tasks.push(Notification.insertMany(notifications));
        }

        // Record audit entry
        tasks.push(
          writeAuditLog({
            user: req.user.id,
            action: 'EDITOR_MODIFY_ARTICLE',
            resource: 'Blog',
            resourceId: blog._id,
          })
        );

        await Promise.allSettled(tasks);
      } catch (asyncErr) {
        console.error('Non-blocking editor update notifications/audit failed:', asyncErr);
      }
    });

  } catch (error) {
    next(error);
  }
};