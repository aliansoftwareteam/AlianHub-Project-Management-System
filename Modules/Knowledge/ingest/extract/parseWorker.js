const { parentPort, workerData } = require('worker_threads');
const { finish, decodeText } = require('./text');
const { inflateWithin } = require('./zip');
const { csvText } = require('./csv');

const { kind, bytes, limits } = workerData;

/* This thread's own heap and off-heap memory, which only it can read: checked where the work
 * yields, and after inflation, so a parser is judged on what it holds itself. */
const held = () => {
    const usage = process.memoryUsage();
    return usage.heapUsed + usage.external;
};

class TooMuchMemory extends Error {
    constructor() {
        super(`Held past ${limits.maxParseMemoryBytes} bytes.`);
        this.code = 'too_much_memory';
    }
}

/* The extractor stops the thread on the first answer, so a report sent from the timer ends it. */
const checkMemory = () => {
    if (held() > limits.maxParseMemoryBytes) throw new TooMuchMemory();
};

const report = (error) => parentPort.postMessage({ ok: false, code: error && error.code, message: String((error && error.message) || error).slice(0, 300) });
setInterval(() => { try { checkMemory(); } catch (error) { report(error); } }, 20).unref();

const inflated = (options) => {
    const archive = inflateWithin(Buffer.from(bytes), limits.maxUnzippedBytes, options);
    checkMemory();
    return archive;
};

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
    const result = await mammoth.extractRawText({ buffer: inflated() });
    return { text: result.value || '', partial: false };
};

/* SheetJS turns a numeric character reference into a single UTF-16 unit, so a character past U+FFFF
 * written as one (an emoji, a rarer ideograph) reads as some other character. Those are spelled
 * out in UTF-8 before it sees the part; every other byte stays as it was. */
const NUMERIC_REFERENCE = /&#(?:x([0-9a-fA-F]{1,8})|([0-9]{1,10}));/g;
const XML_PART = /\.(?:xml|rels)$/i;

const spellWideReferences = (name, content) => {
    if (!XML_PART.test(name.toString('latin1')) || !content.includes('&#')) return content;
    const bytes = content.toString('latin1');
    const spelled = bytes.replace(NUMERIC_REFERENCE, (reference, hex, decimal) => {
        const codePoint = hex ? parseInt(hex, 16) : Number(decimal);
        return codePoint > 0xffff && codePoint <= 0x10ffff ? Buffer.from(String.fromCodePoint(codePoint)).toString('latin1') : reference;
    });
    return spelled === bytes ? content : Buffer.from(spelled, 'latin1');
};

/* The macro part is never loaded and formulas never read, so nothing in a workbook is evaluated. */
const sheetText = () => {
    const XLSX = require('xlsx');
    const archive = inflated({ rewrite: spellWideReferences });
    const book = XLSX.read(archive, { type: 'buffer', cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false, bookDeps: false, sheetRows: limits.maxRows + 1 });
    const names = book.SheetNames.slice(0, limits.maxSheets);
    let partial = book.SheetNames.length > names.length;
    const sections = names.map((name) => {
        const rows = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, blankrows: false, defval: '' });
        if (rows.length > limits.maxRows) partial = true;
        const lines = rows.slice(0, limits.maxRows).map((row) => row.map((cell) => String(cell).trim()).filter(Boolean).join(' | ')).filter(Boolean);
        return [`## ${name}`, ...lines].join('\n');
    });
    return { text: sections.join('\n\n'), partial };
};

const plainText = () => ({ text: decodeText(Buffer.from(bytes)), partial: false });

const csvRows = () => csvText(decodeText(Buffer.from(bytes)), limits.maxRows);

const PARSERS = { pdf: pdfText, docx: docxText, xlsx: sheetText, csv: csvRows, text: plainText, markdown: plainText };

(async () => {
    const { text, partial } = await PARSERS[kind]();
    parentPort.postMessage({ ok: true, ...finish(text, limits.maxChars, partial) });
})().catch(report);
