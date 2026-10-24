const { getRedis, isRedisReady } = require('../config/redis');

// Shared cache when Redis is connected; otherwise a per-process memory cache.
// Redis errors fall back to memory, so a Redis outage never fails a request.
const memory = new Map();

const memoryGet = (key) => {
  const entry = memory.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memory.delete(key);
    return null;
  }
  return entry.value;
};

const cacheGet = async (key) => {
  if (isRedisReady()) {
    try {
      const raw = await getRedis().get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.error('Cache read failed, using memory:', err.message);
    }
  }
  return memoryGet(key);
};

const cacheSet = async (key, value, ttlSeconds) => {
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  if (isRedisReady()) {
    try {
      await getRedis().set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch (err) {
      console.error('Cache write failed, kept in memory:', err.message);
    }
  }
};

const cacheDel = async (...keys) => {
  keys.forEach((key) => memory.delete(key));
  if (isRedisReady()) {
    try {
      await getRedis().del(keys);
    } catch (err) {
      console.error('Cache invalidate failed:', err.message);
    }
  }
};

module.exports = { cacheGet, cacheSet, cacheDel };
