const User = require('../models/User');
const Blog = require('../models/Blog');
const { parsePagination, paginatedResponse } = require('../utils/pagination');
const { EXTERNAL_CREATORS, REVIEWERS } = require('../constants/roles');
const { validateUserReview } = require('../middleware/validateUserInput');

const USER_LIST_SELECT = '-password';
const USER_DETAIL_POPULATE = { path: 'createdBy', select: 'username firstName lastName' };

const buildUserListFilter = (query, requesterRole) => {
  const filter = {};

  if (query.role) filter.role = query.role;
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.profileReviewStatus) filter.profileReviewStatus = query.profileReviewStatus;

  // Communication officers review external contributors only — not staff accounts
  if (requesterRole === 'communication_officer') {
    filter.role = { $in: EXTERNAL_CREATORS };
  }

  if (query.search?.trim()) {
    const term = query.search.trim();
    filter.$or = [
      { username: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
      { firstName: { $regex: term, $options: 'i' } },
      { lastName: { $regex: term, $options: 'i' } },
    ];
  }

  return filter;
};

const attachBlogStats = async (users) => {
  const ids = users.map((u) => u._id);
  const stats = await Blog.aggregate([
    { $match: { author: { $in: ids } } },
    {
      $group: {
        _id: '$author',
        total: { $sum: 1 },
        draft: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
        pending_review: { $sum: { $cond: [{ $eq: ['$status', 'pending_review'] }, 1, 0] } },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
        published: { $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } },
      },
    },
  ]);

  const statsMap = Object.fromEntries(stats.map((s) => [s._id.toString(), s]));

  return users.map((user) => {
    const doc = user.toObject ? user.toObject() : user;
    doc.blogStats = statsMap[user._id.toString()] || {
      total: 0,
      draft: 0,
      pending_review: 0,
      approved: 0,
      published: 0,
    };
    return doc;
  });
};

exports.listUsers = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = buildUserListFilter(req.query, req.user.role);

  const [users, total] = await Promise.all([
    User.find(filter).select(USER_LIST_SELECT).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  const enriched = await attachBlogStats(users);
  res.json(paginatedResponse(enriched, total, { page, limit }));
};

exports.getUserById = async (req, res) => {
  const user = await User.findById(req.params.id).select(USER_LIST_SELECT).populate(USER_DETAIL_POPULATE);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (req.user.role === 'communication_officer' && !EXTERNAL_CREATORS.includes(user.role)) {
    return res.status(403).json({ error: 'Communication officers can only review external contributor accounts' });
  }

  const [enriched] = await attachBlogStats([user]);

  const recentBlogs = await Blog.find({ author: user._id })
    .select('title status submittedAt publishedAt createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(10);

  res.json({ ...enriched, recentBlogs });
};

exports.reviewUser = async (req, res) => {
  const { decision, note } = req.body;
  validateUserReview({ decision, note });

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!user.canBeReviewedBy(req.user.role)) {
    return res.status(403).json({ error: 'You are not permitted to review this account' });
  }

  if (req.user.role === 'communication_officer' && !EXTERNAL_CREATORS.includes(user.role)) {
    return res.status(403).json({ error: 'Communication officers can only review external contributor accounts' });
  }

  user.profileReviewHistory.push({
    decision,
    reviewer: req.user.id,
    note: note?.trim() || '',
  });

  if (decision === 'verified') {
    user.profileReviewStatus = 'verified';
    user.lastProfileReviewNote = undefined;
  } else if (decision === 'needs_attention') {
    user.profileReviewStatus = 'needs_attention';
    user.lastProfileReviewNote = note.trim();
  }
  // 'noted' keeps current status but records the note in history

  await user.save();

  const { password, ...safeUser } = user.toObject();
  res.json({
    message:
      decision === 'verified'
        ? 'User profile marked as verified'
        : decision === 'needs_attention'
          ? 'User flagged for attention — admin has been notified in the review log'
          : 'Review note recorded',
    user: safeUser,
  });
};

exports.getUserReviewQueue = async (req, res) => {
  const filter = {
    role: { $in: EXTERNAL_CREATORS },
    profileReviewStatus: { $in: ['pending', 'needs_attention'] },
    isActive: true,
  };

  const users = await User.find(filter)
    .select(USER_LIST_SELECT)
    .sort({ profileReviewStatus: -1, createdAt: 1 });

  const enriched = await attachBlogStats(users);
  res.json({ count: enriched.length, users: enriched });
};

exports.REVIEWERS = REVIEWERS;
