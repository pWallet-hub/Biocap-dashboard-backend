const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimiter');
const { sendPasswordChangedEmail, sendPasswordResetEmail } = require('../utils/sendEmail');
const { pickProfileFields, validateRoleSpecificFields } = require('../middleware/validateUserInput');
const { writeAuditLog } = require('../utils/auditLogger');
const { ROLES, ALL_ROLES } = require('../constants/roles');

const ACCESS_TOKEN_EXPIRES_IN = '30m';
const RESET_TOKEN_EXPIRES_IN = '30m';
const PASSWORD_EXPIRY_DAYS = parseInt(process.env.PASSWORD_EXPIRY_DAYS || '90', 10);

// ─── Token helpers ─────────────────────────────────────────────────────────────
function createAccessToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
}

function createRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

function createResetToken(email) {
  return jwt.sign(
    { sub: email, purpose: 'password_reset' },
    process.env.JWT_SECRET,
    { expiresIn: RESET_TOKEN_EXPIRES_IN }
  );
}

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: Public registration, login, token refresh, and password recovery management
 */

// ─── Register (Public Direct Registration) ─────────────────────────────────────
/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Public user registration with own password
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, email, password, firstName, lastName, role]
 *             properties:
 *               username: { type: string }
 *               email: { type: string }
 *               password: { type: string, minLength: 8 }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               role:
 *                 type: string
 *                 enum: [communication_officer, editor, broadcast_content_creator, social_media_content_creator]
 *               dateOfBirth: { type: string, format: date }
 *               organization: { type: string }
 *               organizationLink: { type: string }
 *               socialHandle: { type: string }
 *     responses:
 *       201:
 *         description: Account created successfully
 *       400:
 *         description: Validation error or duplicate email/username
 *       403:
 *         description: Self-assigning admin role forbidden
 */
router.post('/register', authLimiter, async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      firstName,
      lastName,
      dateOfBirth,
      organization,
      organizationLink,
      socialHandle,
      role,
    } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ message: 'Password is required and must be at least 8 characters.' });
    }

    if (!ALL_ROLES.includes(role)) {
      return res.status(400).json({ message: `Role must be one of: ${ALL_ROLES.join(', ')}` });
    }

    if (role === ROLES.ADMIN) {
      return res.status(403).json({ message: 'Admin role cannot be self-assigned.' });
    }

    if (role === ROLES.BROADCAST_CONTENT_CREATOR && !organizationLink) {
      return res.status(400).json({ message: 'organizationLink is required for broadcast_content_creator accounts.' });
    }

    const existingUser = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (existingUser) {
      return res.status(400).json({ message: 'A profile under this email or username already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      username,
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      firstName,
      lastName,
      dateOfBirth,
      organization,
      organizationLink,
      socialHandle,
      isPasswordResetRequired: false,
    });

    writeAuditLog({
      req,
      actor: newUser._id,
      actorRole: newUser.role,
      action: 'user.create',
      targetModel: 'User',
      targetId: newUser._id,
      targetLabel: newUser.username,
      detail: { selfRegistration: true, role: newUser.role },
    });

    res.status(201).json({
      message: 'Account created successfully. You can now log in.',
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
 *     summary: User login — returns access token and refresh token
 *     tags: [Authentication]
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
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account deactivated or password expired
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    if (!user.isActive) {
      return res.status(403).json({ message: 'This account has been deactivated. Contact an administrator.' });
    }

    if (user.isPasswordExpired(PASSWORD_EXPIRY_DAYS)) {
      user.isPasswordResetRequired = true;
      await user.save();
    }

    if (user.isPasswordResetRequired) {
      return res.status(403).json({
        message: 'Password expired. Use /api/auth/forgot-password to reset.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

    const accessToken = createAccessToken(user);
    const rawRefreshToken = createRefreshToken();
    await user.setRefreshToken(rawRefreshToken);

    user.lastLoginAt = new Date();
    user.loginCount = (user.loginCount || 0) + 1;
    await user.save();

    writeAuditLog({
      req,
      actor: user._id,
      actorRole: user.role,
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
 *     summary: Exchange a refresh token for a new access token
 *     tags: [Authentication]
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
 *       200:
 *         description: Access token renewed
 *       401:
 *         description: Invalid refresh token
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
 *     summary: Logout — invalidates session refresh token
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
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

// ─── Forgot Password ───────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Send password reset token email
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string }
 *     responses:
 *       200:
 *         description: Reset email sent if account exists
 */
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(200).json({
        message: 'If an account exists for this email, a password reset link has been sent.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'This account has been deactivated. Contact an administrator.' });
    }

    const resetToken = createResetToken(user.email);
    sendPasswordResetEmail(user.email, user.firstName, resetToken).catch((err) =>
      console.error('[Email] Failed to send password reset email:', err.message)
    );

    res.status(200).json({
      message: 'If an account exists for this email, a password reset link has been sent.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Reset Password ────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Verify token and set new permanent password
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, new_password]
 *             properties:
 *               token: { type: string }
 *               new_password: { type: string, minLength: 8 }
 *     responses:
 *       200:
 *         description: Password reset successful
 */
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password || new_password.length < 8) {
      return res.status(400).json({ message: 'Token and a new password (min 8 chars) are required.' });
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

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(new_password, salt);
    user.isPasswordResetRequired = false;
    user.refreshToken = null;
    await user.save();

    res.json({ message: 'Password updated successfully. You can now log in via /api/auth/login.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Change Password ──────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/auth/change-password:
 *   post:
 *     summary: Change logged-in user password
 *     tags: [Authentication]
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
 *       200:
 *         description: Password updated
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
    user.isPasswordResetRequired = false;
    user.refreshToken = null;
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

// ─── Profile Operations ────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get logged-in user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged-in user document
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

/**
 * @swagger
 * /api/auth/me:
 *   put:
 *     summary: Update own profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               socialHandle: { type: string }
 *               organization: { type: string }
 *               organizationLink: { type: string }
 *     responses:
 *       200:
 *         description: Profile updated
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