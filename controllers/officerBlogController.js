const Blog = require('../models/Blog');
const User = require('../models/User');
const { parsePagination, paginatedResponse } = require('../utils/pagination');
const { writeAuditLog } = require('../utils/auditLogger');

/**
 * Officer Blog Controller
 *
 * Communication officers have dedicated blog endpoints that clearly separate their
 * access from the general /api/blogs routes. Officers can:
 *  ✅ List all blogs across all statuses
 *  ✅ View any single blog
 *  ✅ Create and manage their own blogs
 *  ✅ Review (approve/reject) pending blogs
 *  ✅ Unpublish blogs
 *  ❌ Cannot publish blogs (admin-only action)
 *  ❌ Cannot hard-delete or restore blogs
 */

/**
 * GET /api/officer/blogs
 * List all blogs with status/author/search filters.
 */
exports.listBlogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { isDeleted: false };

  if (req.query.status) filter.status = req.query.status;
  if (req.query.author) filter.author = req.query.author;
  if (req.query.search?.trim()) filter.$text = { $search: req.query.search.trim() };

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', 'username email role firstName lastName')
      .populate('publishedBy', 'username firstName lastName')
      .populate('reviewHistory.reviewer', 'username firstName lastName'),
    Blog.countDocuments(filter),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

/**
 * GET /api/officer/blogs/stats
 * Blog counts by status — officer view (all blogs).
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
 * GET /api/officer/blogs/review-queue
 * Blogs awaiting review, ordered oldest-first (FIFO processing).
 */
exports.getReviewQueue = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const [blogs, total] = await Promise.all([
    Blog.find({ status: 'pending_review', isDeleted: false })
      .sort({ submittedAt: 1 }) // Oldest first
      .skip(skip)
      .limit(limit)
      .populate('author', 'username firstName lastName role email profileReviewStatus'),
    Blog.countDocuments({ status: 'pending_review', isDeleted: false }),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

/**
 * GET /api/officer/blogs/:id
 * Full detail of any blog (not deleted).
 */
exports.getBlogById = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false })
    .populate('author', 'username email role firstName lastName socialHandle organization organizationLink profileReviewStatus')
    .populate('publishedBy', 'username firstName lastName')
    .populate('reviewHistory.reviewer', 'username firstName lastName role');

  if (!blog) return res.status(404).json({ error: 'Blog not found' });
  res.json(blog);
};

/**
 * GET /api/officer/dashboard
 * Officer-scoped dashboard: pending blog reviews, user review queue, blog stats.
 */
exports.getDashboard = async (req, res) => {
  const [pendingBlogs, reviewQueue, blogStats, myBlogStats] = await Promise.all([
    Blog.countDocuments({ status: 'pending_review', isDeleted: false }),
    User.countDocuments({
      role: { $in: ['broadcast_media', 'social_media_influencer'] },
      profileReviewStatus: { $in: ['pending', 'needs_attention'] },
      isActive: true,
    }),
    Blog.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    // Officer's own blog stats
    Blog.aggregate([
      { $match: { author: require('mongoose').Types.ObjectId.createFromHexString(req.user.id), isDeleted: false } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const allBlogsByStatus = Object.fromEntries(blogStats.map((s) => [s._id, s.count]));
  const myBlogsByStatus = Object.fromEntries(myBlogStats.map((s) => [s._id, s.count]));

  res.json({
    pendingBlogReviews: pendingBlogs,
    pendingUserReviews: reviewQueue,
    allBlogs: allBlogsByStatus,
    myBlogs: myBlogsByStatus,
  });
};
