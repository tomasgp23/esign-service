const crypto = require('node:crypto');

// Lets a platform admin preview a client org's dashboard exactly as one of
// its three roles would see it — for support/QA, not for acting on an
// org's behalf. Same minimal signed-token shape as lib/partnerToken.js
// (HMAC over a base64url payload), but this one never needs a DB lookup to
// verify: the org and role to preview are baked into the token itself, and
// requireOrgSession additionally requires the admin's own real session to
// still be valid before honoring it (see requireOrgSession.js).
const SECRET = process.env.SESSION_SECRET || 'dev-secret';
const TTL_SECONDS = 60 * 60; // 1 hour, same as a login session's rough scale
const COOKIE_NAME = 'esign_impersonate';

function mintImpersonationToken(orgId, role) {
  const payload = { orgId, role, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyImpersonationToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return { orgId: payload.orgId, role: payload.role };
}

module.exports = { mintImpersonationToken, verifyImpersonationToken, COOKIE_NAME, TTL_SECONDS };
