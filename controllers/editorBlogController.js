const Blog = require('../models/Blog');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { writeAuditLog } = require('../utils/auditLogger');
const { ROLES } = require('../constants/roles');

/**
 * PUT /api/editor/blogs/:id
 * Editor updates an article — saves modifications and alerts Communication Officers to accept changes.
 */
const { htmlToBlocks } = require('../utils/htmlToBlocks');

exports.updateBlogByEditor = async (req, res) => {
  const { id } = req.params;
  const { title, excerpt, blocks, tag, bodyHtml } = req.body;

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

  // Handle uploaded cover image file if present in multipart request
  let updatedImg = blog.img;
  if (req.files && req.files.img && req.files.img[0]) {
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
    bodyHtml: typeof bodyHtml === 'string' ? bodyHtml : '',
    modifiedAt: new Date(),
  };

  // Flag that changes require Communication Officer acceptance
  blog.officerAcceptedChanges = false;

  // Update minor fields directly if provided
  if (tag) {
    blog.tag = tag.trim();
  }

  await blog.save();

  // 2. Query all active Communication Officers
  const communicationOfficers = await User.find({
    role: ROLES.COMMUNICATION_OFFICER,
    isActive: true,
  }).select('_id');

  // 3. Dispatch notifications to all Communication Officers
  if (Notification && communicationOfficers.length > 0) {
    const notifications = communicationOfficers.map((officer) => ({
      recipient: officer._id,
      sender: req.user.id,
      type: 'EDITOR_EDIT_PROMPT',
      message: `Editor ${req.user.firstName || req.user.username} made changes to the article "${blog.title}". Please review and accept changes.`,
      article: blog._id,
    }));

    await Notification.insertMany(notifications);
  }

  // 4. Log Audit Entry
  await writeAuditLog({
    user: req.user.id,
    action: 'EDITOR_MODIFY_ARTICLE',
    resource: 'Blog',
    resourceId: blog._id,
  });

  res.json({
    message: 'Article updated successfully. Communication Officers have been notified to accept changes.',
    blog,
  });
};