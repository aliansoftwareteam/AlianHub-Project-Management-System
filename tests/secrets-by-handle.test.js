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
const KEY = 'current-secrets-key-0123456789abcdef0123456789';
const GITHUB_TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB';
const SLACK_TOKEN = 'Q2hvb3NlQVZlcmlmaWNhdGlv';
const CONNECTIONS = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
const WEBHOOKS = SCHEMA_TYPE.WEBHOOKS;
const SECRETS = SCHEMA_TYPE.SECRETS;

let integrations;
let webhooks;
let dispatcher;
let store;
let recordAudit;
let safeFetch;

const boot = ({ on }) => {
    if (on) { process.env.SECRETS_STORE = 'true'; process.env.SECRETS_KEY = KEY; } else { delete process.env.SECRETS_STORE; delete process.env.SECRETS_KEY; }
    process.env.JWT_SECRET = 'jwt-secret-for-the-legacy-seal';
    jest.resetModules();
    store = require('../Config/secrets');
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
        const again = await call(integrations.connect, OWNER, { body: { type: 'github', config: { token: 'ghp_ReplacementTokenValue0123456789abcdefgh', repo: 'acme/other' } } });
        expect(again.body.statusText).toBe('Updated.');
        expect(rowsOf(CONNECTIONS)).toHaveLength(1);
        expect(rowsOf(CONNECTIONS)[0].secretHandles.token).toBe(handle);
        expect(rowsOf(CONNECTIONS)[0].config).toEqual({ repo: 'acme/other' });
        expect(rowsOf(SECRETS)).toHaveLength(1);
        expect(await store.resolve({ companyId: COMPANY, handle })).toBe('ghp_ReplacementTokenValue0123456789abcdefgh');

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
