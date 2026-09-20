const crypto = require('crypto');
const { create } = require('./fixtures/fakeMongo');

/* Sprint 8 slice 9b: per-workspace provider keys through the secrets store.
 * A workspace key wins for that workspace; the instance key answers otherwise.
 * A set key that will not open refuses rather than billing the instance owner. */
const mockDbs = {};
const mockDbFor = (companyId) => (mockDbs[companyId] = mockDbs[companyId] || create());
const mockCrud = (companyId, query, method) => mockDbFor(String(companyId)).crud(companyId, query, method);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({
    AI_API_KEY: 'sk-instance-openai-key',
    AI_MODEL: 'gpt-4o',
    DEEPSEEK_API_KEY: 'sk-instance-deepseek-key',
    DEEPSEEK_MODEL: 'deepseek-chat',
    myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 },
}));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('axios', () => ({ post: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const axios = require('axios');
const store = require('../Config/secrets');
const providerContext = require('../Modules/AICore/providerContext');
const keys = require('../Modules/AICore/providerKeys');
const openaiProvider = require('../Modules/AICore/llmProvider/openaiProvider');

const COMPANY = '6f0000000000000000000c01';
const OTHER = '6f0000000000000000000c02';
const KEY = crypto.randomBytes(24).toString('hex');
const WORKSPACE_VALUE = `sk-ws-${crypto.randomBytes(20).toString('hex')}`;
const OTHER_VALUE = `sk-other-${crypto.randomBytes(20).toString('hex')}`;
const actor = { id: '6f0000000000000000000a01', name: 'Olivia Owner' };

const ENV_KEYS = ['TENANT_PROVIDER_KEYS', 'SECRETS_STORE', 'SECRETS_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'GOOGLE_API_KEY', 'GOOGLE_MODEL'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const boot = ({ tenant = true, storeOn = true } = {}) => {
    if (tenant) process.env.TENANT_PROVIDER_KEYS = 'on';
    else delete process.env.TENANT_PROVIDER_KEYS;
    if (storeOn) { process.env.SECRETS_STORE = 'true'; process.env.SECRETS_KEY = KEY; }
    else { delete process.env.SECRETS_STORE; delete process.env.SECRETS_KEY; }
    process.env.ANTHROPIC_API_KEY = 'sk-ant-instance-key';
    process.env.ANTHROPIC_MODEL = 'claude-test';
    process.env.GOOGLE_API_KEY = 'google-instance-key';
    process.env.GOOGLE_MODEL = 'gemini-test';
};

const seedMapping = (companyId, mapping) => {
    const db = mockDbFor(dbCollections.GLOBAL);
    const rows = db.store[dbCollections.COMPANIES] || [];
    const row = rows.find((c) => String(c._id) === companyId);
    if (row) row.aiProviderKeys = mapping;
    else db.seed(dbCollections.COMPANIES, { _id: companyId, aiProviderKeys: mapping });
};
const mappingReads = () => mockDbFor(dbCollections.GLOBAL).calls.filter((c) => c.type === dbCollections.COMPANIES);
const secretReads = (companyId = COMPANY) => mockDbFor(companyId).calls.filter((c) => c.type === SCHEMA_TYPE.SECRETS);
const inCompany = (companyId, fn) => providerContext.run({ companyId }, fn);

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    boot();
    seedMapping(COMPANY, {});
    seedMapping(OTHER, {});
});

afterAll(() => {
    ENV_KEYS.forEach((key) => {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    });
});

describe('apiKeyFor', () => {
    it.each([
        ['openai', 'sk-instance-openai-key'],
        ['anthropic', 'sk-ant-instance-key'],
        ['deepseek', 'sk-instance-deepseek-key'],
        ['google', 'google-instance-key'],
    ])('answers the instance %s key with the flag off and touches no mapping', async (provider, instanceKey) => {
        boot({ tenant: false });
        const made = await store.create({ companyId: COMPANY, name: 'OpenAI API key', kind: 'provider', value: WORKSPACE_VALUE, actor });
        seedMapping(COMPANY, { openai: made.handle });
        mockDbFor(COMPANY).calls.length = 0;
        mockDbFor(dbCollections.GLOBAL).calls.length = 0;
        const key = await inCompany(COMPANY, () => keys.apiKeyFor(provider));
        expect(key).toBe(instanceKey);
        expect(mappingReads()).toEqual([]);
        expect(secretReads()).toEqual([]);
    });

    it('answers the instance key with no workspace in context', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'OpenAI API key', kind: 'provider', value: WORKSPACE_VALUE, actor });
        seedMapping(COMPANY, { openai: made.handle });
        expect(await keys.apiKeyFor('openai')).toBe('sk-instance-openai-key');
        expect(mappingReads()).toEqual([]);
    });

    it('prefers the workspace key once one is set', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'OpenAI API key', kind: 'provider', value: WORKSPACE_VALUE, actor });
        seedMapping(COMPANY, { openai: made.handle });
        const key = await inCompany(COMPANY, () => keys.apiKeyFor('openai'));
        expect(key).toBe(WORKSPACE_VALUE);
    });

    it('lets an explicit company win over the ambient context', async () => {
        const mine = await store.create({ companyId: COMPANY, name: 'OpenAI API key', kind: 'provider', value: WORKSPACE_VALUE, actor });
        const theirs = await store.create({ companyId: OTHER, name: 'OpenAI API key', kind: 'provider', value: OTHER_VALUE, actor });
        seedMapping(COMPANY, { openai: mine.handle });
        seedMapping(OTHER, { openai: theirs.handle });
        const key = await inCompany(COMPANY, () => keys.apiKeyFor('openai', OTHER));
        expect(key).toBe(OTHER_VALUE);
    });

    it('falls back to the instance key for providers with no workspace key', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'OpenAI API key', kind: 'provider', value: WORKSPACE_VALUE, actor });
        seedMapping(COMPANY, { openai: made.handle });
        const key = await inCompany(COMPANY, () => keys.apiKeyFor('anthropic'));
        expect(key).toBe('sk-ant-instance-key');
    });

    it('refuses when a set key will not open instead of billing the instance key', async () => {
        const made = await store.create({ companyId: COMPANY, name: 'OpenAI API key', kind: 'provider', value: WORKSPACE_VALUE, actor });
        await store.revoke({ companyId: COMPANY, handle: made.handle, actor });
        seedMapping(COMPANY, { openai: made.handle });
        const error = await inCompany(COMPANY, () => keys.apiKeyFor('openai')).catch((e) => e);
        expect(error.code).toBe('revoked');
        expect(error.message).toContain('will not open');
        expect(JSON.stringify(error)).not.toContain(WORKSPACE_VALUE);
    });

    it('refuses a handle copied from another workspace', async () => {
        const theirs = await store.create({ companyId: OTHER, name: 'OpenAI API key', kind: 'provider', value: OTHER_VALUE, actor });
        seedMapping(COMPANY, { openai: theirs.handle });
        await expect(inCompany(COMPANY, () => keys.apiKeyFor('openai'))).rejects.toThrow('will not open');
    });

    it('answers null for an unknown provider', async () => {
        expect(await inCompany(COMPANY, () => keys.apiKeyFor('nope'))).toBeNull();
    });
});

