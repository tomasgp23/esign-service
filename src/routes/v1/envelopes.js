const express = require('express');
const { db } = require('../../db');
const { createEnvelope, EnvelopeCreateError } = require('../../lib/envelopeCreate');
const { validateMergeData, MergeDataValidationError } = require('../../lib/templateVariables');
const { deliverWebhook } = require('../../lib/webhooks');

const router = express.Router();

function serializeEnvelope(e) {
  return { id: e.id, title: e.title, status: e.status, riskFlags: JSON.parse(e.risk_flags), createdAt: e.created_at, sentAt: e.sent_at, completedAt: e.completed_at };
}

// Template-only — no raw PDF upload through this surface. An external CRM
// integrates against a template it already knows the shape of (via
// GET /templates), not an arbitrary uploaded file.
router.post('/', async (req, res) => {
  try {
    const { templateId, mergeData, recipients, signingOrder, title } = req.body || {};
    if (!templateId) return res.status(400).json({ error: 'missing_fields', message: 'templateId is required' });
    if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 2) {
      return res.status(400).json({ error: 'missing_fields', message: 'recipients must be an array of 1 or 2 signers' });
    }

    const template = db.prepare('select * from esign_templates where id = ? and org_id = ?').get(templateId, req.org.id);
    if (!template) return res.status(404).json({ error: 'template_not_found' });
    if (!template.esign_allowed) return res.status(403).json({ error: 'template_not_approved' });

    try {
      validateMergeData(template, mergeData || {});
    } catch (err) {
      if (err instanceof MergeDataValidationError) {
        return res.status(400).json({ error: 'invalid_merge_data', missing: err.missing, unexpected: err.unexpected });
      }
      throw err;
    }

    const { envelopeId } = await createEnvelope({
      orgId: req.org.id,
      createdByUserId: null,
      actorType: 'api',
      title: title || template.name,
      esignTemplateId: templateId,
      mergeData: mergeData || {},
      recipient1: recipients[0],
      recipient2: recipients[1],
      signingOrder,
    });

    const envelope = db.prepare('select * from esign_envelopes where id = ?').get(envelopeId);
    deliverWebhook(req.org, 'envelope.sent', envelope).catch(() => {});

    res.status(201).json({ ok: true, envelopeId, status: envelope.status });
  } catch (err) {
    if (err instanceof EnvelopeCreateError) return res.status(err.status).json({ error: err.code });
    console.error('[v1/envelopes:create]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/:id', (req, res) => {
  const envelope = db.prepare('select * from esign_envelopes where id = ? and org_id = ?').get(req.params.id, req.org.id);
  if (!envelope) return res.status(404).json({ error: 'not_found' });
  res.json({ envelope: serializeEnvelope(envelope) });
});

module.exports = router;
