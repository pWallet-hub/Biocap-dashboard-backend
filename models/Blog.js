const mongoose = require('mongoose');
const { ROLES, ALL_ROLES, REVIEWERS } = require('../constants/roles');

// ─── Flexible Section Block Schema ──────────────────────────────────────────
const BlockSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['hero', 'h1', 'h2', 'p', 'quote', 'emphasis', 'image', 'list', 'html', 'embed'],
      required: true,
    },
    text: { type: String, trim: true },
    source: { type: String, trim: true },
    src: { type: String, trim: true },
    caption: { type: String, trim: true },
    // Optional list items for 'list' blocks
    items: { type: [String], default: undefined },
    // Background image or hero image URL
    background: { type: String, trim: true },
  },
  { _id: false, strict: false } // Allows dynamic or custom block attributes without throwing schema errors
);

// ─── Article Sidebar Metadata Schema ─────────────────────────────────────────
const ModalSchema = new mongoose.Schema(
  {
    date: { type: String, trim: true },
    organizer: { type: String, trim: true },
    partners: { type: String, trim: true },
  },
  { _id: false, strict: false }
);

// ─── Editorial Review Audit Log Schema ───────────────────────────────────────
const ReviewLogSchema = new mongoose.Schema(
  {
    decision: { type: String, enum: ['approved', 'rejected'], required: true },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, trim: true },
    reviewedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ─── Revision / Change Request Schema ───────────────────────────────────────
const ChangeRequestSchema = new mongoose.Schema(
  {
    commenter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, trim: true },
    comment: { type: String, trim: true, required: true },
    requestedAt: { type: Date, default: Date.now },
    implemented: { type: Boolean, default: false },
    implementedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    implementedAt: { type: Date },
    implementationNote: { type: String, trim: true },
  },
  { _id: true }
);

// ─── Comment Schema for Published Articles ──────────────────────────────────
const CommentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    role: { type: String, trim: true, default: 'guest' },
    content: { type: String, required: true, trim: true },
    parentComment: { type: mongoose.Schema.Types.ObjectId, default: null },
    isVisible: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    replies: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          name: { type: String, trim: true },
          email: { type: String, trim: true, lowercase: true },
          phone: { type: String, trim: true },
          role: { type: String, trim: true, default: 'guest' },
          content: { type: String, required: true, trim: true },
          isVisible: { type: Boolean, default: true },
          isDeleted: { type: Boolean, default: false },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// ─── Editor Modifications Schema ─────────────────────────────────────────────
// The live, not-yet-decided editor proposal. Cleared when the writer responds.
const EditorModificationSchema = new mongoose.Schema(
  {
    editor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    version: { type: Number },
    title: { type: String, trim: true },
    excerpt: { type: String, trim: true },
    tag: { type: String, trim: true },
    blocks: { type: [BlockSchema] },
    img: { type: String, trim: true },
    imgPublicId: { type: String, trim: true },
    bodyHtml: { type: String },
    modifiedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// A content snapshot used for editor proposal history.
const ContentSnapshotSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    excerpt: { type: String, trim: true },
    tag: { type: String, trim: true },
    img: { type: String, trim: true },
    imgPublicId: { type: String, trim: true },
    bodyHtml: { type: String },
    blocks: { type: [BlockSchema], default: [] },
  },
  { _id: false }
);

// Immutable record of one editor proposal: the content it was based on, what it proposed, and the decision.
const EditorProposalRecordSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    editor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    baseline: { type: ContentSnapshotSchema, required: true },
    proposal: { type: ContentSnapshotSchema, required: true },
    proposedAt: { type: Date, default: Date.now },
    decidedAt: { type: Date },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decisionNote: { type: String, trim: true },
  },
  { _id: false }
);

