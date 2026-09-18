const { create } = require('./fixtures/fakeMongo');

/* Sprint 8 slice 9: the tenant secrets store. One fake database per company, so a handle written in one
 * company can only be read back through that company's database. */
const mockDbs = {};
const mockDbFor = (companyId) => (mockDbs[companyId] = mockDbs[companyId] || create());
const mockCrud = (companyId, query, method) => mockDbFor(String(companyId)).crud(companyId, query, method);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');

const COMPANY = '6f0000000000000000000c01';
const OTHER = '6f0000000000000000000c02';
const KEY = 'current-secrets-key-0123456789abcdef0123456789';
const PREVIOUS = 'previous-secrets-key-fedcba9876543210fedcba98';
const VALUE = 'ghp_TheOnlyCopyOfThisTokenValue000000000';
const actor = { id: '6f0000000000000000000a01', name: 'Olivia Owner' };

let store;
let logger;
let recordAudit;

/* Module registry reset per scenario, so the logger and recorder are re-required beside the store. */
const env = ({ on = true, key = KEY, previous } = {}) => {
    if (on) process.env.SECRETS_STORE = 'true'; else delete process.env.SECRETS_STORE;
    if (key === null) delete process.env.SECRETS_KEY; else process.env.SECRETS_KEY = key;
    if (previous === undefined) delete process.env.SECRETS_KEY_PREVIOUS; else process.env.SECRETS_KEY_PREVIOUS = previous;
    jest.resetModules();
    store = require('../Config/secrets');
    logger = require('../Config/loggerConfig');
    ({ recordAudit } = require('../Modules/Audit/recorder'));
};

const rows = (companyId = COMPANY) => mockDbFor(companyId).store[SCHEMA_TYPE.SECRETS] || [];
const audits = () => recordAudit.mock.calls.map(([companyId, entry]) => ({ companyId, ...entry }));
const everythingWritten = () => JSON.stringify({
    rows: Object.values(mockDbs).map((db) => db.store),
    calls: Object.values(mockDbs).map((db) => db.calls),
    audits: recordAudit.mock.calls,
    logs: [logger.info.mock.calls, logger.error.mock.calls, logger.warn.mock.calls],
});

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    env();
});

afterAll(() => {
    delete process.env.SECRETS_STORE;
    delete process.env.SECRETS_KEY;
    delete process.env.SECRETS_KEY_PREVIOUS;
});

describe('configuration', () => {
    it('is off by default and on only with the flag and a key of at least 32 characters', () => {
        env({ on: false });
        expect(store.isOn()).toBe(false);
        env({ on: true, key: null });
        expect(store.isOn()).toBe(false);
        expect(store.config().error).toMatch(/SECRETS_KEY is missing/);
        env({ on: true, key: 'short-key' });
        expect(store.isOn()).toBe(false);
        expect(store.config().error).toMatch(/shorter than 32 characters/);
        env({ on: true, key: KEY });
        expect(store.isOn()).toBe(true);
        expect(store.config().error).toBe('');
    });

    it('logs the key problem at boot and says the store refuses reads and writes', () => {
        env({ on: true, key: 'short-key' });
        store.logBootState();
        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/SECRETS_STORE is on but SECRETS_KEY is shorter than 32 characters.*refuses/));
        env({ on: true, key: KEY });
        store.logBootState();
        expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/secrets store.*on/i));
    });

    it('names each key by a fingerprint that reveals nothing of the key', () => {
        env({ key: KEY, previous: PREVIOUS });
        const { keyId, previousKeyId } = store.config();
        expect(keyId).toMatch(/^k[a-f0-9]{16}$/);
        expect(previousKeyId).toMatch(/^k[a-f0-9]{16}$/);
        expect(keyId).not.toBe(previousKeyId);
        expect(KEY).not.toContain(keyId.slice(1));
        expect(store.keyIdOf(KEY)).toBe(keyId);
    });
});

