const { WALK_ENV } = require('../../scripts/route-walk');

Object.assign(process.env, WALK_ENV);

jest.mock('../../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { build, check, loadMeta, metaShapeProblems } = require('../../scripts/api-doc');

/* Only what another pull request merging first cannot break is checked here. Whether docs/API.md is current, and whether
 * every route has an entry, is `npm run api:doc:check`, run in the docs pull request that follows merges. */
const intervals = [];
const built = build({ stub: false, intervals });

afterAll(async () => {
    intervals.forEach(clearInterval);
    await require('node-schedule').gracefulShutdown();
});

describe('the public API reference', () => {
    it('has a meta file that parses, with valid entries and every documented route complete', () => {
        expect(metaShapeProblems(loadMeta())).toEqual([]);
    });

    it('is generated from the current tree without failing', () => {
        expect(built.problems).toEqual([]);
        expect(built.routes.length).toBeGreaterThan(700);
        expect(built.grouped.resources.length).toBeGreaterThan(0);
        expect(Object.values(built.files).every((content) => typeof content === 'string' && content.length > 1000)).toBe(true);
        expect(() => JSON.parse(Object.values(built.files).find((content) => content.startsWith('{')))).not.toThrow();
    });

    it('is the same on a second run', () => {
        expect(build({ stub: false, intervals }).files).toEqual(built.files);
    });

    it('never fails a pull request on a stale file, a new route or a removed one', () => {
        expect(check(built).problems).toEqual([]);
    });

    it('carries no token, id or address that could be real', () => {
        const text = Object.values(built.files).join('\n');
        expect(text).not.toMatch(/ahp_[a-f0-9]{48}/);
        expect(text).not.toMatch(/"[a-f0-9]{24}"/);
        expect(text).not.toMatch(/[\w.+-]+@(?!example\.(com|test)\b)[\w-]+\.[a-z]{2,}/i);
    });
});
