const mockDb = require('./fixtures/fakeMongo').create();
const mockFailing = { companies: false, companyReads: 0 };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => {
        if (q.type === 'companies') mockFailing.companyReads += 1;
        return mockFailing.companies && q.type === 'companies'
            ? Promise.reject(new Error('global database unreachable'))
            : mockDb.crud(companyId, q, method);
    },
}));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const logger = require('../Config/loggerConfig');
const enforcement = require('../Config/permissionEnforcement');

const CID = '6f00000000000000000000c1';
const ENV_KEYS = ['PERMISSION_ENFORCEMENT_MODE', 'DISABLE_PERMISSION_ENFORCEMENT', 'PERMISSION_ENFORCEMENT_CACHE_TTL_SECONDS'];

const companyReads = () => mockFailing.companyReads;
const storeCompany = (stored) => {
    mockDb.store.companies = [stored === undefined ? { _id: CID } : { _id: CID, permissionEnforcement: stored }];
};

beforeEach(() => {
    ENV_KEYS.forEach((key) => { delete process.env[key]; });
    myCache.flushAll();
    mockDb.calls.length = 0;
    mockFailing.companies = false;
    mockFailing.companyReads = 0;
    storeCompany(undefined);
    jest.clearAllMocks();
});

afterAll(() => ENV_KEYS.forEach((key) => { delete process.env[key]; }));

describe('the instance default', () => {
    test.each([
        [undefined, 'off'],
        ['', 'off'],
        ['off', 'off'],
        ['report', 'report'],
        ['enforce', 'enforce'],
        [' Report ', 'report'],
        ['ENFORCE', 'enforce'],
        ['true', 'off'],
        ['strict', 'off'],
    ])('PERMISSION_ENFORCEMENT_MODE=%p reads as %s', async (raw, expected) => {
        if (raw !== undefined) process.env.PERMISSION_ENFORCEMENT_MODE = raw;
        expect(enforcement.instanceMode()).toBe(expected);
        expect(await enforcement.resolveMode(CID)).toBe(expected);
    });
});

describe('a workspace', () => {
    test.each([
        ['a bare string', 'report', 'off', 'report'],
        ['an object', { mode: 'enforce' }, 'report', 'enforce'],
        ['capitals and spaces', { mode: ' REPORT ' }, 'enforce', 'report'],
        ['off', 'off', 'enforce', 'off'],
    ])('set to %s overrides the instance default', async (_, stored, instance, expected) => {
        process.env.PERMISSION_ENFORCEMENT_MODE = instance;
        storeCompany(stored);
        expect(await enforcement.resolveMode(CID)).toBe(expected);
    });

    const inheriting = [
        ['absent', undefined],
        ['null', null],
        ['an empty string', ''],
        ['garbage', 'strict'],
        ['a boolean', true],
        ['a number', 2],
        ['an object without a mode', {}],
        ['an object with a garbage mode', { mode: 'yes' }],
        ['an object with a nested object', { mode: { mode: 'enforce' } }],
    ];

    test.each(inheriting)('whose value is %s inherits the instance default', async (_, stored) => {
        storeCompany(stored);
        for (const instance of ['off', 'report', 'enforce']) {
            process.env.PERMISSION_ENFORCEMENT_MODE = instance;
            expect(await enforcement.resolveMode(CID)).toBe(instance);
        }
    });

    test.each([
        ['a bare string', 'Report', 'report'],
        ['an object', { mode: 'enforce' }, 'enforce'],
        ['garbage', 'yes', null],
        ['absent', undefined, null],
    ])('normalises %s', (_, stored, expected) => {
        expect(enforcement.normaliseCompanyMode(stored)).toBe(expected);
    });

    test('whose row cannot be read inherits the instance default, and the failure is held briefly and logged once', async () => {
        process.env.PERMISSION_ENFORCEMENT_MODE = 'report';
        storeCompany('enforce');
        mockFailing.companies = true;
        for (let i = 0; i < 5; i += 1) expect(await enforcement.resolveMode(CID)).toBe('report');
        expect(companyReads()).toBe(1);
        expect(logger.error).toHaveBeenCalledTimes(1);

        const held = myCache.getTtl(`permissionEnforcement:${CID}`) - Date.now();
        expect(held).toBeGreaterThan(0);
        expect(held).toBeLessThanOrEqual(enforcement.FAILED_READ_TTL_SECONDS * 1000);
        expect(enforcement.FAILED_READ_TTL_SECONDS).toBeLessThanOrEqual(10);

        mockFailing.companies = false;
        enforcement.invalidateEnforcementMode(CID);
        expect(await enforcement.resolveMode(CID)).toBe('enforce');
    });

    test('whose row cannot be read is held briefly even when the cache TTL is 0', async () => {
        process.env.PERMISSION_ENFORCEMENT_CACHE_TTL_SECONDS = '0';
        mockFailing.companies = true;
        await enforcement.resolveMode(CID);
        await enforcement.resolveMode(CID);
        expect(companyReads()).toBe(1);
        expect(logger.error).toHaveBeenCalledTimes(1);
    });

    test('with a malformed id inherits without reading the company row', async () => {
        process.env.PERMISSION_ENFORCEMENT_MODE = 'report';
        expect(await enforcement.resolveMode('not-an-id')).toBe('report');
        expect(await enforcement.resolveMode('')).toBe('report');
        expect(companyReads()).toBe(0);
    });
});

