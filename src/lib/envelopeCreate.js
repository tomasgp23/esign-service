const crypto = require('node:crypto');
const { PDFDocument } = require('pdf-lib');
const { db } = require('../db');
const { writeFile, readFile } = require('./storage');
const { sha256Hex } = require('./crypto');
const { renderMergeTemplateToPdf } = require('./htmlRender');
const { addSignaturePage } = require('./pdfBuild');
const { inviteRecipient } = require('./invite');
const { logEvent } = require('./hashChain');

class EnvelopeCreateError extends Error {
  constructor(code, status, details) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// The one place a brand-new envelope gets created — shared by the
// session-authenticated dashboard route (routes/org/envelopes.js) and the
// API-key-authenticated integration route (routes/v1/envelopes.js), so the
// two surfaces can never drift apart on freeze ordering, field placement,
// or invite handling.
async function createEnvelope({
  orgId,
  createdByUserId,
  actorType, // 'org_user' | 'api'
  title,
  fileBase64,
  esignTemplateId,
  mergeData,
  recipient1,
  recipient2,
  signingOrder: requestedOrder,
}) {
  if (!title || !recipient1?.fullName || !recipient1?.email) {
    throw new EnvelopeCreateError('missing_fields', 400);
  }

  let pdfBytes;
  let template = null;
  if (esignTemplateId) {
    template = db.prepare('select * from esign_templates where id = ? and org_id = ?').get(esignTemplateId, orgId);
    if (!template) throw new EnvelopeCreateError('template_not_found', 404);
    if (!template.esign_allowed) throw new EnvelopeCreateError('template_not_approved', 403);

    if (template.kind === 'pdf') {
      pdfBytes = readFile(orgId, template.base_pdf_path);
    } else {
      const pdf = await renderMergeTemplateToPdf(template.body_html, mergeData || {});
      pdfBytes = await pdf.save();
    }
  } else if (fileBase64) {
    pdfBytes = Buffer.from(fileBase64, 'base64');
  } else {
    throw new EnvelopeCreateError('no_document_source', 400);
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
    for (const r of recipients) fieldsByRole[r.role] = layout.filter((f) => f.role === r.role);
  } else {
    for (const r of recipients) fieldsByRole[r.role] = await addSignaturePage(pdf, { recipientRole: r.role });
  }

  const finalBytes = await pdf.save();
  const originalSha256 = sha256Hex(finalBytes);
  const envelopeId = crypto.randomUUID();
  const originalPath = `${envelopeId}/original.pdf`;
  writeFile(orgId, originalPath, finalBytes);

  // Freeze-then-insert: the file is hashed and stored, and the envelope row
  // is inserted carrying status:'sent' + its final hash together, in one
  // statement — never insert-as-draft-then-update, since "frozen once sent"
  // is enforced in app code and would reject that second write.
  const now = new Date().toISOString();
  db.prepare(
    `insert into esign_envelopes
      (id, org_id, template_id, title, status, signing_order, merge_snapshot,
       original_path, original_sha256, page_count, created_by, created_at, sent_by, sent_at)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    envelopeId,
    orgId,
    template?.id || null,
    title,
    'sent',
    signingOrder,
    mergeData ? JSON.stringify(mergeData) : null,
    originalPath,
    originalSha256,
    pdf.getPageCount(),
    createdByUserId,
    now,
    createdByUserId,
    now,
  );

  logEvent({ envelope_id: envelopeId, actor_type: actorType, actor_user_id: createdByUserId, event_type: 'envelope.created' });
  logEvent({ envelope_id: envelopeId, actor_type: actorType, actor_user_id: createdByUserId, event_type: 'envelope.sent' });

  const createdRecipients = [];
  for (const [i, r] of recipients.entries()) {
    const recipientId = crypto.randomUUID();
    const deferred = signingOrder === 'sequential' && r.role === 'owner_2';

    db.prepare(
      `insert into esign_recipients
        (id, envelope_id, role, routing_order, full_name, email, mobile_e164, title, status)
       values (?,?,?,?,?,?,?,?,?)`,
    ).run(recipientId, envelopeId, r.role, i + 1, r.fullName, r.email, r.mobileE164 || null, r.title || null, deferred ? 'pending' : 'sent');

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

  return { envelopeId };
}

module.exports = { createEnvelope, EnvelopeCreateError };
