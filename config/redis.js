const { createClient } = require('redis');

// Redis is optional. Without REDIS_URL the app keeps cache and rate-limit counters in process memory.
// The client never queues commands while disconnected, so a Redis outage fails fast and callers fall back.
let client = null;

const getRedis = () => {
  if (!process.env.REDIS_URL) return null;

  if (!client) {
    client = createClient({
      url: process.env.REDIS_URL,
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
