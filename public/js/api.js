async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'request_failed');
    err.data = data;
    throw err;
  }
  return data;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Every client-org page calls this first. Redirects to login if there's no
// session, or to the platform dashboard if this is a platform admin (the
// client-org pages have nothing meaningful to show them).
async function requireClientOrg() {
  try {
    const me = await api('GET', '/api/auth/me');
    if (me.role === 'platform_admin') {
      location.href = 'platform.html';
      return null;
    }
    return me;
  } catch {
    location.href = 'login.html';
    return null;
  }
}

async function requirePlatformAdmin() {
  try {
    const me = await api('GET', '/api/auth/me');
    if (me.role !== 'platform_admin') {
      location.href = 'envelopes.html';
      return null;
    }
    return me;
  } catch {
    location.href = 'login.html';
    return null;
  }
}

// The three org-level roles have non-overlapping scopes: org_admin runs
// envelopes/templates/people, IT runs the integration surface exclusively,
// member just sends/views envelopes. Each role sees only its own pages in
// the nav (the backend enforces this too — this is just so the sidebar
// never shows a link that would 403).
const NAV_LINKS_BY_ROLE = {
  org_admin: [
    { href: 'envelopes.html', label: 'Envelopes' },
    { href: 'templates.html', label: 'Templates' },
    { href: 'team.html', label: 'Team' },
  ],
  it: [{ href: 'integrations.html', label: 'API & Webhooks' }],
  member: [{ href: 'envelopes.html', label: 'Envelopes' }],
};

// The page each role should land on / be redirected to if it hits a page
// outside its scope.
const HOME_PAGE_BY_ROLE = { org_admin: 'envelopes.html', it: 'integrations.html', member: 'envelopes.html' };

// Pages gated to a subset of org-level roles — any role not listed is
// bounced to its own home page rather than seeing a 403'd blank page.
const PAGE_ROLES = {
  'envelopes.html': ['org_admin', 'member'],
  'templates.html': ['org_admin'],
  'team.html': ['org_admin'],
  'integrations.html': ['it'],
};

// Call at the top of any client-org page's boot(), right after
// requireClientOrg(), to bounce a role to its own home page if it's on a
// page outside its scope.
function enforcePageRole(me) {
  const here = location.pathname.split('/').pop();
  const allowed = PAGE_ROLES[here];
  if (allowed && !allowed.includes(me.role)) {
    location.href = HOME_PAGE_BY_ROLE[me.role] || 'envelopes.html';
    return false;
  }
  return true;
}

// Renders the shared sidebar into #sidebar, highlighting the current page.
// `me` is whatever requireClientOrg()/requirePlatformAdmin() returned.
function renderSidebar(me, { platform = false } = {}) {
  const here = location.pathname.split('/').pop();
  const links = platform ? [] : NAV_LINKS_BY_ROLE[me?.role] || [];
  const el = document.getElementById('sidebar');
  el.innerHTML = `
    <div class="brand">E-Sign${platform ? '' : `<span class="org-name">${me?.email || ''}</span>`}</div>
    <nav>
      ${links.map((l) => `<a href="${l.href}" class="${l.href === here ? 'active' : ''}">${l.label}</a>`).join('')}
    </nav>
    <div class="logout-wrap"><button id="sidebarLogoutBtn">Log out</button></div>
  `;
  document.getElementById('sidebarLogoutBtn').addEventListener('click', async () => {
    await api('POST', '/api/auth/logout');
    location.href = 'login.html';
  });
}
