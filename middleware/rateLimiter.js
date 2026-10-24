const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedis } = require('../config/redis');

// Counters live in Redis when REDIS_URL is set, so limits hold across instances.
// Without it they fall back to per-process memory.
// passOnStoreError: a Redis outage lets requests through instead of failing them.
// Limiters are created once by initRateLimiters(), which server.js calls after Redis connects.
const makeStore = (name) => {
  const redis = getRedis();
  if (!redis) return undefined;
  return new RedisStore({
    prefix: `rl:${name}:`,
    sendCommand: (...args) => redis.sendCommand(args),
  });
};

let apiLimit = null;
let authLimit = null;

const initRateLimiters = () => {
  apiLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.API_RATE_LIMIT_MAX) || 1000, // high default: staff often share one office IP
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    passOnStoreError: true,
    store: makeStore('api'),
    message: {
      error: 'Too many requests from this IP. Please wait 15 minutes before trying again.',
    },
  });

  authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    passOnStoreError: true,
    store: makeStore('auth'),
    message: {
      error: 'Too many authentication attempts. Please wait 15 minutes before trying again.',
    },
  });
};

// Route-level wrappers. Routes are only mounted after initRateLimiters() has run in server.js.
const apiLimiter = (req, res, next) => (apiLimit ? apiLimit(req, res, next) : next());
const authLimiter = (req, res, next) => (authLimit ? authLimit(req, res, next) : next());

module.exports = { apiLimiter, authLimiter, initRateLimiters };
