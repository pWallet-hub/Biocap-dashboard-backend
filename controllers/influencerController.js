const Blog = require('../models/Blog');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { parsePagination, paginatedResponse } = require('../utils/pagination');

/**
 * Controller for Social Media Influencer & Broadcast Media users.
 *
 * These roles can:
 *  ✅ View & manage their own blogs (create, edit draft, submit, delete own draft)
 *  ✅ Track the status of their submissions
 *  ✅ View their own profile and activity stats
 *  ✅ View all published blogs (read-only)
 *  ❌ Cannot see other users' blogs
 *  ❌ Cannot perform any review or moderation actions
 */

// ─── Profile & Stats ──────────────────────────────────────────────────────────

/**
 * GET /api/contributor/profile
 * Returns the current user's full profile with blog stats.
 */
exports.getMyProfile = async (req, res) => {
  const user = await User.findById(req.user.id)
    .select('-password -refreshToken')
    .populate('createdBy', 'username firstName lastName');

  if (!user) return res.status(404).json({ error: 'User not found' });

  const blogStats = await Blog.aggregate([
    { $match: { author: user._id, isDeleted: false } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  const byStatus = Object.fromEntries(blogStats.map((s) => [s._id, s.count]));

  res.json({
    profile: user,
    blogStats: {
      draft: byStatus.draft || 0,
      pending_review: byStatus.pending_review || 0,
      approved: byStatus.approved || 0,
      published: byStatus.published || 0,
      total:
        (byStatus.draft || 0) +
        (byStatus.pending_review || 0) +
        (byStatus.approved || 0) +
        (byStatus.published || 0),
    },
  });
};

/**
 * GET /api/contributor/activity
 * Shows the contributor's recent activity: blog timeline, submission history,
 * views on their published posts, and any profile review notes.
 */
exports.getMyActivity = async (req, res) => {
  const [recentBlogs, publishedStats, auditActions] = await Promise.all([
    // 10 most recently updated blogs (any status)
    Blog.find({ author: req.user.id, isDeleted: false })
      .select('title slug status submittedAt publishedAt views lastRejectionNote createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(10),

    // Total views across all published posts
    Blog.aggregate([
      { $match: { author: require('mongoose').Types.ObjectId.createFromHexString(req.user.id), status: 'published', isDeleted: false } },
      {
        $group: {
          _id: null,
          totalViews: { $sum: '$views' },
          publishedCount: { $sum: 1 },
        },
      },
    ]),

    // Last 10 audit entries where this user was the actor
    AuditLog.find({ actor: req.user.id })
      .sort({ timestamp: -1 })
      .limit(10)
      .select('action targetLabel timestamp detail'),
  ]);

  const stats = publishedStats[0] || { totalViews: 0, publishedCount: 0 };

  // Fetch profile review history from user record
  const user = await User.findById(req.user.id)
    .select('profileReviewStatus lastProfileReviewNote profileReviewHistory loginCount lastLoginAt')
    .populate('profileReviewHistory.reviewer', 'firstName lastName role');

  res.json({
    recentBlogs,
    publishedStats: {
      count: stats.publishedCount,
      totalViews: stats.totalViews,
    },
    profileReview: {
      status: user.profileReviewStatus,
      lastNote: user.lastProfileReviewNote,
      history: user.profileReviewHistory,
    },
    accountActivity: {
      loginCount: user.loginCount,
      lastLoginAt: user.lastLoginAt,
    },
    recentActions: auditActions,
  });
};

/**
 * GET /api/contributor/my-blogs
 * Full list of the contributor's own blogs with pagination and status filter.
 */
exports.getMyBlogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { author: req.user.id, isDeleted: false };

  if (req.query.status) filter.status = req.query.status;
  if (req.query.search?.trim()) {
    filter.$text = { $search: req.query.search.trim() };
  }

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .select('title slug tag excerpt status views submittedAt publishedAt lastRejectionNote createdAt updatedAt img')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit),
    Blog.countDocuments(filter),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

/**
 * GET /api/contributor/my-blogs/:id
 * Single blog detail — only if the current user is the author.
 */
exports.getMyBlogById = async (req, res) => {
  const blog = await Blog.findOne({
    _id: req.params.id,
    author: req.user.id,
    isDeleted: false,
  }).populate('reviewHistory.reviewer', 'firstName lastName role');

  if (!blog) return res.status(404).json({ error: 'Blog not found or not yours' });
  res.json(blog);
};

/**
 * GET /api/contributor/published
 * All published blogs across the platform — read-only public feed for contributors.
 * Useful for contributors to see what has been published and get inspiration.
 */
exports.getPublishedFeed = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { status: 'published', isDeleted: false };

  if (req.query.tag) filter.tag = { $regex: req.query.tag.trim(), $options: 'i' };
  if (req.query.search?.trim()) filter.$text = { $search: req.query.search.trim() };

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('title slug tag excerpt img views publishedAt authorRole socialHandle organizationLink')
      .populate('author', 'firstName lastName username'),
    Blog.countDocuments(filter),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

/**
 * GET /api/contributor/published/:slug
 * Single published blog post by slug.
 */
exports.getPublishedBlogBySlug = async (req, res) => {
  const blog = await Blog.findOneAndUpdate(
    { slug: req.params.slug, status: 'published', isDeleted: false },
    { $inc: { views: 1 } },
    { new: true }
  ).populate('author', 'firstName lastName username socialHandle organization organizationLink');

  if (!blog) return res.status(404).json({ error: 'Blog not found' });
  res.json(blog);
};
