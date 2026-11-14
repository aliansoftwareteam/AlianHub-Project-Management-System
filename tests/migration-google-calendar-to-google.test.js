require('./fixtures/mcpFlagsOff');
const crypto = require('crypto');
const mockDb = require('./fixtures/fakeMongo').create();
const mockRefresh = { calls: 0, answer: null };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(async () => {
        mockRefresh.calls += 1;
        return mockRefresh.answer || { status: 200, headers: {}, body: JSON.stringify({ access_token: 'g-access-next', expires_in: 3600 }) };
    }),
}));

const { buildContext, listMigrations, validateMigration } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const store = require('../Config/secrets');
const { resolveConnection } = require('../Modules/Connectors/resolveConnection');

const ID = '081-connectors-google-calendar-to-google';
const migration = require(`../migrations/${ID}`);
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const C1 = '6f0000000000000000000c01';
const MAYA = '6f0000000000000000000a01';
const RUBEN = '6f0000000000000000000a02';
const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.events.owned', 'https://www.googleapis.com/auth/calendar.app.created'];

const ENV = {
    CONNECTORS: 'google', SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'), AGENT_TAINT_ROUTING: 'on',
    CONNECTOR_GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com', CONNECTOR_GOOGLE_CLIENT_SECRET: crypto.randomBytes(18).toString('base64url'),
    APIURL: 'http://localhost:4000/', WEBURL: 'http://localhost:8080', JWT_SECRET: crypto.randomBytes(24).toString('hex'),
};
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

const rows = () => mockDb.store[T] || [];
const quiet = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration: mockDb.crud, SCHEMA_TYPE, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

const legacyRow = (overrides) => mockDb.seed(T, {
    connector: 'google_calendar', userId: MAYA, status: 'connected', scopes: [...GOOGLE_SCOPES],
    account: { email: 'maya@example.test', sub: 'g-sub-maya' }, secretHandles: {}, deletedStatusKey: 0,
    connectedAt: new Date('2026-01-01T00:00:00Z'), createdBy: MAYA, ...overrides,
});

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockRefresh.calls = 0;
    mockRefresh.answer = null;
});

afterAll(() => {
    Object.keys(ENV).forEach((k) => { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; });
});

