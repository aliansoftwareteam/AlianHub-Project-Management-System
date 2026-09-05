const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 'owner'), isPrivileged: (r) => r === 'owner' || r === 'admin' }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent' }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const runs = require('../Modules/Agents/runs');
const ctrl = require('../Modules/Agents/controller');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const runRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(id));
const seedRun = (over) => mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, startedAt: new Date(Date.now() - 5000), proposals: [], ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Reviewer', paused: false, deletedStatusKey: 0 });
});

describe('F7 pause-all stops work in flight and leaves pending decisions alone', () => {
    it('stops running and queued runs, but not a run waiting for approval or one already finished', async () => {
        const running = seedRun({ status: 'running' });
        const queued = seedRun({ status: 'queued' });
        const waiting = seedRun({ status: 'waiting_approval', proposals: ['prop1'] });
        const done = seedRun({ status: 'done', outcome: 'x' });
        const proposal = mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { _id: 'prop1', runId: String(waiting._id), status: 'pending' });

        expect(await runs.pauseAll(C, 'pause all by u1')).toEqual({ stopped: 2 });
        expect(runRow(running._id)).toMatchObject({ status: 'stopped', outcome: 'pause all' });
        expect(runRow(queued._id)).toMatchObject({ status: 'stopped', outcome: 'pause all' });
        expect(runRow(waiting._id)).toMatchObject({ status: 'waiting_approval', proposals: ['prop1'] });
        expect(runRow(waiting._id).outcome).toBeUndefined();
        expect(runRow(done._id)).toMatchObject({ status: 'done', outcome: 'x' });
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS].find((p) => p._id === proposal._id).status).toBe('pending');
    });

    it('pauses every live agent with the reason, and blocks new runs afterwards', async () => {
        const deleted = mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Gone', paused: false, deletedStatusKey: 1 });
        await runs.pauseAll(C, 'pause all by u1');
        const live = mockDb.store[SCHEMA_TYPE.AGENTS].find((a) => String(a._id) === AGENT_ID);
        expect(live).toMatchObject({ paused: true, pausedReason: 'pause all by u1' });
        expect(live.pausedAt).toBeInstanceOf(Date);
        expect(mockDb.store[SCHEMA_TYPE.AGENTS].find((a) => a._id === deleted._id).paused).toBe(false);
        expect(await runs.canStart(live, { companyId: C })).toEqual({ ok: false, reason: 'Agent is paused (pause all by u1).' });
    });

    it('does not count or overwrite a run that finished between the listing and the stop', async () => {
        const racing = seedRun({ status: 'running' });
        const orig = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (...a) => {
            const out = await orig(...a);
            if (a[1].type === SCHEMA_TYPE.AGENT_RUNS && a[2] === 'find') Object.assign(runRow(racing._id), { status: 'done', outcome: 'finished first' });
            return out;
        });
        try {
            expect(await runs.pauseAll(C, 'pause all by u1')).toEqual({ stopped: 0 });
        } finally {
            mockDb.crud.mockImplementation(orig);
        }
        expect(runRow(racing._id)).toMatchObject({ status: 'done', outcome: 'finished first' });
    });

    it('POST /api/v2/agents/pause-all reports only what it stopped', async () => {
        seedRun({ status: 'running' });
        seedRun({ status: 'waiting_approval', proposals: ['prop1'] });
        const r = res();
        await ctrl.pauseAll({ headers: { companyid: C }, query: {}, body: {}, uid: 'owner1' }, r);
        expect(r.body).toEqual({ status: true, statusText: 'All agents paused.', data: { stopped: 1 } });
        expect(mockDb.store[SCHEMA_TYPE.AGENT_RUNS].map((x) => x.status).sort()).toEqual(['stopped', 'waiting_approval']);
    });
});
