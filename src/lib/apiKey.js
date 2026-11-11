const crypto = require('node:crypto');
const { sha256Hex } = require('./crypto');

const PREFIX = 'esk_';

// Same shape as randomToken() (256 bits, URL-safe base64) with a readable
// prefix so a key is recognizable at a glance (and never confusable with a
// session or signing token). Only its hash is ever stored — shown once to
// the org admin at generation time, exactly like a Stripe secret key.
function generateApiKey() {
  const raw = PREFIX + crypto.randomBytes(32).toString('base64url');
  return { raw, hash: sha256Hex(raw), prefix: raw.slice(0, 12) };
}

function hashApiKey(raw) {
  return sha256Hex(raw);
}

module.exports = { generateApiKey, hashApiKey, PREFIX };