describe(ID, () => {
    it('is a company migration, listed once after 079, with a re-trigger down', () => {
        const ids = listMigrations().map((m) => m.id);
        expect(ids.filter((id) => id.startsWith('081-'))).toEqual([ID]);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('080-connector-indexes'));
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration).toMatchObject({ id: ID, scope: 'company' });
        expect(typeof migration.down).toBe('function');
    });

    it('defers while the legacy google_calendar connector is still served, leaving live rows untouched', async () => {
        process.env.CONNECTORS = 'google_calendar';
        const seeded = legacyRow({ secretHandles: { access_token: 'sec_a', refresh_token: 'sec_r' } });
        const ctx = contextFor([C1]);
        await migration.up(ctx);

        expect(ctx.companies).toEqual({});
        const row = rows().find((r) => r._id === seeded._id);
        expect(row).toMatchObject({ connector: 'google_calendar', secretHandles: { access_token: 'sec_a', refresh_token: 'sec_r' } });
        expect(row.provider).toBeUndefined();
    });

    it('holds on a default boot with CONNECTORS unset, before the serving path has cut over', async () => {
        delete process.env.CONNECTORS;
        const seeded = legacyRow({ secretHandles: { access_token: 'sec_a', refresh_token: 'sec_r' } });
        const ctx = contextFor([C1]);
        await migration.up(ctx);

        expect(ctx.companies).toEqual({});
        const row = rows().find((r) => r._id === seeded._id);
        expect(row).toMatchObject({ connector: 'google_calendar' });
        expect(row.provider).toBeUndefined();
    });

    it('down reverses no data; a re-run after cutover then performs the migration', async () => {
        process.env.CONNECTORS = 'google_calendar';
        const seeded = legacyRow({ secretHandles: { access_token: 'sec_a', refresh_token: 'sec_r' } });
        await migration.up(contextFor([C1]));
        const deferred = JSON.stringify(mockDb.store);
        await expect(migration.down(contextFor([C1]))).resolves.toBeUndefined();
        expect(JSON.stringify(mockDb.store)).toBe(deferred);

        process.env.CONNECTORS = 'google';
        const rerun = contextFor([C1]);
        await migration.up(rerun);
        expect(rerun.companies[C1]).toMatchObject({ migrated: 1 });
        const row = rows().find((r) => r._id === seeded._id);
        expect(row.provider).toBe('google');
        expect(row.connector).toBeUndefined();
    });

    it('reshapes a connected Calendar row onto the Google provider, grant untouched', async () => {
        const seeded = legacyRow({ secretHandles: { access_token: 'sec_a', refresh_token: 'sec_r' } });
        const ctx = contextFor([C1]);
        await migration.up(ctx);

        expect(ctx.companies[C1]).toMatchObject({ ok: true, migrated: 1, conflicts: 0 });
        const row = rows().find((r) => r._id === seeded._id);
        expect(row).toMatchObject({
            companyId: C1, provider: 'google', products: ['calendar'], status: 'connected',
            handles: { access: 'sec_a', refresh: 'sec_r' }, account: { id: 'g-sub-maya', label: 'maya@example.test' },
            app: { source: 'instance', appId: null }, userId: MAYA,
        });
        expect(row.scopes).toEqual(GOOGLE_SCOPES);
        expect(row.connectedAt).toEqual(seeded.connectedAt);
        expect(row.connector).toBeUndefined();
        // Unset in the document; real Mongoose re-hydrates the schema default {} on read, so assert no token survives rather than absence.
        expect(row.secretHandles && row.secretHandles.refresh_token).toBeFalsy();
    });

    it('carries broken, pending and revoked rows across in their own shape', async () => {
        const broken = legacyRow({ status: 'broken', brokenReason: 'invalid_grant', brokenAt: new Date('2026-02-01T00:00:00Z'), secretHandles: { access_token: 'sec_a', refresh_token: 'sec_r' } });
        const pending = legacyRow({ userId: RUBEN, status: 'pending', account: undefined, secretHandles: {}, oauth: { stateHash: 'h', verifier: 'v', sessionId: 's', origin: 'o' } });
        const revoked = legacyRow({ status: 'revoked', secretHandles: {}, deletedStatusKey: 1, disconnectedBy: 'self' });
        await migration.up(contextFor([C1]));

        const after = (id) => rows().find((r) => r._id === id);
        expect(after(broken._id)).toMatchObject({ provider: 'google', status: 'broken', lastError: 'invalid_grant', handles: { access: 'sec_a', refresh: 'sec_r' } });
        expect(after(broken._id).brokenReason).toBeUndefined();
        expect(after(pending._id)).toMatchObject({ provider: 'google', status: 'pending', handles: {} });
        expect(after(pending._id).account).toBeUndefined();
        expect(after(revoked._id)).toMatchObject({ provider: 'google', status: 'revoked', deletedStatusKey: 1, handles: {} });
    });

    it('skips a row whose reshape collides on the unique index, counts it, and migrates the rest', async () => {
        const clash = legacyRow({ secretHandles: { access_token: 'sec_a', refresh_token: 'sec_r' } });
        const ok = legacyRow({ userId: RUBEN, secretHandles: { access_token: 'sec_a2', refresh_token: 'sec_r2' } });
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (cid, q, method) => {
            if (method === 'updateOne' && q.data[0] && String(q.data[0]._id) === String(clash._id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
            return real(cid, q, method);
        });
        try {
            const ctx = contextFor([C1]);
            await migration.up(ctx);
            expect(ctx.companies[C1]).toMatchObject({ ok: true, migrated: 1, conflicts: 1 });
        } finally { mockDb.crud.mockImplementation(real); }

        expect(rows().find((r) => r._id === clash._id)).toMatchObject({ connector: 'google_calendar' });
        expect(rows().find((r) => r._id === ok._id)).toMatchObject({ provider: 'google' });
        expect(quiet.error).toHaveBeenCalledWith(expect.stringContaining(String(clash._id)));
    });

    it('migrates every Calendar row in the workspace and leaves a legacy Slack row alone', async () => {
        const slack = mockDb.seed(T, { connector: 'slack', status: 'connected', secretHandles: { bot_token: 'sec_b' }, deletedStatusKey: 0 });
        legacyRow({});
        legacyRow({ userId: RUBEN });
        const ctx = contextFor([C1]);
        await migration.up(ctx);

        expect(ctx.companies[C1]).toMatchObject({ migrated: 2, conflicts: 0 });
        expect(rows().filter((r) => r.provider === 'google')).toHaveLength(2);
        expect(rows().find((r) => r._id === slack._id)).toMatchObject({ connector: 'slack', secretHandles: { bot_token: 'sec_b' } });
        expect(rows().find((r) => r._id === slack._id).provider).toBeUndefined();
    });

    it('is safe to run twice: the second pass finds nothing and writes nothing', async () => {
        legacyRow({ secretHandles: { access_token: 'sec_a', refresh_token: 'sec_r' } });
        legacyRow({ userId: RUBEN, secretHandles: { access_token: 'sec_a2', refresh_token: 'sec_r2' } });
        await migration.up(contextFor([C1]));
        const snapshot = JSON.stringify(mockDb.store);

        const again = contextFor([C1]);
        await migration.up(again);
        expect(again.companies[C1]).toMatchObject({ migrated: 0, conflicts: 0 });
        expect(JSON.stringify(mockDb.store)).toBe(snapshot);
    });
});

