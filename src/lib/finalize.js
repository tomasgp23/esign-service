const { PDFDocument, StandardFonts } = require('pdf-lib');
const { db } = require('../db');
const { readFile, writeFile } = require('./storage');
const { sha256Hex } = require('./crypto');
const { logEvent } = require('./hashChain');
const { computeRiskFlags } = require('./riskFlags');

const updateEnvelopeCompleteStmt = db.prepare(`
  update esign_envelopes
  set status = 'completed', completed_at = ?, final_path = ?, final_sha256 = ?, risk_flags = ?
  where id = ?
`);

// Called when the last recipient finishes signing. Re-verifies the document
// hasn't changed since it was sent, stamps every recipient's fields onto the
// frozen original, and marks the envelope completed. Mirrors the original's
// finalize(): the re-hash-before-touching step is the critical integrity
// check — it must run again here even though `submit` already checked the
// client's own hash, because the client's check only proves what the signer
// saw, not that nothing changed between then and now.
async function finalize(envelopeId) {
  const envelope = db.prepare('select * from esign_envelopes where id = ?').get(envelopeId);
  const recipients = db
    .prepare('select * from esign_recipients where envelope_id = ? order by routing_order')
    .all(envelopeId);
  const fields = db.prepare('select * from esign_fields where envelope_id = ?').all(envelopeId);

  const originalBytes = readFile(envelope.org_id, envelope.original_path);
  const actualHash = sha256Hex(originalBytes);
  if (actualHash !== envelope.original_sha256) {
    logEvent({
      envelope_id: envelopeId,
      actor_type: 'system',
      event_type: 'finalize_failed',
      details: { reason: 'integrity check failed' },
    });
    throw new Error('integrity check failed — original document hash mismatch');
  }

  const pdf = await PDFDocument.load(originalBytes);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const pages = pdf.getPages();

  for (const recipient of recipients) {
    const recipientFields = fields.filter((f) => f.recipient_id === recipient.id);
    for (const field of recipientFields) {
      const page = pages[field.page - 1];
      if (!page) continue;

      if (field.type === 'signature') {
        if (recipient.signature_path) {
          const pngBytes = readFile(envelope.org_id, recipient.signature_path);
          const img = await pdf.embedPng(pngBytes);
          const scale = Math.min(field.width / img.width, field.height / img.height, 1);
          const w = img.width * scale;
          const h = img.height * scale;
          page.drawImage(img, {
            x: field.x + (field.width - w) / 2,
            y: field.y + (field.height - h) / 2,
            width: w,
            height: h,
          });
        } else if (recipient.typed_signature) {
          page.drawText(recipient.typed_signature, {
            x: field.x + 4,
            y: field.y + field.height / 2 - 8,
            size: 22,
            font: italic,
          });
        }
      } else if (field.type === 'full_name') {
        page.drawText(recipient.full_name, { x: field.x + 2, y: field.y + 6, size: 11, font: regular });
      } else if (field.type === 'date_signed') {
        const dateStr = new Date(recipient.signed_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        page.drawText(dateStr, { x: field.x + 2, y: field.y + 6, size: 11, font: regular });
      } else if (field.value) {
        page.drawText(String(field.value), { x: field.x + 2, y: field.y + 6, size: 10, font: regular });
      }
    }
  }

  const finalBytes = await pdf.save();
  const finalHash = sha256Hex(finalBytes);
  const finalPath = `${envelopeId}/final.pdf`;
  writeFile(envelope.org_id, finalPath, finalBytes);

  const riskFlags = computeRiskFlags(recipients);
  const completedAt = new Date().toISOString();
  updateEnvelopeCompleteStmt.run(completedAt, finalPath, finalHash, JSON.stringify(riskFlags), envelopeId);

  logEvent({
    envelope_id: envelopeId,
    actor_type: 'system',
    event_type: 'envelope.completed',
    details: { sealed: false, risk_flags: riskFlags },
  });

  return { finalPath, finalHash, riskFlags };
}

module.exports = { finalize };
