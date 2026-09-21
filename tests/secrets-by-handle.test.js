const crypto = require('crypto');
const mockDb = require('./fixtures/fakeMongo').create();

/* Sprint 8 slice 9: integration and webhook secrets by handle. With SECRETS_STORE on, a new or updated
 * secret goes to the store and the document keeps only the handle; reads resolve the handle and fall back
 * to the legacy field when there is none. With the flag off nothing changes. */
const mockRoles = {};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (uid in mockRoles ? mockRoles[uid] : null)),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ on: jest.fn(), emit: jest.fn() }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    safeFetch: jest.fn(async () => ({ status: 200 })),
    resolvePublic: jest.fn(async () => ({})),
    isBlockedHostname: () => false,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const secretField = require('../utils/secretField');
const { signPayload } = require('../Modules/Webhooks/helpers/webhookRules');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const MEMBER = '6f0000000000000000000a03';
Object.assign(mockRoles, { [OWNER]: 1, [MEMBER]: 3 });
const KEY = crypto.randomBytes(24).toString('hex');
const LEGACY_SEAL_KEY = crypto.randomBytes(24).toString('hex');
const GITHUB_TOKEN = `ghp_${crypto.randomBytes(20).toString('hex')}`;
const NEW_GITHUB_TOKEN = `ghp_${crypto.randomBytes(20).toString('hex')}`;
const SLACK_TOKEN = crypto.randomBytes(12).toString('hex');
const NEW_SLACK_TOKEN = crypto.randomBytes(12).toString('hex');
const CONNECTIONS = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
const WEBHOOKS = SCHEMA_TYPE.WEBHOOKS;
const SECRETS = SCHEMA_TYPE.SECRETS;

let integrations;
let webhooks;
let dispatcher;
let store;
let recordAudit;
let safeFetch;
let logger;

const boot = ({ on, key = on ? KEY : null }) => {
    if (on) process.env.SECRETS_STORE = 'true'; else delete process.env.SECRETS_STORE;
    if (key === null) delete process.env.SECRETS_KEY; else process.env.SECRETS_KEY = key;
    process.env.JWT_SECRET = LEGACY_SEAL_KEY;
    jest.resetModules();
    store = require('../Config/secrets');
    logger = require('../Config/loggerConfig');
    integrations = require('../Modules/Integrations/controller');
    webhooks = require('../Modules/Webhooks/controller');
    dispatcher = require('../Modules/Webhooks/dispatcher');
    ({ recordAudit } = require('../Modules/Audit/recorder'));
    ({ safeFetch } = require('../Modules/Agents/engine/safeFetch'));
};

const response = () => {
    const res = { code: 200, body: null };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    return res;
};
const call = async (handler, uid, { body = {}, params = {}, headers = {} } = {}) => {
    const res = response();
    await handler({ headers: { companyid: COMPANY, ...headers }, uid, body, params, query: {}, ip: '10.0.0.1' }, res);
    return res;
};

const rowsOf = (type) => mockDb.store[type] || [];
const secretCalls = () => mockDb.calls.filter((c) => c.type === SECRETS);
const audits = () => recordAudit.mock.calls.map(([companyId, entry]) => ({ companyId, ...entry }));
const everything = () => JSON.stringify({ store: mockDb.store, calls: mockDb.calls, audits: recordAudit.mock.calls });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
});

afterAll(() => {
    delete process.env.SECRETS_STORE;
    delete process.env.SECRETS_KEY;
});

const slack = (token) => call(integrations.slackCommand, undefined, { params: { companyId: COMPANY }, body: { token, text: 'help' } });
const connectSlack = (token) => call(integrations.connect, OWNER, { body: { type: 'slack', config: { verification_token: token } } });
const liveSecrets = () => rowsOf(SECRETS).filter((r) => !r.revokedAt);

