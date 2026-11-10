const { db } = require('../db');
const { sha256Hex } = require('./crypto');

// Generic starter legal text, seeded for every new organization so the
// signer flow has something real to show from day one. NOT reviewed by a
// lawyer — same caveat as the original's seed migration. An org can replace
// these with counsel-approved wording later by inserting a new version and
// flipping is_active; the old version stays on record for any envelope
// already sent against it (disclosures are append-only).
const DEFAULTS = [
  {
    kind: 'ersd',
    body_md: `# Electronic Records and Signature Disclosure

By proceeding, you agree to receive this document and related communications electronically.

- **Right to paper copy**: you may request a paper copy of this document at any time by contacting the sender.
- **Withdrawing consent**: you may withdraw your consent to sign electronically at any point before signing by declining.
- **Scope**: this consent applies only to this document.
- **Requirements**: you'll need a modern web browser, an email address or mobile phone, and the ability to view a PDF.`,
  },
  {
    kind: 'intent',
    body_md:
      'By clicking Finish, I agree to be legally bound by this document. My electronic signature is the legal equivalent of my handwritten signature.',
  },
  {
    kind: 'adoption',
    body_md:
      'By selecting Adopt and Sign, I agree that the signature and initials above are the electronic representation of my signature and initials for all purposes, including this document and any other documents requiring my signature.',
  },
  {
    kind: 'authority',
    body_md:
      'I certify that I am an owner or authorized officer of the business named in this document and have the authority to sign this document on its behalf. Where this document contains a personal guaranty, I am also signing in my individual capacity.',
  },
];

function seedDefaultDisclosures(orgId) {
  const insert = db.prepare(
    'insert into esign_disclosures (org_id, kind, version, body_md, sha256, is_active) values (?,?,1,?,?,1)',
  );
  for (const d of DEFAULTS) {
    insert.run(orgId, d.kind, d.body_md, sha256Hex(d.body_md));
  }
}

module.exports = { seedDefaultDisclosures };
