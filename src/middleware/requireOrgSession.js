const { resolveSession, COOKIE_NAME } = require('../lib/auth');
const { verifyImpersonationToken, COOKIE_NAME: IMPERSONATE_COOKIE_NAME } = require('../lib/impersonation');

// req.realUser is always the actual authenticated session — platform-level
// checks (requirePlatformAdmin, "am I really allowed to impersonate?") go
// through this, never through the possibly-impersonated view.
//
// req.user is the *effective* view: normally identical to req.realUser, but
// replaced with {orgId, role} from a valid impersonation token when the
// real session is a platform admin and that cookie is present. Org-level
// checks (requireOrgAdmin, requireIT, every org-scoped route) go through
// this, so a page genuinely behaves as the role being previewed.
function requireOrgSession(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const session = resolveSession(token);
  if (!session) return res.status(401).json({ error: 'not_authenticated' });

  req.realUser = session;
  req.user = session;

  if (session.role === 'platform_admin') {
    const impersonateToken = req.cookies?.[IMPERSONATE_COOKIE_NAME];
    const impersonation = impersonateToken ? verifyImpersonationToken(impersonateToken) : null;
    if (impersonation) {
      req.user = {
        userId: session.userId,
        orgId: impersonation.orgId,
        role: impersonation.role,
        email: session.email,
        impersonating: true,
      };
    }
  }

  next();
}

// Mounted only on the org-scoped routers (envelopes/templates/members/
// apiClients) — never on the platform routes, so starting, switching, or
// exiting a preview always works regardless of whatever's currently being
// previewed. Blocks every write so a preview can never actually act on a
// real org's data.
function blockWriteWhileImpersonating(req, res, next) {
  if (req.user?.impersonating && req.method !== 'GET') {
    return res.status(403).json({ error: 'read_only_while_previewing' });
  }
  next();
}

function requireOrgAdmin(req, res, next) {
  if (req.user?.role !== 'org_admin') return res.status(403).json({ error: 'org_admin_required' });
  next();
}

function requirePlatformAdmin(req, res, next) {
  if (req.realUser?.role !== 'platform_admin') return res.status(403).json({ error: 'platform_admin_required' });
  next();
}

// IT owns API keys and webhooks exclusively — org_admin does not have this,
// by design (the three roles have non-overlapping scopes: org_admin runs
// envelopes/templates/people, IT runs the integration surface, member just
// sends/views).
function requireIT(req, res, next) {
  if (req.user?.role !== 'it') return res.status(403).json({ error: 'it_role_required' });
  next();
}

module.exports = {
  requireOrgSession,
  requireOrgAdmin,
  requirePlatformAdmin,
  requireIT,
  blockWriteWhileImpersonating,
};
