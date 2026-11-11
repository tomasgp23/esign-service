const express = require('express');
const crypto = require('node:crypto');
const { db } = require('../../db');
const { requireOrgAdmin } = require('../../middleware/requireOrgSession');
const { generateApiKey } = require('../../lib/apiKey');

const router = express.Router();

router.get('/', (req, res) => {
  const org = db
    .prepare('select api_key_prefix, api_key_created_at, webhook_url, webhook_secret from organizations where id = ?')
    .get(req.user.orgId);
  const deliveries = db
    .prepare(
      `select event_type, url, attempt, status_code, delivered_at, created_at
       from webhook_deliveries where org_id = ? order by created_at desc limit 20`,
    )
    .all(req.user.orgId);
  res.json({ ...org, deliveries });
});

// Shown once in plaintext — only its hash is kept. Generating a new key
// immediately invalidates any previous one (single active key per org).
router.post('/api-key/generate', requireOrgAdmin, (req, res) => {
  const { raw, hash, prefix } = generateApiKey();
  db.prepare('update organizations set api_key_hash = ?, api_key_prefix = ?, api_key_created_at = ? where id = ?').run(
    hash,
    prefix,
    new Date().toISOString(),
    req.user.orgId,
  );
  res.json({ ok: true, apiKey: raw });
});

router.post('/webhook', requireOrgAdmin, (req, res) => {
  const { webhookUrl } = req.body || {};
  if (webhookUrl && !/^https?:\/\//.test(webhookUrl)) {
    return res.status(400).json({ error: 'invalid_url' });
  }

  const org = db.prepare('select webhook_secret from organizations where id = ?').get(req.user.orgId);
  const secret = org.webhook_secret || crypto.randomBytes(32).toString('hex');

  db.prepare('update organizations set webhook_url = ?, webhook_secret = ? where id = ?').run(
    webhookUrl || null,
    webhookUrl ? secret : org.webhook_secret,
    req.user.orgId,
  );
  res.json({ ok: true, webhookSecret: secret });
});

router.post('/webhook/regenerate-secret', requireOrgAdmin, (req, res) => {
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare('update organizations set webhook_secret = ? where id = ?').run(secret, req.user.orgId);
  res.json({ ok: true, webhookSecret: secret });
});

module.exports = router;
