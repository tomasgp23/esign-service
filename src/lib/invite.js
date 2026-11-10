const { db } = require('../db');
const { randomToken, sha256Hex } = require('./crypto');
const { sendMail, sendSms } = require('./mailer');
const { maskEmail } = require('./mask');
const { logEvent } = require('./hashChain');

const updateRecipientTokenStmt = db.prepare(`
  update esign_recipients
  set token_hash = ?, token_expires_at = ?, status = 'sent'
  where id = ?
`);

// Mints a fresh signing token for a recipient and sends the invite. Used by:
// the initial send, the immediate second invite for parallel signing, the
// deferred second invite for sequential signing, and "remind" — same single
// code path as the original's sendSignerInvite(), so wording never drifts
// between those four call sites.
async function inviteRecipient({ envelope, recipient, eventType = 'invite.email_sent' }) {
  const token = randomToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  updateRecipientTokenStmt.run(tokenHash, expiresAt, recipient.id);

  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:4100';
  // Hash fragment, not a query string — never sent to a server log or Referer.
  const link = `${base}/sign.html#t=${token}`;

  await sendMail({
    to: recipient.email,
    subject: `${envelope.title} — signature requested`,
    html: `
      <p>Hi ${recipient.full_name},</p>
      <p>You've been asked to review and sign "<strong>${envelope.title}</strong>".</p>
      <p><a href="${link}" style="background:#c9a84c;color:#0b1626;padding:10px 18px;
         border-radius:6px;text-decoration:none;font-weight:bold;">Review &amp; Sign</a></p>
      <p>Or copy this link: ${link}</p>
    `,
  });

  if (recipient.mobile_e164) {
    await sendSms(recipient.mobile_e164, `${envelope.title}: please review and sign — ${link}`);
  }

  logEvent({
    envelope_id: envelope.id,
    recipient_id: recipient.id,
    actor_type: 'system',
    event_type: eventType,
    details: { to: maskEmail(recipient.email) },
  });
}

module.exports = { inviteRecipient };
