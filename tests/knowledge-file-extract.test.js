/* Text extraction for uploaded files: each supported type yields its text, anything else is not
 * a kind at all, and the limits hold: characters, pages, sheets, rows, declared unzipped size and
 * time. Parsing runs in a worker thread the extractor can stop, so a parser that never returns
 * is abandoned at the deadline rather than waited for. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pdfOf, docxOf, xlsxOf, zipDeclaring } = require('./fixtures/knowledgeFiles');
const extractor = require('../Modules/Knowledge/ingest/extract/extractor');
const { limits } = require('../Modules/Knowledge/ingest/extract/limits');

const ENV_KEYS = ['KNOWLEDGE_FILE_MAX_BYTES', 'KNOWLEDGE_FILE_MAX_CHARS', 'KNOWLEDGE_FILE_TIMEOUT_MS', 'KNOWLEDGE_FILE_MAX_PAGES', 'KNOWLEDGE_FILE_MAX_SHEETS', 'KNOWLEDGE_FILE_MAX_ROWS', 'KNOWLEDGE_FILE_MAX_UNZIPPED_BYTES'];
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const SPINNING_WORKER = path.join(__dirname, 'fixtures', 'knowledgeSpinningWorker.js');

jest.setTimeout(30000);

afterEach(() => {
    ENV_KEYS.forEach((key) => {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    });
});

describe('which files are read', () => {
    it('knows a kind for pdf, docx, xlsx, csv, plain text and markdown, by extension', () => {
        expect(extractor.kindOf({ extension: 'pdf' })).toBe('pdf');
        expect(extractor.kindOf({ extension: 'DOCX' })).toBe('docx');
        expect(extractor.kindOf({ extension: 'xlsx' })).toBe('xlsx');
        expect(extractor.kindOf({ extension: 'csv' })).toBe('csv');
        expect(extractor.kindOf({ extension: 'txt' })).toBe('text');
        expect(extractor.kindOf({ extension: 'md' })).toBe('markdown');
        expect(extractor.kindOf({ filename: 'Notes.Markdown' })).toBe('markdown');
    });

    it('has no kind for anything else, macro-enabled and legacy office files included', () => {
        ['png', 'jpg', 'webm', 'zip', 'exe', 'html', 'svg', 'xlsm', 'xls', 'doc', 'docm', 'pptx', ''].forEach((extension) => {
            expect(extractor.kindOf({ extension })).toBeNull();
        });
        expect(extractor.kindOf({})).toBeNull();
    });

    it('refuses to extract a kind it does not know', async () => {
        await expect(extractor.extractText({ buffer: Buffer.from('x'), kind: 'png' })).rejects.toMatchObject({ code: 'unsupported' });
    });
});

describe('each type yields its text', () => {
    it('pdf', async () => {
        const out = await extractor.extractText({ buffer: pdfOf([['The harbour ledger lists the winch.', 'Second line.']]), kind: 'pdf' });
        expect(out.text).toContain('The harbour ledger lists the winch.');
        expect(out.text).toContain('Second line.');
        expect(out.truncated).toBe(false);
    });

    it('docx', async () => {
        const out = await extractor.extractText({ buffer: await docxOf(['The winch is rated for two tonnes.', 'Inspect it yearly.']), kind: 'docx' });
        expect(out.text).toContain('The winch is rated for two tonnes.');
        expect(out.text).toContain('Inspect it yearly.');
    });

    it('xlsx, a sheet at a time under its name, from cell text only: a formula is never evaluated or indexed', async () => {
        const buffer = xlsxOf({ Rates: [['Berth', 'Fee'], ['North quay', 120], ['Total', { f: 'SUM(B2:B2)*2', v: 240 }]], Notes: [['Remember the tide table']] });
        const out = await extractor.extractText({ buffer, kind: 'xlsx' });
        expect(out.text).toContain('## Rates');
        expect(out.text).toContain('North quay');
        expect(out.text).toContain('240');
        expect(out.text).toContain('## Notes');
        expect(out.text).toContain('Remember the tide table');
        expect(out.text).not.toContain('SUM(');
    });

    it('csv, keeping a cell that looks like a formula as the text it is', async () => {
        const out = await extractor.extractText({ buffer: Buffer.from('Berth,Fee\nNorth quay,120\n"=1+1",5\n'), kind: 'csv' });
        expect(out.text).toContain('North quay');
        expect(out.text).toContain('120');
        expect(out.text).toContain('=1+1');
    });

    it('plain text and markdown, as written', async () => {
        expect((await extractor.extractText({ buffer: Buffer.from('Tide tables are in the locker.\nBring a torch.'), kind: 'text' })).text).toBe('Tide tables are in the locker.\nBring a torch.');
        expect((await extractor.extractText({ buffer: Buffer.from('# Mooring\n\nUse the north cleat.'), kind: 'markdown' })).text).toBe('# Mooring\n\nUse the north cleat.');
    });
});

describe('what is never done', () => {
    it('resolves no external entity: a docx that names one fails, and the file it points at is never read into the text', async () => {
        const secret = path.join(os.tmpdir(), `s7s4-entity-${process.pid}.txt`);
        fs.writeFileSync(secret, 'ENTITYSECRET');
        try {
            const buffer = await docxOf(['Before'], {
                doctype: `<!DOCTYPE w:document [<!ENTITY leak SYSTEM "file://${secret}">]>`,
                rawBody: '<w:p><w:r><w:t>&leak;</w:t></w:r></w:p>',
            });
            const outcome = await extractor.extractText({ buffer, kind: 'docx' }).then((out) => out.text, (error) => error);
            expect(String(outcome instanceof Error ? outcome.message : outcome)).not.toContain('ENTITYSECRET');
            if (outcome instanceof Error) expect(outcome.code).toBe('failed');
        } finally {
            fs.unlinkSync(secret);
        }
    });

    it('never treats a file as text by its name alone: bytes that are not text fail', async () => {
        await expect(extractor.extractText({ buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01]), kind: 'text' })).rejects.toMatchObject({ code: 'failed' });
    });

    it('never hands a parser a file whose bytes are not its type', async () => {
        await expect(extractor.extractText({ buffer: Buffer.from('not a pdf at all'), kind: 'pdf' })).rejects.toMatchObject({ code: 'failed' });
        await expect(extractor.extractText({ buffer: Buffer.from('not a zip at all'), kind: 'docx' })).rejects.toMatchObject({ code: 'failed' });
        await expect(extractor.extractText({ buffer: Buffer.from('not a zip at all'), kind: 'xlsx' })).rejects.toMatchObject({ code: 'failed' });
    });

    it('spawns no process and evaluates nothing: the extraction code names no child process, shell or eval', () => {
        const dir = path.join(__dirname, '..', 'Modules', 'Knowledge', 'ingest', 'extract');
        fs.readdirSync(dir).forEach((file) => {
            const source = fs.readFileSync(path.join(dir, file), 'utf8');
            expect(source).not.toMatch(/child_process|execSync|spawn\(|\beval\(|new Function\(/);
        });
    });
});

describe('limits', () => {
    it('default to 10 MB, 200,000 characters, 20 s, 200 pages, 20 sheets, 5,000 rows and 100 MB unzipped, each overridable', () => {
        ENV_KEYS.forEach((key) => delete process.env[key]);
        expect(limits()).toEqual({ maxBytes: 10 * 1024 * 1024, maxChars: 200000, timeoutMs: 20000, maxPages: 200, maxSheets: 20, maxRows: 5000, maxUnzippedBytes: 100 * 1024 * 1024 });

        process.env.KNOWLEDGE_FILE_MAX_BYTES = '2048';
        process.env.KNOWLEDGE_FILE_MAX_CHARS = '500';
        process.env.KNOWLEDGE_FILE_TIMEOUT_MS = '750';
        process.env.KNOWLEDGE_FILE_MAX_PAGES = '3';
        process.env.KNOWLEDGE_FILE_MAX_SHEETS = '2';
        process.env.KNOWLEDGE_FILE_MAX_ROWS = '10';
        process.env.KNOWLEDGE_FILE_MAX_UNZIPPED_BYTES = '4096';
        expect(limits()).toEqual({ maxBytes: 2048, maxChars: 500, timeoutMs: 750, maxPages: 3, maxSheets: 2, maxRows: 10, maxUnzippedBytes: 4096 });
    });

    it('fall back to the default for a value that is not a positive number', () => {
        process.env.KNOWLEDGE_FILE_MAX_BYTES = '-1';
        process.env.KNOWLEDGE_FILE_TIMEOUT_MS = 'soon';
        expect(limits().maxBytes).toBe(10 * 1024 * 1024);
        expect(limits().timeoutMs).toBe(20000);
    });

    it('refuses a buffer over the size limit before any parser sees it', async () => {
        process.env.KNOWLEDGE_FILE_MAX_BYTES = '32';
        await expect(extractor.extractText({ buffer: Buffer.alloc(33, 'a'), kind: 'text' })).rejects.toMatchObject({ code: 'too_large' });
    });

    it('cuts the text at the character limit and says so with a marker', async () => {
        process.env.KNOWLEDGE_FILE_MAX_CHARS = '40';
        const out = await extractor.extractText({ buffer: Buffer.from('a'.repeat(39) + ' the-tail-that-must-not-be-kept'), kind: 'text' });
        expect(out.truncated).toBe(true);
        expect(out.text.startsWith('a'.repeat(39))).toBe(true);
        expect(out.text).not.toContain('the-tail');
        expect(out.text.endsWith(extractor.TRUNCATION_MARKER)).toBe(true);
    });

    it('cuts parsed text the same way', async () => {
        process.env.KNOWLEDGE_FILE_MAX_CHARS = '30';
        const out = await extractor.extractText({ buffer: await docxOf(['Short opening line.', 'A closing line that falls past the limit.']), kind: 'docx' });
        expect(out.truncated).toBe(true);
        expect(out.text).not.toContain('past the limit');
        expect(out.text.endsWith(extractor.TRUNCATION_MARKER)).toBe(true);
    });

    it('reads no page past the page limit', async () => {
        process.env.KNOWLEDGE_FILE_MAX_PAGES = '2';
        const out = await extractor.extractText({ buffer: pdfOf([['First page.'], ['Second page.'], ['Third page.']]), kind: 'pdf' });
        expect(out.text).toContain('First page.');
        expect(out.text).toContain('Second page.');
        expect(out.text).not.toContain('Third page.');
        expect(out.truncated).toBe(true);
    });

    it('reads no sheet past the sheet limit and no row past the row limit', async () => {
        process.env.KNOWLEDGE_FILE_MAX_SHEETS = '1';
        process.env.KNOWLEDGE_FILE_MAX_ROWS = '2';
        const out = await extractor.extractText({ buffer: xlsxOf({ One: [['row-one'], ['row-two'], ['row-three']], Two: [['second-sheet']] }), kind: 'xlsx' });
        expect(out.text).toContain('row-one');
        expect(out.text).toContain('row-two');
        expect(out.text).not.toContain('row-three');
        expect(out.text).not.toContain('second-sheet');
        expect(out.truncated).toBe(true);
    });

    it('refuses an archive that declares more unzipped content than the limit, before unzipping it', async () => {
        process.env.KNOWLEDGE_FILE_MAX_UNZIPPED_BYTES = '4096';
        const bomb = await zipDeclaring(64 * 1024);
        expect(bomb.length).toBeLessThan(4096);
        await expect(extractor.extractText({ buffer: bomb, kind: 'docx' })).rejects.toMatchObject({ code: 'too_large' });
    });

    it('abandons a parser that does not return by the deadline, and stops it', async () => {
        process.env.KNOWLEDGE_FILE_TIMEOUT_MS = '300';
        const started = Date.now();
        await expect(extractor.extractText({ buffer: pdfOf([['Anything.']]), kind: 'pdf' }, { workerPath: SPINNING_WORKER })).rejects.toMatchObject({ code: 'timed_out' });
        expect(Date.now() - started).toBeLessThan(5000);
        expect(extractor.activeWorkers()).toBe(0);
    });

    it('runs at most two parsers at once, however many files are waiting', async () => {
        process.env.KNOWLEDGE_FILE_TIMEOUT_MS = '400';
        let peak = 0;
        const watch = setInterval(() => { peak = Math.max(peak, extractor.activeWorkers()); }, 10);
        const outcomes = await Promise.all([1, 2, 3, 4].map(() => extractor.extractText({ buffer: pdfOf([['x']]), kind: 'pdf' }, { workerPath: SPINNING_WORKER }).catch((error) => error.code)));
        clearInterval(watch);
        expect(outcomes).toEqual(['timed_out', 'timed_out', 'timed_out', 'timed_out']);
        expect(peak).toBeLessThanOrEqual(extractor.MAX_WORKERS);
        expect(extractor.MAX_WORKERS).toBe(2);
    });
});
