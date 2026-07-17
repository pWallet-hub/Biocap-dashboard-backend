const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimiter');
const { sendCredentialsEmail, sendPasswordChangedEmail } = require('../utils/sendEmail');
const { pickProfileFields, validateRoleSpecificFields } = require('../middleware/validateUserInput');
const { writeAuditLog } = require('../utils/auditLogger');

const ACCESS_TOKEN_EXPIRES_IN = '30m';
const REFRESH_TOKEN_EXPIRES_IN = '7d';
const RESET_TOKEN_EXPIRES_IN = '30m';
const VALID_ROLES = ['admin', 'communication_officer', 'broadcast_media', 'social_media_influencer'];

// ─── Token helpers ─────────────────────────────────────────────────────────────
function createAccessToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
}

function createRefreshToken(userId) {
  // Use a separate secret or the same with distinct payload
  const raw = crypto.randomBytes(40).toString('hex');
  return raw; // Raw token sent to client; we store its hash in DB
}

function createResetToken(email) {
  return jwt.sign(
    { sub: email, purpose: 'password_reset' },
    process.env.JWT_SECRET,
    { expiresIn: RESET_TOKEN_EXPIRES_IN }
  );
}

// ─── Register (admin only) ─────────────────────────────────────────────────────
/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Create a new account and assign its role (admin only)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, email, firstName, lastName, role]
 *             properties:
 *               username: { type: string }
 *               email: { type: string }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *               organization: { type: string }
 *               organizationLink: { type: string, description: "Required when role is broadcast_media" }
 *               socialHandle: { type: string, description: "Used when role is social_media_influencer" }
 *               role:
 *                 type: string
 *                 enum: [admin, communication_officer, broadcast_media, social_media_influencer]
 *     responses:
 *       201: { description: Account created }
 *       400: { description: Validation error }
 *       403: { description: Admin only }
 */
router.post('/register', protect, authorize('admin'), async (req, res) => {
  try {
    const { username, email, firstName, lastName, dateOfBirth, organization, organizationLink, socialHandle, role } = req.body;

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
      username, email, password: hashedPassword, role, firstName, lastName,
      dateOfBirth, organization, organizationLink, socialHandle,
      createdBy: req.user.id,
      isPasswordResetRequired: true,
    });

    const resetToken = createResetToken(newUser.email);
    sendCredentialsEmail(newUser.email, newUser.firstName, tempPassword, resetToken).catch((err) =>
      console.error('Failed to send credentials email:', err.message)
    );

    writeAuditLog({
      req,
      action: 'user.create',
      targetModel: 'User',
      targetId: newUser._id,
      targetLabel: newUser.username,
      detail: { role: newUser.role },
    });

    res.status(201).json({
      message: "Account created. Temporary credentials and a reset token were sent to the user's email.",
      username: newUser.username,
      role: newUser.role,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Login ─────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login — returns access token and refresh token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: Login successful }
 *       401: { description: Invalid credentials }
 *       403: { description: Account deactivated or password reset required }
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    if (!user.isActive) {
      return res.status(403).json({ message: 'This account has been deactivated. Contact an administrator.' });
    }

    if (user.isPasswordResetRequired) {
      return res.status(403).json({
        message: 'Account security reset required. Use /api/auth/reset-password with the token emailed to you before logging in.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

    // Issue tokens
    const accessToken = createAccessToken(user);
    const rawRefreshToken = createRefreshToken(user._id);
    await user.setRefreshToken(rawRefreshToken);

    // Update activity
    user.lastLoginAt = new Date();
    user.loginCount = (user.loginCount || 0) + 1;
    await user.save();

    writeAuditLog({
      req,
      action: 'user.login',
      targetModel: 'User',
      targetId: user._id,
      targetLabel: user.username,
    });

    res.json({
      accessToken,
      refreshToken: rawRefreshToken,
      role: user.role,
      username: user.username,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Refresh Token ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Exchange a valid refresh token for a new access token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken, userId]
 *             properties:
 *               refreshToken: { type: string }
 *               userId: { type: string }
 *     responses:
 *       200: { description: New access token issued }
 *       401: { description: Invalid or expired refresh token }
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken, userId } = req.body;
    if (!refreshToken || !userId) {
      return res.status(400).json({ message: 'refreshToken and userId are required' });
    }

    const user = await User.findById(userId).select('refreshToken role username isActive');
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Invalid token or inactive account' });
    }

    const isValid = await user.compareRefreshToken(refreshToken);
    if (!isValid) {
      return res.status(401).json({ message: 'Refresh token is invalid or has expired' });
    }

    // Issue a new access token (refresh token stays the same until logout)
    const accessToken = createAccessToken(user);
    res.json({ accessToken, expiresIn: ACCESS_TOKEN_EXPIRES_IN });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Logout ────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout — clears the stored refresh token
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Logged out }
 */
router.post('/logout', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { refreshToken: null });

    writeAuditLog({
      req,
      action: 'user.logout',
      targetModel: 'User',
      targetId: req.user.id,
      targetLabel: req.user.username,
    });

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Reset Password (temp password flow) ──────────────────────────────────────
/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Verify the emailed reset token and set a new permanent password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, temp_password, new_password]
 *             properties:
 *               token: { type: string }
 *               temp_password: { type: string }
 *               new_password: { type: string, minLength: 8 }
 *     responses:
 *       200: { description: Password updated }
 *       400: { description: Invalid token or incorrect temp password }
 */
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, temp_password, new_password } = req.body;

    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }

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
    if (!user) return res.status(404).json({ message: 'User not found.' });

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

// ─── Change Password (logged-in user) ─────────────────────────────────────────
/**
 * @swagger
 * /api/auth/change-password:
 *   post:
 *     summary: Change own password (requires current password verification)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 8 }
 *     responses:
 *       200: { description: Password changed }
 *       400: { description: Incorrect current password or weak new password }
 */
router.post('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.refreshToken = null; // Invalidate other sessions
    await user.save();

    sendPasswordChangedEmail(user.email, user.firstName).catch((err) =>
      console.error('[Email] Failed to send password-changed alert:', err.message)
    );

    writeAuditLog({
      req,
      action: 'user.password_change',
      targetModel: 'User',
      targetId: user._id,
      targetLabel: user.username,
    });

    res.json({ message: 'Password changed successfully. All other sessions have been invalidated.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Get current user profile ──────────────────────────────────────────────────
/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get the logged-in user's profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Profile retrieved }
 *       401: { description: Unauthorized }
 */
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -refreshToken');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Update current user profile ──────────────────────────────────────────────
/**
 * @swagger
 * /api/auth/me:
 *   put:
 *     summary: Update the logged-in user's own profile fields
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
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               socialHandle: { type: string }
 *               organization: { type: string }
 *               organizationLink: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *     responses:
 *       200: { description: Profile updated }
 *       401: { description: Unauthorized }
 */
router.put('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const updates = pickProfileFields(req.body);
    Object.assign(user, updates);

    validateRoleSpecificFields(user.role, { organizationLink: user.organizationLink });

    await user.save();

    const { password, refreshToken, ...safeUser } = user.toObject();
    res.json(safeUser);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

module.exports = router;