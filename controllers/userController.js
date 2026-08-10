const User = require('../models/User');
const Blog = require('../models/Blog');
const { parsePagination, paginatedResponse } = require('../utils/pagination');
const { EXTERNAL_CREATORS, REVIEWERS, ROLES, ORGANIZATIONS } = require('../constants/roles');
const { validateUserReview } = require('../middleware/validateUserInput');

const USER_LIST_SELECT = '-password';
const USER_DETAIL_POPULATE = { path: 'createdBy', select: 'username firstName lastName' };

/**
 * Helper: Normalizes input organization strings on the fly
 */
const normalizeOrganizationName = (org) => {
  if (!org) return org;
  const lower = org.toString().toLowerCase().trim();
  if (
    lower === 'asr-rwanda' ||
    lower === 'afs-rwanda' ||
    lower.includes('alliance for science') ||
    lower.includes('asr')
  ) {
    return 'Alliance for Science Rwanda (AfS-Rwanda)';
  }
  return org;
};

/**
 * Helper: Build filter query for user listing based on requester role
 */
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

/**
 * Helper: Attach aggregated blog stats to user objects
 */
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

/**
 * POST /api/auth/register or /api/users/register
 * Register a new user with dynamic institution & role rules
 */
exports.register = async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      firstName,
      lastName,
      dateOfBirth,
      organization: rawOrganization,
      jobTitle,
      organizationLink,
      socialHandle,
      role,
    } = req.body;

    // Normalize legacy or short-form organization names (e.g. 'ASR-RWANDA' -> 'Alliance for Science Rwanda (AfS-Rwanda)')
    const organization = normalizeOrganizationName(rawOrganization);

    const isAdmin = role === 'admin' || role === ROLES?.ADMIN;
    const isAfSRwanda = organization === 'Alliance for Science Rwanda (AfS-Rwanda)';

    // 1. Mandatory Fields Validation
    // jobTitle is required ONLY for non-admin, non-AfS partner institution accounts
    const requiresJobTitle = !isAdmin && !isAfSRwanda;

    if (
      !username ||
      !email ||
      !password ||
      !firstName ||
      !lastName ||
      !organization ||
      (requiresJobTitle && !jobTitle) ||
      !role
    ) {
      return res.status(400).json({
        error: requiresJobTitle
          ? 'Please fill out all required fields, including Organization and Job Title.'
          : 'Please fill out all required fields.',
      });
    }

    // 2. Validate Institution
    if (!ORGANIZATIONS.includes(organization)) {
      return res.status(400).json({
        error: 'Selected institution is not a valid Rwanda BioCap partner institution.',
      });
    }

    // 3. Dynamic Institution-Role Validation Rules (Skipped for Admins)
    if (!isAdmin) {
      const afsRoles = [
        ROLES?.SOCIAL_MEDIA_CONTENT_CREATOR || 'social_media_content_creator',
        ROLES?.MEDIA_CORRESPONDENT || 'media_correspondent',
        ROLES?.COMMUNICATION_OFFICER || 'communication_officer',
      ];
      const partnerRoles = [
        ROLES?.PRINCIPAL_INVESTIGATOR || 'principal_investigator',
        ROLES?.COMMUNICATION_OFFICER || 'communication_officer',
      ];

      if (isAfSRwanda && !afsRoles.includes(role)) {
        return res.status(400).json({
          error: 'Alliance for Science Rwanda accounts must select Social Media Content Creator, Media Correspondent, or Communication Officer.',
        });
      }

      if (!isAfSRwanda && !partnerRoles.includes(role)) {
        return res.status(400).json({
          error: 'Partner institution accounts must select Principal Investigator (PI) or Communication Officer.',
        });
      }
    }

    // 4. Media Correspondent specific check
    const isMediaCorrespondent = role === ROLES?.MEDIA_CORRESPONDENT || role === 'media_correspondent';
    if (isMediaCorrespondent && !organizationLink) {
      return res.status(400).json({
        error: 'An organization link is required for Media Correspondent accounts.',
      });
    }

    // 5. Check duplicate username or email
    const existingUser = await User.findOne({
      $or: [{ username: username.trim() }, { email: email.toLowerCase().trim() }],
    });
    if (existingUser) {
      return res.status(400).json({ error: 'Username or Email is already registered.' });
    }

    // 6. Instantiate & Save User
    const user = new User({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      password, // Password hashing handled in User model pre-save hook
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dateOfBirth: dateOfBirth || undefined,
      organization,
      jobTitle: requiresJobTitle ? (jobTitle ? jobTitle.trim() : undefined) : undefined,
      organizationLink: organizationLink ? organizationLink.trim() : undefined,
      socialHandle: socialHandle ? socialHandle.trim() : undefined,
      role,
    });

    // Save with validateModifiedOnly to bypass un-edited legacy properties
    await user.save({ validateModifiedOnly: true });

    const { password: _, ...safeUser } = user.toObject();

    res.status(201).json({
      message: 'Registration successful! Your account is now active.',
      user: safeUser,
    });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ error: err.message || 'Server error during registration.' });
  }
};

/**
 * GET /api/users — List user accounts with pagination and filters
 */
exports.listUsers = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = buildUserListFilter(req.query, req.user.role);

    const [users, total] = await Promise.all([
      User.find(filter).select(USER_LIST_SELECT).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    const enriched = await attachBlogStats(users);
    res.json(paginatedResponse(enriched, total, { page, limit }));
  } catch (err) {
    console.error('List Users Error:', err);
    res.status(500).json({ error: 'Failed to retrieve users list.' });
  }
};

/**
 * GET /api/users/:id — Get details of a single user
 */
exports.getUserById = async (req, res) => {
  try {
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
  } catch (err) {
    console.error('Get User By ID Error:', err);
    res.status(500).json({ error: 'Failed to retrieve user details.' });
  }
};

/**
 * PATCH /api/users/:id/review — Audit/verify user profile
 */
exports.reviewUser = async (req, res) => {
  try {
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

    await user.save({ validateModifiedOnly: true });

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
  } catch (err) {
    console.error('Review User Error:', err);
    res.status(500).json({ error: err.message || 'Failed to complete user review.' });
  }
};

/**
 * GET /api/users/review-queue — Queue of external creator accounts needing review
 */
exports.getUserReviewQueue = async (req, res) => {
  try {
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
  } catch (err) {
    console.error('User Review Queue Error:', err);
    res.status(500).json({ error: 'Failed to fetch user review queue.' });
  }
};

exports.REVIEWERS = REVIEWERS;