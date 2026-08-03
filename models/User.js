const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, ALL_ROLES, USER_MANAGERS, ROLE_MANAGERS } = require('../constants/roles');

const UserReviewLogSchema = new mongoose.Schema(
  {
    decision: {
      type: String,
      enum: ['verified', 'needs_attention', 'noted'],
      required: true,
    },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, trim: true },
    reviewedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },

    role: {
      type: String,
      enum: ALL_ROLES,
      required: true,
      default: ROLES.SOCIAL_MEDIA_CONTENT_CREATOR,
    },

    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date },

    // Profile picture (Cloudinary URL)
    avatar: { type: String, trim: true },

    // For broadcast_content_creator: organization name + link shown on published posts
    organization: { type: String, trim: true },
    organizationLink: { type: String, trim: true },

    // For social_media_content_creator: default handle pre-filled on new posts
    socialHandle: { type: String, trim: true },

    // Track creator account if created via admin/officer panel
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Admin can deactivate an account without deleting it
    isActive: { type: Boolean, default: true },

    // ─── Notification Subscriptions ─────────────────────────────────────────
    // Controls if the user receives alerts for comments & editor updates
    receiveNotifications: { type: Boolean, default: true },

    // Profile review workflow — communication officers / admins verify external contributors
    profileReviewStatus: {
      type: String,
      enum: ['pending', 'verified', 'needs_attention'],
      default: 'pending',
    },
    profileReviewHistory: { type: [UserReviewLogSchema], default: [] },
    lastProfileReviewNote: { type: String, trim: true },

    // Set to true when password expires or when explicit reset is required
    isPasswordResetRequired: { type: Boolean, default: false },

    // Refresh token (stored hashed) — null means user is logged out
    refreshToken: { type: String, default: null },

    // Activity tracking
    lastLoginAt: { type: Date },
    loginCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index({ profileReviewStatus: 1, role: 1 });
UserSchema.index({ createdAt: -1 });

// ─── Pre-validate hook ───────────────────────────────────────────────────────
UserSchema.pre('validate', function () {
  if (this.role === ROLES.BROADCAST_CONTENT_CREATOR && !this.organizationLink) {
    throw new Error('organizationLink is required for broadcast_content_creator accounts');
  }
});

// ─── Instance methods ────────────────────────────────────────────────────────

/**
 * Hashes and sets a new refresh token on this user document.
 */
UserSchema.methods.setRefreshToken = async function (rawToken) {
  const salt = await bcrypt.genSalt(10);
  this.refreshToken = await bcrypt.hash(rawToken, salt);
};

/**
 * Compares a raw refresh token against the stored hash.
 */
UserSchema.methods.compareRefreshToken = async function (rawToken) {
  if (!this.refreshToken) return false;
  return bcrypt.compare(rawToken, this.refreshToken);
};

/**
 * Returns true if the requesting reviewer's role is allowed to review this profile.
 */
UserSchema.methods.canBeReviewedBy = function (reviewerRole) {
  return USER_MANAGERS.includes(reviewerRole);
};

/**
 * Returns true if managerRole can perform user management tasks.
 */
UserSchema.methods.canBeManagedBy = function (managerRole) {
  return USER_MANAGERS.includes(managerRole);
};

/**
 * Returns true if user role can be modified by managerRole.
 */
UserSchema.methods.canRoleBeChangedBy = function (managerRole) {
  return ROLE_MANAGERS.includes(managerRole);
};

/**
 * Checks if the account has been inactive for longer than maxDays.
 */
UserSchema.methods.isPasswordExpired = function (maxDays = 90) {
  const referenceDate = this.lastLoginAt || this.createdAt;
  if (!referenceDate) return false;

  const diffInMs = Date.now() - new Date(referenceDate).getTime();
  const diffInDays = diffInMs / (1000 * 60 * 60 * 24);
  return diffInDays > maxDays;
};

module.exports = mongoose.model('User', UserSchema);