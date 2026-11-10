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

function hideAll() {
  ['setupCard', 'authCard', 'platformCard', 'appCard'].forEach((id) => document.getElementById(id).classList.add('hidden'));
  document.getElementById('logoutBtn').classList.add('hidden');
}

async function boot() {
  hideAll();
  try {
    const me = await api('GET', '/api/auth/me');
    document.getElementById('logoutBtn').classList.remove('hidden');
    if (me.role === 'platform_admin') {
      document.getElementById('platformCard').classList.remove('hidden');
      loadOrganizations();
    } else {
      document.getElementById('appCard').classList.remove('hidden');
      loadEnvelopes();
    }
    return;
  } catch {
    // not logged in — fall through to setup/login
  }

  const { needsSetup } = await api('GET', '/api/auth/needs-setup');
  if (needsSetup) {
    document.getElementById('setupCard').classList.remove('hidden');
  } else {
    document.getElementById('authCard').classList.remove('hidden');
  }
}

document.getElementById('setupBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('setupErr');
  errEl.textContent = '';
  try {
    await api('POST', '/api/auth/setup', {
      email: document.getElementById('setupEmail').value,
      password: document.getElementById('setupPassword').value,
    });
    boot();
  } catch (err) {
    errEl.textContent = err.data?.error === 'already_set_up' ? 'Already set up — please log in.' : 'Could not create account.';
    if (err.data?.error === 'already_set_up') boot();
  }
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('loginErr');
  errEl.textContent = '';
  try {
    await api('POST', '/api/auth/login', {
      email: document.getElementById('loginEmail').value,
      password: document.getElementById('loginPassword').value,
    });
    boot();
  } catch (err) {
    errEl.textContent =
      err.data?.error === 'org_disabled' ? 'This organization has been disabled.' :
      err.data?.error === 'invalid_credentials' ? 'Incorrect email or password.' : 'Login failed.';
  }
});

document.getElementById('signupBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('signupErr');
  errEl.textContent = '';
  try {
    await api('POST', '/api/auth/signup', {
      orgName: document.getElementById('suOrgName').value,
      adminEmail: document.getElementById('suEmail').value,
      adminPassword: document.getElementById('suPassword').value,
    });
    boot();
  } catch (err) {
    errEl.textContent =
      err.data?.message || (err.data?.error === 'email_already_registered' ? 'That email is already registered.' : 'Could not register.');
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('POST', '/api/auth/logout');
  boot();
});

document.getElementById('sendBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('sendErr');
  errEl.textContent = '';
  try {
    const file = document.getElementById('envFile').files[0];
    if (!file) throw new Error('no_file');
    const fileBase64 = await fileToBase64(file);

    const body = {
      title: document.getElementById('envTitle').value,
      fileBase64,
      recipient1: {
        fullName: document.getElementById('r1Name').value,
        email: document.getElementById('r1Email').value,
        mobileE164: document.getElementById('r1Mobile').value || undefined,
      },
      signingOrder: document.getElementById('sequential').checked ? 'sequential' : 'parallel',
    };
    const r2Name = document.getElementById('r2Name').value;
    const r2Email = document.getElementById('r2Email').value;
    if (r2Name && r2Email) body.recipient2 = { fullName: r2Name, email: r2Email };

    await api('POST', '/api/org/envelopes', body);
    document.getElementById('envTitle').value = '';
    document.getElementById('envFile').value = '';
    loadEnvelopes();
  } catch (err) {
    errEl.textContent = err.message === 'no_file' ? 'Please choose a PDF file.' : 'Could not send envelope.';
  }
});

document.getElementById('inviteBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('inviteErr');
  errEl.textContent = '';
  try {
    await api('POST', '/api/org/members/invite', {
      email: document.getElementById('inviteEmail').value,
      role: document.getElementById('inviteRole').value,
    });
    document.getElementById('inviteEmail').value = '';
    errEl.textContent = 'Invite sent.';
    errEl.style.color = '#1a7d3a';
  } catch {
    errEl.textContent = 'Could not send invite.';
    errEl.style.color = '';
  }
});

async function loadEnvelopes() {
  const { envelopes } = await api('GET', '/api/org/envelopes');
  const tbody = document.getElementById('envelopeRows');
  tbody.innerHTML = '';
  for (const e of envelopes) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.title}</td>
      <td><span class="tag ${e.status}">${e.status}</span></td>
      <td>${e.sent_at ? new Date(e.sent_at).toLocaleString() : ''}</td>
      <td>${e.risk_flags.length ? '⚠ ' + e.risk_flags.length : ''}</td>
      <td>
        ${['sent', 'in_progress'].includes(e.status) ? `<button class="small" data-remind="${e.id}">Remind</button>
        <button class="small" data-void="${e.id}">Void</button>` : ''}
      </td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('[data-remind]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await api('POST', `/api/org/envelopes/${btn.dataset.remind}/remind`, {});
      loadEnvelopes();
    }),
  );
  tbody.querySelectorAll('[data-void]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Void this envelope?')) return;
      await api('POST', `/api/org/envelopes/${btn.dataset.void}/void`, { reason: 'voided from admin' });
      loadEnvelopes();
    }),
  );
}

document.getElementById('platCreateBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('platCreateErr');
  errEl.textContent = '';
  try {
    await api('POST', '/api/platform/organizations', {
      orgName: document.getElementById('platOrgName').value,
      adminEmail: document.getElementById('platAdminEmail').value,
    });
    document.getElementById('platOrgName').value = '';
    document.getElementById('platAdminEmail').value = '';
    loadOrganizations();
  } catch (err) {
    errEl.textContent = err.data?.message || 'Could not create organization.';
  }
});

async function loadOrganizations() {
  const { organizations } = await api('GET', '/api/platform/organizations');
  const tbody = document.getElementById('platOrgRows');
  tbody.innerHTML = '';
  for (const o of organizations) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${o.name}</td>
      <td><span class="tag ${o.is_active ? 'completed' : 'voided'}">${o.is_active ? 'active' : 'disabled'}</span></td>
      <td>${o.user_count}</td>
      <td>${o.envelope_count}</td>
      <td>
        <button class="small" data-toggle="${o.id}" data-active="${o.is_active}">${o.is_active ? 'Disable' : 'Enable'}</button>
      </td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('[data-toggle]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const active = btn.dataset.active === 'true';
      await api('POST', `/api/platform/organizations/${btn.dataset.toggle}/${active ? 'disable' : 'enable'}`, {});
      loadOrganizations();
    }),
  );
}

boot();
