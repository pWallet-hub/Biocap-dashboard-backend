const AuditLog = require('../models/AuditLog');

/**
 * Writes an audit log entry. Failures are swallowed — a logging failure
 * must never break the primary action the user requested.
 *
 * @param {object} opts
 * @param {object}  opts.req         – Express request (provides actor, ip, userAgent)
 * @param {string}  opts.action      – AuditLog action enum value (e.g. 'blog.publish')
 * @param {string}  opts.targetModel – 'Blog' | 'User'
 * @param {*}       opts.targetId    – Mongoose ObjectId of the affected document
 * @param {string}  [opts.targetLabel] – Human-readable name (blog title, username, …)
 * @param {*}       [opts.detail]    – Any extra context (decision, old/new role, …)
 */
async function writeAuditLog({ req, action, targetModel, targetId, targetLabel, detail }) {
  try {
    await AuditLog.create({
      actor: req.user.id,
      actorRole: req.user.role,
      action,
      targetModel,
      targetId,
      targetLabel,
      detail,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    });
  } catch (err) {
    // Never propagate — audit failure must not affect the response
    console.error('[AuditLog] Failed to write log entry:', err.message);
  }
}

module.exports = { writeAuditLog };
