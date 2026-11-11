const crypto = require('node:crypto');
const { sha256Hex } = require('./crypto');

// client_id is an identifier, not a secret — it's fine to log or display.
// The secret is shown once at creation and only its hash is ever stored.
function generateClientCredentials() {
  const clientId = 'eic_' + crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  return { clientId, secret, secretHash: sha256Hex(secret) };
}

module.exports = { generateClientCredentials };
