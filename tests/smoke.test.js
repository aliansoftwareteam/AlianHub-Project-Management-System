/**
 * BUG-045 bootstrap test — minimal smoke test that always runs to
 * confirm the jest harness is wired up correctly. As more helpers
 * land in the codebase, more behaviour tests can be added alongside
 * (tests/<module>/<module>.test.js).
 */

const path = require('path');
const fs = require('fs');

describe('jest harness smoke', () => {
    test('npm test reaches this suite', () => {
        expect(true).toBe(true);
    });

    test('package.json declares the jest test script', () => {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
        expect(pkg.scripts && pkg.scripts.test).toMatch(/^jest/);
    });

    test('jest.config.js exists and points at tests/', () => {
        const cfgPath = path.resolve(__dirname, '../jest.config.js');
        expect(fs.existsSync(cfgPath)).toBe(true);
        const cfg = require(cfgPath);
        expect(cfg.projects.map((p) => p.displayName)).toEqual(['unit', 'conventions']);
        for (const project of cfg.projects) {
            expect(project.testMatch).toEqual(expect.arrayContaining([expect.stringContaining('tests')]));
        }
    });
});
