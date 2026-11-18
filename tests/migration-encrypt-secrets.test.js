const fakeMongo = require('./fixtures/fakeMongo');
const { buildContext, validateMigration } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { encrypt, decrypt, isEncrypted } = require('../utils/secretField');

const migration = require('../migrations/007-encrypt-integration-secrets');
const T = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
const logger = { info: jest.fn(), error: jest.fn() };

beforeAll(() => { process.env.JWT_SECRET = 'test-secret'; });

const contextFor = (db) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => [{ _id: 'c1' }] });

describe('007-encrypt-integration-secrets', () => {
    test('is a valid company-scoped migration', () => {
        expect(() => validateMigration(migration, '007-encrypt-integration-secrets')).not.toThrow();
        expect(migration.scope).toBe('company');
    });

    test('encrypts seeded plaintext secrets, leaves encrypted rows untouched, and is idempotent', async () => {
        const db = fakeMongo.create();
        const plain = db.seed(T, { type: 'github', config: { token: 'ghp_plain', repo: 'a/b' }, deletedStatusKey: 0 });
        const already = encrypt('already-sealed');
        const sealed = db.seed(T, { type: 'gitlab', config: { token: already, project: 'g/p' }, secretsVersion: 1, deletedStatusKey: 0 });
        const noSecret = db.seed(T, { type: 'custom_iframe', config: { name: 'Grafana', url: 'https://g.example.com' }, deletedStatusKey: 0 });

        const first = contextFor(db);
        await migration.up(first);
        expect(first.companies.c1).toMatchObject({ ok: true, encrypted: 1, stamped: 1, skipped: 1 });

        const rows = db.store[T];
        const github = rows.find((r) => r._id === plain._id);
        expect(github.config.token).not.toBe('ghp_plain');
        expect(isEncrypted(github.config.token)).toBe(true);
        expect(decrypt(github.config.token)).toBe('ghp_plain');
        expect(github.config.repo).toBe('a/b');
        expect(github.secretsVersion).toBe(1);
        expect(rows.find((r) => r._id === sealed._id).config.token).toBe(already);
        expect(rows.find((r) => r._id === noSecret._id).secretsVersion).toBe(1);

        const snapshot = JSON.stringify(rows);
        const again = contextFor(db);
        await migration.up(again);
        expect(again.companies.c1).toMatchObject({ encrypted: 0, stamped: 0, skipped: 3 });
        expect(JSON.stringify(db.store[T])).toBe(snapshot);
    });

    test('down refuses without the explicit flag and decrypts back with it', async () => {
        const db = fakeMongo.create();
        db.seed(T, { type: 'slack', config: { verification_token: 'v-tok' }, deletedStatusKey: 0 });
        await migration.up(contextFor(db));
        await expect(migration.down(contextFor(db), {})).rejects.toThrow(/--confirm/);
        expect(isEncrypted(db.store[T][0].config.verification_token)).toBe(true);
        const down = contextFor(db);
        await migration.down(down, { confirmed: true });
        expect(down.companies.c1).toMatchObject({ ok: true, decrypted: 1 });
        expect(db.store[T][0].config.verification_token).toBe('v-tok');
        expect(db.store[T][0].secretsVersion).toBe(0);
    });
});
