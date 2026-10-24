const test = require('node:test');
const assert = require('node:assert/strict');

const { cacheGet, cacheSet, cacheDel } = require('../utils/cache');

test('cache returns a stored value until it expires', async () => {
  await cacheSet('k1', { ok: true }, 60);
  assert.deepEqual(await cacheGet('k1'), { ok: true });
});

test('cache misses after the TTL', async () => {
  await cacheSet('k2', 'short-lived', -1);
  assert.equal(await cacheGet('k2'), null);
});

test('cacheDel removes entries', async () => {
  await cacheSet('k3', 'value', 60);
  await cacheDel('k3');
  assert.equal(await cacheGet('k3'), null);
});
