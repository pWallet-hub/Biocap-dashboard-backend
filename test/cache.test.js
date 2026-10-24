const test = require('node:test');
const assert = require('node:assert/strict');

const { cacheGet, cacheSet, cacheDel } = require('../utils/cache');

// With no REDIS_URL the cache must behave as a permanent miss and never throw.
test('cache helpers fail open when Redis is not configured', async () => {
  delete process.env.REDIS_URL;

  assert.equal(await cacheGet('any-key'), null);
  await assert.doesNotReject(cacheSet('any-key', { ok: true }, 60));
  await assert.doesNotReject(cacheDel('any-key'));
});
