import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';

const BASE = 'http://localhost:4100';
const LOG = 'C:\\Users\\TOMBDN~1\\AppData\\Local\\Temp\\esign-server.log';
let cookie = '';

function logSize() {
  try {
    return fs.statSync(LOG).size;
  } catch {
    return 0;
  }
}

async function call(path, body, opts = {}) {
  const method = opts.method || 'POST';
  const headers = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  else if (cookie) headers.Cookie = cookie;

  const res = await fetch(BASE + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await res.json().catch(() => ({}));
  console.log(opts.allowFail ? 'INFO' : 'OK', path, res.status, JSON.stringify(data).slice(0, 300));
  if (!opts.allowFail && !res.ok) {
    console.error('FAILED', path, res.status, data);
    process.exit(1);
  }
  return { status: res.status, data };
}

// --- tiny webhook receiver ---
const received = [];
const webhookServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    received.push({ body, signature: req.headers['x-esign-signature'] });
    res.writeHead(200);
    res.end('ok');
  });
});
await new Promise((resolve) => webhookServer.listen(4999, resolve));
console.log('webhook receiver listening on :4999');

function waitForWebhook(eventType, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const hit = received.find((r) => JSON.parse(r.body).event === eventType);
      if (hit) return resolve(hit);
      if (Date.now() - start > timeoutMs) return reject(new Error(`timed out waiting for webhook ${eventType}`));
      setTimeout(check, 300);
    };
    check();
  });
}

async function main() {
  const orgName = 'API Test Co ' + Date.now();
  await call('/api/auth/signup', { orgName, adminEmail: `api${Date.now()}@example.com`, adminPassword: 'password123' });

  await call('/api/org/templates', {
    name: 'Simple Agreement',
    kind: 'html',
    bodyHtml: '<h1>Agreement</h1><p>This agrees to pay {{amount}} to {{business_name}} in {{state}}.</p>',
    signerRoles: ['owner_1'],
  });
  const { data: tplList } = await call('/api/org/templates', null, { method: 'GET' });
  const template = tplList.templates[0];
  console.log('template variables detected:', template.variables);
  if (JSON.stringify(template.variables) !== JSON.stringify(['amount', 'business_name', 'state'])) {
    throw new Error('variable extraction mismatch: ' + JSON.stringify(template.variables));
  }

  await call(`/api/org/templates/${template.id}/set-allowed`, { allowed: true });

  const { data: keyRes } = await call('/api/org/integration/api-key/generate', {});
  const apiKey = keyRes.apiKey;
  console.log('generated api key prefix:', apiKey.slice(0, 12));

  await call('/api/org/integration/webhook', { webhookUrl: 'http://localhost:4999/webhook' });
  const { data: integ } = await call('/api/org/integration', null, { method: 'GET' });
  const webhookSecret = integ.webhook_secret;

  // --- strict variable validation: missing one ---
  const missingRes = await call(
    '/api/v1/envelopes',
    { templateId: template.id, mergeData: { amount: '$500', business_name: 'Acme' }, recipients: [{ fullName: 'Jane Signer', email: 'jane@example.com' }] },
    { apiKey, allowFail: true },
  );
  if (missingRes.status !== 400 || !missingRes.data.missing?.includes('state')) {
    throw new Error('expected 400 with missing=["state"], got ' + JSON.stringify(missingRes.data));
  }
  console.log('missing-variable rejection works:', missingRes.data.missing);

  // --- strict variable validation: unexpected extra ---
  const extraRes = await call(
    '/api/v1/envelopes',
    {
      templateId: template.id,
      mergeData: { amount: '$500', business_name: 'Acme', state: 'TX', extra_field: 'oops' },
      recipients: [{ fullName: 'Jane Signer', email: 'jane@example.com' }],
    },
    { apiKey, allowFail: true },
  );
  if (extraRes.status !== 400 || !extraRes.data.unexpected?.includes('extra_field')) {
    throw new Error('expected 400 with unexpected=["extra_field"], got ' + JSON.stringify(extraRes.data));
  }
  console.log('unexpected-variable rejection works:', extraRes.data.unexpected);

  // --- correct call: should succeed ---
  const beforeSend = logSize();
  const sendRes = await call(
    '/api/v1/envelopes',
    {
      templateId: template.id,
      mergeData: { amount: '$500', business_name: 'Acme', state: 'TX' },
      recipients: [{ fullName: 'Jane Signer', email: 'jane@example.com' }],
    },
    { apiKey },
  );
  const envelopeId = sendRes.data.envelopeId;

  // GET /api/v1/templates discovery
  await call('/api/v1/templates', null, { apiKey, method: 'GET' });

  // --- verify envelope.sent webhook arrived and is correctly signed ---
  const sentHook = await waitForWebhook('envelope.sent');
  const expectedSig = crypto.createHmac('sha256', webhookSecret).update(sentHook.body).digest('hex');
  if (sentHook.signature !== `sha256=${expectedSig}`) throw new Error('webhook signature mismatch for envelope.sent');
  console.log('envelope.sent webhook received with valid signature');

  // --- walk the signer flow to trigger envelope.completed ---
  await new Promise((r) => setTimeout(r, 200));
  const sendLog = fs.readFileSync(LOG, 'utf8').slice(beforeSend);
  const linkMatch = sendLog.match(/http:\/\/localhost:4100\/sign\.html#t=([^"&\s<]+)/);
  if (!linkMatch) throw new Error('sign link not found in log');
  const token = linkMatch[1];

  async function pubSession(action, body) {
    const res = await fetch(`${BASE}/api/public/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('FAILED', action, res.status, data);
      process.exit(1);
    }
    console.log('OK', action, res.status, JSON.stringify(data).slice(0, 150));
    return data;
  }

  await pubSession('open', { token });
  const beforeOtp = logSize();
  await pubSession('otp_send', { token, channel: 'email' });
  await new Promise((r) => setTimeout(r, 200));
  const otpLog = fs.readFileSync(LOG, 'utf8').slice(beforeOtp);
  const codeMatch = otpLog.match(/verification code is <strong>(\d{6})<\/strong>/);
  const verifyRes = await pubSession('otp_verify', { token, code: codeMatch[1] });
  const session = verifyRes.session;
  await pubSession('consent', { token, session, ersdId: verifyRes.ersd?.id, accepted: true });
  const docRes = await pubSession('document', { token, session });
  const fileBytes = Buffer.from(await (await fetch(BASE + docRes.url)).arrayBuffer());
  const docSha256 = crypto.createHash('sha256').update(fileBytes).digest('hex');
  await pubSession('signature_adopt', { token, session, type: 'typed', typedSignature: 'Jane Signer' });
  const submitRes = await pubSession('submit', { token, session, fullName: 'Jane Signer', docSha256Client: docSha256 });
  console.log('submit state:', submitRes.state);

  const completedHook = await waitForWebhook('envelope.completed');
  const expectedSig2 = crypto.createHmac('sha256', webhookSecret).update(completedHook.body).digest('hex');
  if (completedHook.signature !== `sha256=${expectedSig2}`) throw new Error('webhook signature mismatch for envelope.completed');
  console.log('envelope.completed webhook received with valid signature');

  webhookServer.close();
  console.log('\nALL API/WEBHOOK CHECKS PASSED');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  webhookServer.close();
  process.exit(1);
});
