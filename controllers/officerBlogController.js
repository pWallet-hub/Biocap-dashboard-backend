const Blog = require('../models/Blog');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { parsePagination, paginatedResponse } = require('../utils/pagination');
const { writeAuditLog } = require('../utils/auditLogger');
const { ROLES } = require('../constants/roles');
const mongoose = require('mongoose');

/**
 * GET /api/officer/dashboard or /api/editor/blogs/stats
 * Dashboard metrics for Communication Officers and Editors
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
 * GET /api/officer/blogs/stats or /api/editor/blogs/stats
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
 * GET /api/editor/blogs or /api/officer/blogs
 * List all blogs with status, search, or tag filtering
 */
exports.listBlogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { isDeleted: false };

  if (req.query.status) filter.status = req.query.status;
  if (req.query.tag) filter.tag = req.query.tag;
  if (req.query.search?.trim()) {
    filter.$or = [
      { title: { $regex: req.query.search.trim(), $options: 'i' } },
      { excerpt: { $regex: req.query.search.trim(), $options: 'i' } },
    ];
  }

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .sort({ updatedAt: -1 })
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
 * GET /api/editor/blogs/review-queue
 * Queue of articles pending review ordered oldest-first (FIFO)
 */
exports.getReviewQueue = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { status: 'pending_review', isDeleted: false };

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate('originalAuthor', 'username email role firstName lastName')
      .populate('author', 'username email role firstName lastName'),
    Blog.countDocuments(filter),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

/**
 * GET /api/editor/blogs/:id or /api/officer/blogs/:id
 * Single article detail by ID
 */
exports.getBlogById = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false })
    .populate('originalAuthor', 'username email role firstName lastName socialHandle organizationLink')
    .populate('author', 'username email role firstName lastName socialHandle organizationLink')
    .populate('publishedBy', 'username firstName lastName')
    .populate('comments.user', 'username firstName lastName role');

  if (!blog) return res.status(404).json({ error: 'Article not found' });
  res.json(blog);
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
 * Single published or review article detail
 */
exports.getPublishedBlogById = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false })
    .populate('originalAuthor', 'username email role firstName lastName socialHandle organizationLink')
    .populate('author', 'username email role firstName lastName socialHandle organizationLink')
    .populate('publishedBy', 'username firstName lastName')
    .populate('comments.user', 'username firstName lastName role');

  if (!blog) return res.status(404).json({ error: 'Article not found' });
  res.json(blog);
};

/**
 * 🟢 GET /api/officer/published/:id/comments
 * Fetch internal review notes and comments for an article
 */
exports.getArticleComments = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false })
    .select('comments title')
    .populate('comments.user', 'username firstName lastName role email jobTitle');

  if (!blog) return res.status(404).json({ error: 'Article not found' });

  // Filter out deleted comments
  const activeComments = (blog.comments || []).filter((c) => c && !c.isDeleted);
  res.json(activeComments);
};

/**
 * 🟢 POST /api/officer/published/:id/comments
 * Add an internal review note to an article and alert team
 */
exports.addArticleComment = async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Comment content is required' });
  }

  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Article not found' });

  const authorName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.username;

  const newComment = {
    name: authorName,
    email: req.user.email || '',
    role: req.user.role,
    user: req.user.id || req.user._id,
    content: content.trim(),
    isVisible: true,
    isDeleted: false,
    replies: [],
    createdAt: new Date(),
  };

  if (!blog.comments) blog.comments = [];
  blog.comments.push(newComment);
  await blog.save();

  const createdComment = blog.comments[blog.comments.length - 1];

  // Notify Editors, Admins, and Officers
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
      message: `${authorName} (${req.user.role}) added a review note on story: "${blog.title}"`,
      article: blog._id,
    }));

    if (notificationPayloads.length > 0) {
      await Notification.insertMany(notificationPayloads);
    }
  }

  writeAuditLog({
    req,
    action: 'blog.comment_add',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.status(201).json({ message: 'Comment posted successfully', comment: createdComment });
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
 * Accept changes made by the Editor and apply them to the article
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
    if (blog.editorModifications.img) blog.img = blog.editorModifications.img;
    blog.editorModifications = undefined;
  }

  blog.officerAcceptedChanges = true;
  blog.officerApprovalNote = approvalNote || undefined;
  await blog.save();

  // Mark related EDITOR_EDIT_PROMPT notifications as read for this officer
  if (Notification) {
    await Notification.updateMany(
      { recipient: req.user.id, article: blog._id, type: 'EDITOR_EDIT_PROMPT' },
      { $set: { isRead: true } }
    );
  }

  writeAuditLog({
    req,
    action: 'blog.accept_editor_changes',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
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