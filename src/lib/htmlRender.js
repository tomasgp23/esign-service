const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const MAX_WIDTH = PAGE_WIDTH - MARGIN * 2;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// {{token}} substitution — always HTML-escaped, so merge data is never
// treated as markup even if it contains angle brackets.
function substituteMergeTokens(html, data) {
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = data[key];
    if (v === null || v === undefined || v === '') return '—';
    return escapeHtml(String(v));
  });
}

// A small, fixed HTML subset — not a real HTML/CSS renderer. Block tags
// (h1/h2/h3/p/ul>li) must appear literally with no nesting. Falls back to
// blank-line-separated paragraphs if no block tags were found at all.
function parseBlocks(html) {
  const blocks = [];
  const blockRe = /<(h1|h2|h3|p|ul)>([\s\S]*?)<\/\1>/gi;
  let match;
  let found = false;
  while ((match = blockRe.exec(html))) {
    found = true;
    const [, tag, inner] = match;
    if (tag === 'ul') {
      const liRe = /<li>([\s\S]*?)<\/li>/gi;
      let li;
      while ((li = liRe.exec(inner))) blocks.push({ type: 'li', runs: parseInline(li[1]) });
    } else {
      blocks.push({ type: tag, runs: parseInline(inner) });
    }
  }
  if (!found) {
    const paras = html.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    for (const p of paras) blocks.push({ type: 'p', runs: parseInline(p) });
  }
  return blocks;
}

function parseInline(html) {
  const runs = [];
  let bold = false;
  let italic = false;
  let last = 0;
  const tagRe = /<(\/?)(b|strong|i|em|br)\s*\/?>/gi;
  let match;
  while ((match = tagRe.exec(html))) {
    const text = html.slice(last, match.index);
    if (text) runs.push({ text: decodeEntities(text), bold, italic });
    const [, closing, tag] = match;
    if (tag === 'br') {
      runs.push({ text: '\n', bold, italic });
    } else if (tag === 'b' || tag === 'strong') {
      bold = !closing;
    } else if (tag === 'i' || tag === 'em') {
      italic = !closing;
    }
    last = tagRe.lastIndex;
  }
  const rest = html.slice(last);
  if (rest) runs.push({ text: decodeEntities(rest), bold, italic });
  return runs;
}

async function renderMergeTemplateToPdf(bodyHtml, mergeData) {
  const substituted = substituteMergeTokens(bodyHtml, mergeData);
  const blocks = parseBlocks(substituted);

  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const pickFont = (bold, italic) =>
    bold && italic ? fonts.boldItalic : bold ? fonts.bold : italic ? fonts.italic : fonts.regular;

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function newPage() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  function wrapAndDraw(runs, size, bold) {
    let x = MARGIN;
    let lineHeight = size * 1.3;
    for (const run of runs) {
      const segments = run.text.split('\n');
      segments.forEach((segment, idx) => {
        if (idx > 0) {
          x = MARGIN;
          y -= lineHeight;
          if (y < MARGIN) newPage();
        }
        const words = segment.split(/(\s+)/).filter((w) => w.length);
        for (const word of words) {
          const font = pickFont(run.bold || bold, run.italic);
          const w = font.widthOfTextAtSize(word, size);
          if (x + w > MARGIN + MAX_WIDTH && word.trim()) {
            x = MARGIN;
            y -= lineHeight;
            if (y < MARGIN) newPage();
          }
          if (word.trim()) {
            page.drawText(word, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) });
          }
          x += w;
        }
      });
    }
    y -= lineHeight;
  }

  if (blocks.length === 0) {
    page.drawText('(This template has no content.)', {
      x: MARGIN,
      y,
      size: 11,
      font: fonts.italic,
    });
  }

  for (const block of blocks) {
    if (y < MARGIN + 24) newPage();
    if (block.type === 'h1') {
      wrapAndDraw(block.runs, 18, true);
      y -= 6;
    } else if (block.type === 'h2') {
      wrapAndDraw(block.runs, 15, true);
      y -= 4;
    } else if (block.type === 'h3') {
      wrapAndDraw(block.runs, 13, true);
      y -= 2;
    } else if (block.type === 'li') {
      page.drawText('•', { x: MARGIN, y, size: 11, font: fonts.regular });
      const savedMargin = MARGIN;
      wrapAndDrawIndented(block.runs, 11, false, savedMargin + 16);
    } else {
      wrapAndDraw(block.runs, 11, false);
      y -= 8;
    }
  }

  function wrapAndDrawIndented(runs, size, bold, indent) {
    let x = indent;
    const lineHeight = size * 1.3;
    for (const run of runs) {
      const words = run.text.split(/(\s+)/).filter((w) => w.length);
      for (const word of words) {
        const font = pickFont(run.bold || bold, run.italic);
        const w = font.widthOfTextAtSize(word, size);
        if (x + w > MARGIN + MAX_WIDTH && word.trim()) {
          x = indent;
          y -= lineHeight;
          if (y < MARGIN) newPage();
        }
        if (word.trim()) page.drawText(word, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) });
        x += w;
      }
    }
    y -= lineHeight;
  }

  return pdf;
}

module.exports = { substituteMergeTokens, parseBlocks, parseInline, renderMergeTemplateToPdf };
