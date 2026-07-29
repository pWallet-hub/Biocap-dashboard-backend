const mongoose = require('mongoose');
const { ROLES, ALL_ROLES, REVIEWERS } = require('../constants/roles');

const BlockSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['p', 'h2', 'quote', 'emphasis', 'image'],
      required: true,
    },
    text: { type: String, trim: true },
    source: { type: String, trim: true },
    src: { type: String, trim: true },
    caption: { type: String, trim: true },
  },
  { _id: false }
);

const ModalSchema = new mongoose.Schema(
  {
    date: { type: String, trim: true },
    organizer: { type: String, trim: true },
    partners: { type: String, trim: true },
  },
  { _id: false }
);

const ReviewLogSchema = new mongoose.Schema(
  {
    decision: { type: String, enum: ['approved', 'rejected'], required: true },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, trim: true },
    reviewedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const BlogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, lowercase: true, trim: true },
    tag: { type: String, required: true, trim: true },
    excerpt: { type: String, required: true, trim: true },
    
    // Core content structured as flexible blocks
    blocks: { type: [BlockSchema], default: [] },

    // Sidebar metadata
    modal: { type: ModalSchema, default: {} },

    img: { type: String, required: true },
    imgPublicId: { type: String, required: true },

    documentUrl: { type: String },
    documentPublicId: { type: String },
    documentName: { type: String },

    // Immutable creator (always displayed on public bylines)
    originalAuthor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    originalAuthorRole: { type: String, required: true },

    // Last editor / responsible account for internal tracking
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorRole: {
      type: String,
      enum: ALL_ROLES,
      required: true,
    },

    socialHandle: { type: String, trim: true },
    organizationLink: { type: String, trim: true },

    status: {
      type: String,
      enum: ['draft', 'pending_review', 'approved', 'published'],
      default: 'draft',
    },
    submittedAt: { type: Date },
    lastRejectionNote: { type: String },
    reviewHistory: { type: [ReviewLogSchema], default: [] },

    publishedAt: { type: Date },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Soft delete — admin can restore or permanently remove
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Public engagement metric
    views: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
BlogSchema.index({ title: 'text', tag: 'text', excerpt: 'text' });
BlogSchema.index({ status: 1, publishedAt: -1 });
BlogSchema.index({ author: 1, status: 1 });
BlogSchema.index({ originalAuthor: 1, status: 1 });
BlogSchema.index({ isDeleted: 1, status: 1 });

// ─── Pre-validate hook ───────────────────────────────────────────────────────
BlogSchema.pre('validate', function () {
  if (this.authorRole === ROLES.SOCIAL_MEDIA_CONTENT_CREATOR && !this.socialHandle) {
    throw new Error('socialHandle is required for social_media_content_creator posts');
  }
  if (this.authorRole === ROLES.BROADCAST_CONTENT_CREATOR && !this.organizationLink) {
    throw new Error('organizationLink is required for broadcast_content_creator posts');
  }
});

// ─── Instance methods ────────────────────────────────────────────────────────

/**
 * Returns true if the blog's owner is allowed to modify it (only while in draft).
 */
BlogSchema.methods.canOwnerModify = function () {
  return this.status === 'draft';
};

/**
 * Returns true if the requesting user may edit this blog.
 * Admin: always.
 * Reviewers (Communication Officer & Editor): any non-published blog.
 * Owner: only their own draft.
 */
BlogSchema.methods.canBeEditedBy = function (user) {
  if (user.role === ROLES.ADMIN) return true;

  if (this.status === 'published') {
    return false;
  }

  const isReviewerRole = REVIEWERS.includes(user.role);
  const isOwner = this.originalAuthor.toString() === user.id || this.author.toString() === user.id;

  if (isReviewerRole) return true;
  return isOwner && this.canOwnerModify();
};

/**
 * Returns true if the requesting user may soft-delete this blog.
 * Published blogs are admin-only to delete.
 */
BlogSchema.methods.canBeDeletedBy = function (user) {
  if (this.status === 'published') return user.role === ROLES.ADMIN;
  const isReviewerRole = REVIEWERS.includes(user.role);
  if (isReviewerRole) return true;
  return (this.originalAuthor.toString() === user.id || this.author.toString() === user.id) && this.canOwnerModify();
};

module.exports = mongoose.model('Blog', BlogSchema);