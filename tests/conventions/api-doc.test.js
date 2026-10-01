const { WALK_ENV } = require('../../scripts/route-walk');

Object.assign(process.env, WALK_ENV);

jest.mock('../../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { build, check, loadMeta } = require('../../scripts/api-doc');

const intervals = [];
const built = build({ stub: false, intervals });

afterAll(async () => {
    intervals.forEach(clearInterval);
    await require('node-schedule').gracefulShutdown();
});

describe('the public API reference', () => {
    it('describes every /api/v2 route in scripts/api-doc.meta.json, and only routes that exist', () => {
        expect(built.problems).toEqual([]);
    });

    it('is current with the routes and the meta file (npm run api:doc)', () => {
        expect(check(built)).toEqual([]);
    });

    it('walks the routes (the enumeration still works)', () => {
        expect(built.routes.length).toBeGreaterThan(700);
        expect(built.routes.filter((r) => r.path.startsWith('/api/v2/')).length).toBeGreaterThan(300);
    });

    it('documents routes in full and lists the rest', () => {
        const documented = Object.values(loadMeta().routes).filter((entry) => entry.resource);
        expect(documented.length).toBeGreaterThan(20);
        expect(built.files).toBeDefined();
    });

    it('carries no token, id or address that could be real', () => {
        const text = Object.values(built.files).join('\n');
        expect(text).not.toMatch(/ahp_[a-f0-9]{48}/);
        expect(text).not.toMatch(/"[a-f0-9]{24}"/);
        expect(text).not.toMatch(/[\w.+-]+@(?!example\.(com|test)\b)[\w-]+\.[a-z]{2,}/i);
    });
});
