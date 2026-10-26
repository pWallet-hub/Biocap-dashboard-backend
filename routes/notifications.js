// Notifications for the signed-in user, for any role.
const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(protect);

const LIST_LIMIT = 30;

/**
 * GET /api/notifications
 * The latest notifications for the signed-in user, with the unread count.
 */
router.get('/', async (req, res, next) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ recipient: req.user.id })
        .sort({ createdAt: -1 })
        .limit(LIST_LIMIT)
        .populate('sender', 'firstName lastName username')
        .lean(),
      Notification.countDocuments({ recipient: req.user.id, isRead: false }),
    ]);
    res.json({ notifications, unreadCount });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/notifications/read-all
 * Marks every notification of the signed-in user as read.
 */
router.patch('/read-all', async (req, res, next) => {
  try {
    await Notification.updateMany({ recipient: req.user.id, isRead: false }, { $set: { isRead: true } });
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Marks one notification as read. Only its recipient can do this.
 */
router.patch('/:id/read', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    const updated = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user.id },
      { $set: { isRead: true } },
      { returnDocument: 'after' }
    );
    if (!updated) return res.status(404).json({ error: 'Notification not found' });
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
