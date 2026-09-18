const fakeMongo = require('./fixtures/fakeMongo');

/* The store reaches the database through MongoDbCrudOpration, so it is routed to the same fake the migration context uses. */
let mockCurrent;
const newDb = () => { mockCurrent = fakeMongo.create(); return mockCurrent; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCurrent.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const { buildContext, validateMigration } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const secretField = require('../utils/secretField');

/* Sprint 8 slice 9: legacy integration and webhook secrets move into the store only when SECRETS_STORE is
 * on at migration time; otherwise the migration is a no-op that can be re-run once the flag is on. */

const ID = '031-secrets-by-handle';
const KEY = 'current-secrets-key-0123456789abcdef0123456789';
const CONNECTIONS = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
const WEBHOOKS = SCHEMA_TYPE.WEBHOOKS;
const SECRETS = SCHEMA_TYPE.SECRETS;
const GITHUB_TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB';
const COMPANY = '6f0000000000000000000c01';
const logger = { info: jest.fn(), error: jest.fn() };

let migration;
let store;

const boot = ({ on }) => {
    if (on) { process.env.SECRETS_STORE = 'true'; process.env.SECRETS_KEY = KEY; } else { delete process.env.SECRETS_STORE; delete process.env.SECRETS_KEY; }
    process.env.JWT_SECRET = 'jwt-secret-for-the-legacy-seal';
    jest.resetModules();
    store = require('../Config/secrets');
    migration = require(`../migrations/${ID}`);
};

const contextFor = (db) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => [{ _id: COMPANY }] });

/* One company whose secrets are in every legacy shape: sealed, plaintext, absent, and one already moved. */
const seedCompany = () => {
    const db = newDb();
    const sealed = db.seed(CONNECTIONS, { type: 'github', name: 'GitHub', config: { token: secretField.encrypt(GITHUB_TOKEN), repo: 'acme/app' }, secretsVersion: 1, deletedStatusKey: 0 });
    const plain = db.seed(CONNECTIONS, { type: 'slack', name: 'Slack', config: { verification_token: 'Q2hvb3NlQVZlcmlmaWNhdGlv' }, deletedStatusKey: 0 });
    const noSecret = db.seed(CONNECTIONS, { type: 'custom_iframe', name: 'Grafana', config: { name: 'Grafana', url: 'https://g.example.com' }, deletedStatusKey: 0 });
    const removed = db.seed(CONNECTIONS, { type: 'gitlab', name: 'Gone', config: { token: secretField.encrypt('glpat-removed'), project: 'g/p' }, secretsVersion: 1, deletedStatusKey: 1 });
    const hook = db.seed(WEBHOOKS, { name: 'Team Slack', url: 'https://hooks.example.com/a', events: ['*'], secret: 'legacy-signing-secret', active: true });
    return { db, sealed, plain, noSecret, removed, hook };
};

afterAll(() => {
    delete process.env.SECRETS_STORE;
    delete process.env.SECRETS_KEY;
});

