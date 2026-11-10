const express = require('express');
const crypto = require('node:crypto');
const { PDFDocument } = require('pdf-lib');
const { db } = require('../../db');
const { requireOrgSession } = require('../../middleware/requireOrgSession');
const { writeFile, readFile } = require('../../lib/storage');
const { sha256Hex, randomToken } = require('../../lib/crypto');
const { renderMergeTemplateToPdf } = require('../../lib/htmlRender');
const { addSignaturePage } = require('../../lib/pdfBuild');
const { inviteRecipient } = require('../../lib/invite');
const { logEvent, verifyChain } = require('../../lib/hashChain');
const { sign } = require('../../lib/signedUrl');

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
    const {
      title,
      fileBase64,
      esignTemplateId,
      mergeData,
      recipient1,
      recipient2,
      signingOrder: requestedOrder,
    } = req.body || {};

    if (!title || !recipient1?.fullName || !recipient1?.email) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    let pdfBytes;
    let template = null;
    if (esignTemplateId) {
      template = db
        .prepare('select * from esign_templates where id = ? and org_id = ?')
        .get(esignTemplateId, req.user.orgId);
      if (!template) return res.status(404).json({ error: 'template_not_found' });
      if (!template.esign_allowed) return res.status(403).json({ error: 'template_not_approved' });

      if (template.kind === 'pdf') {
        pdfBytes = readFile(req.user.orgId, template.base_pdf_path);
      } else {
        const pdf = await renderMergeTemplateToPdf(template.body_html, mergeData || {});
        pdfBytes = await pdf.save();
      }
    } else if (fileBase64) {
      pdfBytes = Buffer.from(fileBase64, 'base64');
    } else {
      return res.status(400).json({ error: 'no_document_source' });
    }

    const hasSecondSigner = !!(recipient2?.fullName && recipient2?.email);
    const signingOrder = requestedOrder === 'sequential' && hasSecondSigner ? 'sequential' : 'parallel';

    const pdf = await PDFDocument.load(pdfBytes);
    const recipients = [{ ...recipient1, role: 'owner_1' }];
    if (hasSecondSigner) recipients.push({ ...recipient2, role: 'owner_2' });

    // Field placement: use the template's pre-placed layout if there is one,
    // otherwise append a fresh signature page per signer.
    const fieldsByRole = {};
    if (template?.kind === 'pdf' && template.field_layout) {
      const layout = JSON.parse(template.field_layout);
      for (const r of recipients) {
        fieldsByRole[r.role] = layout.filter((f) => f.role === r.role);
      }
    } else {
      for (const r of recipients) {
        fieldsByRole[r.role] = await addSignaturePage(pdf, { recipientRole: r.role });
      }
    }

    const finalBytes = await pdf.save();
    const originalSha256 = sha256Hex(finalBytes);
    const envelopeId = crypto.randomUUID();
    const originalPath = `${envelopeId}/original.pdf`;
    writeFile(req.user.orgId, originalPath, finalBytes);

    // Freeze-then-insert: the file is hashed and stored, and the envelope
    // row is inserted carrying status:'sent' + its final hash together, in
    // one statement — never insert-as-draft-then-update, since "frozen once
    // sent" is enforced in app code and would reject that second write.
    const now = new Date().toISOString();
    db.prepare(
      `insert into esign_envelopes
        (id, org_id, template_id, title, status, signing_order, merge_snapshot,
         original_path, original_sha256, page_count, created_by, created_at, sent_by, sent_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      envelopeId,
      req.user.orgId,
      template?.id || null,
      title,
      'sent',
      signingOrder,
      mergeData ? JSON.stringify(mergeData) : null,
      originalPath,
      originalSha256,
      pdf.getPageCount(),
      req.user.userId,
      now,
      req.user.userId,
      now,
    );

    logEvent({ envelope_id: envelopeId, actor_type: 'org_user', actor_user_id: req.user.userId, event_type: 'envelope.created' });
    logEvent({ envelope_id: envelopeId, actor_type: 'org_user', actor_user_id: req.user.userId, event_type: 'envelope.sent' });

    const createdRecipients = [];
    for (const [i, r] of recipients.entries()) {
      const recipientId = crypto.randomUUID();
      const deferred = signingOrder === 'sequential' && r.role === 'owner_2';

      db.prepare(
        `insert into esign_recipients
          (id, envelope_id, role, routing_order, full_name, email, mobile_e164, title, status)
         values (?,?,?,?,?,?,?,?,?)`,
      ).run(
        recipientId,
        envelopeId,
        r.role,
        i + 1,
        r.fullName,
        r.email,
        r.mobileE164 || null,
        r.title || null,
        deferred ? 'pending' : 'sent',
      );

      for (const f of fieldsByRole[r.role] || []) {
        db.prepare(
          `insert into esign_fields (id, envelope_id, recipient_id, type, page, x, y, width, height, required, label)
           values (?,?,?,?,?,?,?,?,?,1,?)`,
        ).run(crypto.randomUUID(), envelopeId, recipientId, f.type, f.page, f.x, f.y, f.width, f.height, f.label || null);
      }

      createdRecipients.push({ id: recipientId, role: r.role, deferred });
    }

    const envelope = db.prepare('select * from esign_envelopes where id = ?').get(envelopeId);
    for (const r of createdRecipients) {
      if (r.deferred) continue;
      const recipientRow = db.prepare('select * from esign_recipients where id = ?').get(r.id);
      await inviteRecipient({ envelope, recipient: recipientRow });
    }

    res.json({ ok: true, envelopeId });
  } catch (err) {
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