describe(`${ID}: a migrated connection resolves and refreshes without reconnecting`, () => {
    const seedWithGrant = async () => {
        const actor = { id: 'migration:test' };
        const access = (await store.create({ companyId: C1, name: 'g access', kind: 'connector', value: 'g-access-now', actor })).handle;
        const refresh = (await store.create({ companyId: C1, name: 'g refresh', kind: 'connector', value: 'g-refresh', actor })).handle;
        return legacyRow({ secretHandles: { access_token: access, refresh_token: refresh }, accessExpiresAt: new Date(Date.now() + 3600 * 1000) });
    };

    it('resolveConnection returns the migrated row and getAccessToken refreshes an expired token in place', async () => {
        const seeded = await seedWithGrant();
        await migration.up(contextFor([C1]));

        const conn = await resolveConnection({ companyId: C1, userId: MAYA, provider: 'google' });
        expect(conn.connectionId).toBe(String(seeded._id));
        expect(conn.scopes).toEqual(GOOGLE_SCOPES);

        expect(await conn.getAccessToken()).toBe('g-access-now');
        expect(mockRefresh.calls).toBe(0);

        const handlesBefore = { ...rows().find((r) => r._id === seeded._id).handles };
        rows().find((r) => r._id === seeded._id).accessExpiresAt = new Date(Date.now() - 1000);
        const refreshed = await (await resolveConnection({ companyId: C1, userId: MAYA, provider: 'google' })).getAccessToken();
        expect(refreshed).toBe('g-access-next');
        expect(mockRefresh.calls).toBe(1);
        const row = rows().find((r) => r._id === seeded._id);
        expect(row.status).toBe('connected');
        // The same grant is kept: the handles are rotated in place, not re-minted, so no reconnect was needed.
        expect(row.handles).toEqual(handlesBefore);
        expect(await store.resolve({ companyId: C1, handle: row.handles.access })).toBe('g-access-next');
        expect(await store.resolve({ companyId: C1, handle: row.handles.refresh })).toBe('g-refresh');
    });
});
