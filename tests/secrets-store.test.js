const crypto = require('crypto');
const { create } = require('./fixtures/fakeMongo');

/* Sprint 8 slice 9: the tenant secrets store. One fake database per company, so a handle written in one
 * company can only be read back through that company's database. */
const mockDbs = {};
const mockDbFor = (companyId) => (mockDbs[companyId] = mockDbs[companyId] || create());
let mockAfterCall = null;
const mockCrud = async (companyId, query, method) => {
    const out = await mockDbFor(String(companyId)).crud(companyId, query, method);
    if (mockAfterCall) await mockAfterCall({ companyId: String(companyId), query, method });
    return out;
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');

const COMPANY = '6f0000000000000000000c01';
const OTHER = '6f0000000000000000000c02';
const KEY = crypto.randomBytes(24).toString('hex');
const PREVIOUS = crypto.randomBytes(24).toString('hex');
const VALUE = `ghp_${crypto.randomBytes(20).toString('hex')}`;
const ROTATED = `glpat-${crypto.randomBytes(12).toString('hex')}`;
const HOUR_MS = 60 * 60 * 1000;
const plainHashIdOf = (key) => `k${crypto.createHash('sha256').update(`alianhub-secrets-key-id:${key}`).digest('hex').slice(0, 16)}`;
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
    mockAfterCall = null;
    jest.clearAllMocks();
    env();
});

afterEach(() => {
    jest.restoreAllMocks();
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

    it('takes the key id from the stretched key, so it is no fast test for a guessed SECRETS_KEY', async () => {
        env({ key: KEY, previous: PREVIOUS });
        expect(store.config().keyId).not.toBe(plainHashIdOf(KEY));
        expect(store.config().previousKeyId).not.toBe(plainHashIdOf(PREVIOUS));
        store.logBootState();
        await store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor });
        const text = everythingWritten();
        expect(text).toContain(store.config().keyId);
        expect(text).not.toContain(plainHashIdOf(KEY));
        expect(text).not.toContain(plainHashIdOf(PREVIOUS));
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
        const rotated = await store.rotate({ companyId: COMPANY, handle: made.handle, value: ROTATED, actor });
        expect(rotated.handle).toBe(made.handle);
        expect(rotated.rotatedAt).toBeInstanceOf(Date);
        expect(rows()).toHaveLength(1);
        expect(rows()[0].ciphertext).not.toBe(before.ciphertext);
        expect(rows()[0].iv).not.toBe(before.iv);
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(ROTATED);
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

    it('refuses a ciphertext copied onto another handle in the same company', async () => {
        const a = await store.create({ companyId: COMPANY, name: 'A', kind: 'integration', value: VALUE, actor });
        const b = await store.create({ companyId: COMPANY, name: 'B', kind: 'integration', value: ROTATED, actor });
        const [ra, rb] = [rows().find((r) => r.handle === a.handle), rows().find((r) => r.handle === b.handle)];
        Object.assign(rb, { ciphertext: ra.ciphertext, iv: ra.iv, tag: ra.tag });
        expect(await store.resolve({ companyId: COMPANY, handle: b.handle })).toBeNull();
        expect(audits().pop()).toMatchObject({ action: 'secret.resolve_failed', entityId: b.handle, meta: { reason: 'undecryptable' } });
        expect(await store.resolve({ companyId: COMPANY, handle: a.handle })).toBe(VALUE);
    });

    it('lists metadata only, newest first, without any ciphertext or value', async () => {
        await store.create({ companyId: COMPANY, name: 'First', kind: 'integration', value: VALUE, actor });
        await store.create({ companyId: COMPANY, name: 'Second', kind: 'webhook', value: VALUE, actor });
        await store.create({ companyId: OTHER, name: 'Theirs', kind: 'webhook', value: VALUE, actor });
        rows()[0].createdAt = new Date(rows()[1].createdAt.getTime() - 1000);
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
        expect(moved).toMatchObject({ moved: 1, kept: 1, failed: 0 });
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
        expect(await store.reencryptAll({ companyId: COMPANY })).toMatchObject({ moved: 0, kept: 0, failed: 1, onPreviousKey: 0, onUnknownKey: 1 });
    });

    it('still resolves a row recorded under the old plain-hash key id, and restamps it with the current id', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'Old id', kind: 'integration', value: VALUE, actor });
        rows()[0].keyId = plainHashIdOf(KEY);
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(VALUE);
        expect(rows()[0].keyId).toBe(store.config().keyId);
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(VALUE);
    });

    it('reencryptAll moves a row recorded under the previous key\'s old plain-hash id', async () => {
        env({ key: PREVIOUS });
        const made = await store.create({ companyId: COMPANY, name: 'Old id, old key', kind: 'integration', value: VALUE, actor });
        rows()[0].keyId = plainHashIdOf(PREVIOUS);
        env({ key: KEY, previous: PREVIOUS });
        expect(await store.reencryptAll({ companyId: COMPANY })).toMatchObject({ moved: 1, failed: 0, onPreviousKey: 0 });
        expect(rows()[0].keyId).toBe(store.config().keyId);
        env({ key: KEY });
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(VALUE);
    });
});

