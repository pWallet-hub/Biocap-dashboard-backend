// Access and refresh tokens, shared by password sign-in and AFS SSO so both issue the same kind of session.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ACCESS_TOKEN_EXPIRES_IN = '7d';
// AFS SSO sessions are shorter: a revoked assignment is noticed at the next token refresh, which asks AFS again.
const SSO_ACCESS_TOKEN_EXPIRES_IN = '8h';

function createAccessToken(user, expiresIn = ACCESS_TOKEN_EXPIRES_IN) {
  return jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn, algorithm: 'HS256' }
  );
}

function createRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

module.exports = { ACCESS_TOKEN_EXPIRES_IN, SSO_ACCESS_TOKEN_EXPIRES_IN, createAccessToken, createRefreshToken };
