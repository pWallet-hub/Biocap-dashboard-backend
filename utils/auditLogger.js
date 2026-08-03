const AuditLog = require('../models/AuditLog');

/**
 * Writes an audit log entry. Failures are swallowed — a logging failure
 * must never break the primary action the user requested.
 *
 * @param {object} opts
 * @param {object}   [opts.req]         – Express request (provides actor, ip, userAgent)
 * @param {object}   [opts.actor]       – Explicit user object if req.user isn't set yet (e.g. login)
 * @param {string}   opts.action        – AuditLog action enum value (e.g. 'blog.publish')
 * @param {string}   opts.targetModel   – 'Blog' | 'User'
 * @param {*}        opts.targetId      – Mongoose ObjectId of the affected document
 * @param {string}   [opts.targetLabel] – Human-readable name (blog title, username, …)
 * @param {*}        [opts.detail]      – Any extra context (decision, old/new role, …)
 */
async function writeAuditLog({ req = {}, actor, action, targetModel, targetId, targetLabel, detail }) {
  try {
    // 1. Safely extract actor ID and Role (handles unauthenticated routes like login gracefully)
    const actorId = actor?._id || actor?.id || req?.user?._id || req?.user?.id || targetId;
    const actorRole = actor?.role || req?.user?.role || 'system';

    await AuditLog.create({
      actor: actorId,
      actorRole,
      action,
      targetModel,
      targetId,
      targetLabel,
      detail,
      ip: req?.ip || req?.connection?.remoteAddress || '127.0.0.1',
      userAgent: req?.headers?.['user-agent'] || 'Unknown',
    });
  } catch (err) {
    // Never propagate — audit failure must not affect the primary HTTP response
    console.error('[AuditLog] Failed to write log entry:', err.message);
  }
}

module.exports = { writeAuditLog };