describe('create and resolve', () => {
    it('round-trips a value through a handle and stores only ciphertext under the current key id', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'GitHub: Personal access token', kind: 'integration', value: VALUE, actor });
        expect(made.handle).toMatch(/^sec_[a-f0-9]{24}$/);
        expect(made).toMatchObject({ name: 'GitHub: Personal access token', kind: 'integration', keyId: store.config().keyId, createdBy: actor.id, rotatedAt: null, revokedAt: null, lastResolvedAt: null });
        expect(made.createdAt).toBeInstanceOf(Date);
        expect(JSON.stringify(made)).not.toContain(VALUE);

        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(VALUE);

        const [row] = rows();
        expect(Object.keys(row).sort()).toEqual(['_id', 'ciphertext', 'createdAt', 'createdBy', 'handle', 'iv', 'keyId', 'kind', 'lastResolvedAt', 'name', 'revokedAt', 'rotatedAt', 'tag'].sort());
        expect(row.lastResolvedAt).toBeInstanceOf(Date);
        expect(row.ciphertext).not.toContain(VALUE);
    });

    it('writes a different ciphertext and iv for the same value every time', async () => {
        const a = await store.create({ companyId: COMPANY, name: 'A', kind: 'integration', value: VALUE, actor });
        const b = await store.create({ companyId: COMPANY, name: 'B', kind: 'integration', value: VALUE, actor });
        const [ra, rb] = [rows().find((r) => r.handle === a.handle), rows().find((r) => r.handle === b.handle)];
        expect(ra.iv).not.toBe(rb.iv);
        expect(ra.ciphertext).not.toBe(rb.ciphertext);
    });

    it('never lets the value into the documents, the audit rows or the log', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'Slack: Verification token', kind: 'integration', value: VALUE, actor });
        await store.resolve({ companyId: COMPANY, handle: made.handle });
        await store.rotate({ companyId: COMPANY, handle: made.handle, value: `${VALUE}Z9`, actor });
        await store.revoke({ companyId: COMPANY, handle: made.handle, actor });
        await store.resolve({ companyId: COMPANY, handle: made.handle });
        const text = everythingWritten();
        expect(text).not.toContain(VALUE);
        expect(text).not.toContain(`${VALUE}Z9`);
        expect(text).not.toContain(KEY);
    });

    it('audits the create with the actor, the handle and the kind', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'Zapier: Zapier catch hook URL', kind: 'integration', value: VALUE, actor });
        expect(audits()).toEqual([{
            companyId: COMPANY, actorId: actor.id, actorName: actor.name, action: 'secret.create',
            entityType: 'secret', entityId: made.handle, entityName: 'Zapier: Zapier catch hook URL', meta: { kind: 'integration', keyId: made.keyId },
        }]);
    });

    it('resolves nothing, and audits the failure, for a handle that does not exist', async () => {
        expect(await store.resolve({ companyId: COMPANY, handle: 'sec_000000000000000000000000' })).toBeNull();
        expect(audits()).toEqual([expect.objectContaining({ companyId: COMPANY, actorId: 'system', action: 'secret.resolve_failed', entityId: 'sec_000000000000000000000000', meta: { reason: 'not_found' } })]);
    });

    it('refuses a malformed handle, an empty value, a bad company id and an oversized value without touching the database', async () => {
        await expect(store.resolve({ companyId: COMPANY, handle: 'not-a-handle' })).resolves.toBeNull();
        await expect(store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: '', actor })).rejects.toMatchObject({ code: 'invalid_input' });
        await expect(store.create({ companyId: 'nope', name: 'X', kind: 'integration', value: VALUE, actor })).rejects.toMatchObject({ code: 'invalid_input' });
        await expect(store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: 'v'.repeat(store.MAX_VALUE_LENGTH + 1), actor })).rejects.toMatchObject({ code: 'invalid_input' });
        await expect(store.create({ companyId: COMPANY, name: '', kind: 'integration', value: VALUE, actor })).rejects.toMatchObject({ code: 'invalid_input' });
        expect(rows()).toEqual([]);
    });
});

describe('rotate and revoke', () => {
    it('rotate keeps the handle, changes the ciphertext and stamps rotatedAt; the old value no longer resolves', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'GitLab: Access token', kind: 'integration', value: VALUE, actor });
        const before = { ...rows()[0] };
        const rotated = await store.rotate({ companyId: COMPANY, handle: made.handle, value: 'glpat-NewValueAfterRotation0000000', actor });
        expect(rotated.handle).toBe(made.handle);
        expect(rotated.rotatedAt).toBeInstanceOf(Date);
        expect(rows()).toHaveLength(1);
        expect(rows()[0].ciphertext).not.toBe(before.ciphertext);
        expect(rows()[0].iv).not.toBe(before.iv);
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe('glpat-NewValueAfterRotation0000000');
        expect(audits().map((a) => a.action)).toEqual(['secret.create', 'secret.rotate']);
    });

    it('revoke makes resolve refuse and audits both the revoke and the refused resolve', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'Webhook: Team Slack', kind: 'webhook', value: VALUE, actor });
        const revoked = await store.revoke({ companyId: COMPANY, handle: made.handle, actor });
        expect(revoked.revokedAt).toBeInstanceOf(Date);
        expect(rows()[0].ciphertext).toBe('');
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBeNull();
        expect(audits().map((a) => [a.action, a.meta.reason])).toEqual([['secret.create', undefined], ['secret.revoke', undefined], ['secret.resolve_failed', 'revoked']]);
    });

    it('refuses to rotate or revoke a revoked or missing secret', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor });
        await store.revoke({ companyId: COMPANY, handle: made.handle, actor });
        await expect(store.rotate({ companyId: COMPANY, handle: made.handle, value: 'v2', actor })).rejects.toMatchObject({ code: 'revoked' });
        await expect(store.revoke({ companyId: COMPANY, handle: made.handle, actor })).rejects.toMatchObject({ code: 'revoked' });
        await expect(store.rotate({ companyId: COMPANY, handle: 'sec_000000000000000000000000', value: 'v2', actor })).rejects.toMatchObject({ code: 'not_found' });
        await expect(store.revoke({ companyId: COMPANY, handle: 'sec_000000000000000000000000', actor })).rejects.toMatchObject({ code: 'not_found' });
    });
});

