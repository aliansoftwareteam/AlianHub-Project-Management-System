const { build, check, loadMeta, metaShapeProblems, scanBackend, scanFrontend } = require('../../scripts/env-doc');

/* Only what another pull request merging first cannot break is checked here. Whether docs/ENV.md and the two
 * .env.example files are current, and whether a description is still read, is `npm run env:doc:check`, run in
 * the docs pull request that follows merges. */
const built = build();

describe('environment variables', () => {
    it('have a descriptions file that parses, with valid entries', () => {
        expect(metaShapeProblems(loadMeta())).toEqual([]);
    });

    it('are all described in scripts/env-doc.meta.json', () => {
        expect(built.drift.undescribed).toEqual([]);
    });

    it('scan something (the regexes still match the source)', () => {
        expect(Object.keys(scanBackend()).length).toBeGreaterThan(50);
        expect(Object.keys(scanFrontend()).length).toBeGreaterThan(5);
    });

    it('generate their docs from the current tree', () => {
        expect(built.problems).toEqual([]);
        expect(Object.values(built.files)).toHaveLength(3);
        expect(Object.values(built.files).every((content) => typeof content === 'string' && content.length > 100)).toBe(true);
    });

    it('generate the same docs on a second run', () => {
        expect(build().files).toEqual(built.files);
    });

    it('never fail a pull request on a stale file or on a description nothing reads any more', () => {
        expect(check(built).problems).toEqual([]);
    });
});
