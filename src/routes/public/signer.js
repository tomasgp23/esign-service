const express = require('express');
const crypto = require('node:crypto');
const { db } = require('../../db');
const { sha256Hex, randomToken, randomDigits } = require('../../lib/crypto');
const { sendMail, sendSms } = require('../../lib/mailer');
const { maskEmail, maskMobile } = require('../../lib/mask');
const { logEvent } = require('../../lib/hashChain');
const { writeFile } = require('../../lib/storage');
const { sign } = require('../../lib/signedUrl');
const { finalize } = require('../../lib/finalize');
const { inviteRecipient } = require('../../lib/invite');

const router = express.Router();

const OTP_PEPPER = process.env.OTP_PEPPER || 'dev-pepper';
const SESSION_TTL_MS = 30 * 60 * 1000; // sliding 30 min, same as the original

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress;
}

function byToken(token) {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  return db.prepare('select * from esign_recipients where token_hash = ?').get(tokenHash);
}

function bySession(sessionToken) {
  if (!sessionToken) return null;
  const tokenHash = sha256Hex(sessionToken);
  const session = db.prepare('select * from esign_sessions where token_hash = ?').get(tokenHash);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;
  // sliding expiry: every use pushes it forward another 30 minutes
  const newExpiry = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('update esign_sessions set expires_at = ? where id = ?').run(newExpiry, session.id);
  const recipient = db.prepare('select * from esign_recipients where id = ?').get(session.recipient_id);
  return recipient;
}

function logSignerEvent(req, { envelopeId, recipientId, eventType, details }) {
  logEvent({
    envelope_id: envelopeId,
    recipient_id: recipientId,
    actor_type: 'signer',
    event_type: eventType,
    client_ip: clientIp(req),
    user_agent: req.headers['user-agent'],
    client_info: req.body?.clientInfo || null,
    device_id: req.body?.deviceId || null,
    details: details || {},
  });
}

router.post('/open', (req, res) => {
  const { token } = req.body || {};
  const recipient = byToken(token);
  if (!recipient) return res.status(404).json({ error: 'not_found' });

  const envelope = db.prepare('select * from esign_envelopes where id = ?').get(recipient.envelope_id);
  if (['voided', 'declined'].includes(envelope.status)) {
    return res.status(410).json({ error: 'envelope_unavailable', status: envelope.status });
  }
  if (recipient.token_expires_at && new Date(recipient.token_expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'link_expired' });
  }
  if (recipient.status === 'signed') {
    return res.json({ state: 'already_signed' });
  }

  if (!recipient.first_viewed_at) {
    db.prepare('update esign_recipients set first_viewed_at = ? where id = ?').run(
      new Date().toISOString(),
      recipient.id,
    );
  }
  if (recipient.status === 'sent') {
    db.prepare("update esign_recipients set status = 'opened' where id = ?").run(recipient.id);
  }
  logSignerEvent(req, { envelopeId: envelope.id, recipientId: recipient.id, eventType: 'link.opened' });

  res.json({
    state: 'ok',
    envelopeTitle: envelope.title,
    recipientName: recipient.full_name,
    hasMobile: !!recipient.mobile_e164,
    maskedMobile: maskMobile(recipient.mobile_e164),
  });
});

