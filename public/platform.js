async function boot() {
  const me = await requirePlatformAdmin();
  if (!me) return;
  renderSidebar(me, { platform: true });
  loadOrganizations();
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
  tbody.innerHTML = organizations.length
    ? organizations
        .map(
          (o) => `<tr>
            <td><a href="platform-org.html?id=${o.id}">${o.name}</a></td>
            <td><span class="tag ${o.is_active ? 'active' : 'disabled'}">${o.is_active ? 'active' : 'disabled'}</span></td>
            <td>${o.user_count}</td>
            <td>${o.envelope_count}</td>
            <td><button class="small" data-toggle="${o.id}" data-active="${o.is_active}">${o.is_active ? 'Disable' : 'Enable'}</button></td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="muted">No organizations yet.</td></tr>';

  tbody.querySelectorAll('[data-toggle]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const active = btn.dataset.active === 'true';
      await api('POST', `/api/platform/organizations/${btn.dataset.toggle}/${active ? 'disable' : 'enable'}`, {});
      loadOrganizations();
    }),
  );
}

boot();
