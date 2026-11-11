const express = require('express');
const { db } = require('../../db');

const router = express.Router();

// Lets an integrating developer discover exactly what a template needs —
// its id (to pass to POST /api/v1/envelopes) and its declared variables —
// without ever reading this service's source code.
router.get('/', (req, res) => {
  const templates = db
    .prepare(
      `select id, name, kind, signer_roles, variables from esign_templates
       where org_id = ? and esign_allowed = 1 and is_active = 1
       order by family_key, version desc`,
    )
    .all(req.org.id);

  res.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      signerRoles: JSON.parse(t.signer_roles),
      variables: JSON.parse(t.variables || '[]'),
    })),
  });
});

module.exports = router;
