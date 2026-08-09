const PDFDocument = require('pdfkit');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets', 'certificate');
const BORDER = path.join(ASSETS, 'border.png');
const BADGE = path.join(ASSETS, 'badge.png');
const SEAL = path.join(ASSETS, 'seal.png');

const PAGE_W = 612, PAGE_H = 792; // US Letter, points

// Inner clear-area fractions measured from the border image (896x1200 source),
// same measurement used when this design was built as a Word template.
const LEFT_F = 154 / 896, RIGHT_F = 1 - 740 / 896;
const TOP_F = 154 / 1200, BOTTOM_F = 1 - 1045 / 1200;
const marginLeft = PAGE_W * LEFT_F;
const marginRight = PAGE_W * RIGHT_F;
const marginTop = PAGE_H * TOP_F;
const marginBottom = PAGE_H * BOTTOM_F;
const contentWidth = PAGE_W - marginLeft - marginRight;

function centerText(doc, text, y, opts = {}) {
  doc.text(text, marginLeft, y, Object.assign({ width: contentWidth, align: 'center' }, opts));
}

/**
 * Generates the GSBS Certificate of Competence as a PDF buffer, filled in
 * with a specific member's real data.
 */
function generateCertificatePdf({ name, credentialTitle, discipline, dateIssued, memberId, certNo }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Full-bleed ornate border, behind everything else.
    doc.image(BORDER, 0, 0, { width: PAGE_W, height: PAGE_H });

    let y = marginTop + 30;

    // Badge
    const badgeW = 58, badgeH = 54;
    doc.image(BADGE, marginLeft + contentWidth / 2 - badgeW / 2, y, { width: badgeW, height: badgeH });
    y += badgeH + 30;

    doc.fillColor('#1A1A1A').font('Times-Bold').fontSize(17);
    centerText(doc, 'CERTIFICATE OF COMPETENCE', y, { characterSpacing: 1.5 });
    y += 26;
    doc.moveTo(marginLeft + 20, y).lineTo(PAGE_W - marginRight - 20, y).strokeColor('#8C7A5C').lineWidth(0.75).stroke();
    y += 34;

    doc.font('Times-Italic').fontSize(12);
    centerText(doc, 'This is to certify that', y);
    y += 26;

    doc.font('Times-Bold').fontSize(23);
    centerText(doc, name, y);
    y += 38;

    doc.font('Times-Roman').fontSize(11);
    centerText(doc, 'has demonstrated the professional competence required to be a', y);
    y += 28;

    doc.font('Times-Bold').fontSize(17);
    centerText(doc, credentialTitle, y);
    y += 22;

    doc.font('Times-Roman').fontSize(10).fillColor('#5C5C5C');
    centerText(doc, 'in', y);
    y += 18;

    doc.font('Times-Bold').fontSize(15).fillColor('#1A1A1A');
    centerText(doc, discipline, y);
    y += 56;

    doc.font('Times-Roman').fontSize(11);
    centerText(doc, 'Awarded by the Ghanaian Society for Biomedical Scientists', y);
    y += 24;

    doc.font('Times-Bold').fontSize(14);
    centerText(doc, dateIssued, y);
    y += 90;

    // Signature row: President (left) — seal (center) — Secretary (right)
    const sigLineY = y + 20;
    const colW = contentWidth / 3;
    const leftColX = marginLeft;
    const rightColX = marginLeft + colW * 2;

    doc.strokeColor('#1A1A1A').lineWidth(0.5);
    doc.moveTo(leftColX + 10, sigLineY).lineTo(leftColX + colW - 20, sigLineY).stroke();
    doc.moveTo(rightColX + 10, sigLineY).lineTo(rightColX + colW - 20, sigLineY).stroke();

    doc.font('Times-Roman').fontSize(9).fillColor('#1A1A1A');
    doc.text('Evans Kwabena Abor', leftColX + 10, sigLineY + 4, { width: colW - 30, align: 'left' });
    doc.fontSize(8).fillColor('#5C5C5C');
    doc.text('President', leftColX + 10, sigLineY + 16, { width: colW - 30, align: 'left' });

    doc.font('Times-Roman').fontSize(9).fillColor('#1A1A1A');
    doc.text('Humphrey P.K. Addy', rightColX + 10, sigLineY + 4, { width: colW - 30, align: 'left' });
    doc.fontSize(8).fillColor('#5C5C5C');
    doc.text('Secretary', rightColX + 10, sigLineY + 16, { width: colW - 30, align: 'left' });

    const sealSize = 62;
    doc.image(SEAL, marginLeft + colW + colW / 2 - sealSize / 2, sigLineY - sealSize + 18, { width: sealSize, height: sealSize });

    doc.font('Times-Italic').fontSize(9).fillColor('#5C5C5C');
    centerText(doc, `Member ID ${memberId}   \u00b7   Certificate No. ${certNo || '\u2014'}`, sigLineY + 48);

    doc.end();
  });
}

module.exports = { generateCertificatePdf };
