/**
 * BUG-045 bootstrap test — exercises `utils/safeServiceFile.js`
 * (introduced in BUG-036 / #90) against the path-traversal threat
 * model that motivated it.
 *
 * Skips if the helper module isn't present (e.g. on this branch
 * before the BUG-036 PR has merged to staging).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
let resolveServiceFile;

try {
    ({ resolveServiceFile } = require(path.resolve(ROOT, 'utils/safeServiceFile.js')));
} catch (_) {
    // module not yet on this branch
}

const d = resolveServiceFile ? describe : describe.skip;

d('utils/safeServiceFile.resolveServiceFile', () => {
    const fixturePath = path.resolve(ROOT, 'tests-fixtures-bug-045.json');

    beforeAll(() => fs.writeFileSync(fixturePath, '{"projectId":"x"}'));
    afterAll(() => { try { fs.unlinkSync(fixturePath); } catch (_) {} });

    test('returns an absolute path for a valid relative .json file inside the project root', () => {
        const resolved = resolveServiceFile('tests-fixtures-bug-045.json');
        expect(resolved).toBe(fixturePath);
    });

    test('rejects an empty or missing input', () => {
        expect(() => resolveServiceFile('')).toThrow(/not set|empty/i);
        expect(() => resolveServiceFile(undefined)).toThrow(/not set|empty/i);
    });

    test('rejects path-traversal escape', () => {
        expect(() => resolveServiceFile('../../../../etc/passwd')).toThrow(/outside|\.json/i);
    });

    test('rejects absolute paths (Unix and Windows shapes)', () => {
        expect(() => resolveServiceFile('/etc/hosts')).toThrow(/relative/i);
        expect(() => resolveServiceFile('C:\\Windows\\System32\\drivers\\etc\\hosts')).toThrow(/relative/i);
    });

    test('rejects non-.json extensions', () => {
        const jsPath = path.resolve(ROOT, 'tests-fixtures-bug-045-inert.js');
        fs.writeFileSync(jsPath, '// inert');
        try {
            expect(() => resolveServiceFile('tests-fixtures-bug-045-inert.js')).toThrow(/\.json/);
        } finally {
            fs.unlinkSync(jsPath);
        }
    });

    test('rejects missing file', () => {
        expect(() => resolveServiceFile('nonexistent-file-bug-045.json')).toThrow(/not found/i);
    });
});
