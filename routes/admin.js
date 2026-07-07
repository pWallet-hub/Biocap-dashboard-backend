const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const VALID_ROLES = ['admin', 'communication_officer', 'broadcast_media', 'social_media_influencer'];

// Protect ALL routes in this file - requires login AND admin role
router.use(protect);
router.use(adminOnly);

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get all users (Admin Only)
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 */
router.get('/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/admin/users/{id}:
 *   get:
 *     summary: Get a single user's profile (Admin Only)
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 */
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/admin/users/{id}/role:
 *   patch:
 *     summary: Change a user's role (Admin Only)
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [admin, communication_officer, broadcast_media, social_media_influencer]
 *               organizationLink:
 *                 type: string
 *                 description: Required if switching a user to broadcast_media
 */
router.patch('/users/:id/role', async (req, res) => {
  try {
    const { role, organizationLink } = req.body;

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    }

    if (req.params.id === req.user.id && role !== 'admin') {
      return res.status(400).json({ message: 'You cannot remove your own admin role' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (role === 'broadcast_media' && !organizationLink && !user.organizationLink) {
      return res.status(400).json({ message: 'organizationLink is required when assigning the broadcast_media role' });
    }

    user.role = role;
    if (organizationLink) user.organizationLink = organizationLink;

    await user.save();
    const { password, ...safeUser } = user.toObject();

    res.json({ message: 'Role updated successfully', user: safeUser });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/admin/users/{id}/deactivate:
 *   patch:
 *     summary: Deactivate a user account without deleting it (Admin Only)
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 */
router.patch('/users/:id/deactivate', async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ message: 'You cannot deactivate your own account' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User deactivated', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/admin/users/{id}/reactivate:
 *   patch:
 *     summary: Reactivate a previously deactivated user (Admin Only)
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 */
router.patch('/users/:id/reactivate', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: true },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User reactivated', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/admin/users/{id}:
 *   delete:
 *     summary: Permanently delete a user (Admin Only)
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }

    const deletedUser = await User.findByIdAndDelete(req.params.id);
    if (!deletedUser) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User removed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;