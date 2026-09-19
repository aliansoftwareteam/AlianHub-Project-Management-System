const archiver = require('archiver');
const XLSX = require('xlsx');

// Small files built in memory for the extraction tests, so no binary is committed.

const escapePdf = (line) => String(line).replace(/[()\\]/g, '\\$&');

const pageContent = (lines) => `BT /F1 12 Tf 72 720 Td ${lines.map((line) => `(${escapePdf(line)}) Tj 0 -16 Td`).join(' ')} ET`;

/* One page per entry of `pages`, each a list of lines set in Helvetica. */
const pdfOf = (pages) => {
    const fontId = 3 + pages.length * 2;
    const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`];
    pages.forEach((lines, i) => {
        const content = pageContent(lines);
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
        objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    let body = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((object, i) => {
        offsets.push(body.length);
        body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(body, 'latin1');
};

const zipOf = (entries) => new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const parts = [];
    archive.on('data', (part) => parts.push(part));
    archive.on('end', () => resolve(Buffer.concat(parts)));
    archive.on('error', reject);
    entries.forEach(([name, content]) => archive.append(content, { name }));
    archive.finalize();
});

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>';

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>';

const escapeXml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* `doctype` goes in front of the document element and `rawBody` inside the body as written, for
 * the external-entity case. */
const docxOf = (paragraphs, { doctype = '', rawBody = '' } = {}) => zipOf([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${doctype}`
        + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        + paragraphs.map((text) => `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`).join('')
        + rawBody
        + '</w:body></w:document>'],
]);

/* `sheets` is { name: rows }, a row being a list of cells; a cell given as { f, v } carries a
 * formula beside its cached value. */
const xlsxOf = (sheets, { bookType = 'xlsx' } = {}) => {
    const book = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([name, rows]) => {
        const sheet = XLSX.utils.aoa_to_sheet(rows.map((row) => row.map((cell) => (cell && typeof cell === 'object' ? cell.v : cell))));
        rows.forEach((row, r) => row.forEach((cell, c) => {
            if (cell && typeof cell === 'object' && cell.f) sheet[XLSX.utils.encode_cell({ r, c })].f = cell.f;
        }));
        XLSX.utils.book_append_sheet(book, sheet, name);
    });
    return XLSX.write(book, { type: 'buffer', bookType });
};

/* A zip whose central directory declares `bytes` of content in one stored entry of zeros. */
const zipDeclaring = (bytes) => zipOf([['word/document.xml', Buffer.alloc(bytes)]]);

module.exports = { pdfOf, docxOf, xlsxOf, zipOf, zipDeclaring };
