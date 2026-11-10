const express = require('express');
const crypto = require('node:crypto');
const { db } = require('../../db');
const { requireOrgAdmin } = require('../../middleware/requireOrgSession');
const { writeFile } = require('../../lib/storage');
const { sign } = require('../../lib/signedUrl');

const router = express.Router();

function slugFamilyKey(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') +
    '-' +
    crypto.randomUUID().slice(0, 8)
  );
}

router.get('/', (req, res) => {
  const templates = db
    .prepare('select * from esign_templates where org_id = ? and is_active = 1 order by family_key, version desc')
    .all(req.user.orgId);
  res.json({ templates: templates.map(serialize) });
});

function serialize(t) {
  return {
    ...t,
    field_layout: t.field_layout ? JSON.parse(t.field_layout) : null,
    signer_roles: JSON.parse(t.signer_roles),
    esign_allowed: !!t.esign_allowed,
    is_active: !!t.is_active,
  };
}

// Templates are never edited in place — every save is a new row, a new
// version of the family. Same reasoning as the original: an envelope points
// at the exact version it was sent from, so an edit can never retroactively
// change what a signer already saw.
router.post('/', requireOrgAdmin, async (req, res) => {
  const { name, kind, bodyHtml, basePdfBase64, fieldLayout, signerRoles, familyKey: existingFamilyKey } =
    req.body || {};
  if (!name || !['html', 'pdf'].includes(kind)) return res.status(400).json({ error: 'missing_fields' });

  const roles = signerRoles && signerRoles.length ? signerRoles : ['owner_1'];

  if (kind === 'pdf') {
    for (const role of roles) {
      const hasSignature = (fieldLayout || []).some((f) => f.role === role && f.type === 'signature');
      if (!hasSignature) {
        return res.status(400).json({ error: 'missing_signature_field', role });
      }
    }
  }

  let familyKey = existingFamilyKey;
  let version = 1;
  let basePdfPath = null;

  if (familyKey) {
    const prev = db
      .prepare(
        'select * from esign_templates where org_id = ? and family_key = ? order by version desc limit 1',
      )
      .get(req.user.orgId, familyKey);
    if (prev) {
      version = prev.version + 1;
      basePdfPath = prev.base_pdf_path;
    }
  } else {
    familyKey = slugFamilyKey(name);
  }

  if (basePdfBase64) {
    const bytes = Buffer.from(basePdfBase64, 'base64');
    basePdfPath = `templates/${familyKey}/v${version}.pdf`;
    writeFile(req.user.orgId, basePdfPath, bytes);
  }

  const id = crypto.randomUUID();
  db.prepare(
    `insert into esign_templates
      (id, org_id, family_key, version, name, kind, body_html, base_pdf_path, field_layout, signer_roles,
       esign_allowed, created_by)
     values (?,?,?,?,?,?,?,?,?,?,0,?)`,
  ).run(
    id,
    req.user.orgId,
    familyKey,
    version,
    name,
    kind,
    kind === 'html' ? bodyHtml || '' : null,
    kind === 'pdf' ? basePdfPath : null,
    kind === 'pdf' ? JSON.stringify(fieldLayout || []) : null,
    JSON.stringify(roles),
  );

  res.json({ ok: true, id, familyKey, version });
});

router.post('/:id/set-allowed', requireOrgAdmin, (req, res) => {
  const { allowed } = req.body || {};
  const template = db
    .prepare('select * from esign_templates where id = ? and org_id = ?')
    .get(req.params.id, req.user.orgId);
  if (!template) return res.status(404).json({ error: 'not_found' });
  db.prepare('update esign_templates set esign_allowed = ? where id = ?').run(allowed ? 1 : 0, template.id);
  res.json({ ok: true });
});

router.delete('/:id', requireOrgAdmin, (req, res) => {
  const template = db
    .prepare('select * from esign_templates where id = ? and org_id = ?')
    .get(req.params.id, req.user.orgId);
  if (!template) return res.status(404).json({ error: 'not_found' });

  const used = db.prepare('select 1 from esign_envelopes where template_id = ? limit 1').get(template.id);
  if (used) {
    db.prepare('update esign_templates set is_active = 0 where id = ?').run(template.id);
    return res.json({ ok: true, deactivated: true });
  }
  db.prepare('delete from esign_templates where id = ?').run(template.id);
  res.json({ ok: true, deleted: true });
});

// Short-lived signed URL so the field editor can reopen an existing
// template's PDF without re-uploading it.
router.get('/:id/pdf-url', requireOrgAdmin, (req, res) => {
  const template = db
    .prepare('select * from esign_templates where id = ? and org_id = ?')
    .get(req.params.id, req.user.orgId);
  if (!template || !template.base_pdf_path) return res.status(404).json({ error: 'not_found' });
  const token = sign(req.user.orgId, template.base_pdf_path, 300);
  res.json({ url: `/files/${token}` });
});

module.exports = router;
