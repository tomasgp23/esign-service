async function boot() {
  const me = await requireClientOrg();
  if (!me || !enforcePageRole(me)) return;
  renderSidebar(me);
  loadEnvelopes();
  loadTemplatesForSend();
}

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
  select.innerHTML =
    templates.filter((t) => t.esign_allowed).map((t) => `<option value="${t.id}">${t.name} (v${t.version})</option>`).join('') ||
    '<option value="">No approved templates yet</option>';
  renderTemplateVarInputs();
}

function renderTemplateVarInputs() {
  const select = document.getElementById('envTemplateSelect');
  const container = document.getElementById('envTemplateVars');
  const template = sendTemplates.find((t) => t.id === select.value);
  container.innerHTML =
    template && template.variables.length
      ? template.variables.map((v) => `<label>${v}</label><input type="text" data-var="${v}">`).join('')
      : '';
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

async function loadEnvelopes() {
  const { envelopes } = await api('GET', '/api/org/envelopes');
  const tbody = document.getElementById('envelopeRows');
  tbody.innerHTML = envelopes.length
    ? envelopes
        .map(
          (e) => `<tr>
            <td>${e.title}</td>
            <td><span class="tag ${e.status}">${e.status}</span></td>
            <td>${e.sent_at ? new Date(e.sent_at).toLocaleString() : ''}</td>
            <td>${e.risk_flags.length ? '⚠ ' + e.risk_flags.length : ''}</td>
            <td>
              ${['sent', 'in_progress'].includes(e.status) ? `<button class="small" data-remind="${e.id}">Remind</button>
              <button class="small" data-void="${e.id}">Void</button>` : ''}
            </td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="muted">No envelopes yet.</td></tr>';

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

boot();
