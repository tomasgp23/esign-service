const crypto = require('node:crypto');

// Adapted from the BDN Sales CRM's _shared/partner-token.ts: a minimal
// HMAC-signed bearer token (not a full JWT) carrying {cid, exp}, signed
// with one server-wide secret. The token alone doesn't prove a client is
// still allowed to act — requireApiKey additionally re-checks the live
// api_clients row on every request, so revoking a client takes effect
// immediately rather than waiting out the token's TTL.
const SECRET = process.env.API_TOKEN_SECRET || 'dev-api-token-secret';
const DEFAULT_TTL_SECONDS = 3600;

function mintToken(clientId, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const payload = { cid: clientId, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
  return { token: `${payloadB64}.${sig}`, expiresIn: ttlSeconds };
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
  if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return { clientId: payload.cid };
}

module.exports = { mintToken, verifyToken };
