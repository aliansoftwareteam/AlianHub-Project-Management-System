require('./fixtures/mcpFlagsOff');
const crypto = require('crypto');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(async () => { throw new Error('this test reaches no provider'); }),
}));

const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { buildContext, listMigrations, validateMigration } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const store = require('../Config/secrets');

const ID = '085-connectors-finish-legacy-cutover';
const migration = require(`../migrations/${ID}`);
const calendar = require('../migrations/080-connectors-google-calendar-to-google');
const cloud = require('../migrations/082-cloud-storage-to-connectors');
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const CLOUD = SCHEMA_TYPE.CLOUD_STORAGE_CONNECTIONS;
const C1 = '6f0000000000000000000c01';
const MAYA = '6f0000000000000000000a01';
const RUBEN = '6f0000000000000000000a02';

const ENV = { SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'), CONNECTORS: 'google_calendar' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

const rows = (type = T) => mockDb.store[type] || [];
const rowOf = (seeded, type = T) => rows(type).find((r) => r._id === seeded._id);
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration: mockDb.crud, SCHEMA_TYPE, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

const secret = async (value) => (await store.create({ companyId: C1, name: value, kind: 'connector', value, actor: { id: 'test' } })).handle;
const calendarRow = (overrides) => mockDb.seed(T, {
    connector: 'google_calendar', userId: MAYA, status: 'connected', scopes: ['openid', 'email'],
    account: { email: 'maya@example.test', sub: 'g-sub-maya' }, secretHandles: {}, deletedStatusKey: 0, ...overrides,
});
const cloudRow = (overrides) => mockDb.seed(CLOUD, {
    userId: MAYA, provider: 'google_drive', status: 'connected', deletedStatusKey: 0,
    config: { client_id: 'c-id', client_secret: 'c-secret' }, accessToken: 'enc-access', refreshToken: 'enc-refresh', ...overrides,
});

/* What the unique index does when the person already holds the same Google account on the module. */
const duplicateOn = (seeded) => {
    const real = mockDb.crud.getMockImplementation();
    mockDb.crud.mockImplementation(async (cid, q, method) => {
        const opening = method === 'updateOne' && q.data[0] && String(q.data[0]._id) === String(seeded._id) && q.data[1].$set.deletedStatusKey === undefined;
        if (opening) throw Object.assign(new Error('E11000 duplicate key error collection: connector_connections index: one_live_per_account'), { code: 11000 });
        return real(cid, q, method);
    });
    return () => mockDb.crud.mockImplementation(real);
};

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
});

afterAll(() => {
    Object.keys(ENV).forEach((k) => { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; });
});

