const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 'owner'), isPrivileged: (r) => r === 'owner' || r === 'admin' }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent' }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Agents/controller');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const REASON = 'autonomy must be between 0 and 3';

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (body, over = {}) => ({ headers: { companyid: C }, params: { id: AGENT_ID }, query: {}, body, uid: 'owner1', ...over });
const agentRow = () => mockDb.store[SCHEMA_TYPE.AGENTS].find((a) => String(a._id) === AGENT_ID);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Reviewer', ownerId: 'owner1', autonomy: 1, paused: false, deletedStatusKey: 0 });
});

describe('F6 autonomy is validated at the API boundary, never clamped', () => {
    it('PUT /agents/:id with 9 is a 400 with the reason, and the row keeps its rung', async () => {
        const r = res();
        await ctrl.updateAgent(req({ autonomy: 9 }), r);
        expect(r.code).toBe(400);
        expect(r.body).toEqual({ status: false, statusText: REASON, message: REASON });
        expect(agentRow().autonomy).toBe(1);
    });

    it.each([[-1], [1.5], ['abc'], [''], [true], [null], [4]])('refuses %p on update', async (value) => {
        const r = res();
        await ctrl.updateAgent(req({ name: 'Renamed', autonomy: value }), r);
        expect(r.code).toBe(400);
        expect(r.body.statusText).toBe(REASON);
        expect(agentRow()).toMatchObject({ name: 'Reviewer', autonomy: 1 });
    });

    it('POST /agents with an out-of-range rung is a 400 and creates nothing', async () => {
        const r = res();
        await ctrl.createAgent(req({ name: 'New', autonomy: 4 }), r);
        expect(r.code).toBe(400);
        expect(r.body).toEqual({ status: false, statusText: REASON, message: REASON });
        expect(mockDb.store[SCHEMA_TYPE.AGENTS]).toHaveLength(1);
    });

    it('accepts every rung from 0 to 3, including a numeric string', async () => {
        for (const [value, stored] of [[3, 3], ['2', 2], [0, 0]]) {
            const r = res();
            // eslint-disable-next-line no-await-in-loop
            await ctrl.updateAgent(req({ autonomy: value }), r);
            expect(r.body.status).toBe(true);
            expect(agentRow().autonomy).toBe(stored);
        }
        const created = res();
        await ctrl.createAgent(req({ name: 'New', autonomy: 2 }), created);
        expect(created.body.status).toBe(true);
        expect(created.body.data.autonomy).toBe(2);
    });

    it('leaves autonomy alone when the body omits it', async () => {
        const r = res();
        await ctrl.updateAgent(req({ name: 'Renamed' }), r);
        expect(r.body.status).toBe(true);
        expect(agentRow()).toMatchObject({ name: 'Renamed', autonomy: 1 });
    });
});
