const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema(
  {
    role: { type: String, required: true },
    name: { type: String, required: true },
    summary: { type: String },
  },
  { _id: false }
);

const ModalSchema = new mongoose.Schema(
  {
    date: { type: String },
    organizer: { type: String },
    partners: { type: String },
    intro: { type: String, required: true },
    objectives: { type: [String], default: [] },
    sessions: { type: [SessionSchema], default: [] },
    collaboration: { type: [String], default: [] },
    quote: { type: String },
    quoteSource: { type: String },
  },
  { _id: false }
);

const ReviewLogSchema = new mongoose.Schema(
  {
    decision: { type: String, enum: ['approved', 'rejected'], required: true },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String },
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
    modal: { type: ModalSchema, required: true },

    img: { type: String, required: true },
    imgPublicId: { type: String, required: true },

    documentUrl: { type: String },
    documentPublicId: { type: String },
    documentName: { type: String },

    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorRole: {
      type: String,
      enum: ['admin', 'communication_officer', 'broadcast_media', 'social_media_influencer'],
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
// Text index for fast full-text search on public-facing fields
BlogSchema.index({ title: 'text', tag: 'text', excerpt: 'text' });

// Most common queries: list by status, author's own blogs, published feed
BlogSchema.index({ status: 1, publishedAt: -1 });
BlogSchema.index({ author: 1, status: 1 });
BlogSchema.index({ isDeleted: 1, status: 1 });

// ─── Pre-validate hook ───────────────────────────────────────────────────────
BlogSchema.pre('validate', function () {
  if (this.authorRole === 'social_media_influencer' && !this.socialHandle) {
    throw new Error('socialHandle is required for social_media_influencer posts');
  }
  if (this.authorRole === 'broadcast_media' && !this.organizationLink) {
    throw new Error('organizationLink is required for broadcast_media posts');
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
 * Admin: always. Officer: any non-published blog.
 * Owner: only their own draft.
 */
BlogSchema.methods.canBeEditedBy = function (user) {
  const isReviewer = ['admin', 'communication_officer'].includes(user.role);
  const isOwner = this.author.toString() === user.id;

  if (this.status === 'published') {
    return user.role === 'admin';
  }

  if (isReviewer) return true;
  return isOwner && this.canOwnerModify();
};

/**
 * Returns true if the requesting user may soft-delete this blog.
 * Published blogs are admin-only to delete.
 */
BlogSchema.methods.canBeDeletedBy = function (user) {
  if (this.status === 'published') return user.role === 'admin';
  const isReviewer = ['admin', 'communication_officer'].includes(user.role);
  if (isReviewer) return true;
  return this.author.toString() === user.id && this.status === 'draft';
};

module.exports = mongoose.model('Blog', BlogSchema);