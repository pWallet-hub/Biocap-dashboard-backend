const Blog = require('../models/Blog');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { writeAuditLog } = require('../utils/auditLogger');
const { ROLES } = require('../constants/roles');

/**
 * PUT /api/editor/blogs/:id
 * Editor updates an article — saves modifications and alerts Communication Officers to accept changes.
 */
exports.updateBlogByEditor = async (req, res) => {
  const { id } = req.params;
  const { title, excerpt, blocks, tag } = req.body;

  const blog = await Blog.findOne({ _id: id, isDeleted: false });
  if (!blog) {
    return res.status(404).json({ error: 'Article not found' });
  }

  // 1. Record proposed editor modifications
  blog.editorModifications = {
    editor: req.user.id,
    title: title?.trim() || blog.title,
    excerpt: excerpt?.trim() || blog.excerpt,
    blocks: blocks ? (typeof blocks === 'string' ? JSON.parse(blocks) : blocks) : blog.blocks,
    modifiedAt: new Date(),
  };

  // Flag that changes require Communication Officer acceptance
  blog.officerAcceptedChanges = false;

  // Update minor fields if provided directly
  if (tag) blog.tag = tag.trim();

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