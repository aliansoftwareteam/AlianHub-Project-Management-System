const fs = require('fs');
const os = require('os');
const path = require('path');
const { pickLogFile, tailLines, readTail, resolveLogFile, listLogFiles, KINDS } = require('../Modules/Instance/logsPath');

const NAMES = ['error-2026-09-01.log', 'error-2026-09-04.log', 'combined-2026-09-04.log', 'track-2026-09-03.log', 'error-2026-09-02.log.gz', 'notes.txt', '.env'];

describe('choosing a log file', () => {
    it('takes the newest rotated file of the requested kind', () => {
        expect(pickLogFile('error', NAMES)).toBe('error-2026-09-04.log');
        expect(pickLogFile('combined', NAMES)).toBe('combined-2026-09-04.log');
        expect(pickLogFile('track', NAMES)).toBe('track-2026-09-03.log');
    });

    it('answers nothing for an unknown kind, an empty directory, or a gzipped archive', () => {
        expect(pickLogFile('secrets', NAMES)).toBeNull();
        expect(pickLogFile('error', [])).toBeNull();
        expect(pickLogFile('error', ['error-2026-09-02.log.gz'])).toBeNull();
        expect(KINDS).toEqual(['error', 'combined', 'track']);
    });

    it('never resolves a name outside the winston pattern', () => {
        for (const name of ['../.env', '.env', 'error-2026-09-04.log/../../.env', 'combined.log', 'error-20260904.log']) {
            expect(resolveLogFile(name, os.tmpdir())).toBeNull();
        }
    });
});

describe('tailing', () => {
    let dir;
    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-logs-'));
        const lines = Array.from({ length: 1200 }, (_, i) => `2026-09-04T00:00:${String(i % 60).padStart(2, '0')} [log] error: line ${i + 1}`);
        fs.writeFileSync(path.join(dir, 'error-2026-09-04.log'), lines.join('\n') + '\n');
        fs.writeFileSync(path.join(dir, 'error-2026-09-01.log'), 'old\n');
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('keeps the last N lines, newest last, without a trailing blank', () => {
        expect(tailLines('a\nb\nc\n', 2)).toEqual(['b', 'c']);
        expect(tailLines('a\r\nb', 5)).toEqual(['a', 'b']);
    });

    it('reads only the tail of the newest file and reports which file it read', async () => {
        const out = await readTail('error', 3, dir);
        expect(out.file).toBe('error-2026-09-04.log');
        expect(out.lines).toEqual(['2026-09-04T00:00:57 [log] error: line 1198', '2026-09-04T00:00:58 [log] error: line 1199', '2026-09-04T00:00:59 [log] error: line 1200']);
        expect((await readTail('error', 1000, dir)).lines.length).toBe(1000);
        expect(await readTail('combined', 10, dir)).toEqual({ file: null, lines: [] });
    });

    it('lists the rotated files with sizes, newest first', () => {
        const files = listLogFiles(dir);
        expect(files.map((f) => f.name)).toEqual(['error-2026-09-04.log', 'error-2026-09-01.log']);
        expect(files[0].size).toBeGreaterThan(files[1].size);
        expect(resolveLogFile('error-2026-09-01.log', dir)).toBe(path.join(dir, 'error-2026-09-01.log'));
    });
});
