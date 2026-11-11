import fs from 'node:fs';
import crypto from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

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
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await res.json().catch(() => ({}));
  if (!opts.allowFail && !res.ok) {
    console.error('FAILED', path, res.status, data);
    process.exit(1);
  }
  console.log('OK', path, res.status, JSON.stringify(data).slice(0, 200));
  return { status: res.status, data };
}

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
  console.log('OK', action, res.status, JSON.stringify(data).slice(0, 200));
  return data;
}

async function main() {
  const orgName = 'Acme Test Co ' + Date.now();
  await call('/api/auth/signup', {
    orgName,
    adminEmail: `admin${Date.now()}@example.com`,
    adminPassword: 'password123',
  });

  const dupe = await call(
    '/api/auth/signup',
    { orgName, adminEmail: 'other@example.com', adminPassword: 'password123' },
    { allowFail: true },
  );
  if (dupe.status !== 409) throw new Error('expected duplicate org name to be blocked');
  console.log('duplicate-org block works:', dupe.data.message);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawText('Test contract body', { x: 72, y: 700, size: 14 });
  const fileBase64 = Buffer.from(await pdf.save()).toString('base64');

  const beforeSend = logSize();
  const sendRes = await call('/api/org/envelopes', {
    title: 'Test Contract',
    fileBase64,
    recipient1: { fullName: 'Jane Signer', email: 'jane@example.com' },
  });
  if (!sendRes.data.envelopeId) throw new Error('no envelopeId returned');

  await new Promise((r) => setTimeout(r, 200));
  const sendLog = fs.readFileSync(LOG, 'utf8').slice(beforeSend);
  const linkMatch = sendLog.match(/http:\/\/localhost:4100\/sign\.html#t=([^"&\s<]+)/);
  if (!linkMatch) throw new Error('sign link not found in log:\n' + sendLog);
  const token = linkMatch[1];
  console.log('signer token captured from invite email');

  const openRes = await pubSession('open', { token });
  console.log('open ->', openRes.state);

  const beforeOtp = logSize();
  await pubSession('otp_send', { token, channel: 'email' });
  await new Promise((r) => setTimeout(r, 200));
  const otpLog = fs.readFileSync(LOG, 'utf8').slice(beforeOtp);
  const codeMatch = otpLog.match(/verification code is <strong>(\d{6})<\/strong>/);
  if (!codeMatch) throw new Error('otp code not found in log:\n' + otpLog);
  console.log('otp code captured');

  const verifyRes = await pubSession('otp_verify', { token, code: codeMatch[1] });
  const session = verifyRes.session;
  console.log('session issued, ersd present:', !!verifyRes.ersd);

  await pubSession('consent', { token, session, ersdId: verifyRes.ersd?.id, accepted: true });
  const docRes = await pubSession('document', { token, session });

  const fileBytes = Buffer.from(await (await fetch(BASE + docRes.url)).arrayBuffer());
  const docSha256 = crypto.createHash('sha256').update(fileBytes).digest('hex');
  console.log('fetched document bytes:', fileBytes.length);

  await pubSession('signature_adopt', { token, session, type: 'typed', typedSignature: 'Jane Signer', typedFont: 'cursive' });

  const submitRes = await pubSession('submit', {
    token,
    session,
    fullName: 'Jane Signer',
    title: 'Owner',
    docSha256Client: docSha256,
  });
  console.log('submit state:', submitRes.state);
  if (submitRes.state !== 'completed') throw new Error('expected single-signer envelope to complete immediately');

  const dl = await pubSession('download', { token, session });
  const finalBytes = await (await fetch(BASE + dl.url)).arrayBuffer();
  console.log('final signed pdf bytes:', finalBytes.byteLength);

  const chainRes = await call(`/api/org/envelopes/${sendRes.data.envelopeId}/verify-chain`, null, { method: 'GET' });
  const allOk = chainRes.data.results.every((r) => r.ok);
  console.log('hash chain verified, all links ok:', allOk, `(${chainRes.data.results.length} events)`);
  if (!allOk) throw new Error('hash chain verification failed');

  console.log('\nALL CHECKS PASSED (session-based client flow)');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
