const { check, scanBackend, scanFrontend } = require('../../scripts/env-doc');

describe('environment variables', () => {
    it('are all described in scripts/env-doc.meta.json and the generated docs are current (node scripts/env-doc.js)', () => {
        expect(check()).toEqual([]);
    });

    it('scan something (the regexes still match the source)', () => {
        expect(Object.keys(scanBackend()).length).toBeGreaterThan(50);
        expect(Object.keys(scanFrontend()).length).toBeGreaterThan(5);
    });
});
