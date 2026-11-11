// Same {{token}} shape the merge renderer itself substitutes
// (src/lib/htmlRender.js), kept as its own small module so the authoring UI,
// the template-save route, and the API validator all agree on exactly one
// definition of what counts as a variable.
function extractVariables(bodyHtml) {
  const found = new Set();
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  let match;
  while ((match = re.exec(bodyHtml || ''))) found.add(match[1]);
  return [...found].sort();
}

class MergeDataValidationError extends Error {
  constructor(missing, unexpected) {
    super('merge data does not match the template’s declared variables');
    this.name = 'MergeDataValidationError';
    this.missing = missing;
    this.unexpected = unexpected;
  }
}

// Strict both ways: every declared variable must be present (and non-empty
// — an integration silently sending "" is almost always a bug, not an
// intentional blank), and nothing extra/unrecognized may be sent. Designed
// to fail loudly on an integration mistake rather than silently rendering a
// wrong or missing value into a legal document.
function validateMergeData(template, mergeData) {
  const declared = JSON.parse(template.variables || '[]');
  const supplied = Object.keys(mergeData || {});

  const missing = declared.filter((name) => {
    const v = mergeData?.[name];
    return v === undefined || v === null || v === '';
  });
  const unexpected = supplied.filter((name) => !declared.includes(name));

  if (missing.length || unexpected.length) {
    throw new MergeDataValidationError(missing, unexpected);
  }
}

module.exports = { extractVariables, validateMergeData, MergeDataValidationError };
