const { resolveSession, COOKIE_NAME } = require('../lib/auth');

function requireOrgSession(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const session = resolveSession(token);
  if (!session) return res.status(401).json({ error: 'not_authenticated' });
  req.user = session;
  next();
}

function requireOrgAdmin(req, res, next) {
  if (req.user?.role !== 'org_admin') return res.status(403).json({ error: 'org_admin_required' });
  next();
}

function requirePlatformAdmin(req, res, next) {
  if (req.user?.role !== 'platform_admin') return res.status(403).json({ error: 'platform_admin_required' });
  next();
}

module.exports = { requireOrgSession, requireOrgAdmin, requirePlatformAdmin };
