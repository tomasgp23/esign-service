async function boot() {
  const me = await requireClientOrg();
  if (!me) return;
  renderSidebar(me);
  loadIntegration();
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

boot();
