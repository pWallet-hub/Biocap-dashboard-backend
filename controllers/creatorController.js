const mongoose = require('mongoose');
const User = require('../models/User');
const Blog = require('../models/Blog');
const Notification = require('../models/Notification');
const { parsePagination, paginatedResponse } = require('../utils/pagination');
const { writeAuditLog } = require('../utils/auditLogger');

/**
 * GET /api/contributor/profile
 * Get creator profile and blog status metrics
 */
exports.getMyProfile = async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.user._id);

  const [user, stats] = await Promise.all([
    User.findById(userId).select('-password'),
    Blog.aggregate([
      {
        $match: {
          originalAuthor: userId,
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          draft: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
          pending_review: {
            $sum: { $cond: [{ $eq: ['$status', 'pending_review'] }, 1, 0] },
          },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          published: { $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  if (!user) {
    return res.status(404).json({ error: 'User profile not found' });
  }

  const blogStats = stats[0] || {
    total: 0,
    draft: 0,
    pending_review: 0,
    approved: 0,
    published: 0,
    rejected: 0,
  };

  res.json({
    user,
    blogStats,
  });
};

/**
 * GET /api/contributor/activity
 * Get creator's recent activity & total view counts
 */
exports.getMyActivity = async (req, res) => {
  const recentBlogs = await Blog.find({
    originalAuthor: req.user._id,
    isDeleted: false,
  })
    .select('title status views createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(10);

  const totalViews = recentBlogs.reduce((sum, b) => sum + (b.views || 0), 0);

  res.json({
    totalViews,
    recentBlogs,
  });
};

/**
 * GET /api/contributor/my-blogs
 * Get list of creator's personal blogs with search and filtering
 */
exports.getMyBlogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { originalAuthor: req.user._id, isDeleted: false };

  if (req.query.status) {
    filter.status = req.query.status;
  }

  if (req.query.search?.trim()) {
    const term = req.query.search.trim();
    filter.$or = [
      { title: { $regex: term, $options: 'i' } },
      { tag: { $regex: term, $options: 'i' } },
    ];
  }

  const [blogs, total] = await Promise.all([
    Blog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Blog.countDocuments(filter),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

/**
 * GET /api/contributor/my-blogs/:id
 * Get detail of creator's single blog
 */
exports.getMyBlogById = async (req, res) => {
  const blog = await Blog.findOne({
    _id: req.params.id,
    originalAuthor: req.user._id,
    isDeleted: false,
  });

  if (!blog) {
    return res.status(404).json({ error: 'Blog post not found' });
  }

  res.json(blog);
};

/**
 * GET /api/contributor/published
 * Public published feed for creators to view
 */
exports.getPublishedFeed = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { status: 'published', isDeleted: false };

  const [blogs, total] = await Promise.all([
    Blog.find(filter).sort({ publishedAt: -1 }).skip(skip).limit(limit),
    Blog.countDocuments(filter),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

/**
 * GET /api/contributor/published/:slug
 * Get single published blog by slug
 */
exports.getPublishedBlogBySlug = async (req, res) => {
  const blog = await Blog.findOne({
    slug: req.params.slug,
    status: 'published',
    isDeleted: false,
  });

  if (!blog) {
    return res.status(404).json({ error: 'Published blog post not found' });
  }

  res.json(blog);
};

/**
 * PATCH /api/contributor/blogs/:id/change-implemented
 * Mark a requested change as implemented by the creator.
 */
exports.markChangeImplemented = async (req, res) => {
  const { implementationNote, changeId } = req.body || {};

  const blog = await Blog.findOne({ _id: req.params.id, originalAuthor: req.user._id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  if (!blog.changeRequests || blog.changeRequests.length === 0) {
    return res.status(400).json({ error: 'No change requests exist for this article' });
  }

  let change = null;
  if (changeId) {
    change = blog.changeRequests.id(changeId);
  } else {
    change = blog.changeRequests.find((c) => !c.implemented);
  }

  if (!change) {
    return res.status(400).json({ error: 'No pending change request found to mark implemented' });
  }

  change.implemented = true;
  change.implementedBy = req.user._id;
  change.implementedAt = new Date();
  if (implementationNote && implementationNote.trim()) change.implementationNote = implementationNote.trim();

  await blog.save();

  // Notify the original requester (reviewer/editor/admin) that the change was implemented
  if (Notification && change.commenter) {
    try {
      await Notification.create({
        recipient: change.commenter,
        sender: req.user._id,
        type: 'CHANGE_REQUEST_IMPLEMENTED',
        message: `${req.user.firstName || req.user.username} marked requested change implemented on "${blog.title}"`,
        article: blog._id,
      });
    } catch (err) {
      console.error('Failed to create change-implemented notification:', err.message);
    }
  }

  await writeAuditLog({
    req,
    action: 'CHANGE_IMPLEMENTED',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
    detail: { changeId: change._id.toString() },
  });

  res.json({ message: 'Change marked implemented', blog });
};