const orgId = new URLSearchParams(location.search).get('id');

async function boot() {
  const me = await requirePlatformAdmin();
  if (!me) return;
  renderSidebar(me, { platform: true });
  if (!orgId) {
    location.href = 'platform.html';
    return;
  }
  await loadDetail();

  const HOME_PAGE_BY_ROLE = { org_admin: 'envelopes.html', it: 'integrations.html', member: 'envelopes.html' };
  document.querySelectorAll('[data-view-as]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const role = btn.dataset.viewAs;
      await api('POST', `/api/platform/impersonate/${orgId}/start`, { role });
      location.href = HOME_PAGE_BY_ROLE[role];
    }),
  );
}

async function loadDetail() {
  const { organization, users, pendingInvites, envelopes } = await api('GET', `/api/platform/organizations/${orgId}`);
  document.getElementById('orgName').textContent = organization.name;

  document.getElementById('orgUsers').innerHTML = users.length
    ? users.map((u) => `<tr><td>${u.email}</td><td>${u.role}</td><td>${new Date(u.created_at).toLocaleString()}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">No users yet.</td></tr>';

  const invitesBody = document.getElementById('orgInvites');
  invitesBody.innerHTML = pendingInvites.length
    ? pendingInvites
        .map(
          (inv) => `<tr>
            <td>${inv.email}</td><td>${inv.role}</td><td>${new Date(inv.expires_at).toLocaleString()}</td>
            <td><button class="small" data-resend="${inv.id}">Resend</button></td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="muted">None pending.</td></tr>';
  invitesBody.querySelectorAll('[data-resend]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await api('POST', `/api/platform/organizations/${orgId}/invites/${btn.dataset.resend}/resend`, {});
      loadDetail();
    }),
  );

  document.getElementById('orgEnvelopes').innerHTML = envelopes.length
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
}

boot();