describe('management', () => {
    it('sets a key by handle and reports metadata without the value', async () => {
        const saved = await keys.setKey({ companyId: COMPANY, provider: 'OpenAI', value: WORKSPACE_VALUE, actor });
        expect(saved).toMatchObject({ provider: 'openai', set: true, keyId: expect.any(String) });
        expect(JSON.stringify(saved)).not.toContain(WORKSPACE_VALUE);
        expect(await inCompany(COMPANY, () => keys.apiKeyFor('openai'))).toBe(WORKSPACE_VALUE);
    });

    it('rotates onto the same handle when the key is set again', async () => {
        await keys.setKey({ companyId: COMPANY, provider: 'openai', value: WORKSPACE_VALUE, actor });
        const rotated = `sk-ws-${crypto.randomBytes(20).toString('hex')}`;
        await keys.setKey({ companyId: COMPANY, provider: 'openai', value: rotated, actor });
        expect(await inCompany(COMPANY, () => keys.apiKeyFor('openai'))).toBe(rotated);
        const rows = mockDbFor(COMPANY).store[SCHEMA_TYPE.SECRETS] || [];
        expect(rows).toHaveLength(1);
        expect(rows[0].rotatedAt).toBeTruthy();
    });

    it('clears a key by revoking its secret and dropping the mapping', async () => {
        await keys.setKey({ companyId: COMPANY, provider: 'openai', value: WORKSPACE_VALUE, actor });
        expect(await keys.clearKey({ companyId: COMPANY, provider: 'openai', actor })).toEqual({ provider: 'openai', set: false });
        expect(await inCompany(COMPANY, () => keys.apiKeyFor('openai'))).toBe('sk-instance-openai-key');
        const rows = mockDbFor(COMPANY).store[SCHEMA_TYPE.SECRETS] || [];
        expect(rows[0].revokedAt).toBeTruthy();
        expect(rows[0].ciphertext).toBe('');
    });

    it('clearing an unset provider is a quiet no-op', async () => {
        expect(await keys.clearKey({ companyId: COMPANY, provider: 'openai', actor })).toEqual({ provider: 'openai', set: false });
    });

    it('lists every provider with metadata only and marks a dead handle stale', async () => {
        await keys.setKey({ companyId: COMPANY, provider: 'openai', value: WORKSPACE_VALUE, actor });
        const made = await store.create({ companyId: COMPANY, name: 'Anthropic API key', kind: 'provider', value: OTHER_VALUE, actor });
        const stored = mockDbFor(dbCollections.GLOBAL).store[dbCollections.COMPANIES].find((c) => String(c._id) === COMPANY);
        seedMapping(COMPANY, { openai: stored.aiProviderKeys.openai, anthropic: made.handle });
        await store.revoke({ companyId: COMPANY, handle: made.handle, actor });
        const listed = await keys.listKeys({ companyId: COMPANY });
        expect(listed.map((row) => row.provider).sort()).toEqual(['anthropic', 'deepseek', 'google', 'openai']);
        expect(JSON.stringify(listed)).not.toContain(WORKSPACE_VALUE);
        expect(JSON.stringify(listed)).not.toContain(OTHER_VALUE);
        expect(listed.find((row) => row.provider === 'openai')).toMatchObject({ set: true });
        expect(listed.find((row) => row.provider === 'anthropic')).toMatchObject({ set: false, stale: true });
        expect(listed.find((row) => row.provider === 'google')).toEqual({ provider: 'google', set: false });
    });

    it('refuses unknown providers and malformed workspaces', async () => {
        await expect(keys.setKey({ companyId: COMPANY, provider: 'nope', value: WORKSPACE_VALUE, actor })).rejects.toThrow('Unknown provider');
        await expect(keys.setKey({ companyId: 'xyz', provider: 'openai', value: WORKSPACE_VALUE, actor })).rejects.toThrow('workspace id');
        await expect(keys.clearKey({ companyId: COMPANY, provider: 'nope', actor })).rejects.toThrow('Unknown provider');
        await expect(keys.listKeys({ companyId: 'xyz' })).rejects.toThrow('workspace id');
    });

    it('refuses writes while the store is off', async () => {
        boot({ storeOn: false });
        await expect(keys.setKey({ companyId: COMPANY, provider: 'openai', value: WORKSPACE_VALUE, actor })).rejects.toThrow('SECRETS_STORE');
    });
});

