const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent' }));
jest.mock('../Modules/Automations/engine/tools', () => ({ getTask: jest.fn(async () => ({ _id: '6f0000000000000000000701', ProjectID: 'p1', TaskKey: 'AR-1' })) }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Agents/proposals', () => ({ create: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ perform: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(() => { throw new Error('not configured'); }), isAnyProviderConfigured: jest.fn(() => false) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const logger = require('../Config/loggerConfig');
const { getProvider } = require('../Modules/AICore/llmProvider');
const usage = require('../Modules/AICore/usage');
const { byKey, validateSettings } = require('../Modules/Instance/settingsCatalog');
const runs = require('../Modules/Agents/runs');
const budget = require('../Modules/Agents/budget');
const ctrl = require('../Modules/Agents/controller');
const runAgent = require('../Modules/Automations/engine/actions/runAgent');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const TASK_ID = '6f0000000000000000000701';
const MYSTERY = 'gpt-9-mystery';
const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Reviewer', autonomy: 1, allowedActions: [], account: 'workspace', spendCapUsd: 0, paused: false, deletedStatusKey: 0, ...over });
const configure = (model, name = 'openai') => getProvider.mockImplementation(() => ({ name, model, isConfigured: true }));
const response = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    delete process.env.LLM_PRICING;
    getProvider.mockImplementation(() => { throw new Error('not configured'); });
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: 'owner1', roleType: 1 });
});

afterAll(() => { delete process.env.LLM_PRICING; });

describe('priceFor fails closed', () => {
    it('answers "unpriced" for a model it does not know instead of pricing it at zero', () => {
        expect(usage.priceFor(MYSTERY)).toEqual({ priced: false, model: MYSTERY, reason: 'unpriced_model', message: usage.unpricedMessage(MYSTERY) });
        expect(usage.unpricedMessage(MYSTERY)).toBe('No price on file for gpt-9-mystery; add it under instance settings (LLM_PRICING) before running.');
        expect(usage.priceFor('')).toMatchObject({ priced: false, reason: 'unpriced_model' });
        expect(usage.summarize({ inputTokens: 1000, outputTokens: 100 }, MYSTERY)).toMatchObject({ costUsd: null, priced: false, reason: 'unpriced_model', totalTokens: 1100 });
    });

    it('prices a dated snapshot like its base model and prefers the longest prefix', () => {
        expect(usage.priceFor('claude-sonnet-4-6-20260115')).toEqual({ priced: true, model: 'claude-sonnet-4-6-20260115', input: 3, output: 15 });
        expect(usage.priceFor('gpt-5.4-mini-2026-05-01')).toMatchObject({ input: 0.75, output: 4.5 });
        expect(usage.priceFor('GPT-4.1')).toMatchObject({ priced: true, input: 2, output: 8 });
    });

    it('reads LLM_PRICING live, treats an explicit zero as a price and ignores junk loudly', () => {
        process.env.LLM_PRICING = JSON.stringify({ [MYSTERY]: { input: 1, output: 2 }, 'my-local-llama': { input: 0, output: 0 }, broken: { input: 'x' } });
        expect(usage.priceFor(MYSTERY)).toMatchObject({ priced: true, input: 1, output: 2 });
        expect(usage.priceFor('my-local-llama')).toEqual({ priced: true, model: 'my-local-llama', input: 0, output: 0 });
        expect(usage.summarize({ inputTokens: 5000, outputTokens: 5000 }, 'my-local-llama')).toMatchObject({ costUsd: 0, priced: true });
        expect(usage.priceFor('broken').priced).toBe(false);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('"broken"'));
        process.env.LLM_PRICING = 'not json';
        expect(usage.priceFor(MYSTERY).priced).toBe(false);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
    });
});