describe('tenant scope', () => {
    it('resolves a handle created in company A to nothing in company B, and never opens B\'s value with A\'s row', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor });
        expect(await store.resolve({ companyId: OTHER, handle: made.handle })).toBeNull();
        expect(rows(OTHER)).toEqual([]);
        expect(mockDbFor(OTHER).calls.every((c) => c.companyId === OTHER)).toBe(true);
        expect(audits().filter((a) => a.action === 'secret.resolve_failed')).toEqual([expect.objectContaining({ companyId: OTHER, meta: { reason: 'not_found' } })]);
    });

    it('refuses a ciphertext copied from another company\'s row', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor });
        mockDbFor(OTHER).seed(SCHEMA_TYPE.SECRETS, { ...rows()[0], _id: undefined });
        expect(await store.resolve({ companyId: OTHER, handle: made.handle })).toBeNull();
        expect(audits().pop()).toMatchObject({ companyId: OTHER, action: 'secret.resolve_failed', meta: { reason: 'undecryptable' } });
    });

    it('lists metadata only, newest first, without any ciphertext or value', async () => {
        await store.create({ companyId: COMPANY, name: 'First', kind: 'integration', value: VALUE, actor });
        await store.create({ companyId: COMPANY, name: 'Second', kind: 'webhook', value: VALUE, actor });
        await store.create({ companyId: OTHER, name: 'Theirs', kind: 'webhook', value: VALUE, actor });
        const listed = await store.list({ companyId: COMPANY });
        expect(listed.map((s) => s.name)).toEqual(['Second', 'First']);
        expect(Object.keys(listed[0]).sort()).toEqual(['createdAt', 'createdBy', 'handle', 'keyId', 'kind', 'lastResolvedAt', 'name', 'revokedAt', 'rotatedAt']);
        expect(JSON.stringify(listed)).not.toContain(VALUE);
    });
});

describe('key rotation', () => {
    it('still resolves a secret written under the previous key, and reencryptAll moves it to the current key id', async () => {
        env({ key: PREVIOUS });
        const made = await store.create({ companyId: COMPANY, name: 'Old', kind: 'integration', value: VALUE, actor });
        const oldKeyId = store.config().keyId;

        env({ key: KEY, previous: PREVIOUS });
        expect(rows()[0].keyId).toBe(oldKeyId);
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(VALUE);

        const fresh = await store.create({ companyId: COMPANY, name: 'New', kind: 'integration', value: VALUE, actor });
        expect(fresh.keyId).toBe(store.config().keyId);

        const moved = await store.reencryptAll({ companyId: COMPANY });
        expect(moved).toEqual({ moved: 1, kept: 1, failed: 0 });
        expect(rows().every((r) => r.keyId === store.config().keyId)).toBe(true);
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(VALUE);

        env({ key: KEY });
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(VALUE);
    });

    it('refuses a secret whose key id is neither the current nor the previous key, and audits it', async () => {
        env({ key: PREVIOUS });
        const made = await store.create({ companyId: COMPANY, name: 'Orphan', kind: 'integration', value: VALUE, actor });
        env({ key: KEY });
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBeNull();
        expect(audits().pop()).toMatchObject({ action: 'secret.resolve_failed', meta: { reason: 'unknown_key' } });
        expect(await store.reencryptAll({ companyId: COMPANY })).toEqual({ moved: 0, kept: 0, failed: 1 });
    });
});

describe('a missing or short key', () => {
    it.each([
        ['missing', null],
        ['short', 'too-short'],
    ])('refuses every write and read with a clear error and writes nothing (%s key)', async (label, key) => {
        env({ on: true, key });
        const calls = [
            () => store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor }),
            () => store.resolve({ companyId: COMPANY, handle: 'sec_000000000000000000000000' }),
            () => store.rotate({ companyId: COMPANY, handle: 'sec_000000000000000000000000', value: VALUE, actor }),
            () => store.revoke({ companyId: COMPANY, handle: 'sec_000000000000000000000000', actor }),
            () => store.list({ companyId: COMPANY }),
            () => store.reencryptAll({ companyId: COMPANY }),
        ];
        for (const call of calls) {
            // eslint-disable-next-line no-await-in-loop
            await expect(call()).rejects.toMatchObject({ code: 'key_invalid', message: expect.stringMatching(/SECRETS_KEY/) });
        }
        expect(Object.keys(mockDbs)).toEqual([]);
        expect(recordAudit).not.toHaveBeenCalled();
    });

    it('refuses writes and the list while the flag is off, but still resolves an existing handle', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor });
        env({ on: false });
        await expect(store.create({ companyId: COMPANY, name: 'Y', kind: 'integration', value: VALUE, actor })).rejects.toMatchObject({ code: 'store_off' });
        await expect(store.rotate({ companyId: COMPANY, handle: made.handle, value: VALUE, actor })).rejects.toMatchObject({ code: 'store_off' });
        await expect(store.revoke({ companyId: COMPANY, handle: made.handle, actor })).rejects.toMatchObject({ code: 'store_off' });
        await expect(store.list({ companyId: COMPANY })).rejects.toMatchObject({ code: 'store_off' });
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(VALUE);
    });
});