describe('the provider sends the resolved key', () => {
    const completion = (content) => ({ data: { choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } } });

    beforeEach(() => {
        axios.post.mockResolvedValue(completion('{"ok":true}'));
    });

    it('bills the workspace key on the wire once one is set', async () => {
        await keys.setKey({ companyId: COMPANY, provider: 'openai', value: WORKSPACE_VALUE, actor });
        await inCompany(COMPANY, () => openaiProvider.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8, spend: { feature: 'ask', companyId: COMPANY } }));
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(axios.post.mock.calls[0][2].headers.Authorization).toBe(`Bearer ${WORKSPACE_VALUE}`);
    });

    it('bills the instance key with no workspace key set', async () => {
        await inCompany(COMPANY, () => openaiProvider.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 }));
        expect(axios.post.mock.calls[0][2].headers.Authorization).toBe('Bearer sk-instance-openai-key');
    });
});

describe('providerContext.middleware', () => {
    it('runs authed requests inside the header tenant and leaves the rest without one', () => {
        const seen = [];
        providerContext.middleware({ headers: { companyid: COMPANY }, uid: 'u1' }, {}, () => seen.push(providerContext.get()));
        providerContext.middleware({ headers: {}, uid: '' }, {}, () => seen.push(providerContext.get()));
        expect(seen).toEqual([{ companyId: COMPANY }, { companyId: null }]);
    });
});
