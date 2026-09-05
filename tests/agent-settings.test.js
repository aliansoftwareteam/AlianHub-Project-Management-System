const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async (c, uid) => (uid === 'member1' ? 3 : 1)), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => (req.agent ? { kind: 'agent', userId: req.uid, agentId: 'a1' } : { kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent' }));
jest.mock('../Modules/AIProjectGenerator/llmProvider', () => ({ getProvider: jest.fn(() => { throw new Error('not configured'); }) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { removeCache } = require('../utils/commonFunctions');
const { getProvider } = require('../Modules/AIProjectGenerator/llmProvider');
const budget = require('../Modules/Agents/budget');
const ctrl = require('../Modules/Agents/controller');

const C = '6f0000000000000000000c01';
const ENV = ['LLM_PROVIDER', 'LLM_REGION', 'AI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY'];
const saved = {};

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (body, over = {}) => ({ headers: { companyid: C }, params: {}, query: {}, body, uid: 'owner1', ...over });
const company = () => mockDb.store[dbCollections.COMPANIES][0];
const get = async (over) => { const r = res(); await ctrl.getSettings(req({}, over), r); return r; };
const put = async (body, over) => { const r = res(); await ctrl.putSettings(req(body, over), r); return r; };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    ENV.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
    mockDb.seed(dbCollections.COMPANIES, { _id: C, Company_Name: 'Acme' });
});

afterEach(() => { ENV.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

describe('GET /agents/settings', () => {
    it('answers the defaults when the company has nothing stored', async () => {
        const r = await get();
        expect(r.body).toEqual({ status: true, data: { undoHours: 24, monthlyBudgetUsd: 0, provider: { name: null, hasKey: false, region: null } } });
    });

    it('falls back to the defaults when the stored values are out of range', async () => {
        company().agentUndoHours = 999;
        company().agentMonthlyBudgetUsd = -3;
        expect((await get()).body.data).toMatchObject({ undoHours: 24, monthlyBudgetUsd: 0 });
    });

    it('needs a companyId', async () => {
        const r = await get({ headers: {} });
        expect(r.body).toMatchObject({ status: false, statusText: 'companyId is required.' });
    });
});

describe('provider block', () => {
    it('names the configured provider and whether a key is set, never the key', async () => {
        process.env.LLM_PROVIDER = 'anthropic';
        process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-123';
        process.env.LLM_REGION = 'eu';
        const r = await get();
        expect(r.body.data.provider).toEqual({ name: 'anthropic', hasKey: true, region: 'eu' });
        expect(JSON.stringify(r.body)).not.toContain('secret');
        expect(getProvider).toHaveBeenCalled();
    });

    it('takes the name the provider module resolves, and reports a missing key', async () => {
        getProvider.mockReturnValueOnce({ name: 'openai' });
        expect(budget.provider()).toEqual({ name: 'openai', hasKey: false, region: null });
        process.env.AI_API_KEY = 'k';
        getProvider.mockReturnValueOnce({ name: 'openai' });
        expect(budget.provider()).toEqual({ name: 'openai', hasKey: true, region: null });
    });

    it('ignores an unknown LLM_PROVIDER', async () => {
        process.env.LLM_PROVIDER = 'mystery';
        process.env.DEEPSEEK_API_KEY = 'k';
        expect(budget.provider()).toEqual({ name: null, hasKey: false, region: null });
    });
});

describe('PUT /agents/settings', () => {
    it.each([
        [{ undoHours: 0 }, 'undoHours must be a whole number between 1 and 168.'],
        [{ undoHours: 169 }, 'undoHours must be a whole number between 1 and 168.'],
        [{ undoHours: 1.5 }, 'undoHours must be a whole number between 1 and 168.'],
        [{ undoHours: 'abc' }, 'undoHours must be a whole number between 1 and 168.'],
        [{ undoHours: '' }, 'undoHours must be a whole number between 1 and 168.'],
        [{ undoHours: true }, 'undoHours must be a whole number between 1 and 168.'],
        [{ monthlyBudgetUsd: -1 }, 'monthlyBudgetUsd must be a number of 0 or more (0 means no budget).'],
        [{ monthlyBudgetUsd: 'x' }, 'monthlyBudgetUsd must be a number of 0 or more (0 means no budget).'],
        [{ undoHours: 12, monthlyBudgetUsd: -1 }, 'monthlyBudgetUsd must be a number of 0 or more (0 means no budget).'],
        [{}, 'Nothing to update.'],
        [{ other: 1 }, 'Nothing to update.'],
    ])('refuses %j with the reason and writes nothing', async (body, reason) => {
        const r = await put(body);
        expect(r.code).toBe(400);
        expect(r.body).toEqual({ status: false, statusText: reason, message: reason });
        expect(company()).toEqual({ _id: C, Company_Name: 'Acme' });
        expect(removeCache).not.toHaveBeenCalled();
    });

    it('stores valid values, clears the company cache and answers the settings shape', async () => {
        const r = await put({ undoHours: '48', monthlyBudgetUsd: 25.5 });
        expect(r.code).toBe(200);
        expect(r.body).toEqual({ status: true, statusText: 'Settings updated.', data: { undoHours: 48, monthlyBudgetUsd: 25.5, provider: { name: null, hasKey: false, region: null } } });
        expect(company()).toMatchObject({ agentUndoHours: 48, agentMonthlyBudgetUsd: 25.5 });
        expect(removeCache).toHaveBeenCalledWith(`companyData_${C}`);
        expect((await get()).body.data).toMatchObject({ undoHours: 48, monthlyBudgetUsd: 25.5 });

        expect((await put({ monthlyBudgetUsd: 0 })).body.data).toMatchObject({ undoHours: 48, monthlyBudgetUsd: 0 });
        expect((await put({ undoHours: 168 })).body.data.undoHours).toBe(168);
        expect((await put({ undoHours: 1 })).body.data.undoHours).toBe(1);
    });

    it('is owner/admin only, and never for an agent', async () => {
        const member = await put({ undoHours: 2 }, { uid: 'member1' });
        expect(member.code).toBe(403);
        expect(member.body.statusText).toBe('Owner/admin only.');
        const agent = await put({ undoHours: 2 }, { agent: true });
        expect(agent.code).toBe(403);
        expect(company().agentUndoHours).toBeUndefined();
        expect((await put({ undoHours: 2 }, { uid: undefined })).code).toBe(401);
    });
});

describe('POST /agents defaults a new agent to L1 Suggest', () => {
    it('stores autonomy 1 when the body omits it, and the explicit rung otherwise', async () => {
        const omitted = res();
        await ctrl.createAgent(req({ name: 'New' }), omitted);
        expect(omitted.body.status).toBe(true);
        expect(omitted.body.data.autonomy).toBe(1);
        expect(mockDb.store[SCHEMA_TYPE.AGENTS][0]).toMatchObject({ name: 'New', autonomy: 1, ownerId: 'owner1' });

        for (const [value, stored] of [[0, 0], ['3', 3], [2, 2]]) {
            const r = res();
            // eslint-disable-next-line no-await-in-loop
            await ctrl.createAgent(req({ name: `L${value}`, autonomy: value }), r);
            expect(r.body.data.autonomy).toBe(stored);
        }
        const bad = res();
        await ctrl.createAgent(req({ name: 'Bad', autonomy: 4 }), bad);
        expect(bad.code).toBe(400);
    });
});
