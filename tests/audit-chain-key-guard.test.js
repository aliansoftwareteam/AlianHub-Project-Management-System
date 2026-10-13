const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const logger = require('../Config/loggerConfig');
const guard = require('../Modules/Audit/keyGuard');

/* The owner's decision of 2026-09-23: AUDIT_CHAIN_KEY cannot change, and the server refuses to start if it does. */

const KEY = 'the-original-audit-chain-key-0123456789';
const OTHER_KEY = 'a-different-audit-chain-key-9876543210';
const on = (key = KEY) => ({ AUDIT_CHAIN: 'true', AUDIT_CHAIN_KEY: key });
const stored = () => mockDb.store[SCHEMA_TYPE.AUDIT_CHAIN_KEY] || [];
const keyCalls = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.AUDIT_CHAIN_KEY);
const allText = (value) => JSON.stringify(value);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
});

describe('the audit chain key fingerprint', () => {
    it('is registered as a collection in the global database with a strict schema that declares its fields', () => {
        expect(SCHEMA_TYPE.AUDIT_CHAIN_KEY).toBe('audit_chain_key');
        expect(dbCollections.AUDIT_CHAIN_KEY).toBe('audit_chain_key');
        const { checkType, tableType } = jest.requireActual('../utils/mongo-handler/mongoQueries');
        const schema = checkType(SCHEMA_TYPE.AUDIT_CHAIN_KEY);
        expect(tableType(SCHEMA_TYPE.AUDIT_CHAIN_KEY)).toBe('audit_chain_key');
        expect(schema.options.strict).toBe(true);
        expect(schema.path('_id')).toBeTruthy();
        expect(schema.path('fingerprint')).toBeTruthy();
        expect(schema.path('at')).toBeTruthy();
    });

    it('is an HMAC of a fixed label under the key: never the key, never a plain hash of it', () => {
        const fingerprint = guard.fingerprintOf(KEY);
        expect(fingerprint).toBe(crypto.createHmac('sha256', KEY).update(guard.FINGERPRINT_LABEL).digest('hex'));
        expect(fingerprint).not.toContain(KEY);
        expect(fingerprint).not.toBe(crypto.createHash('sha256').update(KEY).digest('hex'));
        expect(guard.FINGERPRINT_LABEL).not.toContain(KEY);
        expect(guard.fingerprintOf(OTHER_KEY)).not.toBe(fingerprint);
    });
});

describe('checkKey', () => {
    it('stores the fingerprint once on the first start, in the global database', async () => {
        const exit = jest.fn();
        await expect(guard.checkKey({ env: on(), exit })).resolves.toBe('stored');

        expect(exit).not.toHaveBeenCalled();
        expect(stored()).toHaveLength(1);
        const [doc] = stored();
        expect(doc.fingerprint).toBe(guard.fingerprintOf(KEY));
        expect(doc.at).toBeInstanceOf(Date);
        expect(allText(doc)).not.toContain(KEY);
        expect(allText(doc)).not.toContain(crypto.createHash('sha256').update(KEY).digest('hex'));
        expect(keyCalls().every((c) => c.companyId === SCHEMA_TYPE.GOLBAL)).toBe(true);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('fingerprint'));
    });

    it('starts on every later start with the same key, and writes nothing more', async () => {
        await guard.checkKey({ env: on(), exit: jest.fn() });
        const first = { ...stored()[0] };
        mockDb.calls.length = 0;

        const exit = jest.fn();
        await expect(guard.checkKey({ env: on(), exit })).resolves.toBe('match');

        expect(exit).not.toHaveBeenCalled();
        expect(stored()).toEqual([first]);
        expect(keyCalls().map((c) => c.method)).toEqual(['findOne']);
    });

    it('refuses to start with a different key: a clear fatal message, a non-zero exit, and the stored fingerprint kept', async () => {
        await guard.checkKey({ env: on(), exit: jest.fn() });
        const first = { ...stored()[0] };

        const exit = jest.fn();
        await expect(guard.checkKey({ env: on(OTHER_KEY), exit })).resolves.toBe('refused');

        expect(exit).toHaveBeenCalledTimes(1);
        const [message, code] = exit.mock.calls[0];
        expect(code).toBe(1);
        expect(message).toMatch(/AUDIT_CHAIN_KEY/);
        expect(message).toMatch(/changed/);
        expect(message).toMatch(/cannot change/);
        expect(message).toMatch(/broken/);
        expect(message).toMatch(/restore|set .*back/i);
        expect(message).toContain(first.at.toISOString());
        expect(message).not.toContain(KEY);
        expect(message).not.toContain(OTHER_KEY);
        expect(stored()).toEqual([first]);
    });

    it('lets only one key win when two servers start together for the first time with different keys', async () => {
        const exitA = jest.fn();
        const exitB = jest.fn();
        const results = await Promise.all([guard.checkKey({ env: on(), exit: exitA }), guard.checkKey({ env: on(OTHER_KEY), exit: exitB })]);

        expect(stored()).toHaveLength(1);
        expect(results.sort()).toEqual(['refused', 'stored']);
        expect(exitA.mock.calls.length + exitB.mock.calls.length).toBe(1);
    });

    it.each([
        ['unset', {}],
        ['false', { AUDIT_CHAIN: 'false' }],
    ])('reads and stores nothing with AUDIT_CHAIN %s, even with a key set', async (_label, flag) => {
        const exit = jest.fn();
        await expect(guard.checkKey({ env: { ...flag, AUDIT_CHAIN_KEY: KEY }, exit })).resolves.toBe('off');
        await expect(guard.checkKey({ env: { ...flag, AUDIT_CHAIN_KEY: OTHER_KEY }, exit })).resolves.toBe('off');

        expect(mockDb.calls).toEqual([]);
        expect(exit).not.toHaveBeenCalled();
    });

    it.each([
        ['missing', ''],
        ['too short', 'short-key'],
    ])('keeps today\'s behaviour with AUDIT_CHAIN on and the key %s: nothing read, stored or refused', async (_label, key) => {
        await guard.checkKey({ env: on(), exit: jest.fn() });
        mockDb.calls.length = 0;

        const exit = jest.fn();
        await expect(guard.checkKey({ env: on(key), exit })).resolves.toBe('off');

        expect(mockDb.calls).toEqual([]);
        expect(exit).not.toHaveBeenCalled();
    });

    it('logs and lets the server start when the database cannot be read, so the setup page can report it', async () => {
        const exit = jest.fn();
        const run = jest.fn().mockRejectedValue(new Error('connection refused'));
        await expect(guard.checkKey({ env: on(), exit, run })).resolves.toBe('unchecked');

        expect(exit).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/AUDIT_CHAIN_KEY.*connection refused/));
    });
});

describe('boot', () => {
    it('checks the key after saved settings are applied and before any module or cron job loads', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
        const boot = source.slice(source.indexOf('(async () => {'));
        const settings = boot.indexOf('await applySavedSettings()');
        const check = boot.indexOf("require('./Modules/Audit/keyGuard').guardAtBoot()");
        const modules = boot.indexOf('initializeControllers()');
        expect(settings).toBeGreaterThan(-1);
        expect(check).toBeGreaterThan(settings);
        expect(modules).toBeGreaterThan(check);
    });
});
