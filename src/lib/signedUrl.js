const crypto = require('node:crypto');

// Short-lived signed file URLs — the local-disk equivalent of Supabase's
// createSignedUrl(). A file is never served directly off disk by path;
// every read goes through /files/:token, and the token carries its own
// expiry and an HMAC so it can't be edited or extended by the client.
function sign(orgId, relativePath, ttlSeconds) {
  const exp = Date.now() + ttlSeconds * 1000;
  const payload = `${orgId}:${relativePath}:${exp}`;
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET || 'dev-secret')
    .update(payload)
    .digest('base64url');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verify(token) {
  let decoded;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const parts = decoded.split(':');
  if (parts.length !== 4) return null;
  const [orgId, relativePath, expStr, sig] = parts;
  const payload = `${orgId}:${relativePath}:${expStr}`;
  const expected = crypto
    .createHmac('sha256', process.env.SESSION_SECRET || 'dev-secret')
    .update(payload)
    .digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Date.now() > Number(expStr)) return null;
  return { orgId, relativePath };
}

module.exports = { sign, verify };
