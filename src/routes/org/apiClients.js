const express = require('express');
const crypto = require('node:crypto');
const { db } = require('../../db');
const { requireIT } = require('../../middleware/requireOrgSession');
const { generateClientCredentials } = require('../../lib/apiClient');

const router = express.Router();

router.get('/', requireIT, (req, res) => {
  const clients = db
    .prepare('select id, name, client_id, is_active, created_at, last_used_at from api_clients where org_id = ? order by created_at desc')
    .all(req.user.orgId);
  const org = db.prepare('select webhook_url, webhook_secret from organizations where id = ?').get(req.user.orgId);
  const deliveries = db
    .prepare(
      `select event_type, url, attempt, status_code, delivered_at, created_at
       from webhook_deliveries where org_id = ? order by created_at desc limit 20`,
    )
    .all(req.user.orgId);
  res.json({ clients: clients.map((c) => ({ ...c, is_active: !!c.is_active })), ...org, deliveries });
});

// Shown once in plaintext — only the secret's hash is kept. A client stays
// usable (via POST /api/v1/auth/token) until explicitly revoked, matching
// the BDN Sales CRM's api_clients model.
router.post('/generate', requireIT, (req, res) => {
  const { name } = req.body || {};
  const { clientId, secret, secretHash } = generateClientCredentials();
  db.prepare(
    'insert into api_clients (id, org_id, name, client_id, secret_hash, created_by) values (?,?,?,?,?,?)',
  ).run(crypto.randomUUID(), req.user.orgId, name || 'default', clientId, secretHash, req.user.userId);
  res.json({ ok: true, clientId, clientSecret: secret });
});

router.post('/:id/revoke', requireIT, (req, res) => {
  const client = db.prepare('select * from api_clients where id = ? and org_id = ?').get(req.params.id, req.user.orgId);
  if (!client) return res.status(404).json({ error: 'not_found' });
  db.prepare('update api_clients set is_active = 0 where id = ?').run(client.id);
  res.json({ ok: true });
});

router.post('/webhook', requireIT, (req, res) => {
  const { webhookUrl } = req.body || {};
  if (webhookUrl && !/^https?:\/\//.test(webhookUrl)) return res.status(400).json({ error: 'invalid_url' });

  const org = db.prepare('select webhook_secret from organizations where id = ?').get(req.user.orgId);
  const secret = org.webhook_secret || crypto.randomBytes(32).toString('hex');

  db.prepare('update organizations set webhook_url = ?, webhook_secret = ? where id = ?').run(
    webhookUrl || null,
    webhookUrl ? secret : org.webhook_secret,
    req.user.orgId,
  );
  res.json({ ok: true, webhookSecret: secret });
});

router.post('/webhook/regenerate-secret', requireIT, (req, res) => {
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare('update organizations set webhook_secret = ? where id = ?').run(secret, req.user.orgId);
  res.json({ ok: true, webhookSecret: secret });
});

module.exports = router;
