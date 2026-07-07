const jwt = require('jsonwebtoken');
const User = require('../models/User');

// -----------------------------
// Core auth: requires a valid, non-expired token
// -----------------------------
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Re-check the account is still active — catches accounts deactivated
    // after the token was issued, without waiting for the token to expire.
    const user = await User.findById(decoded.id).select('isActive role username');
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Account is inactive or no longer exists' });
    }

    req.user = { id: decoded.id, username: decoded.username, role: user.role };
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized, token invalid or expired' });
  }
};

// -----------------------------
// Generic role gate — preferred going forward
// Usage: authorize('admin', 'communication_officer')
// -----------------------------
const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied. Insufficient role permissions.' });
  }
  next();
};

// -----------------------------
// Named convenience wrappers (kept so existing routes using them don't break)
// -----------------------------
const adminOnly = authorize('admin');

const reviewerOnly = authorize('admin', 'communication_officer'); // approve/reject/publish

const communicationOfficerOnly = authorize('admin', 'communication_officer');

const broadcastMediaOnly = authorize('admin', 'broadcast_media');

const socialMediaInfluencerOnly = authorize('admin', 'social_media_influencer');

// Any of the 4 blog-creating roles
const creatorOnly = authorize(
  'admin',
  'communication_officer',
  'broadcast_media',
  'social_media_influencer'
);

// Just confirms the user is authenticated, regardless of role
const authenticatedOnly = (req, res, next) => {
  if (req.user) {
    next();
  } else {
    res.status(401).json({ message: 'Not authorized.' });
  }
};

module.exports = {
  protect,
  authorize,
  adminOnly,
  reviewerOnly,
  communicationOfficerOnly,
  broadcastMediaOnly,
  socialMediaInfluencerOnly,
  creatorOnly,
  authenticatedOnly,
};