// ─── Main Blog Post Schema ───────────────────────────────────────────────────
const BlogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, lowercase: true, trim: true },
    tag: { type: String, required: true, trim: true },
    
    // Excerpt text & optional structured blocks
    excerpt: { type: String, trim: true },
    excerptBlocks: { type: [BlockSchema], default: [] },

    // Core article content structured as flexible blocks
    blocks: { type: [BlockSchema], default: [] },
    bodyHtml: { type: String },

    // Sidebar metadata
    modal: { type: ModalSchema, default: {} },

    // Cover image & Cloudinary public identifier
    img: { type: String, required: true },
    imgPublicId: { type: String, required: true },

    // Optional supporting PDF document
    documentUrl: { type: String },
    documentPublicId: { type: String },
    documentName: { type: String },

    // Immutable creator (always displayed on public bylines)
    originalAuthor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    originalAuthorRole: { type: String, required: true },

    // Responsible author/editor for internal tracking
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorRole: {
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
    changeRequests: { type: [ChangeRequestSchema], default: [] },

    publishedAt: { type: Date },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Officer Review & Editor Change Tracking
    editorModifications: { type: EditorModificationSchema },
    // Versioned history of editor proposals. Excluded from default queries; select with '+editorProposals'.
    editorProposals: { type: [EditorProposalRecordSchema], default: [], select: false },
    officerAcceptedChanges: { type: Boolean, default: false },
    officerApprovalNote: { type: String, trim: true },

    // Comments on Published Articles
    comments: { type: [CommentSchema], default: [] },

    // Writer consent before a reviewer/editor-published article goes live
    publishConsentStatus: {
      type: String,
      enum: ['not_required', 'pending', 'approved', 'rejected'],
      default: 'not_required',
    },
    publishConsentRequestedAt: { type: Date },
    publishConsentNote: { type: String, trim: true },
    publishConsentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Soft delete tracking
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Public engagement metrics
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
  const socialRole = ROLES?.SOCIAL_MEDIA_CONTENT_CREATOR || 'social_media_content_creator';
  const mediaRole = ROLES?.MEDIA_CORRESPONDENT || 'media_correspondent';
  const legacyMediaRole = ROLES?.BROADCAST_CONTENT_CREATOR || 'broadcast_content_creator';

  if (this.authorRole === socialRole && !this.socialHandle) {
    throw new Error('socialHandle is required for social_media_content_creator posts');
  }
  
  if ((this.authorRole === mediaRole || this.authorRole === legacyMediaRole) && !this.organizationLink) {
    throw new Error('organizationLink is required for media_correspondent posts');
  }
});

// ─── Instance methods ────────────────────────────────────────────────────────

/**
 * Helper to safely extract String ID whether document field is populated or raw ObjectId
 */
const getObjectIdString = (field) => {
  if (!field) return '';
  return field._id ? field._id.toString() : field.toString();
};

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
  if (!user) return false;

  const adminRole = ROLES?.ADMIN || 'admin';
  if (user.role === adminRole) return true;

  if (this.status === 'published') {
    return false;
  }

  const isReviewerRole = REVIEWERS ? REVIEWERS.includes(user.role) : false;
  const originalAuthorId = getObjectIdString(this.originalAuthor);
  const authorId = getObjectIdString(this.author);
  const userId = user.id || user._id?.toString();

  const isOwner = originalAuthorId === userId || authorId === userId;

  if (isReviewerRole) return true;
  return isOwner && this.canOwnerModify();
};

/**
 * Returns true if the requesting user may soft-delete this blog.
 * Published blogs are admin-only to delete.
 */
BlogSchema.methods.canBeDeletedBy = function (user) {
  if (!user) return false;

  const adminRole = ROLES?.ADMIN || 'admin';
  if (this.status === 'published') return user.role === adminRole;

  const isReviewerRole = REVIEWERS ? REVIEWERS.includes(user.role) : false;
  if (isReviewerRole) return true;

  const originalAuthorId = getObjectIdString(this.originalAuthor);
  const authorId = getObjectIdString(this.author);
  const userId = user.id || user._id?.toString();

  const isOwner = originalAuthorId === userId || authorId === userId;
  return isOwner && this.canOwnerModify();
};

module.exports = mongoose.model('Blog', BlogSchema);