describe(ID, () => {
    it('is a forward-only company migration, listed after the 080 and 082 it finishes', () => {
        const ids = listMigrations().map((m) => m.id);
        expect(ids.filter((id) => id.startsWith('085-'))).toEqual([ID]);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf(calendar.id));
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf(cloud.id));
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.down).toBeUndefined();
    });

    it('moves a Calendar row that 080 held back onto the Google provider, grant untouched', async () => {
        const handles = { access_token: await secret('g-access'), refresh_token: await secret('g-refresh') };
        const seeded = calendarRow({ secretHandles: handles });
        await calendar.up(contextFor([C1]));
        expect(rowOf(seeded).connector).toBe('google_calendar');

        const ctx = contextFor([C1]);
        await migration.up(ctx);

        expect(ctx.companies[C1]).toMatchObject({ ok: true, calendarMoved: 1, calendarClosed: 0 });
        expect(rowOf(seeded)).toMatchObject({
            companyId: C1, provider: 'google', products: ['calendar'], status: 'connected', deletedStatusKey: 0,
            handles: { access: handles.access_token, refresh: handles.refresh_token }, account: { id: 'g-sub-maya', label: 'maya@example.test' },
        });
        expect(rowOf(seeded).connector).toBeUndefined();
        expect(await store.resolve({ companyId: C1, handle: handles.refresh_token })).toBe('g-refresh');
    });

    it('moves it whatever CONNECTORS says, since no old connector is left to read it', async () => {
        delete process.env.CONNECTORS;
        const seeded = calendarRow({});
        await migration.up(contextFor([C1]));
        expect(rowOf(seeded)).toMatchObject({ provider: 'google' });
    });

    it('closes a duplicate of an account already on the module: its tokens are retired, Google is not called, the live connection stays', async () => {
        const live = mockDb.seed(T, { companyId: C1, provider: 'google', userId: MAYA, account: { id: 'g-sub-maya', label: '' }, status: 'connected', handles: { refresh: 'sec_live' }, deletedStatusKey: 0 });
        const handles = { access_token: await secret('old-access'), refresh_token: await secret('old-refresh') };
        const dup = calendarRow({ secretHandles: handles });
        const restore = duplicateOn(dup);
        const ctx = contextFor([C1]);
        try {
            await migration.up(ctx);
        } finally { restore(); }

        expect(ctx.companies[C1]).toMatchObject({ ok: true, calendarMoved: 0, calendarClosed: 1 });
        expect(rowOf(dup)).toMatchObject({ provider: 'google', status: 'revoked', deletedStatusKey: 1, handles: {}, disconnectedBy: ID });
        expect(rowOf(dup).connector).toBeUndefined();
        expect(await store.resolve({ companyId: C1, handle: handles.access_token })).toBeNull();
        expect(await store.resolve({ companyId: C1, handle: handles.refresh_token })).toBeNull();
        expect(rowOf(live)).toMatchObject({ status: 'connected', handles: { refresh: 'sec_live' }, deletedStatusKey: 0 });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('retires nothing when an update fails for any other reason, and reports the company as failed', async () => {
        const handles = { refresh_token: await secret('kept-refresh') };
        const seeded = calendarRow({ secretHandles: handles });
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (cid, q, method) => {
            if (method === 'updateOne' && q.type === T) throw new Error('connection reset');
            return real(cid, q, method);
        });
        const ctx = contextFor([C1]);
        try {
            await expect(migration.up(ctx)).rejects.toThrow('1 of 1 companies failed');
        } finally { mockDb.crud.mockImplementation(real); }

        expect(ctx.companies[C1]).toMatchObject({ ok: false });
        expect(rowOf(seeded).connector).toBe('google_calendar');
        expect(await store.resolve({ companyId: C1, handle: handles.refresh_token })).toBe('kept-refresh');
    });

    it('clears every cloud-storage row 082 held back, whatever CONNECTORS says, and leaves a cleared one alone', async () => {
        delete process.env.CONNECTORS;
        const drive = cloudRow();
        const drop = cloudRow({ userId: RUBEN, provider: 'dropbox', config: { app_key: 'k', app_secret: 's' } });
        await cloud.up(contextFor([C1]));
        expect(rowOf(drive, CLOUD).config).toMatchObject({ client_secret: 'c-secret' });
        const done = cloudRow({ userId: RUBEN, status: 'migrated', deletedStatusKey: 1, config: {}, accessToken: '', refreshToken: '' });
        const doneBefore = JSON.stringify(rowOf(done, CLOUD));

        const ctx = contextFor([C1]);
        await migration.up(ctx);

        expect(ctx.companies[C1]).toMatchObject({ cloudCleared: 2 });
        [drive, drop].forEach((seeded) => {
            expect(rowOf(seeded, CLOUD)).toMatchObject({ config: {}, accessToken: '', refreshToken: '', status: 'migrated', deletedStatusKey: 1 });
        });
        expect(JSON.stringify(rowOf(done, CLOUD))).toBe(doneBefore);
    });

    it('is safe to run twice: the second pass finds nothing and writes nothing', async () => {
        calendarRow({ secretHandles: { refresh_token: await secret('r1') } });
        const dup = calendarRow({ userId: RUBEN, secretHandles: { refresh_token: await secret('r2') } });
        cloudRow();
        const restore = duplicateOn(dup);
        try {
            await migration.up(contextFor([C1]));
        } finally { restore(); }
        const snapshot = JSON.stringify(mockDb.store);

        const again = contextFor([C1]);
        await migration.up(again);
        expect(again.companies[C1]).toMatchObject({ calendarMoved: 0, calendarClosed: 0, cloudCleared: 0 });
        expect(JSON.stringify(mockDb.store)).toBe(snapshot);
    });
});
