const Blog = require('../models/Blog');
const User = require('../models/User');
const Notification = require('../models/Notification'); // Ensure Notification model exists
const { parsePagination, paginatedResponse } = require('../utils/pagination');
const { writeAuditLog } = require('../utils/auditLogger');
const { ROLES, EXTERNAL_CREATORS } = require('../constants/roles');
const mongoose = require('mongoose');

/**
 * GET /api/officer/dashboard
 * Dashboard metrics for Communication Officers
 */
exports.getDashboard = async (req, res) => {
  const userId = mongoose.Types.ObjectId.createFromHexString(req.user.id);

  const [publishedBlogs, unreadNotifications, blogStats] = await Promise.all([
    Blog.countDocuments({ status: 'published', isDeleted: false }),
    Notification ? Notification.countDocuments({ recipient: userId, isRead: false }) : Promise.resolve(0),
    Blog.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const allBlogsByStatus = Object.fromEntries(blogStats.map((s) => [s._id, s.count]));

  res.json({
    publishedArticlesCount: publishedBlogs,
    unreadNotificationsCount: unreadNotifications,
    blogStats: {
      draft: allBlogsByStatus.draft || 0,
      pending_review: allBlogsByStatus.pending_review || 0,
      approved: allBlogsByStatus.approved || 0,
      published: allBlogsByStatus.published || 0,
      total: Object.values(allBlogsByStatus).reduce((a, b) => a + b, 0),
    },
  });
};

/**
 * GET /api/officer/blogs/stats
 * Published and platform-wide metrics
 */
exports.getBlogStats = async (req, res) => {
  const stats = await Blog.aggregate([
    { $match: { isDeleted: false } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const byStatus = Object.fromEntries(stats.map((s) => [s._id, s.count]));

  res.json({
    draft: byStatus.draft || 0,
    pending_review: byStatus.pending_review || 0,
    approved: byStatus.approved || 0,
    published: byStatus.published || 0,
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
  });
};

/**
 * GET /api/officer/published
 * List all live published articles
 */
exports.listPublishedBlogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { status: 'published', isDeleted: false };

  if (req.query.tag) filter.tag = req.query.tag;
  if (req.query.search?.trim()) filter.$text = { $search: req.query.search.trim() };

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('originalAuthor', 'username email role firstName lastName')
      .populate('author', 'username email role firstName lastName')
      .populate('publishedBy', 'username firstName lastName'),
    Blog.countDocuments(filter),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

/**
 * GET /api/officer/published/:id
 * Single published article detail
 */
exports.getPublishedBlogById = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, status: 'published', isDeleted: false })
    .populate('originalAuthor', 'username email role firstName lastName socialHandle organizationLink')
    .populate('author', 'username email role firstName lastName socialHandle organizationLink')
    .populate('publishedBy', 'username firstName lastName')
    .populate('comments.user', 'username firstName lastName role');

  if (!blog) return res.status(404).json({ error: 'Published article not found' });
  res.json(blog);
};

/**
 * GET /api/officer/published/:id/comments
 * Fetch comments on a published article
 */
exports.getArticleComments = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, status: 'published', isDeleted: false })
    .select('comments title')
    .populate('comments.user', 'username firstName lastName role');

  if (!blog) return res.status(404).json({ error: 'Published article not found' });
  res.json(blog.comments || []);
};

/**
 * POST /api/officer/published/:id/comments
 * Add comment to a published article and notify team
 */
exports.addArticleComment = async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Comment content is required' });
  }

  const blog = await Blog.findOne({ _id: req.params.id, status: 'published', isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Published article not found' });

  const newComment = {
    user: req.user.id,
    content: content.trim(),
    createdAt: new Date(),
  };

  if (!blog.comments) blog.comments = [];
  blog.comments.push(newComment);
  await blog.save();

  // Notify Editors and Admins about the comment on the published article
  if (Notification) {
    const reviewers = await User.find({
      role: { $in: [ROLES.EDITOR, ROLES.ADMIN, ROLES.COMMUNICATION_OFFICER] },
      _id: { $ne: req.user.id },
      isActive: true,
    }).select('_id');

    const notificationPayloads = reviewers.map((rev) => ({
      recipient: rev._id,
      sender: req.user.id,
      type: 'ARTICLE_COMMENT',
      message: `Communication Officer commented on published story: "${blog.title}"`,
      article: blog._id,
    }));

    if (notificationPayloads.length > 0) {
      await Notification.insertMany(notificationPayloads);
    }
  }

  await writeAuditLog({
    user: req.user.id,
    action: 'ADD_PUBLISHED_COMMENT',
    resource: 'Blog',
    resourceId: blog._id,
  });

  res.status(201).json({ message: 'Comment posted successfully', comment: newComment });
};

/**
 * GET /api/officer/blogs/:id/editor-changes
 * Inspect edits made by the Editor
 */
exports.getEditorChanges = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false })
    .select('title excerpt blocks editorModifications status updatedAt')
    .populate('author', 'username firstName lastName');

  if (!blog) return res.status(404).json({ error: 'Article not found' });
  res.json(blog);
};

/**
 * PATCH /api/officer/blogs/:id/accept-editor-changes
 * Accept changes made by the Editor
 */
exports.acceptEditorChanges = async (req, res) => {
  const { approvalNote } = req.body;
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });

  if (!blog) return res.status(404).json({ error: 'Article not found' });

  // Apply pending editor modifications if present
  if (blog.editorModifications) {
    if (blog.editorModifications.title) blog.title = blog.editorModifications.title;
    if (blog.editorModifications.excerpt) blog.excerpt = blog.editorModifications.excerpt;
    if (blog.editorModifications.blocks) blog.blocks = blog.editorModifications.blocks;
    blog.editorModifications = undefined;
  }

  blog.officerAcceptedChanges = true;
  blog.officerApprovalNote = approvalNote || undefined;
  await blog.save();

  await writeAuditLog({
    user: req.user.id,
    action: 'ACCEPT_EDITOR_CHANGES',
    resource: 'Blog',
    resourceId: blog._id,
  });

  res.json({ message: 'Editor changes accepted successfully', blog });
};

/**
 * GET /api/officer/notifications
 * Fetch officer notifications
 */
exports.getOfficerNotifications = async (req, res) => {
  if (!Notification) return res.json([]);
  const notifications = await Notification.find({ recipient: req.user.id })
    .sort({ createdAt: -1 })
    .populate('sender', 'username firstName lastName role')
    .populate('article', 'title slug');

  res.json(notifications);
};

/**
 * PATCH /api/officer/notifications/:id/read
 * Mark notification as read
 */
exports.markNotificationRead = async (req, res) => {
  if (!Notification) return res.json({ message: 'Notification marked read' });

  await Notification.updateOne(
    { _id: req.params.id, recipient: req.user.id },
    { $set: { isRead: true } }
  );

  res.json({ message: 'Notification marked read' });
};