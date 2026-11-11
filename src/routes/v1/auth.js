const express = require('express');
const { db } = require('../../db');
const { sha256Hex } = require('../../lib/crypto');
const { mintToken } = require('../../lib/partnerToken');

const router = express.Router();

// Exchanges a client_id + secret for a short-lived bearer token — same
// two-step shape as the BDN Sales CRM's api-oauth-token: the secret proves
// who you are once, then every actual API call uses the token instead of
// resending the secret, and the token is cheap to re-mint when it expires.
router.post('/token', (req, res) => {
  const { clientId, clientSecret } = req.body || {};
  if (!clientId || !clientSecret) return res.status(400).json({ error: 'missing_fields' });

  const client = db.prepare('select * from api_clients where client_id = ?').get(clientId);
  if (!client || !client.is_active) return res.status(401).json({ error: 'invalid_client' });
  if (sha256Hex(clientSecret) !== client.secret_hash) return res.status(401).json({ error: 'invalid_client' });

  db.prepare('update api_clients set last_used_at = ? where id = ?').run(new Date().toISOString(), client.id);

  const { token, expiresIn } = mintToken(clientId);
  res.json({ token, tokenType: 'Bearer', expiresIn });
});

module.exports = router;
