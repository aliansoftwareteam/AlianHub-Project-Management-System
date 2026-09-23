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

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const SPREADSHEET_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/* A one-sheet workbook written part by part, as writers other than SheetJS lay it out: each row
 * one cell from the shared strings table. `sheetName` and every string go into the XML as given,
 * so a caller can write a character as a numeric reference. */
const workbookXmlOf = ({ sheetName, strings }) => zipOf([
    ['[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        + '</Types>'],
    ['_rels/.rels', `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${XML_HEAD}<workbook xmlns="${SPREADSHEET_MAIN}" xmlns:r="${REL}"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>`
        + `<Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/sharedStrings.xml', `${XML_HEAD}<sst xmlns="${SPREADSHEET_MAIN}" count="${strings.length}" uniqueCount="${strings.length}">`
        + strings.map((text) => `<si><t xml:space="preserve">${text}</t></si>`).join('')
        + '</sst>'],
    ['xl/worksheets/sheet1.xml', `${XML_HEAD}<worksheet xmlns="${SPREADSHEET_MAIN}"><sheetData>`
        + strings.map((_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="s"><v>${i}</v></c></row>`).join('')
        + '</sheetData></worksheet>'],
]);

/* A zip whose central directory declares `bytes` of content in one stored entry of zeros. */
const zipDeclaring = (bytes) => zipOf([['word/document.xml', Buffer.alloc(bytes)]]);

/* Entries whose headers claim `declared` bytes each, whatever they really hold; deflated unless
 * `store` is set. */
const lyingZipOf = (entries, declared, { store = false } = {}) => {
    const zlib = require('zlib');
    const locals = [];
    const centrals = [];
    let offset = 0;
    entries.forEach(([name, content]) => {
        const nameBytes = Buffer.from(name);
        const raw = Buffer.isBuffer(content) ? content : Buffer.from(content);
        const data = store ? raw : zlib.deflateRawSync(raw);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(store ? 0 : 8, 8);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(declared, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(store ? 0 : 8, 10);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(declared, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, nameBytes, data);
        centrals.push(central, nameBytes);
        offset += local.length + nameBytes.length + data.length;
    });
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
};

module.exports = { pdfOf, docxOf, xlsxOf, workbookXmlOf, zipOf, zipDeclaring, lyingZipOf };