describe('with the flag off', () => {
    beforeEach(() => boot({ on: false }));

    it('seals an integration secret into the document as before and never touches the store', async () => {
        const res = await call(integrations.connect, OWNER, { body: { type: 'github', config: { token: GITHUB_TOKEN, repo: 'acme/app' } } });
        expect(res.body.status).toBe(true);
        const [row] = rowsOf(CONNECTIONS);
        expect(secretField.isEncrypted(row.config.token)).toBe(true);
        expect(secretField.decrypt(row.config.token)).toBe(GITHUB_TOKEN);
        expect(row.secretHandles).toBeUndefined();
        expect(res.body.data.secrets).toEqual({ token: true });
        expect(secretCalls()).toEqual([]);
        expect(rowsOf(SECRETS)).toEqual([]);
    });

    it('keeps the webhook secret on the document and signs with it', async () => {
        const res = await call(webhooks.createWebhook, OWNER, { body: { name: 'Team Slack', url: 'https://hooks.example.com/a', events: ['*'] } });
        expect(res.body.status).toBe(true);
        expect(res.body.data.secret).toMatch(/^[a-f0-9]{48}$/);
        const [hook] = rowsOf(WEBHOOKS);
        expect(hook.secret).toBe(res.body.data.secret);
        expect(hook.secretHandle).toBeUndefined();
        await dispatcher.deliverToHook(COMPANY, hook, { event: 'task.created', data: {} }, 1);
        const sent = safeFetch.mock.calls[0][1];
        expect(sent.headers['X-AlianHub-Signature']).toBe(signPayload(hook.secret, sent.data));
        expect(secretCalls()).toEqual([]);
    });
});

