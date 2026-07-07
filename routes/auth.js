const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/authMiddleware');
const { sendCredentialsEmail } = require('../utils/sendEmail');

const ACCESS_TOKEN_EXPIRES_IN = '30m';
const RESET_TOKEN_EXPIRES_IN = '30m';
const VALID_ROLES = ['admin', 'communication_officer', 'broadcast_media', 'social_media_influencer'];

// -----------------------------
// Token helpers
// -----------------------------
function createAccessToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
}

function createResetToken(email) {
  return jwt.sign(
    { sub: email, purpose: 'password_reset' },
    process.env.JWT_SECRET,
    { expiresIn: RESET_TOKEN_EXPIRES_IN }
  );
}

// -----------------------------
// Register — ADMIN ONLY: creates an account and assigns its role
// -----------------------------
/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Create a new account and assign its role (admin only). System generates a temporary password and emails it.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - email
 *               - firstName
 *               - lastName
 *               - role
 *             properties:
 *               username: { type: string }
 *               email: { type: string }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *               organization: { type: string }
 *               organizationLink:
 *                 type: string
 *                 description: Required when role is broadcast_media
 *               socialHandle:
 *                 type: string
 *                 description: Used when role is social_media_influencer
 *               role:
 *                 type: string
 *                 enum: [admin, communication_officer, broadcast_media, social_media_influencer]
 *     responses:
 *       201:
 *         description: Account created, temporary credentials emailed
 *       400:
 *         description: User already exists, invalid role, or missing required field for role
 *       403:
 *         description: Only admin can create accounts
 *       500:
 *         description: Server error
 */
router.post('/register', protect, authorize('admin'), async (req, res) => {
  try {
    const {
      username,
      email,
      firstName,
      lastName,
      dateOfBirth,
      organization,
      organizationLink,
      socialHandle,
      role,
    } = req.body;

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ message: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }

    if (role === 'broadcast_media' && !organizationLink) {
      return res.status(400).json({ message: 'organizationLink is required for broadcast_media accounts.' });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ message: 'A profile under this email or username already exists.' });
    }

    const tempPassword = crypto.randomBytes(8).toString('base64url').slice(0, 10);
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);

    const newUser = await User.create({
      username,
      email,
      password: hashedPassword,
      role,
      firstName,
      lastName,
      dateOfBirth,
      organization,
      organizationLink,
      socialHandle,
      createdBy: req.user.id,
      isPasswordResetRequired: true,
    });

    const resetToken = createResetToken(newUser.email);

    sendCredentialsEmail(newUser.email, newUser.firstName, tempPassword, resetToken).catch((err) =>
      console.error('Failed to send credentials email:', err.message)
    );

    res.status(201).json({
      message: 'Account created. Temporary credentials and a reset token were sent to the user\'s email.',
      username: newUser.username,
      role: newUser.role,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------
// Reset Password (unchanged)
// -----------------------------
/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Verify the emailed reset token and set a new password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - temp_password
 *               - new_password
 *             properties:
 *               token: { type: string }
 *               temp_password: { type: string }
 *               new_password: { type: string }
 *     responses:
 *       200:
 *         description: Password updated successfully
 *       400:
 *         description: Invalid or expired token / incorrect temp password
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, temp_password, new_password } = req.body;

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ message: 'The verification token has expired or is invalid.' });
    }

    if (!payload.sub || payload.purpose !== 'password_reset') {
      return res.status(400).json({ message: 'Invalid token metadata.' });
    }

    const user = await User.findOne({ email: payload.sub });
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const isTempValid = await bcrypt.compare(temp_password, user.password);
    if (!isTempValid) {
      return res.status(400).json({ message: 'Temporary password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(new_password, salt);
    user.isPasswordResetRequired = false;
    await user.save();

    res.json({ message: 'Password updated successfully. You can now log in via /api/auth/login.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------
// Login (unchanged)
// -----------------------------
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user and get token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Password reset required before login
 *       500:
 *         description: Server error
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    if (user.isPasswordResetRequired) {
      return res.status(403).json({
        message: 'Account security reset required. Use /api/auth/reset-password with the token emailed to you before logging in.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

    const token = createAccessToken(user);
    res.json({ token, role: user.role, username: user.username });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------
// Get current user profile (unchanged)
// -----------------------------
/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get the logged-in user's profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------
// Update current user profile (unchanged)
// -----------------------------
/**
 * @swagger
 * /api/auth/me:
 *   put:
 *     summary: Update the logged-in user's profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username: { type: string }
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.put('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (req.body.username) user.username = req.body.username;
    await user.save();

    const { password, ...safeUser } = user.toObject();
    res.json(safeUser);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;