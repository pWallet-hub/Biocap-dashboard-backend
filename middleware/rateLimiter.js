const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedis, isRedisReady } = require('../config/redis');

// Counters are shared through Redis when it is connected, so limits hold across instances.
// Without Redis they stay in process memory, and each instance counts separately.
// passOnStoreError: a Redis failure lets requests through instead of blocking them.
//
// Limiters are built by initRateLimiters(), which server.js calls after its Redis attempt.
// Building them earlier would attach a store before Redis is connected, and it would never count.
const makeStore = (name) => {
  if (!isRedisReady()) return undefined;
  const redis = getRedis();
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

// Route-level wrappers. server.js calls initRateLimiters() before it accepts traffic.
const apiLimiter = (req, res, next) => (apiLimit ? apiLimit(req, res, next) : next());
const authLimiter = (req, res, next) => (authLimit ? authLimit(req, res, next) : next());

module.exports = { apiLimiter, authLimiter, initRateLimiters };
