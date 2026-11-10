const express = require('express');
const crypto = require('node:crypto');
const { db } = require('../../db');
const { requireOrgAdmin } = require('../../middleware/requireOrgSession');
const { randomToken, sha256Hex } = require('../../lib/crypto');
const { sendMail } = require('../../lib/mailer');

const router = express.Router();

router.get('/', (req, res) => {
  const members = db
    .prepare('select id, email, role, created_at from users where org_id = ? order by created_at')
    .all(req.user.orgId);
  res.json({ members });
});

router.post('/invite', requireOrgAdmin, async (req, res) => {
  const { email, role } = req.body || {};
  if (!email || !['org_admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const emailNormalized = String(email).trim().toLowerCase();
  const existingUser = db.prepare('select id from users where email_normalized = ?').get(emailNormalized);
  if (existingUser) return res.status(409).json({ error: 'email_already_registered' });

  const token = randomToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    'insert into invites (id, org_id, email, role, token_hash, invited_by, expires_at) values (?,?,?,?,?,?,?)',
  ).run(crypto.randomUUID(), req.user.orgId, email.trim(), role, tokenHash, req.user.userId, expiresAt);

  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:4100';
  const link = `${base}/accept-invite.html#t=${token}`;
  await sendMail({
    to: email,
    subject: `You've been invited to join on E-Sign`,
    html: `<p>You've been invited to join as a ${role === 'org_admin' ? 'admin' : 'member'}.</p>
           <p><a href="${link}">Accept invite</a></p>`,
  });

  res.json({ ok: true });
});

module.exports = router;
