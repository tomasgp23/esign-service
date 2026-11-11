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
      loadTemplates();
      loadIntegration();
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

document.getElementById('envSource').addEventListener('change', (e) => {
  const useTemplate = e.target.value === 'template';
  document.getElementById('envUploadBlock').classList.toggle('hidden', useTemplate);
  document.getElementById('envTemplateBlock').classList.toggle('hidden', !useTemplate);
});

let sendTemplates = [];
async function loadTemplatesForSend() {
  const { templates } = await api('GET', '/api/org/templates');
  sendTemplates = templates;
  const select = document.getElementById('envTemplateSelect');
  select.innerHTML = templates
    .filter((t) => t.esign_allowed)
    .map((t) => `<option value="${t.id}">${t.name} (v${t.version})</option>`)
    .join('') || '<option value="">No approved templates yet</option>';
  renderTemplateVarInputs();
}

function renderTemplateVarInputs() {
  const select = document.getElementById('envTemplateSelect');
  const container = document.getElementById('envTemplateVars');
  const template = sendTemplates.find((t) => t.id === select.value);
  if (!template || !template.variables.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = template.variables
    .map((v) => `<label>${v}</label><input type="text" data-var="${v}">`)
    .join('');
}

document.getElementById('envTemplateSelect').addEventListener('change', renderTemplateVarInputs);

document.getElementById('sendBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('sendErr');
  errEl.textContent = '';
  try {
    const useTemplate = document.getElementById('envSource').value === 'template';
    const body = {
      title: document.getElementById('envTitle').value,
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

    if (useTemplate) {
      const templateId = document.getElementById('envTemplateSelect').value;
      if (!templateId) throw new Error('no_template');
      body.esignTemplateId = templateId;
      body.mergeData = {};
      document.querySelectorAll('#envTemplateVars [data-var]').forEach((input) => {
        body.mergeData[input.dataset.var] = input.value;
      });
    } else {
      const file = document.getElementById('envFile').files[0];
      if (!file) throw new Error('no_file');
      body.fileBase64 = await fileToBase64(file);
    }

    await api('POST', '/api/org/envelopes', body);
    document.getElementById('envTitle').value = '';
    document.getElementById('envFile').value = '';
    loadEnvelopes();
  } catch (err) {
    errEl.textContent =
      err.message === 'no_file' ? 'Please choose a PDF file.' :
      err.message === 'no_template' ? 'Please choose a template.' :
      err.data?.missing ? `Missing: ${err.data.missing.join(', ')}` :
      err.data?.unexpected ? `Unexpected: ${err.data.unexpected.join(', ')}` : 'Could not send envelope.';
  }
});

function extractVariablesClient(bodyHtml) {
  const found = new Set();
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(bodyHtml || ''))) found.add(m[1]);
  return [...found].sort();
}

document.getElementById('tplBody').addEventListener('input', (e) => {
  const vars = extractVariablesClient(e.target.value);
  document.getElementById('tplVarsPreview').textContent = vars.length ? vars.join(', ') : '(none)';
});

document.getElementById('tplSaveBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('tplErr');
  errEl.textContent = '';
  try {
    const signerRoles = ['owner_1'];
    if (document.getElementById('tplRole2').checked) signerRoles.push('owner_2');

    await api('POST', '/api/org/templates', {
      name: document.getElementById('tplName').value,
      kind: 'html',
      bodyHtml: document.getElementById('tplBody').value,
      signerRoles,
    });
    document.getElementById('tplName').value = '';
    document.getElementById('tplBody').value = '';
    document.getElementById('tplVarsPreview').textContent = '(none)';
    loadTemplates();
  } catch {
    errEl.textContent = 'Could not save template.';
  }
});