describe(ID, () => {
    test('is a valid company-scoped migration with a down', () => {
        boot({ on: true });
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('company');
        expect(typeof migration.down).toBe('function');
    });

    test('with the flag off it writes nothing, touches no store and says it can be re-run', async () => {
        boot({ on: false });
        const { db } = seedCompany();
        const snapshot = JSON.stringify(db.store);
        const ctx = contextFor(db);
        await migration.up(ctx);
        expect(JSON.stringify(db.store)).toBe(snapshot);
        expect(db.calls).toEqual([]);
        expect(ctx.companies).toEqual({});
        expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/SECRETS_STORE is off.*nothing moved.*re-run/i));
    });

    test('with the flag on it moves every legacy secret into the store, keeps the handle, and is idempotent', async () => {
        boot({ on: true });
        const { db, sealed, plain, noSecret, removed, hook } = seedCompany();
        const ctx = contextFor(db);
        await migration.up(ctx);
        expect(ctx.companies[COMPANY]).toMatchObject({ ok: true, connections: 2, webhooks: 1, skipped: 2 });

        const rows = db.store[CONNECTIONS];
        const github = rows.find((r) => r._id === sealed._id);
        expect(github.config).toEqual({ repo: 'acme/app' });
        expect(github.secretHandles.token).toMatch(/^sec_[a-f0-9]{24}$/);
        expect(await store.resolve({ companyId: COMPANY, handle: github.secretHandles.token })).toBe(GITHUB_TOKEN);

        const slack = rows.find((r) => r._id === plain._id);
        expect(slack.config).toEqual({});
        expect(await store.resolve({ companyId: COMPANY, handle: slack.secretHandles.verification_token })).toBe('Q2hvb3NlQVZlcmlmaWNhdGlv');

        expect(rows.find((r) => r._id === noSecret._id).secretHandles).toBeUndefined();
        expect(rows.find((r) => r._id === removed._id).config.token).toBeDefined();
        expect(rows.find((r) => r._id === removed._id).secretHandles).toBeUndefined();

        const moved = db.store[WEBHOOKS].find((r) => r._id === hook._id);
        expect(moved.secret).toBeUndefined();
        expect(await store.resolve({ companyId: COMPANY, handle: moved.secretHandle })).toBe('legacy-signing-secret');

        const secrets = db.store[SECRETS];
        expect(secrets.map((s) => [s.name, s.kind]).sort()).toEqual([['GitHub: Personal access token', 'integration'], ['Slack: Slack verification token', 'integration'], ['Webhook: Team Slack', 'webhook']]);
        expect(JSON.stringify(db.store)).not.toContain(GITHUB_TOKEN);
        expect(JSON.stringify(db.store)).not.toContain('legacy-signing-secret');

        const snapshot = JSON.stringify(db.store);
        const again = contextFor(db);
        await migration.up(again);
        expect(again.companies[COMPANY]).toMatchObject({ connections: 0, webhooks: 0 });
        expect(JSON.stringify(db.store)).toBe(snapshot);
    });

    test('a sealed value that no longer decrypts is left in place and counted, not lost', async () => {
        boot({ on: true });
        const db = newDb();
        db.seed(CONNECTIONS, { type: 'github', name: 'GitHub', config: { token: 'enc:v1:bogus:bogus:bogus', repo: 'acme/app' }, secretsVersion: 1, deletedStatusKey: 0 });
        const ctx = contextFor(db);
        await migration.up(ctx);
        expect(ctx.companies[COMPANY]).toMatchObject({ ok: true, connections: 0, unreadable: 1 });
        expect(db.store[CONNECTIONS][0].config.token).toBe('enc:v1:bogus:bogus:bogus');
        expect(db.store[SECRETS] || []).toEqual([]);
    });

    test('down refuses without --confirm and moves the secrets back onto the documents with it', async () => {
        boot({ on: true });
        const { db, sealed, hook } = seedCompany();
        await migration.up(contextFor(db));
        await expect(migration.down(contextFor(db), {})).rejects.toThrow(/--confirm/);
        expect(db.store[CONNECTIONS].find((r) => r._id === sealed._id).secretHandles.token).toBeDefined();

        const down = contextFor(db);
        await migration.down(down, { confirmed: true });
        expect(down.companies[COMPANY]).toMatchObject({ ok: true, connections: 2, webhooks: 1 });
        const github = db.store[CONNECTIONS].find((r) => r._id === sealed._id);
        expect(github.secretHandles).toBeUndefined();
        expect(secretField.decrypt(github.config.token)).toBe(GITHUB_TOKEN);
        const restored = db.store[WEBHOOKS].find((r) => r._id === hook._id);
        expect(restored.secretHandle).toBeUndefined();
        expect(restored.secret).toBe('legacy-signing-secret');
        expect(db.store[SECRETS].every((s) => s.revokedAt instanceof Date)).toBe(true);
    });
});
