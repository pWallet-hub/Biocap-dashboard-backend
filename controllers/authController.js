// controllers/authController.js
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role, username: user.username },
    process.env.JWT_SECRET || 'biocap_default_jwt_secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id },
    process.env.REFRESH_TOKEN_SECRET || 'biocap_default_refresh_secret',
    { expiresIn: '30d' }
  );
};

const normalizeOrganizationName = (org) => {
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
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide both username/email and password.' });
    }

    const inputIdentifier = email.trim();

    const user = await User.findOne({
      $or: [
        { email: inputIdentifier.toLowerCase() },
        { username: inputIdentifier },
      ],
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ error: 'Your account has been deactivated. Please contact an admin.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    // Auto-normalize legacy organization values stored in DB before save
    if (user.organization) {
      user.organization = normalizeOrganizationName(user.organization);
    }

    user.lastLoginAt = new Date();
    user.loginCount = (user.loginCount || 0) + 1;

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    if (typeof user.setRefreshToken === 'function') {
      await user.setRefreshToken(refreshToken);
    } else {
      const salt = await bcrypt.genSalt(10);
      user.refreshToken = await bcrypt.hash(refreshToken, salt);
    }

    // Save only modified fields during login
    await user.save({ validateModifiedOnly: true });

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshToken;

    return res.status(200).json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      role: user.role,
      username: user.username,
      user: userObj,
    });
  } catch (err) {
    console.error('Login Error:', err);
    return res.status(500).json({ error: err.message || 'Server error during login.' });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required.' });
    }

    const decoded = jwt.verify(
      refreshToken,
      process.env.REFRESH_TOKEN_SECRET || 'biocap_default_refresh_secret'
    );

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User session expired or account deactivated.' });
    }

    const isValidToken =
      typeof user.compareRefreshToken === 'function'
        ? await user.compareRefreshToken(refreshToken)
        : await bcrypt.compare(refreshToken, user.refreshToken || '');

    if (!isValidToken) {
      return res.status(401).json({ error: 'Invalid or revoked refresh token.' });
    }

    const newAccessToken = generateAccessToken(user);

    return res.status(200).json({
      accessToken: newAccessToken,
      role: user.role,
      username: user.username,
    });
  } catch (err) {
    console.error('Refresh Token Error:', err);
    return res.status(401).json({ error: 'Invalid or expired refresh token.' });
  }
};

exports.logout = async (req, res) => {
  try {
    if (req.user?.id) {
      const user = await User.findById(req.user.id);
      if (user) {
        user.refreshToken = null;
        await user.save({ validateModifiedOnly: true });
      }
    }
    return res.status(200).json({ message: 'Logged out successfully.' });
  } catch (err) {
    console.error('Logout Error:', err);
    return res.status(500).json({ error: 'Server error during logout.' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -refreshToken');
    if (!user) {
      return res.status(404).json({ error: 'User profile not found.' });
    }
    return res.status(200).json(user);
  } catch (err) {
    console.error('Get Me Error:', err);
    return res.status(500).json({ error: 'Failed to retrieve profile.' });
  }
};