describe('resealing under a new key', () => {
    const underPrevious = async (names) => {
        env({ key: PREVIOUS });
        const made = [];
        for (const name of names) made.push(await store.create({ companyId: COMPANY, name, kind: 'integration', value: `${VALUE}${name}`, actor }));
        return made;
    };

    /* Another process changes the row between reencryptAll reading it and writing it back. */
    const whileResealing = (change) => {
        let done = false;
        mockAfterCall = async ({ query, method }) => {
            if (done || method !== 'find' || query.type !== SCHEMA_TYPE.SECRETS) return;
            done = true;
            await change();
        };
    };

    it('never overwrites a secret rotated while it was being resealed', async () => {
        const [made] = await underPrevious(['Raced']);
        env({ key: KEY, previous: PREVIOUS });
        whileResealing(() => store.rotate({ companyId: COMPANY, handle: made.handle, value: ROTATED, actor }));
        const counts = await store.reencryptAll({ companyId: COMPANY });
        expect(counts).toMatchObject({ moved: 0, raced: 1, onPreviousKey: 0 });
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(ROTATED);
    });

    it('counts a row that changed underneath it and is still on the previous key as remaining', async () => {
        const [made] = await underPrevious(['Raced, still old']);
        env({ key: KEY, previous: PREVIOUS });
        /* A process that still runs on the old configuration rotates the row. */
        whileResealing(async () => {
            process.env.SECRETS_KEY = PREVIOUS;
            delete process.env.SECRETS_KEY_PREVIOUS;
            await store.rotate({ companyId: COMPANY, handle: made.handle, value: ROTATED, actor });
            process.env.SECRETS_KEY = KEY;
            process.env.SECRETS_KEY_PREVIOUS = PREVIOUS;
        });
        const counts = await store.reencryptAll({ companyId: COMPANY });
        expect(counts).toMatchObject({ moved: 0, raced: 1, onPreviousKey: 1 });
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(ROTATED);
    });

    it('reports revoked rows apart from live ones, so what remains on the previous key can reach zero', async () => {
        const [live, gone] = await underPrevious(['Live', 'Gone']);
        await store.revoke({ companyId: COMPANY, handle: gone.handle, actor });
        env({ key: KEY, previous: PREVIOUS });
        const counts = await store.reencryptAll({ companyId: COMPANY });
        expect(counts).toEqual({ moved: 1, kept: 0, failed: 0, raced: 0, revoked: 1, onPreviousKey: 0, onUnknownKey: 0 });
        expect(rows().find((r) => r.handle === live.handle).keyId).toBe(store.config().keyId);
        expect(rows().find((r) => r.handle === gone.handle).ciphertext).toBe('');
    });

    it('writes one audit row per company with the counts and the key id, never a value', async () => {
        await underPrevious(['One', 'Two']);
        env({ key: KEY, previous: PREVIOUS });
        recordAudit.mockClear();
        const counts = await store.reencryptAll({ companyId: COMPANY, actor: { id: 'script:secrets-reencrypt' }, run: 'run-1' });
        expect(audits()).toEqual([{
            companyId: COMPANY, actorId: 'script:secrets-reencrypt', actorName: '', action: 'secret.reencrypt', entityType: 'secret',
            entityId: COMPANY, entityName: 'Secrets store key rotation', meta: { ...counts, keyId: store.config().keyId, run: 'run-1' },
        }]);
        expect(everythingWritten()).not.toContain(VALUE);
        expect(everythingWritten()).not.toContain(KEY);
        expect(everythingWritten()).not.toContain(PREVIOUS);
    });

    it('reseals while the flag is off, as long as the key is set', async () => {
        const [made] = await underPrevious(['Flag off']);
        env({ on: false, key: KEY, previous: PREVIOUS });
        expect(await store.reencryptAll({ companyId: COMPANY })).toMatchObject({ moved: 1, onPreviousKey: 0 });
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(`${VALUE}Flag off`);
    });
});

