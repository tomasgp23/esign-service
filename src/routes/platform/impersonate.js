const express = require('express');
const { db } = require('../../db');
const { mintImpersonationToken, COOKIE_NAME, TTL_SECONDS } = require('../../lib/impersonation');

const router = express.Router();

const ROLES = ['org_admin', 'it', 'member'];

// Starts (or switches) a read-only preview of a client org as one of its
// three roles. Requires the caller's real session to be a platform admin
// (checked in requireOrgSession/requirePlatformAdmin against req.realUser,
// never against the possibly-already-impersonated req.user) — so you can
// freely switch between role previews, or exit, without first logging out
// of whichever preview is currently active.
router.post('/:orgId/start', (req, res) => {
  const { role } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role' });

  const org = db.prepare('select id, name from organizations where id = ?').get(req.params.orgId);
  if (!org) return res.status(404).json({ error: 'not_found' });

  const token = mintImpersonationToken(org.id, role);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TTL_SECONDS * 1000,
  });
  res.json({ ok: true, orgName: org.name, role });
});

router.post('/stop', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

module.exports = router;
