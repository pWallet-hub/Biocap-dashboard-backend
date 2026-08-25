const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { REVIEWERS, PUBLISHERS, USER_MANAGERS, ROLE_MANAGERS, CREATORS, ROLES } = require('../constants/roles');

// Strict protection: requires a valid token
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

// Optional protection: attaches user if token is present, but allows guests through if not
const optionalProtect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(); // Proceed as guest
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('isActive role username');
    if (user && user.isActive) {
      req.user = { id: decoded.id, username: decoded.username, role: user.role };
    }
  } catch (error) {
    // Ignore invalid tokens for public endpoints
  }
  next();
};

const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied. Insufficient role permissions.' });
  }
  next();
};

const adminOnly = authorize(ROLES.ADMIN);
const reviewerOnly = authorize(...REVIEWERS);
const publisherOnly = authorize(...PUBLISHERS);
const userManagerOnly = authorize(...USER_MANAGERS);
const roleManagerOnly = authorize(...ROLE_MANAGERS);
const creatorOnly = authorize(...CREATORS);
const editorOnly = authorize(ROLES.EDITOR);

const authenticatedOnly = (req, res, next) => {
  if (req.user) {
    next();
  } else {
    res.status(401).json({ message: 'Not authorized.' });
  }
};

module.exports = {
  protect,
  optionalProtect, // Exported for public routes
  authorize,
  adminOnly,
  reviewerOnly,
  publisherOnly,
  userManagerOnly,
  roleManagerOnly,
  creatorOnly,
  editorOnly,
  authenticatedOnly,
};