const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/authMiddleware');

// Protect ALL routes in this file - requires login AND admin role
router.use(protect);
router.use(adminOnly);

/**
 * @swagger
 * /api/admin/users:
 * get:
 * summary: Get all users (Admin Only)
 * tags: [Admin Management]
 */
router.get('/users', async (req, res) => {
  try {
    const users = await User.find().select('-password'); // Return users without their hashed passwords
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/admin/users/{id}/role:
 * patch:
 * summary: Change user role (Admin Only)
 * tags: [Admin Management]
 */
router.patch('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role assignment' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select('-password');

    if (!updatedUser) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'Role updated successfully', user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/admin/users/{id}:
 * delete:
 * summary: Delete a user (Admin Only)
 * tags: [Admin Management]
 */
router.delete('/users/:id', async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);
    if (!deletedUser) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User removed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;