async function loadTemplates() {
  const { templates } = await api('GET', '/api/org/templates');
  const tbody = document.getElementById('tplRows');
  tbody.innerHTML = templates.length
    ? templates
        .map(
          (t) => `<tr>
            <td>${t.name}</td>
            <td>v${t.version}</td>
            <td>${t.variables.length ? t.variables.join(', ') : '—'}</td>
            <td><span class="tag ${t.esign_allowed ? 'completed' : 'draft'}">${t.esign_allowed ? 'approved' : 'not approved'}</span></td>
            <td><button class="small" data-tpl-toggle="${t.id}" data-allowed="${t.esign_allowed}">${t.esign_allowed ? 'Revoke' : 'Approve'}</button></td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="muted">No templates yet.</td></tr>';

  tbody.querySelectorAll('[data-tpl-toggle]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const allowed = btn.dataset.allowed === 'true';
      await api('POST', `/api/org/templates/${btn.dataset.tplToggle}/set-allowed`, { allowed: !allowed });
      loadTemplates();
      loadTemplatesForSend();
    }),
  );
  loadTemplatesForSend();
}

document.getElementById('genKeyBtn').addEventListener('click', async () => {
  const { apiKey } = await api('POST', '/api/org/integration/api-key/generate', {});
  document.getElementById('apiKeyReveal').classList.remove('hidden');
  document.getElementById('apiKeyValue').textContent = apiKey;
  loadIntegration();
});

document.getElementById('saveWebhookBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('webhookErr');
  errEl.textContent = '';
  try {
    await api('POST', '/api/org/integration/webhook', { webhookUrl: document.getElementById('webhookUrl').value });
    loadIntegration();
  } catch {
    errEl.textContent = 'Could not save webhook URL.';
  }
});

document.getElementById('regenSecretBtn').addEventListener('click', async () => {
  await api('POST', '/api/org/integration/webhook/regenerate-secret', {});
  loadIntegration();
});

async function loadIntegration() {
  const data = await api('GET', '/api/org/integration');
  document.getElementById('apiKeyExisting').textContent = data.api_key_prefix
    ? `Current key: ${data.api_key_prefix}… (created ${new Date(data.api_key_created_at).toLocaleString()})`
    : 'No API key generated yet.';
  document.getElementById('webhookUrl').value = data.webhook_url || '';
  document.getElementById('webhookSecret').textContent = data.webhook_secret || '(set a webhook URL to generate one)';

  const tbody = document.getElementById('webhookDeliveryRows');
  tbody.innerHTML = data.deliveries.length
    ? data.deliveries
        .map(
          (d) => `<tr>
            <td>${d.event_type}</td>
            <td>${d.attempt}</td>
            <td>${d.status_code ?? 'failed'}</td>
            <td>${new Date(d.created_at).toLocaleString()}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="muted">No deliveries yet.</td></tr>';
}

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
        <button class="small" data-view="${o.id}">View</button>
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
  tbody.querySelectorAll('[data-view]').forEach((btn) =>
    btn.addEventListener('click', () => showOrgDetail(btn.dataset.view)),
  );
}

async function showOrgDetail(orgId) {
  const { organization, users, pendingInvites, envelopes } = await api('GET', `/api/platform/organizations/${orgId}`);

  document.getElementById('orgDetailName').textContent = organization.name;

  const usersBody = document.getElementById('orgDetailUsers');
  usersBody.innerHTML = users.length
    ? users.map((u) => `<tr><td>${u.email}</td><td>${u.role}</td><td>${new Date(u.created_at).toLocaleString()}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">No users yet.</td></tr>';

  const invitesBody = document.getElementById('orgDetailInvites');
  invitesBody.innerHTML = '';
  if (!pendingInvites.length) {
    invitesBody.innerHTML = '<tr><td colspan="4" class="muted">None pending.</td></tr>';
  } else {
    for (const inv of pendingInvites) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${inv.email}</td>
        <td>${inv.role}</td>
        <td>${new Date(inv.expires_at).toLocaleString()}</td>
        <td><button class="small" data-resend="${inv.id}">Resend</button></td>`;
      invitesBody.appendChild(tr);
    }
    invitesBody.querySelectorAll('[data-resend]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        await api('POST', `/api/platform/organizations/${orgId}/invites/${btn.dataset.resend}/resend`, {});
        showOrgDetail(orgId);
      }),
    );
  }

  const envBody = document.getElementById('orgDetailEnvelopes');
  envBody.innerHTML = envelopes.length
    ? envelopes
        .map(
          (e) => `<tr>
            <td>${e.title}</td>
            <td><span class="tag ${e.status}">${e.status}</span></td>
            <td>${e.sent_at ? new Date(e.sent_at).toLocaleString() : ''}</td>
            <td>${e.risk_flags.length ? '⚠ ' + e.risk_flags.length : ''}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="muted">No envelopes yet.</td></tr>';

  document.querySelectorAll('.plat-list-view').forEach((el) => el.classList.add('hidden'));
  document.getElementById('orgDetailCard').classList.remove('hidden');
}

document.getElementById('orgDetailBack').addEventListener('click', () => {
  document.getElementById('orgDetailCard').classList.add('hidden');
  document.querySelectorAll('.plat-list-view').forEach((el) => el.classList.remove('hidden'));
});

boot();
