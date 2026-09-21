const { parentPort, workerData } = require('worker_threads');
const { finish } = require('./text');

// Runs in a thread of its own, one file per thread. The parsers read whatever a member or an
// outsider uploaded, so they get nothing but the bytes: no environment, no handle on the main
// thread's objects, and a lifetime the extractor ends at its deadline. Whatever a hostile file
// does to a parser's own state dies with the thread.

const { kind, bytes, limits } = workerData;

const pdfText = async () => {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: bytes, isEvalSupported: false, enableXfa: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false });
    try {
        const parsed = await parser.getText({ first: limits.maxPages });
        const pages = Array.isArray(parsed.pages) ? parsed.pages.map((page) => page.text) : [parsed.text];
        return { text: pages.join('\n\n'), partial: Number(parsed.total) > limits.maxPages };
    } finally {
        await parser.destroy().catch(() => null);
    }
};

const docxText = async () => {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { text: result.value || '', partial: false };
};

/* Cell text only: formulas are not read (cellFormula), let alone evaluated, the macro part is
 * not loaded (bookVBA), and no row past the limit is parsed (sheetRows). A csv cell stays the
 * text it is (raw), so "=1+1" is never taken for a formula. */
const sheetText = () => {
    const XLSX = require('xlsx');
    const book = XLSX.read(Buffer.from(bytes), { type: 'buffer', raw: kind === 'csv', cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false, bookDeps: false, sheetRows: limits.maxRows + 1 });
    const names = book.SheetNames.slice(0, limits.maxSheets);
    let partial = book.SheetNames.length > names.length;
    const sections = names.map((name) => {
        const rows = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, blankrows: false, defval: '' });
        if (rows.length > limits.maxRows) partial = true;
        const lines = rows.slice(0, limits.maxRows).map((row) => row.map((cell) => String(cell).trim()).filter(Boolean).join(' | ')).filter(Boolean);
        return (kind === 'csv' ? lines : [`## ${name}`, ...lines]).join('\n');
    });
    return { text: sections.join('\n\n'), partial };
};

const PARSERS = { pdf: pdfText, docx: docxText, xlsx: sheetText, csv: sheetText };

(async () => {
    const { text, partial } = await PARSERS[kind]();
    parentPort.postMessage({ ok: true, ...finish(text, limits.maxChars, partial) });
})().catch((error) => parentPort.postMessage({ ok: false, message: String((error && error.message) || error).slice(0, 300) }));