router.post('/otp_send', async (req, res) => {
  const { token, channel } = req.body || {};
  const recipient = byToken(token);
  if (!recipient) return res.status(404).json({ error: 'not_found' });
  if (recipient.locked_at) return res.status(423).json({ error: 'locked' });

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentCount = db
    .prepare('select count(*) as n from esign_otps where recipient_id = ? and created_at >= ?')
    .get(recipient.id, oneHourAgo).n;
  if (recentCount >= 5) return res.status(429).json({ error: 'rate_limited' });

  const useChannel = channel === 'sms' && recipient.mobile_e164 ? 'sms' : 'email';
  const code = randomDigits(6);
  const codeHash = sha256Hex(`${code}|${recipient.id}|${OTP_PEPPER}`);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const destinationMasked = useChannel === 'sms' ? maskMobile(recipient.mobile_e164) : maskEmail(recipient.email);

  db.prepare(
    'insert into esign_otps (recipient_id, channel, destination_masked, code_hash, expires_at) values (?,?,?,?,?)',
  ).run(recipient.id, useChannel, destinationMasked, codeHash, expiresAt);

  if (useChannel === 'sms') {
    await sendSms(recipient.mobile_e164, `Your verification code is ${code}. It expires in 10 minutes.`);
  } else {
    await sendMail({
      to: recipient.email,
      subject: 'Your verification code',
      html: `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
    });
  }

  res.json({ ok: true, channel: useChannel, destinationMasked });
});

router.post('/otp_verify', (req, res) => {
  const { token, code } = req.body || {};
  const recipient = byToken(token);
  if (!recipient) return res.status(404).json({ error: 'not_found' });
  if (recipient.locked_at) return res.status(423).json({ error: 'locked' });

  const otp = db
    .prepare(
      'select * from esign_otps where recipient_id = ? and verified_at is null order by created_at desc limit 1',
    )
    .get(recipient.id);
  if (!otp || new Date(otp.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'code_expired' });
  }
  if (otp.attempts >= 5) return res.status(400).json({ error: 'too_many_attempts' });

  const expectedHash = sha256Hex(`${code}|${recipient.id}|${OTP_PEPPER}`);
  if (expectedHash !== otp.code_hash) {
    db.prepare('update esign_otps set attempts = attempts + 1 where id = ?').run(otp.id);
    const newFailedCount = recipient.failed_otp_count + 1;
    if (newFailedCount >= 10) {
      db.prepare('update esign_recipients set failed_otp_count = ?, locked_at = ? where id = ?').run(
        newFailedCount,
        new Date().toISOString(),
        recipient.id,
      );
      return res.status(423).json({ error: 'locked' });
    }
    db.prepare('update esign_recipients set failed_otp_count = ? where id = ?').run(newFailedCount, recipient.id);
    return res.status(400).json({ error: 'incorrect_code' });
  }

  db.prepare('update esign_otps set verified_at = ? where id = ?').run(new Date().toISOString(), otp.id);
  db.prepare("update esign_recipients set status = 'verified' where id = ?").run(recipient.id);

  const sessionToken = randomToken();
  db.prepare(
    'insert into esign_sessions (id, recipient_id, token_hash, device_id, ip, expires_at) values (?,?,?,?,?,?)',
  ).run(
    crypto.randomUUID(),
    recipient.id,
    sha256Hex(sessionToken),
    req.body?.deviceId || null,
    clientIp(req),
    new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  );

  logSignerEvent(req, { envelopeId: recipient.envelope_id, recipientId: recipient.id, eventType: 'otp.verified' });

  const ersd = db
    .prepare(
      `select * from esign_disclosures where org_id = (select org_id from esign_envelopes where id = ?)
       and kind = 'ersd' and is_active = 1 order by version desc limit 1`,
    )
    .get(recipient.envelope_id);

  res.json({ ok: true, session: sessionToken, ersd: ersd ? { id: ersd.id, bodyMd: ersd.body_md } : null });
});

router.post('/consent', (req, res) => {
  const { session, ersdId, accepted } = req.body || {};
  const recipient = bySession(session);
  if (!recipient) return res.status(401).json({ error: 'not_authenticated' });
  if (!accepted) return res.status(400).json({ error: 'consent_required' });

  db.prepare('update esign_recipients set ersd_id = ?, consented_at = ? where id = ?').run(
    ersdId || null,
    new Date().toISOString(),
    recipient.id,
  );
  logSignerEvent(req, {
    envelopeId: recipient.envelope_id,
    recipientId: recipient.id,
    eventType: 'ersd.accepted',
  });
  res.json({ ok: true });
});

router.post('/document', (req, res) => {
  const { session } = req.body || {};
  const recipient = bySession(session);
  if (!recipient) return res.status(401).json({ error: 'not_authenticated' });

  const envelope = db.prepare('select * from esign_envelopes where id = ?').get(recipient.envelope_id);
  const fields = db
    .prepare('select * from esign_fields where envelope_id = ? and recipient_id = ? order by page')
    .all(envelope.id, recipient.id);
  const disclosures = db
    .prepare(
      `select * from esign_disclosures where org_id = ? and kind in ('intent','adoption','authority')
       and is_active = 1`,
    )
    .all(envelope.org_id);

  const url = `/files/${sign(envelope.org_id, envelope.original_path, 300)}`;
  res.json({ url, fields, disclosures: Object.fromEntries(disclosures.map((d) => [d.kind, d.body_md])) });
});

router.post('/signature_adopt', (req, res) => {
  const { session, type, imageBase64, typedSignature, typedFont } = req.body || {};
  const recipient = bySession(session);
  if (!recipient) return res.status(401).json({ error: 'not_authenticated' });

  const envelope = db.prepare('select * from esign_envelopes where id = ?').get(recipient.envelope_id);

  if (type === 'drawn') {
    const bytes = Buffer.from(imageBase64, 'base64');
    if (bytes.length > 200 * 1024) return res.status(413).json({ error: 'image_too_large' });
    const path = `${envelope.id}/sig/${recipient.id}.png`;
    writeFile(envelope.org_id, path, bytes);
    db.prepare(
      'update esign_recipients set signature_type = ?, signature_path = ?, signature_sha256 = ?, typed_signature = null where id = ?',
    ).run('drawn', path, sha256Hex(bytes), recipient.id);
    logSignerEvent(req, {
      envelopeId: envelope.id,
      recipientId: recipient.id,
      eventType: 'signature.adopted',
      details: { signature_sha256: sha256Hex(bytes) },
    });
  } else if (type === 'typed') {
    db.prepare(
      'update esign_recipients set signature_type = ?, typed_signature = ?, typed_font = ?, signature_path = null where id = ?',
    ).run('typed', typedSignature, typedFont || null, recipient.id);
    logSignerEvent(req, { envelopeId: envelope.id, recipientId: recipient.id, eventType: 'signature.adopted' });
  } else {
    return res.status(400).json({ error: 'invalid_type' });
  }

  res.json({ ok: true });
});

router.post('/submit', async (req, res) => {
  try {
    const { session, fullName, title, docSha256Client } = req.body || {};
    const recipient = bySession(session);
    if (!recipient) return res.status(401).json({ error: 'not_authenticated' });
    if (recipient.status === 'signed') return res.status(409).json({ error: 'already_signed' });
    if (!recipient.consented_at) return res.status(400).json({ error: 'consent_required' });
    if (!recipient.signature_path && !recipient.typed_signature) {
      return res.status(400).json({ error: 'signature_required' });
    }

    const envelope = db.prepare('select * from esign_envelopes where id = ?').get(recipient.envelope_id);
    if (docSha256Client !== envelope.original_sha256) {
      return res.status(409).json({ error: 'hash_mismatch' });
    }

    db.prepare(
      `update esign_recipients set status = 'signed', signed_at = ?, full_name = coalesce(?, full_name), title = ?,
       sign_ip = ?, sign_user_agent = ?, sign_device_id = ? where id = ?`,
    ).run(
      new Date().toISOString(),
      fullName || null,
      title || null,
      clientIp(req),
      req.headers['user-agent'],
      req.body?.deviceId || null,
      recipient.id,
    );

    logSignerEvent(req, { envelopeId: envelope.id, recipientId: recipient.id, eventType: 'authority.attested' });
    logSignerEvent(req, { envelopeId: envelope.id, recipientId: recipient.id, eventType: 'recipient.signed' });

    const remaining = db
      .prepare("select * from esign_recipients where envelope_id = ? and status != 'signed'")
      .all(envelope.id);

    if (remaining.length === 0) {
      await finalize(envelope.id);
      return res.json({ state: 'completed' });
    }

    db.prepare("update esign_envelopes set status = 'in_progress' where id = ?").run(envelope.id);

    if (envelope.signing_order === 'sequential') {
      const next = remaining.filter((r) => r.status === 'pending').sort((a, b) => a.routing_order - b.routing_order)[0];
      if (next) {
        await inviteRecipient({ envelope, recipient: next, eventType: 'invite.sequential_sent' });
      }
    }

    res.json({ state: 'waiting_on_other_signer' });
  } catch (err) {
    console.error('[submit]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/decline', (req, res) => {
  const { session, reason } = req.body || {};
  const recipient = bySession(session);
  if (!recipient) return res.status(401).json({ error: 'not_authenticated' });

  db.prepare('update esign_recipients set status = ?, declined_at = ?, decline_reason = ? where id = ?').run(
    'declined',
    new Date().toISOString(),
    reason || null,
    recipient.id,
  );
  db.prepare("update esign_envelopes set status = 'declined' where id = ?").run(recipient.envelope_id);
  logSignerEvent(req, { envelopeId: recipient.envelope_id, recipientId: recipient.id, eventType: 'recipient.declined', details: { reason } });
  res.json({ ok: true });
});

router.post('/download', (req, res) => {
  const { session } = req.body || {};
  const recipient = bySession(session);
  if (!recipient) return res.status(401).json({ error: 'not_authenticated' });
  const envelope = db.prepare('select * from esign_envelopes where id = ?').get(recipient.envelope_id);
  if (envelope.status !== 'completed') return res.status(409).json({ error: 'not_completed' });
  const url = `/files/${sign(envelope.org_id, envelope.final_path, 300)}`;
  res.json({ url });
});

module.exports = router;
