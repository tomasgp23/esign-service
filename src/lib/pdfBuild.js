const { StandardFonts, rgb } = require('pdf-lib');

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

// Appends one fresh US-Letter signature page for a recipient when the
// envelope wasn't built from a template with pre-placed fields. Returns the
// esign_fields rows (page/x/y/width/height) describing what was drawn, same
// box/line layout as the original's addSignaturePage().
async function addSignaturePage(pdfDoc, { recipientRole }) {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageNumber = pdfDoc.getPageCount();

  const boxX = 72;
  const boxY = 500;
  const boxW = 260;
  const boxH = 50;

  page.drawText('Signature page', { x: boxX, y: 720, size: 14, font: boldFont });
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxW,
    height: boxH,
    borderColor: rgb(0.6, 0.6, 0.6),
    borderWidth: 1,
  });
  page.drawText('Signature', { x: boxX, y: boxY - 14, size: 9, font });

  const nameY = boxY - 40;
  page.drawLine({
    start: { x: boxX, y: nameY },
    end: { x: boxX + boxW, y: nameY },
    thickness: 0.75,
    color: rgb(0.6, 0.6, 0.6),
  });
  page.drawText('Printed name', { x: boxX, y: nameY - 14, size: 9, font });

  const titleY = nameY - 40;
  page.drawLine({
    start: { x: boxX, y: titleY },
    end: { x: boxX + boxW, y: titleY },
    thickness: 0.75,
    color: rgb(0.6, 0.6, 0.6),
  });
  page.drawText('Title', { x: boxX, y: titleY - 14, size: 9, font });

  const dateY = titleY - 40;
  page.drawLine({
    start: { x: boxX, y: dateY },
    end: { x: boxX + boxW, y: dateY },
    thickness: 0.75,
    color: rgb(0.6, 0.6, 0.6),
  });
  page.drawText('Date signed', { x: boxX, y: dateY - 14, size: 9, font });

  return [
    { type: 'signature', page: pageNumber, x: boxX, y: boxY, width: boxW, height: boxH, label: 'Signature' },
    { type: 'full_name', page: pageNumber, x: boxX, y: nameY, width: boxW, height: 24, label: 'Printed name' },
    { type: 'date_signed', page: pageNumber, x: boxX, y: dateY, width: boxW, height: 24, label: 'Date signed' },
  ];
}

module.exports = { addSignaturePage, PAGE_WIDTH, PAGE_HEIGHT };
