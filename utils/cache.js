// In-process cache with a time-to-live. Each instance keeps its own copy, so entries can be stale on
// other instances for up to the TTL. Callers treat a miss as normal and read from MongoDB.
const entries = new Map();

const cacheGet = async (key) => {
  const entry = entries.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    entries.delete(key);
    return null;
  }
  return entry.value;
};

const cacheSet = async (key, value, ttlSeconds) => {
  entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
};

const cacheDel = async (...keys) => {
  keys.forEach((key) => entries.delete(key));
};

module.exports = { cacheGet, cacheSet, cacheDel };
