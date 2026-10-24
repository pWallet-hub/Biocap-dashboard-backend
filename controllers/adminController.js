const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Blog = require('../models/Blog');
const AuditLog = require('../models/AuditLog');
const { pickProfileFields, validateRole, validateRoleSpecificFields } = require('../middleware/validateUserInput');
const { sendCredentialsEmail } = require('../utils/sendEmail');
const { writeAuditLog } = require('../utils/auditLogger');
const { parsePagination, paginatedResponse } = require('../utils/pagination');
const { ALL_ROLES, ROLES } = require('../constants/roles');

const RESET_TOKEN_EXPIRES_IN = '30m';

const createResetToken = (email) =>
  jwt.sign({ sub: email, purpose: 'password_reset' }, process.env.JWT_SECRET, {
    expiresIn: RESET_TOKEN_EXPIRES_IN,
  });

const assertNotSelf = (targetId, requesterId, action) => {
  if (targetId === requesterId) {
    const err = new Error(`You cannot ${action} your own account`);
    err.statusCode = 400;
    throw err;
  }
};

// ─── Admin / Officer Direct User Creation ─────────────────────────────────────

/**
 * POST /api/admin/users
 * Admin or Communication Officer creates a user account directly with a password set.
 */
exports.createUser = async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      firstName,
      lastName,
      role,
      organization,
      organizationLink,
      socialHandle,
      dateOfBirth,
    } = req.body;

    if (!username || !email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({ message: 'username, email, password, firstName, lastName, and role are required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
    }

    if (!ALL_ROLES.includes(role)) {
      return res.status(400).json({ message: `Role must be one of: ${ALL_ROLES.join(', ')}` });
    }

    // Only Admin can assign Admin role to others
    if (role === ROLES.ADMIN && req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({ message: 'Only administrators can assign the admin role.' });
    }

    if (role === ROLES.BROADCAST_CONTENT_CREATOR && !organizationLink) {
      return res.status(400).json({ message: 'organizationLink is required for broadcast_content_creator accounts.' });
    }

    const existingUser = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (existingUser) {
      return res.status(400).json({ message: 'A profile under this email or username already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      username,
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      firstName,
      lastName,
      dateOfBirth,
      organization,
      organizationLink,
      socialHandle,
      createdBy: req.user.id,
      isPasswordResetRequired: false,
    });

    writeAuditLog({
      req,
      action: 'user.create',
      targetModel: 'User',
      targetId: newUser._id,
      targetLabel: newUser.username,
      detail: { createdByStaff: true, role: newUser.role },
    });

    res.status(201).json({
      message: 'User created successfully.',
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ─── User CRUD ────────────────────────────────────────────────────────────────

exports.updateUser = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const updates = pickProfileFields(req.body);

  if (req.body.role) {
    validateRole(req.body.role);
    if (req.params.id === req.user.id && req.body.role !== ROLES.ADMIN) {
      return res.status(400).json({ error: 'You cannot remove your own admin role' });
    }
    updates.role = req.body.role;
  }

  Object.assign(user, updates);

  const roleToValidate = updates.role || user.role;
  validateRoleSpecificFields(roleToValidate, {
    organizationLink: user.organizationLink,
  });

  await user.save();

  writeAuditLog({
    req,
    action: 'user.update',
    targetModel: 'User',
    targetId: user._id,
    targetLabel: user.username,
    detail: { updatedFields: Object.keys(updates) },
  });

  const { password, refreshToken, ...safeUser } = user.toObject();
  res.json({ message: 'User updated successfully', user: safeUser });
};

exports.changeUserRole = async (req, res) => {
  const { role, organizationLink } = req.body;
  validateRole(role);

  if (req.params.id === req.user.id && role !== ROLES.ADMIN) {
    return res.status(400).json({ error: 'You cannot remove your own admin role' });
  }

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (role === ROLES.BROADCAST_CONTENT_CREATOR && !organizationLink && !user.organizationLink) {
    return res
      .status(400)
      .json({ error: 'organizationLink is required when assigning the broadcast_content_creator role' });
  }

  const previousRole = user.role;
  user.role = role;
  if (organizationLink) user.organizationLink = organizationLink;
  await user.save();

  writeAuditLog({
    req,
    action: 'user.role_change',
    targetModel: 'User',
    targetId: user._id,
    targetLabel: user.username,
    detail: { from: previousRole, to: role },
  });

  const { password, refreshToken, ...safeUser } = user.toObject();
  res.json({ message: 'Role updated successfully', user: safeUser });
};

exports.deactivateUser = async (req, res) => {
  assertNotSelf(req.params.id, req.user.id, 'deactivate');

  const user = await User.findByIdAndUpdate(req.params.id, { isActive: false }, { returnDocument: 'after' }).select('-password -refreshToken');
  if (!user) return res.status(404).json({ error: 'User not found' });

  writeAuditLog({
    req,
    action: 'user.deactivate',
    targetModel: 'User',
    targetId: user._id,
    targetLabel: user.username,
  });

  res.json({ message: 'User deactivated', user });
};

exports.reactivateUser = async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: true }, { returnDocument: 'after' }).select('-password -refreshToken');
  if (!user) return res.status(404).json({ error: 'User not found' });

  writeAuditLog({
    req,
    action: 'user.reactivate',
    targetModel: 'User',
    targetId: user._id,
    targetLabel: user.username,
  });

  res.json({ message: 'User reactivated', user });
};

exports.deleteUser = async (req, res) => {
  assertNotSelf(req.params.id, req.user.id, 'delete');

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const publishedCount = await Blog.countDocuments({
    $or: [{ originalAuthor: user._id }, { author: user._id }],
    status: 'published',
  });

  if (publishedCount > 0) {
    return res.status(400).json({
      error: 'Cannot delete a user with published blogs. Deactivate the account or reassign content first.',
      publishedBlogCount: publishedCount,
    });
  }

  await Blog.deleteMany({
    $or: [{ originalAuthor: user._id }, { author: user._id }],
    status: { $ne: 'published' },
  });
  await user.deleteOne();

  writeAuditLog({
    req,
    action: 'user.delete',
    targetModel: 'User',
    targetId: user._id,
    targetLabel: user.username,
  });

  res.json({ message: 'User and their non-published blogs removed successfully' });
};

exports.resetUserPassword = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const tempPassword = crypto.randomBytes(8).toString('base64url').slice(0, 10);
  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(tempPassword, salt);
  user.isPasswordResetRequired = true;
  user.refreshToken = null;
  await user.save();

  const resetToken = createResetToken(user.email);
  sendCredentialsEmail(user.email, user.firstName, tempPassword, resetToken).catch((err) =>
    console.error('Failed to send password reset email:', err.message)
  );

  writeAuditLog({
    req,
    action: 'user.password_reset',
    targetModel: 'User',
    targetId: user._id,
    targetLabel: user.username,
  });

  res.json({ message: 'Temporary password generated and emailed to the user' });
};

