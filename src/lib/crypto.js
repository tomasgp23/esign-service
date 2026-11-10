const crypto = require('node:crypto');

function sha256Hex(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// 256-bit random token, URL-safe base64, no padding — safe to put in a URL
// hash fragment. Only its sha256 is ever stored; the raw value is handed to
// the recipient once (in the invite link) and never persisted.
function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function randomDigits(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += crypto.randomInt(0, 10);
  return out;
}

module.exports = { sha256Hex, randomToken, randomDigits };
