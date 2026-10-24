const rateLimit = require('express-rate-limit');

// Counters are kept in process memory. With several instances, each instance counts separately,
// so the effective limit is multiplied by the number of instances. Run one instance, or put the limit at the proxy.

/**
 * General API limiter, applied to every /api route.
 * Default 1000 requests per 15 minutes per IP (override with API_RATE_LIMIT_MAX).
 * The default is high because staff often share one office IP.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT_MAX) || 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP. Please wait 15 minutes before trying again.',
  },
});

/**
 * Strict limiter for auth-sensitive endpoints (login, registration, password reset).
 * 10 attempts per 15 minutes per IP.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts. Please wait 15 minutes before trying again.',
  },
});

module.exports = { apiLimiter, authLimiter };
