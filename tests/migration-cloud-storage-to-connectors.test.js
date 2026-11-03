require('./fixtures/mcpFlagsOff');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { buildContext, listMigrations, validateMigration } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const ID = '081-cloud-storage-to-connectors';
const migration = require(`../migrations/${ID}`);
const T = SCHEMA_TYPE.CLOUD_STORAGE_CONNECTIONS;
const C1 = '6f0000000000000000000c01';
const MAYA = '6f0000000000000000000a01';
const RUBEN = '6f0000000000000000000a02';

const ENV = { CONNECTORS: 'google,dropbox' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

const rows = () => mockDb.store[T] || [];
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration: mockDb.crud, SCHEMA_TYPE, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

const legacyRow = (overrides) => mockDb.seed(T, {
    userId: MAYA, provider: 'google_drive', status: 'connected', deletedStatusKey: 0,
    config: { client_id: 'c-id', client_secret: 'c-secret', api_key: 'a-key', app_id: '42' },
    accessToken: 'enc-access', refreshToken: 'enc-refresh', accountEmail: 'maya@example.test', ...overrides,
});

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
});

afterAll(() => {
    Object.keys(ENV).forEach((k) => { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; });
});

describe(ID, () => {
    it('is a company migration, listed after 080, forward-only with a re-trigger down', () => {
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('080-connectors-google-calendar-to-google'));
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration).toMatchObject({ id: ID, scope: 'company' });
        expect(typeof migration.down).toBe('function');
    });

    it('clears the stored client secrets and closes the row once the module serves the provider', async () => {
        const seeded = legacyRow();
        const ctx = contextFor([C1]);
        await migration.up(ctx);

        const row = rows().find((r) => r._id === seeded._id);
        expect(row.config).toEqual({});
        expect(row.accessToken).toBe('');
        expect(row.refreshToken).toBe('');
        expect(row.status).toBe('migrated');
        expect(row.deletedStatusKey).toBe(1);
    });

    it('is safe to run twice — a second run clears nothing', async () => {
        legacyRow();
        legacyRow({ userId: RUBEN, provider: 'dropbox', config: { app_key: 'k', app_secret: 's' }, refreshToken: 'enc-r2' });
        await migration.up(contextFor([C1]));
        const afterFirst = JSON.stringify(mockDb.store);
        const rerun = contextFor([C1]);
        await migration.up(rerun);
        expect(JSON.stringify(mockDb.store)).toBe(afterFirst);
        expect(rerun.companies[C1]).toMatchObject({ google_drive: 0, dropbox: 0 });
    });

    it('holds while CONNECTORS serves neither provider, leaving the credentials in place', async () => {
        delete process.env.CONNECTORS;
        const seeded = legacyRow();
        const ctx = contextFor([C1]);
        await migration.up(ctx);

        expect(ctx.companies).toEqual({});
        const row = rows().find((r) => r._id === seeded._id);
        expect(row.config).toMatchObject({ client_secret: 'c-secret' });
        expect(row.status).toBe('connected');
    });

    it('clears only a served provider, leaving the unserved one for its own cutover', async () => {
        process.env.CONNECTORS = 'google';
        const drive = legacyRow();
        const drop = legacyRow({ userId: RUBEN, provider: 'dropbox', config: { app_key: 'k', app_secret: 's' } });
        const ctx = contextFor([C1]);
        await migration.up(ctx);

        expect(rows().find((r) => r._id === drive._id).status).toBe('migrated');
        const dropRow = rows().find((r) => r._id === drop._id);
        expect(dropRow.status).toBe('connected');
        expect(dropRow.config).toMatchObject({ app_secret: 's' });
    });

    it('down restores no data; it only lets a later up re-evaluate the gate', async () => {
        legacyRow();
        await migration.up(contextFor([C1]));
        const cleared = JSON.stringify(mockDb.store);
        await expect(migration.down(contextFor([C1]))).resolves.toBeUndefined();
        expect(JSON.stringify(mockDb.store)).toBe(cleared);
    });
});
