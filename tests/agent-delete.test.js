const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 'member'), isPrivileged: (r) => r === 'owner' || r === 'admin' }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: req.agentToken ? 'agent' : 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent' }));
jest.mock('../Modules/Agents/agentAudit', () => ({ recordAgentDeleted: jest.fn(async () => 'aud1'), AGENT_DELETED: 'agent.deleted' }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const agentAudit = require('../Modules/Agents/agentAudit');
const socket = require('../event/socketEventEmitter');
const ctrl = require('../Modules/Agents/controller');
const routes = require('../Modules/Agents/routes');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (over = {}) => ({ headers: { companyid: C }, params: { id: AGENT_ID }, query: {}, body: {}, uid: 'owner1', ip: '1.1.1.1', ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    getRoleType.mockResolvedValue('member');
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Reviewer', ownerId: 'owner1', paused: false, deletedStatusKey: 0 });
});

describe('#15 DELETE /api/v2/agents/:id', () => {
    it('is registered under the JWT+company prefix', () => {
        const app = { use: jest.fn(), get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
        routes.init(app);
        expect(app.delete).toHaveBeenCalledWith('/api/v2/agents/:id', ctrl.deleteAgent);
        expect(app.delete.mock.calls.map(([p]) => p)).toEqual(['/api/v2/agents/account', '/api/v2/agents/:id']);
        expect(require('fs').readFileSync(require('path').join(__dirname, '../Config/setMiddleware.js'), 'utf8')).toMatch(/'\/api\/v2\/agents'/);
    });

    it('lets the agent\'s owner soft-delete it, keeps the row, writes an audit row and emits', async () => {
        const r = res();
        await ctrl.deleteAgent(req(), r);
        expect(r.body).toMatchObject({ status: true, data: { agentId: AGENT_ID } });
        expect(mockDb.store[SCHEMA_TYPE.AGENTS][0]).toMatchObject({ deletedStatusKey: 1, deletedBy: 'owner1', paused: true, pausedReason: 'deleted', name: 'Reviewer' });
        expect(agentAudit.recordAgentDeleted).toHaveBeenCalledWith(C, expect.objectContaining({ userId: 'owner1' }), { agentId: AGENT_ID, agentName: 'Reviewer', ip: '1.1.1.1' });
        expect(socket.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'agent', data: { kind: 'agent', agentId: AGENT_ID, deleted: true } }));
    });

    it('lets an owner/admin who is not the agent owner delete it, but refuses a plain member', async () => {
        const member = res();
        await ctrl.deleteAgent(req({ uid: 'someone' }), member);
        expect(member.code).toBe(403);
        expect(member.body.statusText).toMatch(/Owner, an Admin or the agent's owner/);
        expect(mockDb.store[SCHEMA_TYPE.AGENTS][0].deletedStatusKey).toBe(0);

        getRoleType.mockResolvedValue('admin');
        const admin = res();
        await ctrl.deleteAgent(req({ uid: 'someone' }), admin);
        expect(admin.body.status).toBe(true);
    });

    it('refuses while a run is in progress and leaves history rows alone', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'running', startedAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'done', startedAt: new Date() });
        const r = res();
        await ctrl.deleteAgent(req(), r);
        expect(r.code).toBe(409);
        expect(r.body.statusText).toBe('This agent has 1 run(s) in progress — stop them first.');
        mockDb.store[SCHEMA_TYPE.AGENT_RUNS][0].status = 'stopped';
        const again = res();
        await ctrl.deleteAgent(req(), again);
        expect(again.body.status).toBe(true);
        expect(mockDb.store[SCHEMA_TYPE.AGENT_RUNS]).toHaveLength(2);
    });

    it('404s a deleted or unknown agent and refuses agent tokens', async () => {
        mockDb.store[SCHEMA_TYPE.AGENTS][0].deletedStatusKey = 1;
        const gone = res();
        await ctrl.deleteAgent(req(), gone);
        expect(gone.code).toBe(404);
        const bot = res();
        await ctrl.deleteAgent(req({ agentToken: true }), bot);
        expect(bot.code).toBe(403);
    });
});

describe('#8 the schedule field is stored but documented as unconsumed', () => {
    it('says so next to the field in the controller', () => {
        const src = require('fs').readFileSync(require('path').join(__dirname, '../Modules/Agents/controller.js'), 'utf8');
        expect(src).toMatch(/`schedule` is stored for a scheduler that does not exist yet/);
    });
});
