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
    },
    actorRole: {
      type: String,
      enum: [...ALL_ROLES, 'system', 'anonymous'],
      required: true,
    },
    actorLabel: { type: String, trim: true, maxlength: 160 },

    // What happened
    action: {
      type: String,
      trim: true,
      maxlength: 100,
      match: /^[a-z][a-z0-9_.-]*$/,
      required: true,
    },

    // What was affected
    targetModel: {
      type: String,
      enum: ['Blog', 'User', 'Gallery'],
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
    requestMethod: { type: String, maxlength: 10 },
    requestPath: { type: String, maxlength: 500 },
  },
  {
    timestamps: { createdAt: 'timestamp', updatedAt: false },
  }
);

// Index for fast queries by actor, target, or action
AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.index({ actor: 1, timestamp: -1 });
AuditLogSchema.index({ targetModel: 1, targetId: 1, timestamp: -1 });
AuditLogSchema.index({ action: 1, timestamp: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);