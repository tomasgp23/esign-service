async function boot() {
  const me = await requireClientOrg();
  if (!me || !enforcePageRole(me)) return;
  renderSidebar(me);
  loadTemplates();
}

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
            <td><span class="tag ${t.esign_allowed ? 'approved' : 'not-approved'}">${t.esign_allowed ? 'approved' : 'not approved'}</span></td>
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
    }),
  );
}

boot();
