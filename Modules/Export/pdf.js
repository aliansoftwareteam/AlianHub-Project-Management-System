// PDF export (S4-04). A general "render this payload as a branded PDF" endpoint.
// The client sends what it already displays — table rows for timesheets, and
// client-rendered chart images (ApexCharts dataURI) for the agile reports — so
// the PDF always matches the on-screen data and we avoid server-side chart
// rendering and date/unit guesswork. Uses pdfmake with the standard PDF
// Helvetica font (no embedded font files / headless browser — light Docker image).
const path = require('path');
const fs = require('fs');
const logger = require('../../Config/loggerConfig');

// pdfmake is loaded lazily so a missing install never breaks app startup — only
// this endpoint errors (with a clear message) until `npm install` brings it in.
let _printer = null;
function getPrinter() {
    if (_printer) return _printer;
    const PdfPrinter = require('pdfmake');
    _printer = new PdfPrinter({
        Helvetica: {
            normal: 'Helvetica',
            bold: 'Helvetica-Bold',
            italics: 'Helvetica-Oblique',
            bolditalics: 'Helvetica-BoldOblique',
        },
    });
    return _printer;
}

const BRAND_COLOR = '#2F3990';

function productName() {
    try {
        const p = path.join(__dirname, '../../brandSettings.json');
        if (fs.existsSync(p)) {
            const data = JSON.parse(fs.readFileSync(p, 'utf8'));
            return data.productName || 'AlianHub';
        }
    } catch (e) { /* fall through to default */ }
    return 'AlianHub';
}

function sanitizeFilename(name) {
    return String(name || 'export').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'export';
}

const STYLES = {
    brand: { fontSize: 16, bold: true, color: BRAND_COLOR },
    h1: { fontSize: 18, bold: true, margin: [0, 6, 0, 0] },
    sub: { fontSize: 10, color: '#666666', margin: [0, 2, 0, 0] },
    th: { bold: true, fontSize: 10, color: '#ffffff' },
    meta: { fontSize: 10, color: '#444444', margin: [0, 1, 0, 1] },
    total: { bold: true, fontSize: 10 },
};

function headerBlocks(title, subtitle) {
    const blocks = [
        { text: productName(), style: 'brand' },
        { text: title || 'Report', style: 'h1' },
    ];
    if (subtitle) blocks.push({ text: subtitle, style: 'sub' });
    blocks.push({ canvas: [{ type: 'line', x1: 0, y1: 4, x2: 515, y2: 4, lineWidth: 1, lineColor: '#dddddd' }], margin: [0, 6, 0, 10] });
    return blocks;
}

function tableBlock(tableHead, tableRows, totalRow) {
    const body = [];
    if (Array.isArray(tableHead) && tableHead.length) {
        body.push(tableHead.map((h) => ({ text: String(h), style: 'th', fillColor: BRAND_COLOR, margin: [0, 4, 0, 4] })));
    }
    (tableRows || []).forEach((row) => {
        body.push((row || []).map((cell) => ({ text: cell == null ? '' : String(cell), fontSize: 9, margin: [0, 2, 0, 2] })));
    });
    if (Array.isArray(totalRow) && totalRow.length) {
        body.push(totalRow.map((cell) => ({ text: cell == null ? '' : String(cell), style: 'total', fillColor: '#f0f1f7', margin: [0, 4, 0, 4] })));
    }
    if (!body.length) return { text: 'No data for this selection.', italics: true, color: '#888888' };
    const colCount = (tableHead && tableHead.length) || (body[0] && body[0].length) || 1;
    return {
        table: { headerRows: tableHead && tableHead.length ? 1 : 0, widths: Array(colCount).fill('*'), body },
        layout: { hLineColor: () => '#e6e6e6', vLineColor: () => '#e6e6e6' },
        margin: [0, 4, 0, 12],
    };
}

function streamPdf(res, docDefinition, filename) {
    const pdfDoc = getPrinter().createPdfKitDocument(docDefinition);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}.pdf"`);
    pdfDoc.pipe(res);
    pdfDoc.end();
}

/* POST /api/v1/export/pdf  body: { type, params }  (companyId from header)
 * params: { title, subtitle?, filename?, meta?: string[], image?|images?: base64 dataURI,
 *           tableHead?: string[], tableRows?: any[][], totalRow?: any[] } */
exports.exportPdf = (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { type, params = {} } = req.body || {};
        if (!companyId || !type) {
            return res.status(400).send({ status: false, statusText: 'companyId and type are required.' });
        }

        const content = headerBlocks(params.title, params.subtitle);

        if (Array.isArray(params.meta) && params.meta.length) {
            params.meta.forEach((line) => content.push({ text: String(line), style: 'meta' }));
            content.push({ text: ' ', margin: [0, 0, 0, 6] });
        }

        const images = params.images || (params.image ? [params.image] : []);
        images.forEach((img) => {
            if (typeof img === 'string' && img.startsWith('data:image')) {
                content.push({ image: img, width: 515, margin: [0, 4, 0, 12] });
            }
        });

        if ((Array.isArray(params.tableHead) && params.tableHead.length) || (Array.isArray(params.tableRows) && params.tableRows.length)) {
            content.push(tableBlock(params.tableHead, params.tableRows, params.totalRow));
        }

        const docDefinition = {
            pageSize: 'A4',
            pageMargins: [40, 40, 40, 50],
            defaultStyle: { font: 'Helvetica', fontSize: 10 },
            styles: STYLES,
            content,
            footer: (currentPage, pageCount) => ({
                columns: [
                    { text: `Generated ${new Date().toISOString().slice(0, 10)}`, fontSize: 8, color: '#999999', margin: [40, 0, 0, 0] },
                    { text: `${currentPage} / ${pageCount}`, alignment: 'right', fontSize: 8, color: '#999999', margin: [0, 0, 40, 0] },
                ],
            }),
        };

        streamPdf(res, docDefinition, params.filename || type);
    } catch (error) {
        logger.error(`ERROR in export pdf: ${error.message}`);
        if (!res.headersSent) res.status(500).send({ status: false, statusText: error.message });
    }
};
