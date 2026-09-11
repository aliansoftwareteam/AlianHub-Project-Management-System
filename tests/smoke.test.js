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

    test('npm test leaves the integration layer to npm run test:integration', () => {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
        expect(pkg.scripts.test).toBe('jest --selectProjects unit conventions');
        expect(pkg.scripts['test:integration']).toMatch(/--selectProjects integration/);
    });

    test('jest.config.js exists and points at tests/', () => {
        const cfgPath = path.resolve(__dirname, '../jest.config.js');
        expect(fs.existsSync(cfgPath)).toBe(true);
        const cfg = require(cfgPath);
        expect(cfg.projects.map((p) => p.displayName)).toEqual(['unit', 'conventions', 'integration']);
        for (const project of cfg.projects) {
            expect(project.testMatch).toEqual(expect.arrayContaining([expect.stringContaining('tests')]));
        }
    });
});
