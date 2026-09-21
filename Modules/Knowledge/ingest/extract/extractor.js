const path = require('path');
const { Worker } = require('worker_threads');
const { limits: readLimits } = require('./limits');
const { TRUNCATION_MARKER, finish } = require('./text');

// Text out of an uploaded file, for the indexer. The types read are the ones named in KINDS;
// anything else has no kind and is never opened. Plain text is decoded here. Every parsed type
// goes to a thread of its own (parseWorker.js), because a parser is the one piece of this that
// runs on bytes a stranger may have chosen: the thread can be stopped at the deadline even when
// the parser never yields, its memory is capped, and whatever the file does to the parser's
// state stays in a thread that ends with the file. Nothing is evaluated, no macro part is
// loaded, no external entity or linked file is resolved, and no other program is started.

const KINDS = Object.freeze({ pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', csv: 'csv', txt: 'text', md: 'markdown', markdown: 'markdown' });
const PARSED = ['pdf', 'docx', 'xlsx', 'csv'];
const ZIPPED = ['docx', 'xlsx'];
const MAX_WORKERS = 2;
const WORKER_HEAP_MB = 512;
const MAX_ZIP_ENTRIES = 5000;
const WORKER_PATH = path.join(__dirname, 'parseWorker.js');

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const ZIP64_SIZE = 0xffffffff;

const refusal = (code, message) => Object.assign(new Error(message), { code });

const extensionOf = (filename) => {
    const name = String(filename || '');
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot + 1);
};

const kindOf = ({ extension, filename } = {}) => KINDS[String(extension || extensionOf(filename)).trim().toLowerCase()] || null;

/* What the archive says it unpacks to, read from its central directory without unpacking
 * anything. A size a zip64 record would hold is already past any limit set here. */
const declaredUnzippedBytes = (buffer) => {
    const earliest = Math.max(0, buffer.length - 65557);
    let at = buffer.length - 22;
    while (at >= earliest && buffer.readUInt32LE(at) !== END_OF_CENTRAL_DIRECTORY) at -= 1;
    if (at < earliest) throw refusal('failed', 'The file is not the archive its type says it is.');
    const entries = buffer.readUInt16LE(at + 10);
    let offset = buffer.readUInt32LE(at + 16);
    if (entries > MAX_ZIP_ENTRIES || offset === ZIP64_SIZE) return Infinity;
    let total = 0;
    for (let i = 0; i < entries; i += 1) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) throw refusal('failed', 'The archive directory is damaged.');
        const size = buffer.readUInt32LE(offset + 24);
        if (size === ZIP64_SIZE) return Infinity;
        total += size;
        offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    }
    return total;
};

const looksLike = {
    pdf: (buffer) => buffer.subarray(0, 1024).includes('%PDF-'),
    zip: (buffer) => buffer.length > 22 && buffer.readUInt32LE(0) === 0x04034b50,
};

const checkBytes = (buffer, kind, limits) => {
    if (kind === 'pdf' && !looksLike.pdf(buffer)) throw refusal('failed', 'The file is not a PDF.');
    if (!ZIPPED.includes(kind)) return;
    if (!looksLike.zip(buffer)) throw refusal('failed', 'The file is not the archive its type says it is.');
    const unzipped = declaredUnzippedBytes(buffer);
    if (unzipped > limits.maxUnzippedBytes) throw refusal('too_large', `The archive unpacks to more than the ${limits.maxUnzippedBytes} bytes allowed.`);
};

const decodeText = (buffer) => {
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
    if (buffer.includes(0)) throw refusal('failed', 'The file is not text.');
    return new TextDecoder('utf-8').decode(buffer);
};

let active = 0;
const waiting = [];

const withSlot = (run) => new Promise((resolve, reject) => {
    const begin = () => {
        active += 1;
        run().then(resolve, reject).finally(() => {
            active -= 1;
            const next = waiting.shift();
            if (next) next();
        });
    };
    if (active < MAX_WORKERS) begin();
    else waiting.push(begin);
});

/* The deadline runs from the moment the thread starts, not from when the file began to wait
 * for a slot. */
const parseInThread = (buffer, kind, limits, workerPath) => new Promise((resolve, reject) => {
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    const worker = new Worker(workerPath, {
        workerData: { kind, bytes, limits },
        transferList: [bytes.buffer],
        env: {},
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
    });
    let settled = false;
    const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate().catch(() => null).then(() => fn(value));
    };
    const timer = setTimeout(() => settle(reject, refusal('timed_out', `Abandoned after ${limits.timeoutMs} ms.`)), limits.timeoutMs);
    worker.once('message', (message) => (message && message.ok
        ? settle(resolve, { text: message.text, truncated: message.truncated })
        : settle(reject, refusal('failed', (message && message.message) || 'The parser failed.'))));
    worker.once('error', (error) => settle(reject, refusal('failed', String((error && error.message) || error).slice(0, 300))));
    worker.once('exit', (code) => settle(reject, refusal('failed', `The parser stopped with code ${code}.`)));
});

/**
 * @returns {Promise<{ text: string, truncated: boolean }>} rejects with code unsupported,
 *          too_large, failed or timed_out
 */
const extractText = async ({ buffer, kind } = {}, { workerPath = WORKER_PATH } = {}) => {
    if (!Object.values(KINDS).includes(kind)) throw refusal('unsupported', `No reader for ${kind || 'this file'}.`);
    if (!Buffer.isBuffer(buffer)) throw refusal('failed', 'No bytes to read.');
    const limits = readLimits();
    if (buffer.length > limits.maxBytes) throw refusal('too_large', `The file is ${buffer.length} bytes, over the ${limits.maxBytes} allowed.`);
    if (!PARSED.includes(kind)) return finish(decodeText(buffer), limits.maxChars);
    checkBytes(buffer, kind, limits);
    return withSlot(() => parseInThread(buffer, kind, limits, workerPath));
};

const activeWorkers = () => active;

module.exports = { KINDS, MAX_WORKERS, TRUNCATION_MARKER, kindOf, extractText, activeWorkers, declaredUnzippedBytes };
