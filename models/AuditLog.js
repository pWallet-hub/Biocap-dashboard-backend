const mongoose = require('mongoose');
const { ALL_ROLES } = require('../constants/roles');

/**
 * AuditLog — immutable record of every significant action taken in the system.
 */
const AuditLogSchema = new mongoose.Schema(
  {
    // Who performed the action
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    actorRole: {
      type: String,
      enum: ALL_ROLES,
      required: true,
    },

    // What happened
    action: {
      type: String,
      enum: [
        // Blog actions
        'blog.create',
        'blog.update',
        'blog.delete',       // soft delete
        'blog.hard_delete',  // permanent delete
        'blog.restore',
        'blog.submit',
        'blog.review',       // approve or reject
        'blog.publish',
        'blog.unpublish',
        'blog.editor_proposal',          // editor proposed a new version
        'blog.editor_changes_accepted',  // writer accepted an editor proposal
        'blog.editor_changes_rejected',  // writer rejected an editor proposal
        'blog.editor_proposal_withdrawn', // editor withdrew a pending proposal

        // User actions
        'user.create',
        'user.update',
        'user.deactivate',
        'user.reactivate',
        'user.delete',
        'user.role_change',
        'user.review',
        'user.password_reset',
        'user.password_change',
        'user.login',
        'user.logout',
      ],
      required: true,
    },

    // What was affected
    targetModel: {
      type: String,
      enum: ['Blog', 'User'],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    // Human-readable summary (e.g. blog title or username)
    targetLabel: { type: String },

    // Optional: decision detail (e.g. "approved", "rejected", new role, etc.)
    detail: { type: mongoose.Schema.Types.Mixed },

    // Request metadata
    ip: { type: String },
    userAgent: { type: String },
  },
  {
    timestamps: { createdAt: 'timestamp', updatedAt: false },
  }
);

// Index for fast queries by actor, target, or action
AuditLogSchema.index({ actor: 1, timestamp: -1 });
AuditLogSchema.index({ targetModel: 1, targetId: 1, timestamp: -1 });
AuditLogSchema.index({ action: 1, timestamp: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);