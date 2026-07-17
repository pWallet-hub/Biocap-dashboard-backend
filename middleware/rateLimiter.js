const rateLimit = require('express-rate-limit');

/**
 * General API limiter — applies to all /api/* routes.
 * Allows 100 requests per 15 minutes per IP.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,   // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP. Please wait 15 minutes before trying again.',
  },
});

/**
 * Strict limiter for auth-sensitive endpoints (login, reset-password).
 * Allows 10 attempts per 15 minutes per IP.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts. Please wait 15 minutes before trying again.',
  },
});

module.exports = { apiLimiter, authLimiter };