describe('with the flag on', () => {
    beforeEach(() => boot({ on: true }));

    it('moves a new integration secret to the store and keeps only the handle on the document', async () => {
        const res = await call(integrations.connect, OWNER, { body: { type: 'github', config: { token: GITHUB_TOKEN, repo: 'acme/app' } } });
        expect(res.body.status).toBe(true);
        const [row] = rowsOf(CONNECTIONS);
        expect(row.config).toEqual({ repo: 'acme/app' });
        expect(row.secretHandles.token).toMatch(/^sec_[a-f0-9]{24}$/);
        expect(rowsOf(SECRETS)).toHaveLength(1);
        expect(rowsOf(SECRETS)[0]).toMatchObject({ handle: row.secretHandles.token, name: 'GitHub: Personal access token', kind: 'integration', createdBy: OWNER });
        expect(res.body.data.secrets).toEqual({ token: true });
        expect(res.body.data.config).toEqual({ repo: 'acme/app' });
        expect(everything()).not.toContain(GITHUB_TOKEN);
        expect(await store.resolve({ companyId: COMPANY, handle: row.secretHandles.token })).toBe(GITHUB_TOKEN);
        expect(audits().map((a) => a.action)).toEqual(['secret.create']);
    });

    it('rotates the same handle when a connection is set up again, and revokes it on disconnect', async () => {
        await call(integrations.connect, OWNER, { body: { type: 'github', config: { token: GITHUB_TOKEN, repo: 'acme/app' } } });
        const handle = rowsOf(CONNECTIONS)[0].secretHandles.token;
        const again = await call(integrations.connect, OWNER, { body: { type: 'github', config: { token: NEW_GITHUB_TOKEN, repo: 'acme/other' } } });
        expect(again.body.statusText).toBe('Updated.');
        expect(rowsOf(CONNECTIONS)).toHaveLength(1);
        expect(rowsOf(CONNECTIONS)[0].secretHandles.token).toBe(handle);
        expect(rowsOf(CONNECTIONS)[0].config).toEqual({ repo: 'acme/other' });
        expect(rowsOf(SECRETS)).toHaveLength(1);
        expect(await store.resolve({ companyId: COMPANY, handle })).toBe(NEW_GITHUB_TOKEN);

        const gone = await call(integrations.disconnect, OWNER, { params: { id: rowsOf(CONNECTIONS)[0]._id } });
        expect(gone.body.status).toBe(true);
        expect(rowsOf(SECRETS)[0].revokedAt).toBeInstanceOf(Date);
        expect(audits().map((a) => a.action)).toEqual(['secret.create', 'secret.rotate', 'secret.revoke']);
    });

    it('resolves the Slack verification token through its handle and still through a legacy sealed field', async () => {
        await call(integrations.connect, OWNER, { body: { type: 'slack', config: { verification_token: SLACK_TOKEN } } });
        const byHandle = await call(integrations.slackCommand, undefined, { params: { companyId: COMPANY }, body: { token: SLACK_TOKEN, text: 'help' } });
        expect(byHandle.code).toBe(200);
        expect(byHandle.body.text).toMatch(/alianhub/i);
        const wrong = await call(integrations.slackCommand, undefined, { params: { companyId: COMPANY }, body: { token: 'nope', text: 'help' } });
        expect(wrong.code).toBe(401);

        mockDb.store[CONNECTIONS].length = 0;
        mockDb.seed(CONNECTIONS, { type: 'slack', name: 'Slack', config: { verification_token: secretField.encrypt(SLACK_TOKEN) }, secretsVersion: 1, enabled: true, deletedStatusKey: 0 });
        const legacy = await call(integrations.slackCommand, undefined, { params: { companyId: COMPANY }, body: { token: SLACK_TOKEN, text: 'help' } });
        expect(legacy.code).toBe(200);
        expect(legacy.body.text).toMatch(/alianhub/i);
    });

    it('treats a revoked integration secret as not configured', async () => {
        await call(integrations.connect, OWNER, { body: { type: 'slack', config: { verification_token: SLACK_TOKEN } } });
        await store.revoke({ companyId: COMPANY, handle: rowsOf(CONNECTIONS)[0].secretHandles.verification_token, actor: { id: OWNER } });
        const res = await call(integrations.slackCommand, undefined, { params: { companyId: COMPANY }, body: { token: SLACK_TOKEN, text: 'help' } });
        expect(res.code).toBe(200);
        expect(res.body.text).toMatch(/isn’t connected/);
    });

    it('stores a new webhook signing secret by handle, returns it once, signs through the handle and revokes it on delete', async () => {
        const res = await call(webhooks.createWebhook, OWNER, { body: { name: 'Team Slack', url: 'https://hooks.example.com/a', events: ['*'] } });
        expect(res.body.status).toBe(true);
        const secret = res.body.data.secret;
        expect(secret).toMatch(/^[a-f0-9]{48}$/);
        const [hook] = rowsOf(WEBHOOKS);
        expect(hook.secret).toBeUndefined();
        expect(hook.secretHandle).toMatch(/^sec_[a-f0-9]{24}$/);
        expect(rowsOf(SECRETS)[0]).toMatchObject({ handle: hook.secretHandle, name: 'Webhook: Team Slack', kind: 'webhook' });
        expect(JSON.stringify(mockDb.store)).not.toContain(secret);

        const listed = await call(webhooks.listWebhooks, OWNER);
        expect(JSON.stringify(listed.body)).not.toContain(secret);
        expect(JSON.stringify(listed.body)).not.toContain(hook.secretHandle);

        await dispatcher.deliverToHook(COMPANY, hook, { event: 'task.created', data: {} }, 1);
        const sent = safeFetch.mock.calls[0][1];
        expect(sent.headers['X-AlianHub-Signature']).toBe(signPayload(secret, sent.data));

        const removed = await call(webhooks.deleteWebhook, OWNER, { params: { id: hook._id } });
        expect(removed.body.status).toBe(true);
        expect(rowsOf(SECRETS)[0].revokedAt).toBeInstanceOf(Date);
    });

    it('does not deliver, and logs why, when the signing secret no longer resolves', async () => {
        await call(webhooks.createWebhook, OWNER, { body: { name: 'Team Slack', url: 'https://hooks.example.com/a', events: ['*'] } });
        const [hook] = rowsOf(WEBHOOKS);
        await store.revoke({ companyId: COMPANY, handle: hook.secretHandle, actor: { id: OWNER } });
        await dispatcher.deliverToHook(COMPANY, hook, { event: 'task.created', data: {} }, 1);
        expect(safeFetch).not.toHaveBeenCalled();
        expect(rowsOf(SCHEMA_TYPE.WEBHOOK_LOGS)[0]).toMatchObject({ success: false, error: expect.stringMatching(/signing secret/i) });
    });

    it('still signs a legacy webhook that carries its secret on the document', async () => {
        const hook = mockDb.seed(WEBHOOKS, { name: 'Old', url: 'https://hooks.example.com/a', events: ['*'], secret: 'legacy-secret', active: true, createdBy: OWNER });
        await dispatcher.deliverToHook(COMPANY, hook, { event: 'task.created', data: {} }, 1);
        const sent = safeFetch.mock.calls[0][1];
        expect(sent.headers['X-AlianHub-Signature']).toBe(signPayload('legacy-secret', sent.data));
        expect(secretCalls()).toEqual([]);
    });
});

