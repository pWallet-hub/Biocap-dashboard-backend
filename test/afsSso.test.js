const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

// SSO reads its settings from the environment. Set them before the modules are loaded.
process.env.REFRESH_TOKEN_SECRET = 'refresh-secret-for-sso-tests-0123456789abcdef';
process.env.AFS_SSO_ENABLED = 'true';
process.env.AFS_OIDC_ISSUER = 'http://localhost:8081/realms/afs';
process.env.AFS_OIDC_CLIENT_ID = 'biocap';
process.env.AFS_OIDC_CLIENT_SECRET = 'client-secret-for-sso-tests';
process.env.AFS_OIDC_REDIRECT_URI = 'http://localhost:5000/api/auth/sso/callback';
process.env.AFS_PORTAL_URL = 'http://localhost:3000';
process.env.AFS_COMMAND_CENTER_URL = 'http://backend:8000';
process.env.AFS_SERVICE_TOKEN = 'service-token-for-sso-tests-0123456789';

const sso = require('../services/afsSso');
const cfg = sso.ssoConfig();

test('safeNextPath keeps same-site paths and sends anything else home', () => {
  assert.equal(sso.safeNextPath('/admin/users'), '/admin/users');
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'admin', undefined, '/a\nb']) {
    assert.equal(sso.safeNextPath(bad), '/');
  }
});

test('sign-in start carries PKCE and a state bound to a signed cookie', () => {
  const { url, cookie } = sso.startSignIn(cfg, '/admin', false);
  const params = new URL(url).searchParams;
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.equal(params.get('client_id'), 'biocap');
  assert.equal(params.get('prompt'), null);
  const saved = sso.readState(cookie);
  assert.equal(saved.state, params.get('state'));
  assert.equal(saved.nonce, params.get('nonce'));
  assert.equal(saved.next, '/admin');
});

test('silent sign-in asks Keycloak not to show a form', () => {
  const { url } = sso.startSignIn(cfg, '/', true);
  assert.equal(new URL(url).searchParams.get('prompt'), 'none');
});

test('a state cookie signed with another secret, or an access token, is refused', () => {
  const forged = jwt.sign({ typ: 'sso_state', state: 'a', nonce: 'b', verifier: 'c', next: '/' }, 'not-the-real-secret-value-0000000000');
  assert.equal(sso.readState(forged), null);
  const accessToken = jwt.sign({ id: 'someone', role: 'admin' }, process.env.REFRESH_TOKEN_SECRET);
  assert.equal(sso.readState(accessToken), null);
  assert.equal(sso.readState(undefined), null);
});

test('a callback without a matching saved state is refused as expired', async () => {
  await assert.rejects(sso.verifyCallback(cfg, 'code', 'state', null), (err) => err.code === 'expired');
  const { cookie } = sso.startSignIn(cfg, '/', false);
  await assert.rejects(sso.verifyCallback(cfg, 'code', 'other-state', sso.readState(cookie)), (err) => err.code === 'expired');
});

test('SSO settings are required together when enabled', () => {
  const saved = process.env.AFS_OIDC_CLIENT_SECRET;
  delete process.env.AFS_OIDC_CLIENT_SECRET;
  assert.throws(() => sso.ssoConfig(), /AFS_OIDC_CLIENT_SECRET/);
  process.env.AFS_OIDC_CLIENT_SECRET = saved;
});

// Access decisions come from AFS Command Center. The HTTP call is replaced for these tests.
async function decide(response) {
  const realFetch = global.fetch;
  global.fetch = async () => response;
  try {
    return await sso.requireAccess(cfg, 'subject-123');
  } finally {
    global.fetch = realFetch;
  }
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('an assigned person gets the central role', async () => {
  assert.equal(await decide(json({ allowed: true, external_role: 'editor', reason: 'ok' })), 'editor');
});

test('an unassigned person is refused as not_assigned', async () => {
  await assert.rejects(decide(json({ allowed: false, external_role: null, reason: 'not assigned' })), (err) => err.code === 'not_assigned');
});

test('a disabled account is refused as disabled', async () => {
  await assert.rejects(decide(json({ allowed: false, external_role: null, reason: 'account disabled' })), (err) => err.code === 'disabled');
});

test('a role Biocap does not know grants nothing', async () => {
  await assert.rejects(decide(json({ allowed: true, external_role: 'superuser', reason: 'ok' })), (err) => err.code === 'unknown_role');
});

test('when Command Center cannot be reached, access is refused', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('connection refused'); };
  try {
    await assert.rejects(sso.requireAccess(cfg, 'subject-123'), (err) => err.code === 'unavailable');
  } finally {
    global.fetch = realFetch;
  }
});
