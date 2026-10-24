const { getRedis, isRedisReady } = require('../config/redis');

// Cache helpers. Every call fails open: if Redis is missing or errors, callers get a miss
// and read from MongoDB, so a Redis outage slows responses but never breaks them.

const cacheGet = async (key) => {
  if (!isRedisReady()) return null;
  try {
    const raw = await getRedis().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Cache read failed:', err.message);
    return null;
  }
};

const cacheSet = async (key, value, ttlSeconds) => {
  if (!isRedisReady()) return;
  try {
    await getRedis().set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch (err) {
    console.error('Cache write failed:', err.message);
  }
};

const cacheDel = async (...keys) => {
  if (!isRedisReady()) return;
  try {
    await getRedis().del(keys);
  } catch (err) {
    console.error('Cache invalidate failed:', err.message);
  }
};

module.exports = { cacheGet, cacheSet, cacheDel };
