const path = require('path');
const { Worker } = require('worker_threads');
const { limits: readLimits } = require('./limits');
const { TRUNCATION_MARKER, isUtf16 } = require('./text');

// Parsers run on bytes anyone with an upload may have chosen, so each gets a thread of its own
// that can be stopped whether or not it ever yields, and whose failures end with it.

const KINDS = Object.freeze({ pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', csv: 'csv', txt: 'text', md: 'markdown', markdown: 'markdown' });
const ZIPPED = ['docx', 'xlsx'];
const MAX_WORKERS = 2;
const PER_COMPANY_WHEN_OTHERS_WAIT = 1;
const WORKER_HEAP_MB = 512;
const MEMORY_SAMPLE_MS = 20;
/* What starting a thread costs in resident memory before its parser holds anything. */
const THREAD_OVERHEAD = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5000;
const WORKER_PATH = path.join(__dirname, 'parseWorker.js');
const OWN_REASONS = ['inflated_too_large', 'too_much_memory'];

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const ZIP64_SIZE = 0xffffffff;
const CFB = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const WEB_PAGE = /^\s*<(?:!doctype\s+html|html[\s>]|head[\s>]|body[\s>]|table[\s>]|\?xml|svg[\s>])/i;

const refusal = (code, message) => Object.assign(new Error(message), { code });

const extensionOf = (filename) => {
    const name = String(filename || '');
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot + 1);
};

const kindOf = ({ extension, filename } = {}) => KINDS[String(extension || extensionOf(filename)).trim().toLowerCase()] || null;

/* A size a zip64 record would hold is already past any limit set here. */
const declaredUnzippedBytes = (buffer) => {
    const earliest = Math.max(0, buffer.length - 65557);
    let at = buffer.length - 22;
    while (at >= earliest && buffer.readUInt32LE(at) !== END_OF_CENTRAL_DIRECTORY) at -= 1;
    if (at < earliest) throw refusal('type_mismatch', 'The file is not the archive its type says it is.');
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

const signs = (buffer) => ({
    pdf: buffer.subarray(0, 1024).includes('%PDF-'),
    zip: buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50,
    cfb: buffer.subarray(0, CFB.length).equals(CFB),
    webPage: WEB_PAGE.test(buffer.subarray(0, 512).toString('latin1').replace(/^ï»¿/, '')),
    binary: !isUtf16(buffer) && buffer.includes(0),
});

/* The name picks the parser and the bytes must agree with it. */
const agrees = (kind, sign) => {
    if (kind === 'pdf') return sign.pdf && !sign.zip && !sign.cfb;
    if (ZIPPED.includes(kind)) return sign.zip;
    return !sign.zip && !sign.cfb && !sign.webPage && !sign.binary;
};

const checkBytes = (buffer, kind, limits) => {
    if (!agrees(kind, signs(buffer))) throw refusal('type_mismatch', `The file's bytes are not ${kind}.`);
    if (ZIPPED.includes(kind) && declaredUnzippedBytes(buffer) > limits.maxUnzippedBytes) {
        throw refusal('too_large', `The archive declares more than the ${limits.maxUnzippedBytes} bytes allowed.`);
    }
};

let active = 0;
const holding = new Map();
const waiting = [];
let arrivals = 0;

const held = (companyId) => holding.get(companyId) || 0;

/* The company holding the fewest slots goes first, then a live upload before the backfill, then
 * whoever came first. */
const nextWaiting = () => {
    const fewest = Math.min(...waiting.map((entry) => held(entry.companyId)));
    const capped = fewest < PER_COMPANY_WHEN_OTHERS_WAIT;
    const eligible = waiting.filter((entry) => !capped || held(entry.companyId) === fewest);
    eligible.sort((a, b) => (b.live - a.live) || (a.order - b.order));
    return eligible[0];
};

const pump = () => {
    while (active < MAX_WORKERS && waiting.length) {
        const entry = nextWaiting();
        waiting.splice(waiting.indexOf(entry), 1);
        active += 1;
        holding.set(entry.companyId, held(entry.companyId) + 1);
        entry.begin();
    }
};

const inSlot = ({ companyId = '', priority = 'live' } = {}, run) => new Promise((resolve, reject) => {
    const company = String(companyId);
    waiting.push({
        companyId: company,
        live: priority === 'backfill' ? 0 : 1,
        order: arrivals += 1,
        begin: () => Promise.resolve().then(run).then(resolve, reject).finally(() => {
            active -= 1;
            if (held(company) <= 1) holding.delete(company);
            else holding.set(company, held(company) - 1);
            pump();
        }),
    });
    pump();
});

/* The thread judges its own memory where its parser yields (parseWorker.js). A parser that never
 * yields cannot, so the process's resident growth is watched as well, allowing each running parse
 * its cap and a thread's own start-up cost: with two running, either may be stopped once both
 * together pass that, and the file is retried. */
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
    const baseline = process.memoryUsage.rss();
    let settled = false;
    const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(watchdog);
        worker.terminate().catch(() => null).then(() => fn(value));
    };
    const timer = setTimeout(() => settle(reject, refusal('timed_out', `Abandoned after ${limits.timeoutMs} ms.`)), limits.timeoutMs);
    const watchdog = setInterval(() => {
        if (process.memoryUsage.rss() - baseline > (limits.maxParseMemoryBytes + THREAD_OVERHEAD) * Math.max(active, 1)) settle(reject, refusal('too_much_memory', `Stopped past ${limits.maxParseMemoryBytes} bytes of memory.`));
    }, MEMORY_SAMPLE_MS);
    worker.once('message', (message) => (message && message.ok
        ? settle(resolve, { text: message.text, truncated: message.truncated })
        : settle(reject, refusal(OWN_REASONS.includes(message && message.code) ? message.code : 'failed', (message && message.message) || 'The parser failed.'))));
    worker.once('error', (error) => settle(reject, refusal('failed', String((error && error.message) || error).slice(0, 300))));
    worker.once('exit', (code) => settle(reject, refusal('failed', `The parser stopped with code ${code}.`)));
});

/**
 * @returns {Promise<{ text: string, truncated: boolean }>} rejects with code unsupported,
 *          too_large, type_mismatch, inflated_too_large, too_much_memory, failed or timed_out
 */
const extractText = async ({ buffer, kind } = {}, { workerPath = WORKER_PATH, companyId = '', priority = 'live' } = {}) => {
    if (!Object.values(KINDS).includes(kind)) throw refusal('unsupported', `No reader for ${kind || 'this file'}.`);
    if (!Buffer.isBuffer(buffer)) throw refusal('failed', 'No bytes to read.');
    const limits = readLimits();
    if (buffer.length > limits.maxBytes) throw refusal('too_large', `The file is ${buffer.length} bytes, over the ${limits.maxBytes} allowed.`);
    checkBytes(buffer, kind, limits);
    return module.exports.inSlot({ companyId, priority }, () => parseInThread(buffer, kind, limits, workerPath));
};

const activeWorkers = () => active;

module.exports = { KINDS, MAX_WORKERS, TRUNCATION_MARKER, kindOf, extractText, inSlot, activeWorkers, declaredUnzippedBytes };
