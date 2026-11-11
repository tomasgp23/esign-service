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

const NAV_LINKS = [
  { href: 'envelopes.html', label: 'Envelopes' },
  { href: 'templates.html', label: 'Templates' },
  { href: 'integrations.html', label: 'API & Webhooks' },
  { href: 'team.html', label: 'Team' },
];

// Renders the shared sidebar into #sidebar, highlighting the current page.
// `me` is whatever requireClientOrg()/requirePlatformAdmin() returned.
function renderSidebar(me, { platform = false } = {}) {
  const here = location.pathname.split('/').pop();
  const links = platform ? [] : NAV_LINKS;
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
