const jwt = require('jsonwebtoken');

// Middleware to protect routes (Requires a valid logged-in user)
const protect = (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header (Format: Bearer <token>)
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Attach user data to request object
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized, token invalid or expired' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token provided' });
  }
};

// Middleware to restrict access to Admins only
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Administrator privileges required.' });
  }
};

// Middleware to restrict access to Students (or Admins) — e.g. adding books
const studentOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'student' || req.user.role === 'admin')) {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Only students can perform this action.' });
  }
};

// Middleware to restrict access to Editors (or Admins) — e.g. editing books
const editorOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'editor' || req.user.role === 'admin')) {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Only editors can perform this action.' });
  }
};

// Middleware that just confirms the user is authenticated, regardless of role
// (mirrors require_authenticated in the FastAPI version — useful when a route
// needs req.user populated but doesn't care which role it is)
const authenticatedOnly = (req, res, next) => {
  if (req.user) {
    next();
  } else {
    res.status(401).json({ message: 'Not authorized.' });
  }
};

module.exports = { protect, adminOnly, studentOnly, editorOnly, authenticatedOnly };