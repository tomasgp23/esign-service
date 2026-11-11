const express = require('express');
const crypto = require('node:crypto');
const { db } = require('../../db');
const { randomToken, sha256Hex } = require('../../lib/crypto');
const { sendMail } = require('../../lib/mailer');
const { seedDefaultDisclosures } = require('../../lib/seedDisclosures');

const router = express.Router();

function normalize(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
}

router.get('/', (req, res) => {
  const orgs = db
    .prepare(
      `select o.*,
        (select count(*) from users u where u.org_id = o.id) as user_count,
        (select count(*) from esign_envelopes e where e.org_id = o.id) as envelope_count
       from organizations o order by o.created_at desc`,
    )
    .all();
  res.json({ organizations: orgs.map((o) => ({ ...o, is_active: !!o.is_active })) });
});

// Creates a new client organization on the platform admin's behalf, and
// invites its first admin by email (same invite-token pattern as inviting a
// teammate) rather than handing out a password directly.
router.post('/', async (req, res) => {
  const { orgName, adminEmail } = req.body || {};
  if (!orgName || !adminEmail) return res.status(400).json({ error: 'missing_fields' });

  const nameNormalized = normalize(orgName);
  const existingOrg = db.prepare('select id from organizations where name_normalized = ?').get(nameNormalized);
  if (existingOrg) {
    return res.status(409).json({ error: 'org_already_registered', message: 'A company with this name is already registered.' });
  }
  const emailNormalized = normalize(adminEmail);
  const existingUser = db.prepare('select id from users where email_normalized = ?').get(emailNormalized);
  if (existingUser) return res.status(409).json({ error: 'email_already_registered' });

  const orgId = crypto.randomUUID();
  db.prepare('insert into organizations (id, name, name_normalized, primary_contact_email) values (?,?,?,?)').run(
    orgId,
    orgName.trim(),
    nameNormalized,
    adminEmail.trim(),
  );
  seedDefaultDisclosures(orgId);

  const token = randomToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'insert into invites (id, org_id, email, role, token_hash, invited_by, expires_at) values (?,?,?,?,?,?,?)',
  ).run(crypto.randomUUID(), orgId, adminEmail.trim(), 'org_admin', tokenHash, req.user.userId, expiresAt);

  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:4100';
  const link = `${base}/accept-invite.html#t=${token}`;
  await sendMail({
    to: adminEmail,
    subject: `Your organization "${orgName}" has been set up`,
    html: `<p>Your organization has been created. Set your password to get started:</p>
           <p><a href="${link}">Accept invite</a></p>`,
  });

  res.json({ ok: true, orgId });
});

router.get('/:id', (req, res) => {
  const org = db.prepare('select * from organizations where id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'not_found' });

  const users = db
    .prepare('select id, email, role, created_at from users where org_id = ? order by created_at')
    .all(org.id);
  const pendingInvites = db
    .prepare(
      `select id, email, role, expires_at, created_at from invites
       where org_id = ? and accepted_at is null order by created_at desc`,
    )
    .all(org.id);
  const envelopes = db
    .prepare(
      `select id, title, status, risk_flags, created_at, sent_at, completed_at
       from esign_envelopes where org_id = ? order by created_at desc`,
    )
    .all(org.id)
    .map((e) => ({ ...e, risk_flags: JSON.parse(e.risk_flags) }));

  res.json({ organization: { ...org, is_active: !!org.is_active }, users, pendingInvites, envelopes });
});

// Re-sends a client organization's pending admin invite with a fresh token
// (mirrors the member-invite "remind" pattern used everywhere else).
router.post('/:id/invites/:inviteId/resend', async (req, res) => {
  const invite = db
    .prepare('select * from invites where id = ? and org_id = ? and accepted_at is null')
    .get(req.params.inviteId, req.params.id);
  if (!invite) return res.status(404).json({ error: 'not_found' });

  const org = db.prepare('select name from organizations where id = ?').get(req.params.id);
  const token = randomToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('update invites set token_hash = ?, expires_at = ? where id = ?').run(tokenHash, expiresAt, invite.id);

  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:4100';
  const link = `${base}/accept-invite.html#t=${token}`;
  await sendMail({
    to: invite.email,
    subject: `Reminder: your organization "${org.name}" is waiting for setup`,
    html: `<p>Set your password to get started:</p><p><a href="${link}">Accept invite</a></p>`,
  });

  res.json({ ok: true });
});

router.post('/:id/disable', (req, res) => {
  const org = db.prepare('select * from organizations where id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'not_found' });
  db.prepare('update organizations set is_active = 0 where id = ?').run(org.id);
  res.json({ ok: true });
});

router.post('/:id/enable', (req, res) => {
  const org = db.prepare('select * from organizations where id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'not_found' });
  db.prepare('update organizations set is_active = 1 where id = ?').run(org.id);
  res.json({ ok: true });
});

// There is deliberately no hard-delete. Every organization gets its own
// legal disclosure records the moment it's created, and those are
// append-only by design (the same guarantee that protects every signer's
// audit trail) — the database itself refuses to delete them. Disabling is
// the only "remove an organization" operation this system supports.

module.exports = router;
