const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, ALL_ROLES, USER_MANAGERS, ROLE_MANAGERS } = require('../constants/roles');

// ─── Rwanda BioCap Partner Institutions List ────────────────────────────────
const ORGANIZATIONS = [
  'International Potato Center (CIP)',
  'International Institute of Tropical Agriculture (IITA)',
  'Donald Danforth Plant Science Center (DDPSC)',
  'Michigan State University (MSU)',
  'Rwanda Agriculture and Animal Resources Development Board (RAB)',
  'Alliance for Science Rwanda (AfS-Rwanda)',
];

/**
 * Normalizes input organization values.
 * Auto-converts legacy abbreviations ('ASR-RWANDA', 'asr-rwanda', 'afs-rwanda', etc.) to the exact enum value.
 */
const normalizeOrganization = (val) => {
  if (!val) return val;
  const lower = val.toString().toLowerCase().trim();
  if (
    lower === 'asr-rwanda' || 
    lower === 'afs-rwanda' || 
    lower.includes('alliance for science') ||
    lower.includes('asr')
  ) {
    return 'Alliance for Science Rwanda (AfS-Rwanda)';
  }
  return val;
};

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
      enum: ALL_ROLES || [
        'admin',
        'communication_officer',
        'editor',
        'social_media_content_creator',
        'media_correspondent',
        'principal_investigator',
      ],
      required: true,
      default: ROLES?.SOCIAL_MEDIA_CONTENT_CREATOR || 'social_media_content_creator',
    },

    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date },

    // Optional Job Title in base schema (used for author bylines)
    jobTitle: { 
      type: String, 
      trim: true 
    },

    // Profile picture (Cloudinary URL)
    avatar: { type: String, trim: true },

    // Rwanda BioCap Partner Institution
    organization: { 
      type: String, 
      required: [true, 'Partner Institution is required'],
      set: normalizeOrganization, // Auto-converts 'ASR-RWANDA' on assignment
      enum: {
        values: ORGANIZATIONS,
        message: '{VALUE} is not a valid Rwanda BioCap partner institution',
      },
      trim: true 
    },
    organizationLink: { type: String, trim: true },

    // For social_media_content_creator: default handle pre-filled on new posts
    socialHandle: { type: String, trim: true },

    // Track creator account if created via admin/officer panel
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Admin can deactivate an account without deleting it
    isActive: { type: Boolean, default: true },

    // ─── Notification Subscriptions ─────────────────────────────────────────
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
  // 1. Force normalization of legacy database values (e.g., 'ASR-RWANDA', 'afs-rwanda')
  if (this.organization) {
    this.organization = normalizeOrganization(this.organization);
  }

  const targetMediaRole = ROLES?.MEDIA_CORRESPONDENT || 'media_correspondent';
  const legacyMediaRole = ROLES?.BROADCAST_CONTENT_CREATOR || 'broadcast_content_creator';
  const isAdmin = this.role === 'admin';

  // 2. Admins do not require organization links or job titles
  if (isAdmin) {
    return;
  }

  // 3. Validate organizationLink requirement for Media Correspondents
  if ((this.role === targetMediaRole || this.role === legacyMediaRole) && !this.organizationLink) {
    throw new Error('organizationLink is required for Media Correspondent accounts');
  }

  // 4. Require jobTitle ONLY during NEW user registration (this.isNew)
  const isAfSRwanda = this.organization === 'Alliance for Science Rwanda (AfS-Rwanda)';

  if (this.isNew && !isAfSRwanda && (!this.jobTitle || !this.jobTitle.trim())) {
    throw new Error('Job Title is required for author bylines');
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
  return USER_MANAGERS ? USER_MANAGERS.includes(reviewerRole) : true;
};

/**
 * Returns true if managerRole can perform user management tasks.
 */
UserSchema.methods.canBeManagedBy = function (managerRole) {
  return USER_MANAGERS ? USER_MANAGERS.includes(managerRole) : true;
};

/**
 * Returns true if user role can be modified by managerRole.
 */
UserSchema.methods.canRoleBeChangedBy = function (managerRole) {
  return ROLE_MANAGERS ? ROLE_MANAGERS.includes(managerRole) : true;
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