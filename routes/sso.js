// AFS single sign-on routes, mounted at /api/auth/sso. The browser reaches the callback directly from Keycloak, so these
// routes are public. Each sign-in ends on the frontend with a one-time code, which the frontend exchanges for a session.
const express = require('express');
const User = require('../models/User');
const SsoCode = require('../models/SsoCode');
const { writeAuditLog } = require('../utils/auditLogger');
const { createAccessToken, createRefreshToken, SSO_ACCESS_TOKEN_EXPIRES_IN } = require('../services/tokens');
const {
  ssoConfig, SsoFailure, STATE_COOKIE, STATE_PATH, STATE_TTL_SECONDS,
  startSignIn, readState, verifyCallback, requireAccess, sha256, randomValue,
} = require('../services/afsSso');

const router = express.Router();
const CODE_TTL_SECONDS = 60;

function readCookie(header, name) {
  for (const part of (header || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

const stateCookieOptions = (req) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: req.secure,
  path: STATE_PATH,
  maxAge: STATE_TTL_SECONDS * 1000,
});

/** Whether single sign-on is switched on. The login page asks this before it shows the AFS button. */
router.get('/config', (req, res) => {
  res.json({ enabled: ssoConfig() !== null });
});

/** Start a sign-in. `silent=1` asks Keycloak not to show a form, for a person who is already signed in to AFS. */
router.get('/login', (req, res) => {
  const cfg = ssoConfig();
  if (!cfg) return res.status(404).json({ message: 'Single sign-on is not enabled' });
  const { url, cookie } = startSignIn(cfg, req.query.next, req.query.silent === '1');
  res.cookie(STATE_COOKIE, cookie, stateCookieOptions(req));
  res.redirect(url);
});

/**
 * Keycloak returns here. Every outcome ends on the frontend: success with a one-time code, failure with a short code
 * that the login page explains. Details go to the server log only.
 */
router.get('/callback', async (req, res) => {
  const cfg = ssoConfig();
  if (!cfg) return res.status(404).json({ message: 'Single sign-on is not enabled' });
  const saved = readState(readCookie(req.headers.cookie, STATE_COOKIE));
  res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
  try {
    const { code, state, error } = req.query;
    if (error) {
      // No AFS session for a silent sign-in: the login page shows its form instead of an error.
      if (error === 'login_required' || error === 'interaction_required') throw new SsoFailure('silent');
      throw new SsoFailure('cancelled');
    }
    const claims = await verifyCallback(cfg, code, state, saved);
    // AFS decides first. Nothing is linked for a person AFS has not assigned to Biocap.
    const role = await requireAccess(cfg, claims.sub);
    const user = await linkedAccount(claims, req.ip);
    user.role = role;
    await user.save({ validateModifiedOnly: true });

    const oneTimeCode = randomValue();
    await SsoCode.create({ codeHash: sha256(oneTimeCode), user: user._id, expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000) });
    writeAuditLog({
      req,
      actor: user._id,
      actorRole: role,
      action: 'user.sso_login',
      targetModel: 'User',
      targetId: user._id,
      targetLabel: user.username,
      detail: { role },
    });
    return res.redirect(`${cfg.portalUrl}/auth/sso/complete?code=${encodeURIComponent(oneTimeCode)}&next=${encodeURIComponent(saved.next)}`);
  } catch (err) {
    if (!(err instanceof SsoFailure)) console.error('[SSO] callback failed:', err);
    const code = err instanceof SsoFailure ? err.code : 'unavailable';
    return res.redirect(`${cfg.portalUrl}/auth/login?sso_error=${code}`);
  }
});

/**
 * The account linked to this identity, or the existing account with the same verified email, which is then linked.
 * Accounts are never created here; an administrator creates them first.
 */
async function linkedAccount(claims, ip) {
  const byIdentity = await User.findOne({ keycloakSub: claims.sub });
  if (byIdentity) {
    if (!byIdentity.isActive) throw new SsoFailure('disabled');
    return byIdentity;
  }
  const byEmail = await User.findOne({ email: String(claims.email).trim().toLowerCase(), keycloakSub: null });
  if (!byEmail) throw new SsoFailure('no_account');
  if (!byEmail.isActive) throw new SsoFailure('disabled');
  byEmail.keycloakSub = claims.sub;
  writeAuditLog({
    req: { ip },
    actor: byEmail._id,
    actorRole: byEmail.role,
    action: 'user.sso_link',
    targetModel: 'User',
    targetId: byEmail._id,
    targetLabel: byEmail.username,
  });
  return byEmail;
}

/** The frontend trades its one-time code for a session. A code works once and only within its short lifetime. */
router.post('/exchange', async (req, res) => {
  if (!ssoConfig()) return res.status(404).json({ message: 'Single sign-on is not enabled' });
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!code) return res.status(400).json({ message: 'code is required' });

  const row = await SsoCode.findOneAndUpdate(
    { codeHash: sha256(code), usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
    { new: false }
  );
  if (!row) return res.status(400).json({ message: 'This sign-in link is invalid or has expired. Sign in again.' });

  const user = await User.findById(row.user);
  if (!user || !user.isActive) return res.status(401).json({ message: 'Account is not active' });

  const accessToken = createAccessToken(user, SSO_ACCESS_TOKEN_EXPIRES_IN);
  const refreshToken = createRefreshToken();
  await user.setRefreshToken(refreshToken);
  user.lastLoginAt = new Date();
  user.loginCount = (user.loginCount || 0) + 1;
  await user.save({ validateModifiedOnly: true });

  const userObj = user.toObject();
  delete userObj.password;
  delete userObj.refreshToken;
  res.json({
    accessToken,
    refreshToken,
    role: user.role,
    username: user.username,
    expiresIn: SSO_ACCESS_TOKEN_EXPIRES_IN,
    user: userObj,
  });
});

module.exports = router;
