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
 * Normalizes legacy or abbreviated organization strings stored in old DB records.
 */
function normalizeOrganizationName(org) {
  if (!org) return org;
  const lower = org.toString().toLowerCase().trim();
  if (
    lower === 'asr-rwanda' ||
    lower === 'afs-rwanda' ||
    lower.includes('alliance for science') ||
    lower.includes('asr')
  ) {
    return 'Alliance for Science Rwanda (AfS-Rwanda)';
  }
  return org;
}

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: Public registration, login, token refresh, and password recovery management
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - email
 *               - password
 *               - firstName
 *               - lastName
 *               - role
 *             properties:
 *               username:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               role:
 *                 type: string
 *               organization:
 *                 type: string
 *               jobTitle:
 *                 type: string
 *               organizationLink:
 *                 type: string
 *               socialHandle:
 *                 type: string
 *     responses:
 *       201:
 *         description: Account created successfully
 *       400:
 *         description: Validation error or profile already exists
 *       403:
 *         description: Forbidden role assignment
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
      organization: rawOrganization,
      jobTitle,
      job_title,
      title,
      organizationLink: rawOrganizationLink,
      organization_link,
      socialHandle: rawSocialHandle,
      social_handle,
      role,
    } = req.body;

    const organizationLink = rawOrganizationLink || organization_link;
    const socialHandle = rawSocialHandle || social_handle;

    if (!username || !email || !password || !firstName || !lastName) {
      return res.status(400).json({ message: 'Please fill out all required fields.' });
    }

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

    const organization = normalizeOrganizationName(rawOrganization);
    const isAfSRwanda = organization === 'Alliance for Science Rwanda (AfS-Rwanda)';

    let finalJobTitle = (jobTitle || job_title || title || '').toString().trim();
    if (!finalJobTitle) {
      finalJobTitle = isAfSRwanda ? 'AfS Representative' : 'Contributor';
    }

    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase().trim() }, { username: username.trim() }],
    });
    if (existingUser) {
      return res.status(400).json({ message: 'A profile under this email or username already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dateOfBirth,
      organization,
      jobTitle: finalJobTitle,
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
    if (error.name === 'ValidationError' || error.code === 11000) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Authenticate user and obtain tokens
 *     tags: [Authentication]
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
 *               email:
 *                 type: string
 *                 description: Email address or username
 *               password:
 *                 type: string
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
      return res.status(400).json({ message: 'email/username and password are required' });
    }

    const inputIdentifier = email.trim();

    const user = await User.findOne({
      $or: [
        { email: inputIdentifier.toLowerCase() },
        { username: inputIdentifier },
      ],
    });

    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    if (!user.isActive) {
      return res.status(403).json({ message: 'This account has been deactivated. Contact an administrator.' });
    }

    if (user.isPasswordExpired(PASSWORD_EXPIRY_DAYS)) {
      user.isPasswordResetRequired = true;
      await user.save({ validateModifiedOnly: true });
    }

    if (user.isPasswordResetRequired) {
      return res.status(403).json({
        message: 'Password expired. Use /api/auth/forgot-password to reset.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

    if (user.organization) {
      user.organization = normalizeOrganizationName(user.organization);
    }

    const accessToken = createAccessToken(user);
    const rawRefreshToken = createRefreshToken();
    await user.setRefreshToken(rawRefreshToken);

    user.lastLoginAt = new Date();
    user.loginCount = (user.loginCount || 0) + 1;

    await user.save({ validateModifiedOnly: true });

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

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token using refresh token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *               - userId
 *             properties:
 *               refreshToken:
 *                 type: string
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: New access token issued
 *       401:
 *         description: Invalid or expired refresh token
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

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Log out current user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       401:
 *         description: Unauthorized
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

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request a password reset link
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
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

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password using reset token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password updated successfully
 *       400:
 *         description: Invalid or expired token
 */
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, new_password, newPassword } = req.body;
    const targetPassword = new_password || newPassword;

    if (!token || !targetPassword || targetPassword.length < 8) {
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
    user.password = await bcrypt.hash(targetPassword, salt);
    user.isPasswordResetRequired = false;
    user.refreshToken = null;
    await user.save({ validateModifiedOnly: true });

    res.json({ message: 'Password updated successfully. You can now log in via /api/auth/login.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auth/change-password:
 *   post:
 *     summary: Change password for authenticated user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Invalid password or validation failure
 */
router.post('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, oldPassword, current_password, newPassword, new_password } = req.body;

    const actualCurrent = currentPassword || oldPassword || current_password;
    const actualNew = newPassword || new_password;

    if (!actualCurrent || !actualNew) {
      return res.status(400).json({ message: 'Current password and new password are required.' });
    }
    if (actualNew.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isMatch = await bcrypt.compare(actualCurrent, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(actualNew, salt);
    user.isPasswordResetRequired = false;
    user.refreshToken = null;

    await user.save({ validateModifiedOnly: true });

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

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current authenticated user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved
 *       401:
 *         description: Unauthorized
 *   put:
 *     summary: Update current authenticated user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               jobTitle:
 *                 type: string
 *               organizationLink:
 *                 type: string
 *               socialHandle:
 *                 type: string
 *               dateOfBirth:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated
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

router.put('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const updates = typeof pickProfileFields === 'function' ? pickProfileFields(req.body) : {};
    Object.assign(user, updates);

    const {
      firstName,
      lastName,
      jobTitle,
      job_title,
      title,
      organizationLink,
      organization_link,
      socialHandle,
      social_handle,
      dateOfBirth,
    } = req.body;

    if (firstName !== undefined) user.firstName = firstName.toString().trim();
    if (lastName !== undefined) user.lastName = lastName.toString().trim();

    const activeJobTitle = jobTitle || job_title || title;
    if (activeJobTitle !== undefined) {
      user.jobTitle = activeJobTitle.toString().trim();
    }

    const activeOrgLink = organizationLink || organization_link;
    if (activeOrgLink !== undefined) {
      user.organizationLink = activeOrgLink.toString().trim();
    }

    const activeSocialHandle = socialHandle || social_handle;
    if (activeSocialHandle !== undefined) {
      user.socialHandle = activeSocialHandle.toString().trim();
    }

    if (dateOfBirth !== undefined) {
      user.dateOfBirth = dateOfBirth;
    }

    if (typeof validateRoleSpecificFields === 'function') {
      validateRoleSpecificFields(user.role, { organizationLink: user.organizationLink });
    }

    await user.save({ validateModifiedOnly: true });

    const { password, refreshToken, ...safeUser } = user.toObject();
    res.json(safeUser);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

module.exports = router;