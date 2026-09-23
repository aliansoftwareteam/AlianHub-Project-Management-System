const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 'owner'), isPrivileged: (r) => r === 'owner' || r === 'admin' }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent' }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const runs = require('../Modules/Agents/runs');
const ctrl = require('../Modules/Agents/controller');
const { createAgentRecord } = require('../Modules/Agents/agentRecord');
const { DEFAULT_RATE_LIMIT_PER_DAY, dailyRunLimitOf } = require('../Modules/Agents/dailyRunLimit');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Reviewer', autonomy: 2, allowedActions: [], account: 'workspace', spendCapUsd: 10, ...over });
const seedRunsToday = (n) => { for (let i = 0; i < n; i += 1) mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'done', startedAt: new Date() }); };
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (body) => ({ headers: { companyid: C }, params: {}, query: {}, body, uid: 'owner1' });

beforeAll(() => require('../Modules/AICore/persistence').useInMemory());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
});

describe('the default daily run limit', () => {
    it('is 40', () => {
        expect(DEFAULT_RATE_LIMIT_PER_DAY).toBe(40);
    });

    it('allows the 40th run of the day for an agent with no stored limit', async () => {
        seedRunsToday(39);
        expect(await runs.canStart(agent(), { companyId: C })).toEqual({ ok: true, reason: '' });
    });

    it('refuses the 41st run of the day for an agent with no stored limit, with the existing message', async () => {
        seedRunsToday(40);
        expect(await runs.canStart(agent(), { companyId: C })).toEqual({ ok: false, reason: 'Daily run limit reached (40 of 40 today).' });
    });

    it('treats a stored null as not set', async () => {
        seedRunsToday(40);
        expect((await runs.canStart(agent({ rateLimitPerDay: null }), { companyId: C })).ok).toBe(false);
    });

    it('honours a stored limit of 12 unchanged', async () => {
        seedRunsToday(11);
        expect((await runs.canStart(agent({ rateLimitPerDay: 12 }), { companyId: C })).ok).toBe(true);
        seedRunsToday(1);
        expect(await runs.canStart(agent({ rateLimitPerDay: 12 }), { companyId: C })).toEqual({ ok: false, reason: 'Daily run limit reached (12 of 12 today).' });
    });

    it('honours a stored limit above the default', async () => {
        seedRunsToday(40);
        expect((await runs.canStart(agent({ rateLimitPerDay: 100 }), { companyId: C })).ok).toBe(true);
    });

    it('keeps a stored 0 as the explicit choice of no daily limit', async () => {
        seedRunsToday(45);
        expect((await runs.canStart(agent({ rateLimitPerDay: 0 }), { companyId: C })).ok).toBe(true);
    });

    it('resolves the limit the same way for every reader', () => {
        expect(dailyRunLimitOf({})).toBe(40);
        expect(dailyRunLimitOf({ rateLimitPerDay: null })).toBe(40);
        expect(dailyRunLimitOf({ rateLimitPerDay: 12 })).toBe(12);
        expect(dailyRunLimitOf({ rateLimitPerDay: 0 })).toBe(0);
    });
});

describe('a new agent stores the default explicitly', () => {
    it('POST /agents without a limit stores 40', async () => {
        const r = res();
        await ctrl.createAgent(req({ name: 'New' }), r);
        expect(r.body.status).toBe(true);
        expect(mockDb.store[SCHEMA_TYPE.AGENTS][0].rateLimitPerDay).toBe(40);
    });

    it('POST /agents with a limit stores that limit, 0 included', async () => {
        for (const [value, stored] of [[12, 12], [0, 0]]) {
            const r = res();
            // eslint-disable-next-line no-await-in-loop
            await ctrl.createAgent(req({ name: `L${value}`, rateLimitPerDay: value }), r);
            expect(r.body.data.rateLimitPerDay).toBe(stored);
        }
    });

    it('an agent created outside the controller stores 40', async () => {
        const saved = await createAgentRecord(C, { name: 'Planned' }, { ownerId: 'owner1' });
        expect(saved.rateLimitPerDay).toBe(40);
    });
});