describe('every configurable vendor ships priced defaults', () => {
    const catalogDefaults = ['AI_MODEL', 'ANTHROPIC_MODEL', 'DEEPSEEK_MODEL'].map((key) => byKey.get(key).default);

    it.each([...catalogDefaults, 'gpt-4.1', 'gpt-4o', 'gpt-5-mini', 'gpt-4o-mini', 'claude-sonnet-4-5-20250929', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-flash'])(
        '%s resolves to a price',
        (model) => {
            const price = usage.priceFor(model);
            expect(price.priced).toBe(true);
            expect(Number.isFinite(price.input) && Number.isFinite(price.output)).toBe(true);
        },
    );

    it('every default entry has finite non-negative input and output prices', () => {
        for (const [model, price] of Object.entries(usage.DEFAULT_PRICING)) {
            expect({ model, ok: Number.isFinite(price.input) && Number.isFinite(price.output) && price.input >= 0 && price.output >= 0 }).toEqual({ model, ok: true });
        }
        expect(Object.keys(usage.DEFAULT_PRICING).some((m) => m.startsWith('gpt-'))).toBe(true);
        expect(Object.keys(usage.DEFAULT_PRICING).some((m) => m.startsWith('claude-'))).toBe(true);
        expect(Object.keys(usage.DEFAULT_PRICING).some((m) => m.startsWith('deepseek-'))).toBe(true);
    });

    it('each provider adapter exposes the model id it will send', () => {
        jest.isolateModules(() => {
            process.env.AI_MODEL = 'gpt-4.1'; process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929'; process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
            expect(require('../Modules/AICore/llmProvider/openaiProvider').model).toBe('gpt-4.1');
            expect(require('../Modules/AICore/llmProvider/anthropicProvider').model).toBe('claude-sonnet-4-5-20250929');
            expect(require('../Modules/AICore/llmProvider/deepseekProvider').model).toBe('deepseek-v4-flash');
        });
        delete process.env.AI_MODEL; delete process.env.ANTHROPIC_MODEL; delete process.env.DEEPSEEK_MODEL;
    });
});

describe('a run on an unpriced model is refused before it starts', () => {
    it('canStart names the model and the missing price, for workspace and personal accounts alike', async () => {
        configure(MYSTERY);
        const refused = { ok: false, reason: usage.unpricedMessage(MYSTERY), code: 'unpriced_model', model: MYSTERY };
        expect(await runs.canStart(agent(), { companyId: C })).toEqual(refused);
        expect(await runs.canStart(agent({ account: 'personal' }), { companyId: C })).toEqual(refused);
        expect(await runs.canStart(agent(), { companyId: C, viaAccount: 'local' })).toEqual({ ok: true, reason: '' });
        configure('gpt-4.1');
        expect(await runs.canStart(agent(), { companyId: C })).toEqual({ ok: true, reason: '' });
        expect(usage.checkConfiguredModelPriced()).toEqual({ ok: true, reason: '', model: 'gpt-4.1' });
    });

    it('does not stand in for a missing provider — that fails on its own', async () => {
        expect(usage.checkConfiguredModelPriced()).toEqual({ ok: true, reason: '', model: null });
        expect(await runs.canStart(agent(), { companyId: C })).toEqual({ ok: true, reason: '' });
    });

    it('POST /agents/runs answers { status: false, message } with 409 and creates no run', async () => {
        configure(MYSTERY);
        const r = response();
        await ctrl.startRun({ headers: { companyid: C }, body: { agentId: AGENT_ID, taskId: TASK_ID }, query: {}, uid: 'owner1' }, r);
        expect(r.code).toBe(409);
        expect(r.body).toEqual({ status: false, statusText: usage.unpricedMessage(MYSTERY), message: usage.unpricedMessage(MYSTERY) });
        expect(mockDb.store[SCHEMA_TYPE.AGENT_RUNS] || []).toHaveLength(0);
    });

    it('a rule-triggered run is refused the same way', async () => {
        configure(MYSTERY);
        const args = { companyId: C, entity: { kind: 'task', id: TASK_ID }, config: { agent: 'Reviewer', skill: 'qa-review' }, context: { ruleId: '6f0000000000000000000b01', task: { _id: TASK_ID, ProjectID: 'p1' } } };
        await expect(runAgent.run(args)).rejects.toThrow(`Reviewer cannot run: ${usage.unpricedMessage(MYSTERY)}`);
        expect(mockDb.store[SCHEMA_TYPE.AGENT_RUNS] || []).toHaveLength(0);
    });

    it('the instance console learns the configured model and whether it is priced', () => {
        configure(MYSTERY);
        expect(budget.provider()).toMatchObject({ name: 'openai', model: MYSTERY, priced: false });
        configure('claude-sonnet-4-5-20250929', 'anthropic');
        expect(budget.provider()).toMatchObject({ name: 'anthropic', model: 'claude-sonnet-4-5-20250929', priced: true });
    });
});

describe('recordSpend never books tokens as $0 on an unpriced model', () => {
    const start = (over = {}) => runs.create(C, { agent: agent(over), taskId: TASK_ID, projectId: 'p1', skill: 'qa-review', ...over });

    it('throws, logs and leaves the run untouched', async () => {
        const run = await start();
        await expect(runs.recordSpend(C, run, { inputTokens: 900, outputTokens: 100 }, MYSTERY)).rejects.toMatchObject({ code: 'unpriced_model', message: expect.stringContaining(`1000 tokens as $0: ${usage.unpricedMessage(MYSTERY)}`) });
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('refusing to book 1000 tokens as $0'));
        expect(mockDb.store[SCHEMA_TYPE.AGENT_RUNS][0].spend).toEqual({ tokens: 0, usd: 0, model: null, billedToWorkspace: true });
        expect(mockDb.store[SCHEMA_TYPE.AGENTS][0].spendMonth).toBeUndefined();
    });

    it('still records a priced run, a token-less failure, and a local run at zero', async () => {
        const priced = await start();
        expect(await runs.recordSpend(C, priced, { inputTokens: 1000000, outputTokens: 0 }, 'gpt-4.1')).toEqual({ usd: 2, tokens: 1000000, capReached: false });
        expect(mockDb.store[SCHEMA_TYPE.AGENT_RUNS][0].spend).toMatchObject({ tokens: 1000000, usd: 2, model: 'gpt-4.1' });

        const empty = await start();
        expect(await runs.recordSpend(C, empty, {}, MYSTERY)).toEqual({ usd: 0, tokens: 0, capReached: false });

        const local = await start({ viaAccount: 'local' });
        expect(await runs.recordSpend(C, local, { inputTokens: 500, outputTokens: 500 }, 'llama3')).toEqual({ usd: 0, tokens: 1000, capReached: false });
    });
});

describe('LLM_PRICING as an instance setting', () => {
    it('is an AI-group text field that refuses malformed JSON and keeps a valid sheet', () => {
        expect(byKey.get('LLM_PRICING')).toMatchObject({ group: 'ai', type: 'text', secret: false });
        expect(validateSettings({ LLM_PRICING: '{"gpt-4.1":{"input":2}}' })).toMatchObject({ valid: false, errors: { LLM_PRICING: 'json' } });
        expect(validateSettings({ LLM_PRICING: 'nope' })).toMatchObject({ valid: false, errors: { LLM_PRICING: 'json' } });
        const good = validateSettings({ LLM_PRICING: '{"gpt-4.1":{"input":2,"output":8}}' });
        expect(good).toEqual({ valid: true, errors: {}, values: { LLM_PRICING: '{"gpt-4.1":{"input":2,"output":8}}' } });
        expect(validateSettings({ LLM_PRICING: '' })).toMatchObject({ valid: true, values: { LLM_PRICING: '' } });
    });
});
