const express = require('express');
const crypto = require('node:crypto');
const { db } = require('../db');
const { hashPassword, verifyPassword, createSession, sessionCookieOptions, COOKIE_NAME } = require('../lib/auth');
const { sha256Hex } = require('../lib/crypto');
const { seedDefaultDisclosures } = require('../lib/seedDisclosures');
const { requireOrgSession } = require('../middleware/requireOrgSession');

const router = express.Router();

function normalize(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
}

// True only until the very first account in the whole system is created.
// That first account is always the platform admin — it belongs to no
// organization and sits above the client layer entirely.
router.get('/needs-setup', (req, res) => {
  const anyUser = db.prepare('select 1 from users limit 1').get();
  res.json({ needsSetup: !anyUser });
});

// One-time bootstrap: creates the platform admin account. Refuses once any
// account already exists, so it can never be used to mint a second one.
router.post('/setup', async (req, res) => {
  const anyUser = db.prepare('select 1 from users limit 1').get();
  if (anyUser) return res.status(409).json({ error: 'already_set_up' });

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  db.prepare(
    'insert into users (id, org_id, email, email_normalized, password_hash, role) values (?,null,?,?,?,?)',
  ).run(userId, email.trim(), normalize(email), passwordHash, 'platform_admin');

  const { token, expiresAt } = createSession(userId);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  res.json({ ok: true, role: 'platform_admin', expiresAt });
});

router.get('/me', requireOrgSession, (req, res) => {
  res.json({ role: req.user.role, orgId: req.user.orgId, email: req.user.email });
});

// Creates a brand-new organization plus its first org_admin. Blocks a second
// signup for a company that's already registered — per Tomas's decision,
// this shows a clear error pointing the person at their org's admin instead
// of silently creating a duplicate organization.
router.post('/signup', async (req, res) => {
  const anyUser = db.prepare('select 1 from users limit 1').get();
  if (!anyUser) return res.status(409).json({ error: 'setup_required' });

  const { orgName, adminEmail, adminPassword } = req.body || {};
  if (!orgName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (adminPassword.length < 8) {
    return res.status(400).json({ error: 'password_too_short' });
  }

  const nameNormalized = normalize(orgName);
  const existingOrg = db.prepare('select id from organizations where name_normalized = ?').get(nameNormalized);
  if (existingOrg) {
    return res.status(409).json({
      error: 'org_already_registered',
      message: 'This company is already registered. Please contact your organization’s admin for an invite.',
    });
  }

  const emailNormalized = normalize(adminEmail);
  const existingUser = db.prepare('select id from users where email_normalized = ?').get(emailNormalized);
  if (existingUser) {
    return res.status(409).json({ error: 'email_already_registered' });
  }

  const orgId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(adminPassword);

  db.prepare('insert into organizations (id, name, name_normalized, primary_contact_email) values (?,?,?,?)').run(
    orgId,
    orgName.trim(),
    nameNormalized,
    adminEmail.trim(),
  );
  db.prepare(
    'insert into users (id, org_id, email, email_normalized, password_hash, role) values (?,?,?,?,?,?)',
  ).run(userId, orgId, adminEmail.trim(), emailNormalized, passwordHash, 'org_admin');
  seedDefaultDisclosures(orgId);

  const { token, expiresAt } = createSession(userId);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  res.json({ ok: true, orgId, userId, expiresAt });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

  const user = db.prepare('select * from users where email_normalized = ?').get(normalize(email));
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (user.org_id) {
    const org = db.prepare('select is_active from organizations where id = ?').get(user.org_id);
    if (!org?.is_active) return res.status(403).json({ error: 'org_disabled' });
  }

  const { token, expiresAt } = createSession(user.id);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  res.json({ ok: true, orgId: user.org_id, role: user.role, expiresAt });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// Accept an org-admin invite: set a password, this becomes the user's login.
router.post('/accept-invite', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'missing_fields' });
  if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });

  const tokenHash = sha256Hex(token);
  const invite = db.prepare('select * from invites where token_hash = ?').get(tokenHash);
  if (!invite) return res.status(404).json({ error: 'invite_not_found' });
  if (invite.accepted_at) return res.status(409).json({ error: 'invite_already_used' });
  if (new Date(invite.expires_at).getTime() < Date.now()) return res.status(410).json({ error: 'invite_expired' });

  const emailNormalized = normalize(invite.email);
  const existingUser = db.prepare('select id from users where email_normalized = ?').get(emailNormalized);
  if (existingUser) return res.status(409).json({ error: 'email_already_registered' });

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  db.prepare(
    'insert into users (id, org_id, email, email_normalized, password_hash, role, invited_by) values (?,?,?,?,?,?,?)',
  ).run(userId, invite.org_id, invite.email, emailNormalized, passwordHash, invite.role, invite.invited_by);
  db.prepare('update invites set accepted_at = ? where id = ?').run(new Date().toISOString(), invite.id);

  const { token: sessionToken, expiresAt } = createSession(userId);
  res.cookie(COOKIE_NAME, sessionToken, sessionCookieOptions());
  res.json({ ok: true, orgId: invite.org_id, expiresAt });
});

module.exports = router;
