const { createClient } = require('redis');

// Redis is optional. Without REDIS_URL the app runs with per-process fallbacks
// (memory cache, memory rate limits) and logs a notice at startup.
let client = null;

const getRedis = () => {
  if (!process.env.REDIS_URL) return null;

  if (!client) {
    client = createClient({
      url: process.env.REDIS_URL,
      // Fail fast while disconnected instead of queuing commands indefinitely.
      disableOfflineQueue: true,
      socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 5000) },
    });
    client.on('error', (err) => console.error('Redis error:', err.message));
  }
  return client;
};

const connectRedis = async () => {
  const redis = getRedis();
  if (!redis) return null;
  if (!redis.isOpen) await redis.connect();
  return redis;
};

const isRedisReady = () => Boolean(client && client.isReady);

const disconnectRedis = async () => {
  if (client && client.isOpen) await client.quit();
};

module.exports = { getRedis, connectRedis, isRedisReady, disconnectRedis };
