async function boot() {
  const me = await requireClientOrg();
  if (!me || !enforcePageRole(me)) return;
  renderSidebar(me);
  loadIntegration();
}

document.getElementById('genClientBtn').addEventListener('click', async () => {
  const { clientId, clientSecret } = await api('POST', '/api/org/integration/generate', {
    name: document.getElementById('newClientName').value || undefined,
  });
  document.getElementById('clientReveal').classList.remove('hidden');
  document.getElementById('revealClientId').textContent = clientId;
  document.getElementById('revealSecret').textContent = clientSecret;
  document.getElementById('newClientName').value = '';
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

  document.getElementById('webhookUrl').value = data.webhook_url || '';
  document.getElementById('webhookSecret').textContent = data.webhook_secret || '(set a webhook URL to generate one)';

  const clientTbody = document.getElementById('clientRows');
  clientTbody.innerHTML = data.clients.length
    ? data.clients
        .map(
          (c) => `<tr>
            <td>${c.name}</td>
            <td style="font-family:monospace">${c.client_id}</td>
            <td><span class="tag ${c.is_active ? 'active' : 'disabled'}">${c.is_active ? 'active' : 'revoked'}</span></td>
            <td>${c.last_used_at ? new Date(c.last_used_at).toLocaleString() : 'never'}</td>
            <td>${c.is_active ? `<button class="small" data-revoke="${c.id}">Revoke</button>` : ''}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="muted">No API clients yet.</td></tr>';

  clientTbody.querySelectorAll('[data-revoke]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Revoke this API client? Any token it already holds stops working immediately.')) return;
      await api('POST', `/api/org/integration/${btn.dataset.revoke}/revoke`, {});
      loadIntegration();
    }),
  );

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

boot();
