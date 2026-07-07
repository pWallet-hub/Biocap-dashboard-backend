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
    title: { type: String, required: true },
    tag: { type: String, required: true },
    excerpt: { type: String, required: true },
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
  },
  { timestamps: true }
);

BlogSchema.pre('validate', function () {
  if (this.authorRole === 'social_media_influencer' && !this.socialHandle) {
    throw new Error('socialHandle is required for social_media_influencer posts');
  }
  if (this.authorRole === 'broadcast_media' && !this.organizationLink) {
    throw new Error('organizationLink is required for broadcast_media posts');
  }
});

BlogSchema.methods.canOwnerModify = function () {
  return this.status === 'draft';
};

BlogSchema.methods.canBeDeletedBy = function (user) {
  const isReviewer = ['admin', 'communication_officer'].includes(user.role);
  if (this.status === 'published') return user.role === 'admin';
  if (isReviewer) return true;
  return this.author.toString() === user.id && this.status === 'draft';
};

module.exports = mongoose.model('Blog', BlogSchema);