describe('rolling back: the flag goes off after secrets were stored by handle', () => {
    it('lets a secret saved after the rollback win over the stale handle, and revokes the store copy while the key is set', async () => {
        boot({ on: true });
        await connectSlack(SLACK_TOKEN);
        const stale = rowsOf(CONNECTIONS)[0].secretHandles.verification_token;

        boot({ on: false, key: KEY });
        expect((await connectSlack(NEW_SLACK_TOKEN)).body.status).toBe(true);
        const [row] = rowsOf(CONNECTIONS);
        expect(row.secretHandles).toBeUndefined();
        expect(secretField.decrypt(row.config.verification_token)).toBe(NEW_SLACK_TOKEN);
        expect((await slack(NEW_SLACK_TOKEN)).code).toBe(200);
        expect((await slack(SLACK_TOKEN)).code).toBe(401);
        expect(rowsOf(SECRETS).find((r) => r.handle === stale).revokedAt).toBeInstanceOf(Date);
        expect(liveSecrets()).toEqual([]);
    });

    it('does the same with no key left, and marks the store copy as orphaned for a later sweep', async () => {
        boot({ on: true });
        await connectSlack(SLACK_TOKEN);
        const stale = rowsOf(CONNECTIONS)[0].secretHandles.verification_token;

        boot({ on: false });
        expect((await connectSlack(NEW_SLACK_TOKEN)).body.status).toBe(true);
        expect(rowsOf(CONNECTIONS)[0].secretHandles).toBeUndefined();
        expect((await slack(NEW_SLACK_TOKEN)).code).toBe(200);
        expect((await slack(NEW_SLACK_TOKEN)).body.text).toMatch(/alianhub/i);
        expect((await slack(SLACK_TOKEN)).code).toBe(401);
        const copy = rowsOf(SECRETS).find((r) => r.handle === stale);
        expect(copy.revokedAt).toBeNull();
        expect(copy.orphanedAt).toBeInstanceOf(Date);
    });

    it('goes back to a handle, with no sealed copy left on the document, when the flag returns', async () => {
        boot({ on: true });
        await connectSlack(SLACK_TOKEN);
        boot({ on: false });
        await connectSlack(NEW_SLACK_TOKEN);
        boot({ on: true });
        const third = crypto.randomBytes(12).toString('hex');
        expect((await connectSlack(third)).body.status).toBe(true);
        const [row] = rowsOf(CONNECTIONS);
        expect(row.config).toEqual({});
        expect(row.secretHandles.verification_token).toMatch(/^sec_[a-f0-9]{24}$/);
        expect((await slack(third)).code).toBe(200);
        expect((await slack(NEW_SLACK_TOKEN)).code).toBe(401);
        expect(JSON.stringify(rowsOf(CONNECTIONS))).not.toContain(third);
    });

    it('revokes on disconnect and on webhook delete with the flag off while the key is set', async () => {
        boot({ on: true });
        await connectSlack(SLACK_TOKEN);
        await call(webhooks.createWebhook, OWNER, { body: { name: 'Team Slack', url: 'https://hooks.example.com/a', events: ['*'] } });
        expect(liveSecrets()).toHaveLength(2);

        boot({ on: false, key: KEY });
        expect((await call(integrations.disconnect, OWNER, { params: { id: rowsOf(CONNECTIONS)[0]._id } })).body.status).toBe(true);
        expect((await call(webhooks.deleteWebhook, OWNER, { params: { id: rowsOf(WEBHOOKS)[0]._id } })).body.status).toBe(true);
        expect(liveSecrets()).toEqual([]);
        expect(audits().filter((a) => a.action === 'secret.revoke')).toHaveLength(2);
    });

    it('marks both as orphaned on disconnect and webhook delete when no key is left', async () => {
        boot({ on: true });
        await connectSlack(SLACK_TOKEN);
        await call(webhooks.createWebhook, OWNER, { body: { name: 'Team Slack', url: 'https://hooks.example.com/a', events: ['*'] } });

        boot({ on: false });
        await call(integrations.disconnect, OWNER, { params: { id: rowsOf(CONNECTIONS)[0]._id } });
        await call(webhooks.deleteWebhook, OWNER, { params: { id: rowsOf(WEBHOOKS)[0]._id } });
        expect(rowsOf(SECRETS).map((r) => [r.revokedAt, r.orphanedAt instanceof Date])).toEqual([[null, true], [null, true]]);

        boot({ on: true });
        expect(await store.revokeOrphans({ companyId: COMPANY, actor: { id: OWNER } })).toBe(2);
        expect(liveSecrets()).toEqual([]);
    });
});