describe('the kill switch', () => {
    test('turns enforce into report, from the instance default and from a workspace', async () => {
        process.env.DISABLE_PERMISSION_ENFORCEMENT = 'true';
        process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
        expect(await enforcement.resolveMode(CID)).toBe('report');

        process.env.PERMISSION_ENFORCEMENT_MODE = 'off';
        storeCompany({ mode: 'enforce' });
        enforcement.invalidateEnforcementMode(CID);
        expect(await enforcement.resolveMode(CID)).toBe('report');
    });

    test('leaves off and report alone', async () => {
        process.env.DISABLE_PERMISSION_ENFORCEMENT = 'true';
        process.env.PERMISSION_ENFORCEMENT_MODE = 'report';
        expect(await enforcement.resolveMode(CID)).toBe('report');
        storeCompany('off');
        enforcement.invalidateEnforcementMode(CID);
        expect(await enforcement.resolveMode(CID)).toBe('off');
    });

    test('takes effect without waiting for the cached workspace value to expire', async () => {
        storeCompany('enforce');
        expect(await enforcement.resolveMode(CID)).toBe('enforce');
        process.env.DISABLE_PERMISSION_ENFORCEMENT = 'true';
        expect(await enforcement.resolveMode(CID)).toBe('report');
    });
});

describe('caching the workspace value', () => {
    test('reads the company row once within the TTL, including a row that inherits', async () => {
        storeCompany('report');
        await enforcement.resolveMode(CID);
        await enforcement.resolveMode(CID);
        expect(companyReads()).toBe(1);

        const OTHER = '6f00000000000000000000c2';
        await enforcement.resolveMode(OTHER);
        await enforcement.resolveMode(OTHER);
        expect(companyReads()).toBe(2);
    });

    test('holds a value for a short TTL', async () => {
        storeCompany('report');
        await enforcement.resolveMode(CID);
        const ttl = myCache.getTtl(`permissionEnforcement:${CID}`);
        expect(ttl - Date.now()).toBeGreaterThan(0);
        expect(ttl - Date.now()).toBeLessThanOrEqual(enforcement.DEFAULT_CACHE_TTL_SECONDS * 1000);
        expect(enforcement.DEFAULT_CACHE_TTL_SECONDS).toBeLessThanOrEqual(60);
    });

    test('invalidateEnforcementMode makes the next request see a changed value', async () => {
        storeCompany('report');
        expect(await enforcement.resolveMode(CID)).toBe('report');
        storeCompany('enforce');
        expect(await enforcement.resolveMode(CID)).toBe('report');
        enforcement.invalidateEnforcementMode(CID);
        expect(await enforcement.resolveMode(CID)).toBe('enforce');
    });

    test('PERMISSION_ENFORCEMENT_CACHE_TTL_SECONDS=0 reads the row on every request', async () => {
        process.env.PERMISSION_ENFORCEMENT_CACHE_TTL_SECONDS = '0';
        storeCompany('report');
        expect(await enforcement.resolveMode(CID)).toBe('report');
        storeCompany('enforce');
        expect(await enforcement.resolveMode(CID)).toBe('enforce');
        expect(companyReads()).toBe(2);
    });

    test.each([['-5'], ['abc']])('an unusable TTL of %p falls back to the default', (raw) => {
        process.env.PERMISSION_ENFORCEMENT_CACHE_TTL_SECONDS = raw;
        expect(enforcement.cacheTtlSeconds()).toBe(enforcement.DEFAULT_CACHE_TTL_SECONDS);
    });
});
