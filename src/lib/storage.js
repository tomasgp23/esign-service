const fs = require('node:fs');
const path = require('node:path');
const { FILES_DIR } = require('../db');

// Private, local-disk equivalent of the original's Supabase storage bucket —
// organized the same way (one folder per envelope), scoped under org_id so
// one organization's files are never reachable through another's path.
function pathFor(orgId, relativePath) {
  const full = path.join(FILES_DIR, orgId, relativePath);
  const resolved = path.resolve(full);
  const root = path.resolve(path.join(FILES_DIR, orgId));
  if (!resolved.startsWith(root)) throw new Error('invalid storage path');
  return resolved;
}

function writeFile(orgId, relativePath, buffer) {
  const full = pathFor(orgId, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return relativePath;
}

function readFile(orgId, relativePath) {
  return fs.readFileSync(pathFor(orgId, relativePath));
}

function exists(orgId, relativePath) {
  return fs.existsSync(pathFor(orgId, relativePath));
}

module.exports = { writeFile, readFile, exists };
