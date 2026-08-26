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

exports.register = async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      firstName,
      lastName,
      dateOfBirth,
      organization,
      jobTitle,
      job_title,
      title,
      organizationLink,
      organization_link,
      socialHandle,
      social_handle,
      role,
    } = req.body;

    if (!username || !email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'Please fill out all required fields.' });
    }

    const normalizedOrg = normalizeOrganizationName(organization);
    const isAfSRwanda = normalizedOrg === 'Alliance for Science Rwanda (AfS-Rwanda)';

    // Extract job title from any payload key variant
    let finalJobTitle = (jobTitle || job_title || title || '').toString().trim();

    // Auto-assign default job title for AfS-Rwanda or general fallback if missing
    if (!finalJobTitle) {
      if (isAfSRwanda) {
        finalJobTitle = 'AfS Representative';
      } else {
        finalJobTitle = 'Contributor';
      }
    }

    const existingUser = await User.findOne({
      $or: [
        { email: email.toString().trim().toLowerCase() },
        { username: username.toString().trim() },
      ],
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already registered.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      username: username.toString().trim(),
      email: email.toString().trim().toLowerCase(),
      password: hashedPassword,
      firstName: firstName.toString().trim(),
      lastName: lastName.toString().trim(),
      dateOfBirth: dateOfBirth || undefined,
      organization: normalizedOrg,
      jobTitle: finalJobTitle,
      organizationLink: (organizationLink || organization_link || '').toString().trim() || undefined,
      socialHandle: (socialHandle || social_handle || '').toString().trim() || undefined,
      role: role || 'principal_investigator',
    });

    await newUser.save();

    const userObj = newUser.toObject();
    delete userObj.password;
    delete userObj.refreshToken;

    return res.status(201).json({
      message: 'Registration successful',
      username: newUser.username,
      role: newUser.role,
      user: userObj,
    });
  } catch (err) {
    console.error('Registration Error:', err);

    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Username or email already exists.' });
    }

    return res.status(400).json({ error: err.message || 'Server error during registration.' });
  }
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

/**
 * PUT /api/auth/me or PUT /api/auth/profile
 * Allows authenticated users to update their profile details.
 */
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized user session.' });
    }

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

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found.' });
    }

    if (firstName !== undefined) user.firstName = firstName.toString().trim();
    if (lastName !== undefined) user.lastName = lastName.toString().trim();

    // Extract job title from payload variants
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

    await user.save({ validateModifiedOnly: true });

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshToken;

    return res.status(200).json({
      message: 'Profile updated successfully',
      user: userObj,
    });
  } catch (err) {
    console.error('Update Profile Error:', err);
    return res.status(500).json({ error: err.message || 'Server error updating profile.' });
  }
};