// ─── Dashboard stats ──────────────────────────────────────────────────────────

exports.getDashboardStats = async (req, res) => {
  const [userStats, blogStats, reviewQueueCount, recentLogins] = await Promise.all([
    User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 },
          active: { $sum: { $cond: ['$isActive', 1, 0] } },
        },
      },
    ]),
    Blog.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),
    User.countDocuments({
      role: { $in: EXTERNAL_CREATORS },
      profileReviewStatus: { $in: ['pending', 'needs_attention'] },
      isActive: true,
    }),
    User.find({ lastLoginAt: { $exists: true } })
      .select('username firstName lastName role lastLoginAt loginCount')
      .sort({ lastLoginAt: -1 })
      .limit(5),
  ]);

  const usersByRole = Object.fromEntries(
    userStats.map((s) => [s._id, { total: s.count, active: s.active }])
  );
  const blogsByStatus = Object.fromEntries(blogStats.map((s) => [s._id, s.count]));

  const deletedBlogs = await Blog.countDocuments({ isDeleted: true });

  res.json({
    users: usersByRole,
    blogs: {
      ...blogsByStatus,
      deleted: deletedBlogs,
    },
    pendingUserReviews: reviewQueueCount,
    pendingBlogReviews: blogsByStatus.pending_review || 0,
    readyToPublish: blogsByStatus.approved || 0,
    recentActivity: {
      lastLogins: recentLogins,
    },
  });
};

// ─── Audit log queries (admin only) ──────────────────────────────────────────

exports.getAuditLogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};

  if (req.query.action) filter.action = req.query.action;
  if (req.query.actor) filter.actor = req.query.actor;
  if (req.query.targetModel) filter.targetModel = req.query.targetModel;
  if (req.query.targetId) filter.targetId = req.query.targetId;

  if (req.query.from || req.query.to) {
    filter.timestamp = {};
    if (req.query.from) filter.timestamp.$gte = new Date(req.query.from);
    if (req.query.to) filter.timestamp.$lte = new Date(req.query.to);
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .populate('actor', 'username firstName lastName role'),
    AuditLog.countDocuments(filter),
  ]);

  res.json(paginatedResponse(logs, total, { page, limit }));
};

exports.getBlogAuditTrail = async (req, res) => {
  const logs = await AuditLog.find({ targetModel: 'Blog', targetId: req.params.id })
    .sort({ timestamp: -1 })
    .populate('actor', 'username firstName lastName role');

  res.json({ count: logs.length, logs });
};

exports.getUserAuditTrail = async (req, res) => {
  const [asTarget, asActor] = await Promise.all([
    AuditLog.find({ targetModel: 'User', targetId: req.params.id })
      .sort({ timestamp: -1 })
      .populate('actor', 'username firstName lastName role'),
    AuditLog.find({ actor: req.params.id })
      .sort({ timestamp: -1 })
      .limit(50),
  ]);

  res.json({
    actionsOnThisUser: asTarget,
    actionsPerformedByThisUser: asActor,
  });
};