require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('node:path');

require('./src/db'); // applies migrations on boot

const { requireOrgSession, requirePlatformAdmin } = require('./src/middleware/requireOrgSession');
const { requireApiKey } = require('./src/middleware/requireApiKey');
const { verify: verifySignedUrl } = require('./src/lib/signedUrl');
const { readFile } = require('./src/lib/storage');

const authRoutes = require('./src/routes/auth');
const memberRoutes = require('./src/routes/org/members');
const templateRoutes = require('./src/routes/org/templates');
const envelopeRoutes = require('./src/routes/org/envelopes');
const signerRoutes = require('./src/routes/public/signer');
const platformOrgRoutes = require('./src/routes/platform/organizations');
const v1EnvelopeRoutes = require('./src/routes/v1/envelopes');
const v1TemplateRoutes = require('./src/routes/v1/templates');
const v1AuthRoutes = require('./src/routes/v1/auth');
const apiClientRoutes = require('./src/routes/org/apiClients');

const app = express();

app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/org/members', requireOrgSession, memberRoutes);
app.use('/api/org/templates', requireOrgSession, templateRoutes);
app.use('/api/org/envelopes', requireOrgSession, envelopeRoutes);
app.use('/api/platform/organizations', requireOrgSession, requirePlatformAdmin, platformOrgRoutes);
app.use('/api/org/integration', requireOrgSession, apiClientRoutes);
app.use('/api/public', signerRoutes);
app.use('/api/v1/auth', v1AuthRoutes);
app.use('/api/v1/envelopes', requireApiKey, v1EnvelopeRoutes);
app.use('/api/v1/templates', requireApiKey, v1TemplateRoutes);

// Private files are never served off disk by path — only through a
// short-lived signed token (local-disk equivalent of a Supabase signed URL).
app.get('/files/:token', (req, res) => {
  const resolved = verifySignedUrl(req.params.token);
  if (!resolved) return res.status(403).send('expired or invalid link');
  try {
    const bytes = readFile(resolved.orgId, resolved.relativePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(bytes);
  } catch {
    res.status(404).send('not found');
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4100;
app.listen(port, () => {
  console.log(`[esign-service] listening on http://localhost:${port}`);
});
