const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
      enum: ['admin', 'communication_officer', 'broadcast_media', 'social_media_influencer'],
      required: true,
      default: 'social_media_influencer',
    },

    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date },

    // Profile picture (Cloudinary URL)
    avatar: { type: String, trim: true },

    // For broadcast_media: their organization name + the link shown on published posts
    organization: { type: String, trim: true },
    organizationLink: { type: String, trim: true },

    // For social_media_influencer: their default handle, pre-filled on new posts
    socialHandle: { type: String, trim: true },

    // Every non-admin account is created by an admin — track who created it
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Admin can deactivate an account without deleting it
    isActive: { type: Boolean, default: true },

    // Profile review workflow — communication officers verify external contributors
    profileReviewStatus: {
      type: String,
      enum: ['pending', 'verified', 'needs_attention'],
      default: 'pending',
    },
    profileReviewHistory: { type: [UserReviewLogSchema], default: [] },
    lastProfileReviewNote: { type: String, trim: true },

    // True until the user resets the auto-generated temporary password sent at registration
    isPasswordResetRequired: { type: Boolean, default: true },

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
// Enforce role-specific required fields at the data layer, not just in routes
UserSchema.pre('validate', function () {
  if (this.role === 'broadcast_media' && !this.organizationLink) {
    throw new Error('organizationLink is required for broadcast_media accounts');
  }
});

// ─── Instance methods ────────────────────────────────────────────────────────

/**
 * Hashes and sets a new refresh token on this user document.
 * Call user.save() after.
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
  return ['admin', 'communication_officer'].includes(reviewerRole);
};

/**
 * Returns true if the requesting manager is an admin (the only role that can
 * create, deactivate, delete, or change roles of users).
 */
UserSchema.methods.canBeManagedBy = function (managerRole) {
  return managerRole === 'admin';
};

module.exports = mongoose.model('User', UserSchema);