/* The AI switch: the instance owner can turn AI off for the whole instance (AI_ENABLED), and a
 * workspace owner or admin for their workspace. While it is off no model call leaves the server,
 * which is asserted on a loopback server that counts what reaches it. With no provider at all,
 * the availability read says so instead of a screen failing. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ AI_API_KEY: '', AI_MODEL: '' }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));

const { dbCollections } = require('../Config/collections');
const { startOpenAiCompatibleServer } = require('./support/openAiCompatibleServer');
const llmProvider = require('../Modules/AICore/llmProvider');
const aiSwitch = require('../Modules/AICore/aiSwitch');
const providerContext = require('../Modules/AICore/providerContext');
const { FEATURES } = require('../Modules/AICore/features');
const knowledgeEmbeddings = require('../Modules/Knowledge/embeddings');
const runs = require('../Modules/Agents/runs');
const transcribe = require('../Modules/AI/transcribe');

const OFF = '6f0000000000000000000c31';
const ON = '6f0000000000000000000c32';
const KEYS = ['LLM_PROVIDER', 'OPENAI_BASE_URL', 'OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_MODEL', 'OPENAI_COMPATIBLE_EMBEDDINGS_MODEL', 'AI_ENABLED', 'AI_MODEL_ROUTER'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const chatOf = (companyId) => ({ messages: [{ role: 'user', content: 'secret project plans' }], spend: { feature: FEATURES.ASK, companyId } });
const embedOf = (companyId) => ({ texts: ['secret'], model: 'nomic-embed-text', spend: { feature: FEATURES.KNOWLEDGE_EMBED, companyId } });

let stub;

const configure = () => {
    process.env.LLM_PROVIDER = 'openai_compatible';
    process.env.OPENAI_COMPATIBLE_BASE_URL = stub.baseUrl;
    process.env.OPENAI_COMPATIBLE_MODEL = 'llama3.1:8b';
    process.env.OPENAI_COMPATIBLE_EMBEDDINGS_MODEL = 'nomic-embed-text';
};

const seedCompanies = () => {
    mockDb.store[dbCollections.COMPANIES] = [
        { _id: OFF, Cst_CompanyName: 'Off Co' },
        { _id: ON, Cst_CompanyName: 'On Co' },
    ];
};

beforeAll(async () => { stub = await startOpenAiCompatibleServer(); });
afterAll(async () => {
    await stub.stop();
    KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
});

beforeEach(() => {
    KEYS.forEach((k) => { delete process.env[k]; });
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    seedCompanies();
    stub.reset();
    aiSwitch.forget();
    knowledgeEmbeddings.resetBreaker();
    knowledgeEmbeddings.forgetSizes();
    configure();
});

describe('the instance switch', () => {
    it('is on unless AI_ENABLED is "false"', () => {
        expect(aiSwitch.instanceEnabled()).toBe(true);
        process.env.AI_ENABLED = 'false';
        expect(aiSwitch.instanceEnabled()).toBe(false);
        process.env.AI_ENABLED = 'true';
        expect(aiSwitch.instanceEnabled()).toBe(true);
    });

    it('sends no chat, embedding or transcription request while off', async () => {
        process.env.AI_ENABLED = 'false';
        const chat = await llmProvider.getProvider().chat(chatOf(ON)).catch((e) => e);
        expect(chat.code).toBe(aiSwitch.AI_OFF);
        expect(chat.message).toMatch(/turned off/i);
        const embed = await llmProvider.embeddingProvider().embed(embedOf(ON)).catch((e) => e);
        expect(embed.code).toBe(aiSwitch.AI_OFF);
        expect(stub.requests).toHaveLength(0);
    });

    it('reads as no provider to the features that check before calling', () => {
        expect(llmProvider.isAnyProviderConfigured()).toBe(true);
        process.env.AI_ENABLED = 'false';
        expect(llmProvider.isAnyProviderConfigured()).toBe(false);
        expect(knowledgeEmbeddings.readiness(ON)).toBe('off');
    });
});

describe('the workspace switch', () => {
    it('is on until an owner or admin turns it off, and off stops only that workspace', async () => {
        expect(await aiSwitch.workspaceEnabled(OFF)).toBe(true);
        await aiSwitch.setWorkspaceEnabled(OFF, false, 'u-admin');
        expect(await aiSwitch.workspaceEnabled(OFF)).toBe(false);
        expect(mockDb.store[dbCollections.COMPANIES].find((c) => c._id === OFF).aiSwitch).toMatchObject({ enabled: false, updatedBy: 'u-admin' });

        const refused = await llmProvider.getProvider().chat(chatOf(OFF)).catch((e) => e);
        expect(refused.code).toBe(aiSwitch.AI_OFF);
        const refusedEmbed = await knowledgeEmbeddings.embedTexts(OFF, ['secret']).catch((e) => e);
        expect(refusedEmbed.code).toBe(aiSwitch.AI_OFF);
        expect(stub.requests).toHaveLength(0);

        const answered = await llmProvider.getProvider().chat(chatOf(ON));
        expect(answered.content).toBe('echo: secret project plans');
        expect(stub.requests).toHaveLength(1);
    });

    it('is read from the company row after the cache is gone, so a restart keeps it off', async () => {
        await aiSwitch.setWorkspaceEnabled(OFF, false, 'u1');
        aiSwitch.forget();
        const refused = await llmProvider.getProvider().chat(chatOf(OFF)).catch((e) => e);
        expect(refused.code).toBe(aiSwitch.AI_OFF);
        expect(stub.requests).toHaveLength(0);
    });

    it('reads as no provider inside a request for that workspace', async () => {
        await aiSwitch.setWorkspaceEnabled(OFF, false, 'u1');
        expect(providerContext.run({ companyId: OFF }, () => llmProvider.isAnyProviderConfigured())).toBe(false);
        expect(providerContext.run({ companyId: ON }, () => llmProvider.isAnyProviderConfigured())).toBe(true);
    });

    it('turns back on', async () => {
        await aiSwitch.setWorkspaceEnabled(OFF, false, 'u1');
        await aiSwitch.setWorkspaceEnabled(OFF, true, 'u1');
        const answered = await llmProvider.getProvider().chat(chatOf(OFF));
        expect(answered.content).toMatch(/echo/);
    });
});

describe('background work skips', () => {
    it('refuses to start an agent run while AI is off', async () => {
        const agent = { _id: 'a1', paused: false, account: 'workspace', autonomy: 3 };
        await aiSwitch.setWorkspaceEnabled(OFF, false, 'u1');
        await expect(runs.canStart(agent, { companyId: OFF, trigger: 'schedule' })).resolves.toMatchObject({ ok: false, code: aiSwitch.AI_OFF });
        process.env.AI_ENABLED = 'false';
        await expect(runs.canStart(agent, { companyId: ON, trigger: 'manual' })).resolves.toMatchObject({ ok: false, code: aiSwitch.AI_OFF });
    });

    it('writes knowledge chunks without vectors while AI is off', async () => {
        await aiSwitch.setWorkspaceEnabled(OFF, false, 'u1');
        await expect(knowledgeEmbeddings.planFor(OFF)).resolves.toBeNull();
    });
});

describe('talk to text', () => {
    const call = async (companyId) => {
        const handler = transcribe.transcribe[transcribe.transcribe.length - 1];
        const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
        await handler({ headers: { companyid: companyId }, uid: 'u1', body: {}, file: { buffer: Buffer.from('RIFF'), mimetype: 'audio/webm', originalname: 'a.webm' } }, res);
        return res;
    };

    it('goes to the compatible server when it answers chat, and not at all while AI is off', async () => {
        const on = await call(ON);
        expect(on.body).toMatchObject({ status: true, data: { text: 'hello from audio' } });
        expect(stub.requests.map((r) => r.url)).toEqual(['/v1/audio/transcriptions']);

        stub.reset();
        await aiSwitch.setWorkspaceEnabled(OFF, false, 'u1');
        const off = await call(OFF);
        expect(off.statusCode).toBe(403);
        expect(off.body).toMatchObject({ status: false, code: aiSwitch.AI_OFF });
        expect(stub.requests).toHaveLength(0);
    });
});

describe('availability', () => {
    it('names the state a screen should show', async () => {
        expect(await llmProvider.availability(ON)).toMatchObject({ state: aiSwitch.STATE.ON, provider: 'openai_compatible', embeddings: true });

        await aiSwitch.setWorkspaceEnabled(OFF, false, 'u1');
        expect(await llmProvider.availability(OFF)).toMatchObject({ state: aiSwitch.STATE.OFF_WORKSPACE, workspaceEnabled: false });

        process.env.AI_ENABLED = 'false';
        expect(await llmProvider.availability(ON)).toMatchObject({ state: aiSwitch.STATE.OFF_INSTANCE, instanceEnabled: false });
    });

    it('says unconfigured when no provider is set up, without failing', async () => {
        KEYS.forEach((k) => { delete process.env[k]; });
        expect(await llmProvider.availability(ON)).toMatchObject({ state: aiSwitch.STATE.UNCONFIGURED, provider: null, embeddings: false });
    });
});
