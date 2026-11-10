const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

// Best-effort, same philosophy as the original: email/SMS delivery failing
// should never crash the request that triggered it. Until SMTP_* is filled
// in, this logs to the console instead so local development still works.
async function sendMail({ to, subject, html }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[mailer:stub] to=${to} subject=${JSON.stringify(subject)}\n${html}`);
    return;
  }
  try {
    await t.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
  } catch (err) {
    console.error('[mailer] send failed', err.message);
  }
}

async function sendSms(to, body) {
  const base = process.env.SMS_API_BASE;
  const sid = process.env.SMS_ACCOUNT_SID;
  const token = process.env.SMS_AUTH_TOKEN;
  const from = process.env.SMS_FROM_NUMBER;
  if (!base || !sid || !token || !from) {
    console.log(`[sms:stub] to=${to} body=${body}`);
    return;
  }
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    await fetch(`${base}/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
  } catch (err) {
    console.error('[sms] send failed', err.message);
  }
}

module.exports = { sendMail, sendSms };
