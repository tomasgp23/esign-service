const { db } = require('../db');
const { verifyToken } = require('../lib/partnerToken');

// Verifies the bearer token's signature/expiry, then re-checks the live
// api_clients row — a revoked client is rejected immediately, not just once
// its current token happens to expire. Same two-layer check as the BDN
// Sales CRM's authenticatePartnerRequest().
function requireApiKey(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'missing_token' });

  const verified = verifyToken(match[1].trim());
  if (!verified) return res.status(401).json({ error: 'invalid_or_expired_token' });

  const client = db.prepare('select * from api_clients where client_id = ?').get(verified.clientId);
  if (!client || !client.is_active) return res.status(401).json({ error: 'client_revoked' });

  const org = db.prepare('select * from organizations where id = ?').get(client.org_id);
  if (!org || !org.is_active) return res.status(403).json({ error: 'org_disabled' });

  db.prepare('update api_clients set last_used_at = ? where id = ?').run(new Date().toISOString(), client.id);

  req.org = org;
  req.apiClient = client;
  next();
}

module.exports = { requireApiKey };
