// In-app notifications. Failures are logged and never thrown, so the action that caused a notification still succeeds.
const Notification = require('../models/Notification');
const User = require('../models/User');

// Creates one notification per recipient. The actor (sender) is never notified about their own action.
async function notifyUsers(recipientIds, { type, message, article, sender }) {
  const actor = sender ? String(sender) : null;
  const recipients = [...new Set(recipientIds.filter(Boolean).map(String))].filter((id) => id !== actor);
  if (recipients.length === 0) return;

  try {
    await Notification.insertMany(
      recipients.map((recipient) => ({ recipient, sender: actor, type, message, article }))
    );
  } catch (err) {
    console.error(`In-app notification (${type}) failed:`, err.message);
  }
}

// Notifies every active user with one of the given roles, e.g. all editors.
async function notifyUsersByRole(roles, payload) {
  try {
    const users = await User.find({ role: { $in: roles }, isActive: true }).select('_id').lean();
    await notifyUsers(
      users.map((user) => user._id),
      payload
    );
  } catch (err) {
    console.error(`In-app notification (${payload.type}) failed:`, err.message);
  }
}

module.exports = { notifyUsers, notifyUsersByRole };