describe('what a stored row must look like to open', () => {
    const sealedByHand = ({ handle, ivBytes }) => {
        const iv = crypto.randomBytes(ivBytes);
        const cipher = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(KEY, 'alianhub-secrets-store', 32), iv);
        cipher.setAAD(Buffer.from(`${COMPANY}:${handle}`, 'utf8'));
        const body = Buffer.concat([cipher.update(VALUE, 'utf8'), cipher.final()]);
        return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: body.toString('base64') };
    };

    it('opens a row sealed by hand the way the store seals it', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'By hand', kind: 'integration', value: ROTATED, actor });
        Object.assign(rows()[0], sealedByHand({ handle: made.handle, ivBytes: 12 }));
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(VALUE);
    });

    it.each([4, 8, 12, 15])('refuses an auth tag cut to %i bytes', async (bytes) => {
        const made = await store.create({ companyId: COMPANY, name: 'Short tag', kind: 'integration', value: VALUE, actor });
        rows()[0].tag = Buffer.from(rows()[0].tag, 'base64').subarray(0, bytes).toString('base64');
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBeNull();
        expect(audits().pop()).toMatchObject({ action: 'secret.resolve_failed', meta: { reason: 'undecryptable' } });
    });

    it('refuses a row whose iv is not 12 bytes, even when it authenticates', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'Long iv', kind: 'integration', value: ROTATED, actor });
        Object.assign(rows()[0], sealedByHand({ handle: made.handle, ivBytes: 16 }));
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBeNull();
        expect(audits().pop()).toMatchObject({ action: 'secret.resolve_failed', meta: { reason: 'undecryptable' } });
    });
});

describe('letting go of a handle', () => {
    it('revokes with the flag off while the key is set, so a rollback leaves no live copy', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor });
        env({ on: false });
        expect(await store.retire({ companyId: COMPANY, handle: made.handle, actor })).toBe('revoked');
        expect(rows()[0].revokedAt).toBeInstanceOf(Date);
        expect(rows()[0].ciphertext).toBe('');
        expect(audits().pop()).toMatchObject({ action: 'secret.revoke', entityId: made.handle });
    });

    it('marks the row as orphaned when there is no key, and revokes it once there is one', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor });
        const kept = await store.create({ companyId: COMPANY, name: 'Still used', kind: 'integration', value: VALUE, actor });
        env({ on: false, key: null });
        expect(await store.retire({ companyId: COMPANY, handle: made.handle, actor })).toBe('orphaned');
        const row = () => rows().find((r) => r.handle === made.handle);
        expect(row().orphanedAt).toBeInstanceOf(Date);
        expect(row().revokedAt).toBeNull();
        expect(row().ciphertext).not.toBe('');
        expect(audits().pop()).toMatchObject({ action: 'secret.orphan', entityId: made.handle, actorId: actor.id });

        env();
        expect(await store.revokeOrphans({ companyId: COMPANY, actor })).toBe(1);
        expect(row().revokedAt).toBeInstanceOf(Date);
        expect(row().ciphertext).toBe('');
        expect(rows().find((r) => r.handle === kept.handle).revokedAt).toBeNull();
        expect(await store.revokeOrphans({ companyId: COMPANY, actor })).toBe(0);
    });

    it('answers gone for a handle that is already revoked or was never there', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'X', kind: 'integration', value: VALUE, actor });
        await store.revoke({ companyId: COMPANY, handle: made.handle, actor });
        expect(await store.retire({ companyId: COMPANY, handle: made.handle, actor })).toBe('gone');
        expect(await store.retire({ companyId: COMPANY, handle: 'sec_000000000000000000000000', actor })).toBe('gone');
        expect(await store.retire({ companyId: COMPANY, handle: 'not-a-handle', actor })).toBe('gone');
    });
});

describe('a secret that keeps failing to resolve', () => {
    it('is audited once per handle per hour, not once per lookup', async () => {
        const now = jest.spyOn(Date, 'now');
        const start = 1750000000000;
        now.mockReturnValue(start);
        const a = await store.create({ companyId: COMPANY, name: 'A', kind: 'webhook', value: VALUE, actor });
        const b = await store.create({ companyId: COMPANY, name: 'B', kind: 'webhook', value: VALUE, actor });
        await store.revoke({ companyId: COMPANY, handle: a.handle, actor });
        await store.revoke({ companyId: COMPANY, handle: b.handle, actor });
        const failures = () => audits().filter((x) => x.action === 'secret.resolve_failed').map((x) => x.entityId);

        for (let i = 0; i < 5; i += 1) expect(await store.resolve({ companyId: COMPANY, handle: a.handle })).toBeNull();
        expect(failures()).toEqual([a.handle]);
        expect(await store.resolve({ companyId: COMPANY, handle: b.handle })).toBeNull();
        expect(failures()).toEqual([a.handle, b.handle]);

        now.mockReturnValue(start + HOUR_MS - 1);
        await store.resolve({ companyId: COMPANY, handle: a.handle });
        expect(failures()).toEqual([a.handle, b.handle]);

        now.mockReturnValue(start + HOUR_MS);
        await store.resolve({ companyId: COMPANY, handle: a.handle });
        expect(failures()).toEqual([a.handle, b.handle, a.handle]);
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
        await expect(store.list({ companyId: COMPANY })).rejects.toMatchObject({ code: 'store_off' });
        expect(await store.resolve({ companyId: COMPANY, handle: made.handle })).toBe(VALUE);
    });
});
