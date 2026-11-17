const AuditLog = require('../models/AuditLog');

/**
 * Persist a successful business action before returning success to the caller.
 *
 * @param {object} opts
 * @param {object} [opts.req] Express request metadata and authenticated user
 * @param {object|string} [opts.actor] Explicit actor document or user ID
 * @param {string} [opts.actorRole] Explicit actor role for pre-authentication events
 * @param {string} opts.action Namespaced action such as 'blog.publish'
 * @param {string} opts.targetModel A supported audit target model
 * @param {*} opts.targetId ID of the affected document
 * @param {string} [opts.targetLabel] Human-readable target name
 * @param {*} [opts.detail] Safe, non-secret action context
 */
async function writeAuditLog({
  req = {},
  actor,
  actorRole,
  actorLabel: explicitActorLabel,
  action,
  targetModel,
  targetId,
  targetLabel,
  detail,
}) {
  const actorId = actor?._id || req?.user?._id || req?.user?.id || actor;
  const resolvedActorRole = actorRole || actor?.role || req?.user?.role || (actorId ? 'system' : 'anonymous');
  const actorLabel = explicitActorLabel ||
    actor?.username ||
    [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') ||
    req?.user?.username ||
    undefined;

  try {
    await AuditLog.create({
      actor: actorId,
      actorRole: resolvedActorRole,
      actorLabel: actorLabel?.slice(0, 160),
      action,
      targetModel,
      targetId,
      targetLabel,
      detail,
      ip: req?.ip || req?.connection?.remoteAddress,
      userAgent: req?.headers?.['user-agent'] || 'Unknown',
      requestMethod: req?.method,
      requestPath: req?.path,
    });
  } catch (err) {
    console.error('[AuditLog] Failed to persist action:', {
      action,
      targetModel,
      targetId: String(targetId || ''),
      error: err.message,
    });
    throw err;
  }
}

module.exports = { writeAuditLog };