describe('a document that holds both a handle and a sealed copy', () => {
    beforeEach(() => boot({ on: true }));

    it('reads an integration secret as not configured and logs it, rather than guessing which is current', async () => {
        await connectSlack(SLACK_TOKEN);
        rowsOf(CONNECTIONS)[0].config.verification_token = secretField.encrypt(NEW_SLACK_TOKEN);
        for (const token of [SLACK_TOKEN, NEW_SLACK_TOKEN]) {
            // eslint-disable-next-line no-await-in-loop
            const res = await slack(token);
            expect(res.code).toBe(200);
            expect(res.body.text).toMatch(/isn’t connected/);
        }
        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/both a handle and a sealed value.*verification_token/));
        expect(JSON.stringify(logger.error.mock.calls)).not.toContain(SLACK_TOKEN);
        expect(JSON.stringify(logger.error.mock.calls)).not.toContain(NEW_SLACK_TOKEN);
    });

    it('does not sign a webhook that carries both, and logs why', async () => {
        await call(webhooks.createWebhook, OWNER, { body: { name: 'Team Slack', url: 'https://hooks.example.com/a', events: ['*'] } });
        const [hook] = rowsOf(WEBHOOKS);
        hook.secret = crypto.randomBytes(24).toString('hex');
        await dispatcher.deliverToHook(COMPANY, hook, { event: 'task.created', data: {} }, 1);
        expect(safeFetch).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/both a handle and a secret/));
        expect(JSON.stringify(logger.error.mock.calls)).not.toContain(hook.secret);
    });
});

describe('with the flag on and a missing or short key', () => {
    it.each([['missing', null], ['short', 'too-short']])('refuses to connect, reconnect or create a webhook, and writes nothing (%s key)', async (label, key) => {
        boot({ on: false });
        await connectSlack(SLACK_TOKEN);
        const before = JSON.stringify(mockDb.store);

        boot({ on: true, key });
        const reconnect = await connectSlack(NEW_SLACK_TOKEN);
        expect(reconnect.code).toBe(503);
        expect(reconnect.body).toMatchObject({ status: false, statusText: expect.stringMatching(/SECRETS_KEY/) });
        const fresh = await call(integrations.connect, OWNER, { body: { type: 'github', config: { token: GITHUB_TOKEN, repo: 'acme/app' } } });
        expect(fresh.code).toBe(503);
        expect(fresh.body.status).toBe(false);
        const hook = await call(webhooks.createWebhook, OWNER, { body: { name: 'Team Slack', url: 'https://hooks.example.com/a', events: ['*'] } });
        expect(hook.body).toMatchObject({ status: false, statusCode: 503, statusText: expect.stringMatching(/SECRETS_KEY/) });
        expect(hook.body.data).toBeUndefined();

        expect(JSON.stringify(mockDb.store)).toBe(before);
        expect(everything()).not.toContain(NEW_SLACK_TOKEN);
        expect(everything()).not.toContain(GITHUB_TOKEN);
    });
});

describe('a webhook whose signing secret no longer resolves', () => {
    beforeEach(() => boot({ on: true }));

    it('is marked as needing attention, audited once however many events fire, and cleared by a signed delivery', async () => {
        await call(webhooks.createWebhook, OWNER, { body: { name: 'Team Slack', url: 'https://hooks.example.com/a', events: ['*'] } });
        const stored = () => rowsOf(WEBHOOKS)[0];
        const handle = stored().secretHandle;
        const sealed = { ...rowsOf(SECRETS)[0] };
        rowsOf(SECRETS)[0].keyId = 'k0000000000000000';

        for (let i = 0; i < 4; i += 1) await dispatcher.deliverToHook(COMPANY, { ...stored() }, { event: 'task.updated', data: {} }, 1);
        expect(safeFetch).not.toHaveBeenCalled();
        expect(rowsOf(SCHEMA_TYPE.WEBHOOK_LOGS)).toHaveLength(4);
        expect(audits().filter((a) => a.action === 'secret.resolve_failed')).toEqual([expect.objectContaining({ entityId: handle, meta: { reason: 'unknown_key' } })]);
        expect(stored().needsAttention).toBe('signing_secret_unavailable');
        const listed = await call(webhooks.listWebhooks, OWNER);
        expect(listed.body.data[0].needsAttention).toBe('signing_secret_unavailable');

        rowsOf(SECRETS)[0].keyId = sealed.keyId;
        await dispatcher.deliverToHook(COMPANY, { ...stored() }, { event: 'task.updated', data: {} }, 1);
        expect(safeFetch).toHaveBeenCalledTimes(1);
        expect(stored().needsAttention).toBeUndefined();
    });
});
