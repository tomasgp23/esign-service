const crypto = require('node:crypto');
const { db } = require('../db');

// Same signing shape as Stripe/GitHub webhooks: HMAC-SHA256 over the exact
// raw body bytes that get sent, so the receiver can recompute it from the
// raw request body (never from a re-serialized/parsed copy, which could
// differ in whitespace/key order and silently break verification).
function signPayload(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

const insertDeliveryStmt = db.prepare(`
  insert into webhook_deliveries (id, org_id, envelope_id, event_type, url, payload, attempt, status_code, delivered_at)
  values (?,?,?,?,?,?,?,?,?)
`);

async function attemptDelivery(org, eventType, envelope, attempt) {
  const payload = JSON.stringify({
    event: eventType,
    envelopeId: envelope.id,
    orgId: org.id,
    status: envelope.status,
    timestamp: new Date().toISOString(),
  });
  const signature = signPayload(org.webhook_secret, payload);

  let statusCode = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(org.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Esign-Signature': `sha256=${signature}` },
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    statusCode = res.status;
  } catch {
    statusCode = null; // network error, timeout, DNS failure, etc.
  }

  const ok = statusCode !== null && statusCode >= 200 && statusCode < 300;
  insertDeliveryStmt.run(
    crypto.randomUUID(),
    org.id,
    envelope.id,
    eventType,
    org.webhook_url,
    payload,
    attempt,
    statusCode,
    ok ? new Date().toISOString() : null,
  );
  return ok;
}

// Fire-and-forget from the caller's point of view — never awaited by the
// request that triggered it, so a slow or dead webhook endpoint never
// delays a signer or an API caller. Retries with backoff; every attempt
// (success or failure) is logged to webhook_deliveries for visibility.
async function deliverWebhook(org, eventType, envelope) {
  if (!org.webhook_url || !org.webhook_secret) return;
  const delaysMs = [0, 2000, 8000];
  for (let i = 0; i < delaysMs.length; i++) {
    if (delaysMs[i]) await new Promise((r) => setTimeout(r, delaysMs[i]));
    const ok = await attemptDelivery(org, eventType, envelope, i + 1);
    if (ok) return;
  }
}

module.exports = { signPayload, deliverWebhook };
