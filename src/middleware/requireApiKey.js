const { db } = require('../db');
const { hashApiKey } = require('../lib/apiKey');

function requireApiKey(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'missing_api_key' });

  const hash = hashApiKey(match[1].trim());
  const org = db.prepare('select * from organizations where api_key_hash = ?').get(hash);
  if (!org) return res.status(401).json({ error: 'invalid_api_key' });
  if (!org.is_active) return res.status(403).json({ error: 'org_disabled' });

  req.org = org;
  next();
}

module.exports = { requireApiKey };
