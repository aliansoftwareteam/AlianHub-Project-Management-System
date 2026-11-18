const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 'owner'), isPrivileged: (r) => r === 'owner' || r === 'admin' }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent' }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Agents/controller');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (body, over = {}) => ({ headers: { companyid: C }, params: { id: AGENT_ID }, query: {}, body, uid: 'owner1', ...over });
const agentRow = () => mockDb.store[SCHEMA_TYPE.AGENTS].find((a) => String(a._id) === AGENT_ID);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Reviewer', ownerId: 'owner1', autonomy: 1, paused: false, deletedStatusKey: 0 });
});

describe('the role an agent plays', () => {
    it('is set on update when it names a role playbook, and cleared with an empty value', async () => {
        const r = res();
        await ctrl.updateAgent(req({ role: 'it-company/bug-triager' }), r);
        expect(r.body.status).toBe(true);
        expect(agentRow().role).toBe('it-company/bug-triager');
        await ctrl.updateAgent(req({ role: '' }), res());
        expect(agentRow().role).toBe('');
    });

    it('refuses a role that does not exist, on update and on create', async () => {
        const r = res();
        await ctrl.updateAgent(req({ role: 'it-company/nobody' }), r);
        expect(r.code).toBe(400);
        expect(agentRow().role).toBeUndefined();
        const created = res();
        await ctrl.createAgent(req({ name: 'New', role: 'nobody' }), created);
        expect(created.code).toBe(400);
        expect(mockDb.store[SCHEMA_TYPE.AGENTS]).toHaveLength(1);
    });
});
