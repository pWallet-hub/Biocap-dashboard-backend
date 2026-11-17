// AFS single sign-on helpers: OpenID Connect with PKCE through Keycloak, and the access check against AFS Command Center.
// Sign-in proves who the person is. Command Center decides whether they may use Biocap, and with which role.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { ALL_ROLES } = require('../constants/roles');

const STATE_COOKIE = 'biocap_sso';
const STATE_TTL_SECONDS = 600;
const STATE_PATH = '/api/auth/sso';

/** A sign-in that AFS refuses, or that cannot be completed. `code` is what the login page shows. */
class SsoFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** SSO settings, or null when single sign-on is disabled. Startup fails if SSO is enabled with settings missing. */
function ssoConfig() {
  if (process.env.AFS_SSO_ENABLED !== 'true') return null;
  const cfg = {
    issuer: process.env.AFS_OIDC_ISSUER || '',
    internalIssuer: process.env.AFS_OIDC_INTERNAL_ISSUER || process.env.AFS_OIDC_ISSUER || '',
    clientId: process.env.AFS_OIDC_CLIENT_ID || '',
    clientSecret: process.env.AFS_OIDC_CLIENT_SECRET || '',
    redirectUri: process.env.AFS_OIDC_REDIRECT_URI || '',
    portalUrl: (process.env.AFS_PORTAL_URL || '').replace(/\/$/, ''),
    commandCenterUrl: process.env.AFS_COMMAND_CENTER_URL || '',
    serviceToken: process.env.AFS_SERVICE_TOKEN || '',
    appSlug: process.env.AFS_APP_SLUG || 'biocap',
  };
  const required = {
    AFS_OIDC_ISSUER: cfg.issuer, AFS_OIDC_CLIENT_ID: cfg.clientId, AFS_OIDC_CLIENT_SECRET: cfg.clientSecret,
    AFS_OIDC_REDIRECT_URI: cfg.redirectUri, AFS_PORTAL_URL: cfg.portalUrl,
    AFS_COMMAND_CENTER_URL: cfg.commandCenterUrl, AFS_SERVICE_TOKEN: cfg.serviceToken,
  };
  const missing = Object.keys(required).filter((k) => !required[k]);
  if (missing.length) throw new Error(`AFS_SSO_ENABLED=true requires: ${missing.join(', ')}`);
  return cfg;
}

/** Only same-site paths are accepted after sign-in (no open redirect). */
function safeNextPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (/[\r\n\t\0]/.test(value)) return '/';
  return value;
}

const base64url = (buf) => buf.toString('base64url');
const randomValue = () => base64url(crypto.randomBytes(24));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Start a sign-in: the Keycloak URL, and the signed cookie that holds this attempt's state. */
function startSignIn(cfg, next, silent) {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = randomValue();
  const nonce = randomValue();
  // Signed with the refresh secret, so an access token can never be mistaken for a sign-in state.
  const cookie = jwt.sign(
    { typ: 'sso_state', state, nonce, verifier, next: safeNextPath(next) },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: STATE_TTL_SECONDS }
  );
  const url = new URL(`${cfg.issuer}/protocol/openid-connect/auth`);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Silent sign-in completes only if the person already signed in to AFS in this browser.
    ...(silent ? { prompt: 'none' } : {}),
  }).toString();
  return { url: url.toString(), cookie };
}

/** The saved state, or null when the cookie is missing, altered or expired. */
function readState(cookie) {
  if (!cookie) return null;
  try {
    const payload = jwt.verify(cookie, process.env.REFRESH_TOKEN_SECRET, { algorithms: ['HS256'] });
    return payload.typ === 'sso_state' ? payload : null;
  } catch {
    return null;
  }
}

/** Exchange the code at Keycloak (server to server) and verify the ID token. Returns its claims. */
async function verifyCallback(cfg, code, state, saved) {
  if (!saved || !code || state !== saved.state) throw new SsoFailure('expired');
  let idToken;
  try {
    const res = await fetch(`${cfg.internalIssuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, client_id: cfg.clientId,
        client_secret: cfg.clientSecret, code_verifier: saved.verifier,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`);
    idToken = (await res.json()).id_token;
  } catch {
    throw new SsoFailure('token');
  }
  try {
    // Keys come over the internal network. The issuer is the public one that Keycloak writes into tokens.
    const jwks = createRemoteJWKSet(new URL(`${cfg.internalIssuer}/protocol/openid-connect/certs`));
    const { payload } = await jwtVerify(idToken, jwks, { issuer: cfg.issuer, audience: cfg.clientId, algorithms: ['RS256'] });
    if (typeof payload.sub !== 'string' || payload.nonce !== saved.nonce) throw new Error('nonce or subject mismatch');
    if (payload.email_verified !== true) throw new SsoFailure('unverified_email');
    return payload;
  } catch (err) {
    if (err instanceof SsoFailure) throw err;
    throw new SsoFailure('invalid_token');
  }
}

/**
 * The central decision for this subject. Throws SsoFailure unless AFS grants Biocap access with a known role.
 * If Command Center cannot be reached, access is refused (fails closed).
 */
async function requireAccess(cfg, subject) {
  let decision;
  try {
    const url = new URL('/api/internal/access', cfg.commandCenterUrl);
    url.search = new URLSearchParams({ application: cfg.appSlug, subject }).toString();
    const res = await fetch(url, { headers: { 'X-Service-Token': cfg.serviceToken }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`access check failed: HTTP ${res.status}`);
    decision = await res.json();
  } catch {
    throw new SsoFailure('unavailable');
  }
  if (!decision.allowed) {
    throw new SsoFailure(decision.reason === 'account disabled' ? 'disabled' : 'not_assigned');
  }
  if (!decision.external_role || !ALL_ROLES.includes(decision.external_role)) throw new SsoFailure('unknown_role');
  return decision.external_role;
}

module.exports = {
  STATE_COOKIE,
  STATE_PATH,
  STATE_TTL_SECONDS,
  SsoFailure,
  ssoConfig,
  safeNextPath,
  sha256,
  randomValue,
  startSignIn,
  readState,
  verifyCallback,
  requireAccess,
};
