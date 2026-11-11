const express = require('express');
const { db } = require('../../db');
const { requireOrgSession } = require('../../middleware/requireOrgSession');
const { inviteRecipient } = require('../../lib/invite');
const { logEvent, verifyChain } = require('../../lib/hashChain');
const { sign } = require('../../lib/signedUrl');
const { createEnvelope, EnvelopeCreateError } = require('../../lib/envelopeCreate');
const { deliverWebhook } = require('../../lib/webhooks');

const router = express.Router();

router.get('/', (req, res) => {
  const envelopes = db
    .prepare('select * from esign_envelopes where org_id = ? order by created_at desc')
    .all(req.user.orgId);
  res.json({ envelopes: envelopes.map(serializeEnvelope) });
});

router.get('/:id', (req, res) => {
  const envelope = db
    .prepare('select * from esign_envelopes where id = ? and org_id = ?')
    .get(req.params.id, req.user.orgId);
  if (!envelope) return res.status(404).json({ error: 'not_found' });
  const recipients = db
    .prepare('select * from esign_recipients where envelope_id = ? order by routing_order')
    .all(envelope.id);
  res.json({ envelope: serializeEnvelope(envelope), recipients });
});

router.get('/:id/verify-chain', (req, res) => {
  const envelope = db
    .prepare('select id from esign_envelopes where id = ? and org_id = ?')
    .get(req.params.id, req.user.orgId);
  if (!envelope) return res.status(404).json({ error: 'not_found' });
  res.json({ results: verifyChain(envelope.id) });
});

function serializeEnvelope(e) {
  return { ...e, risk_flags: JSON.parse(e.risk_flags) };
}

// The only place a brand-new envelope gets created. One of three document
// sources: a raw uploaded PDF, a kind='pdf' esign_template (fields already
// placed), or a kind='html' merge-token esign_template (rendered to a real
// PDF here before anything is stored). Mirrors the original esign-send.
router.post('/', requireOrgSession, async (req, res) => {
  try {
    const { envelopeId } = await createEnvelope({
      orgId: req.user.orgId,
      createdByUserId: req.user.userId,
      actorType: 'org_user',
      ...req.body,
    });

    const org = db.prepare('select * from organizations where id = ?').get(req.user.orgId);
    const envelope = db.prepare('select * from esign_envelopes where id = ?').get(envelopeId);
    deliverWebhook(org, 'envelope.sent', envelope).catch(() => {});

    res.json({ ok: true, envelopeId });
  } catch (err) {
    if (err instanceof EnvelopeCreateError) return res.status(err.status).json({ error: err.code });
    console.error('[envelopes:create]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/:id/void', requireOrgSession, (req, res) => {
  const envelope = db
    .prepare('select * from esign_envelopes where id = ? and org_id = ?')
    .get(req.params.id, req.user.orgId);
  if (!envelope) return res.status(404).json({ error: 'not_found' });
  if (['completed', 'voided', 'declined'].includes(envelope.status)) {
    return res.status(409).json({ error: 'cannot_void' });
  }
  const { reason } = req.body || {};
  db.prepare('update esign_envelopes set status = ?, voided_by = ?, voided_at = ?, void_reason = ? where id = ?').run(
    'voided',
    req.user.userId,
    new Date().toISOString(),
    reason || null,
    envelope.id,
  );
  logEvent({ envelope_id: envelope.id, actor_type: 'org_user', actor_user_id: req.user.userId, event_type: 'envelope.voided', details: { reason } });

  const org = db.prepare('select * from organizations where id = ?').get(req.user.orgId);
  const updated = db.prepare('select * from esign_envelopes where id = ?').get(envelope.id);
  deliverWebhook(org, 'envelope.voided', updated).catch(() => {});

  res.json({ ok: true });
});

router.post('/:id/remind', requireOrgSession, async (req, res) => {
  const envelope = db
    .prepare('select * from esign_envelopes where id = ? and org_id = ?')
    .get(req.params.id, req.user.orgId);
  if (!envelope) return res.status(404).json({ error: 'not_found' });
  if (!['sent', 'in_progress'].includes(envelope.status)) return res.status(409).json({ error: 'cannot_remind' });

  const { recipientId } = req.body || {};
  let recipients = db
    .prepare(
      `select * from esign_recipients where envelope_id = ?
       and status in ('pending','sent','opened','verified')`,
    )
    .all(envelope.id);
  if (recipientId) recipients = recipients.filter((r) => r.id === recipientId);

  for (const r of recipients) {
    await inviteRecipient({ envelope, recipient: r, eventType: 'reminder.sent' });
  }
  res.json({ ok: true, remindedCount: recipients.length });
});

router.get('/:id/original-url', requireOrgSession, (req, res) => {
  const envelope = db
    .prepare('select * from esign_envelopes where id = ? and org_id = ?')
    .get(req.params.id, req.user.orgId);
  if (!envelope || !envelope.original_path) return res.status(404).json({ error: 'not_found' });
  const token = sign(req.user.orgId, envelope.original_path, 300);
  res.json({ url: `/files/${token}` });
});

module.exports = router;
