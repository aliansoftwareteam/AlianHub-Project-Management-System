// REP-05 — tests for Modules/Export/helpers/exportRules.js (tabular CSV/XLSX
// export). Distinct from tests/export-rules.test.js (which covers the separate
// Modules/ExportJobs async task export).
const R = require('../Modules/Export/helpers/exportRules');

describe('csvEscape', () => {
    test('leaves plain values unquoted', () => {
        expect(R.csvEscape('hello')).toBe('hello');
        expect(R.csvEscape(42)).toBe('42');
        expect(R.csvEscape(null)).toBe('');
        expect(R.csvEscape(undefined)).toBe('');
    });
    test('quotes + doubles quotes for commas/quotes/newlines', () => {
        expect(R.csvEscape('a,b')).toBe('"a,b"');
        expect(R.csvEscape('say "hi"')).toBe('"say ""hi"""');
        expect(R.csvEscape('line1\nline2')).toBe('"line1\nline2"');
    });
});

describe('toCsv', () => {
    test('builds header + rows + total with CRLF', () => {
        const csv = R.toCsv(['Label', 'Value'], [['Open', 3], ['Done', 5]], ['Total', 8]);
        expect(csv).toBe('Label,Value\r\nOpen,3\r\nDone,5\r\nTotal,8');
    });
    test('escapes fields with commas', () => {
        const csv = R.toCsv(['Task', 'N'], [['Fix bug, urgent', 1]]);
        expect(csv).toBe('Task,N\r\n"Fix bug, urgent",1');
    });
    test('empty input → empty string', () => {
        expect(R.toCsv()).toBe('');
    });
});

describe('toAoa', () => {
    test('produces header + rows + total array-of-arrays; null → empty', () => {
        const aoa = R.toAoa(['A', 'B'], [['x', null]], ['T', 9]);
        expect(aoa).toEqual([['A', 'B'], ['x', ''], ['T', 9]]);
    });
});

describe('sanitizeFilename', () => {
    test('strips unsafe chars + caps length', () => {
        expect(R.sanitizeFilename('my report/2026:v1')).toBe('my_report_2026_v1');
        expect(R.sanitizeFilename('')).toBe('export');
        expect(R.sanitizeFilename(null)).toBe('export');
    });
});
