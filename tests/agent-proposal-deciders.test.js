/* A proposal is decided by a person signed in who holds a member's seat, and read by whoever may open what it touches. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Knowledge/memory/publish', () => mockStub());
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null), TRIGGER: { MENTION: 'mention', ASSIGN: 'assign' } }));
jest.mock('../Modules/AI/feedback', () => ({ fromDecline: jest.fn(async () => null) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/service.js', () => mockStub());

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const persistence = require('../Modules/AICore/persistence');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const proposals = require('../Modules/Agents/proposals');
const queue = require('../Modules/Inbox/helpers/approvalQueue');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, OUTSIDER, TOKEN, P_OPEN, P_PRIVATE, TASKS_GRANT, settle, ctx } = world;
const { seed, rows, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const store = persistence.useInMemory();

const GUEST = OUTSIDER;
const DAY = 24 * 60 * 60 * 1000;

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers.flat(); };
require('../Modules/Agents/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: () => {} });

const LIST = 'GET /api/v2/agents/proposals';
const APPROVE = 'POST /api/v2/agents/proposals/:id/approve';
const DECLINE = 'POST /api/v2/agents/proposals/:id/decline';
const UNDO = 'POST /api/v2/agents/proposals/:id/undo';

const send = async (route, caller, params = {}, body = {}) => {
    const [method, path] = route.split(' ');
    const url = Object.entries(params).reduce((text, [name, value]) => text.replace(`:${name}`, value), path);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
    const req = { ...caller, method, originalUrl: url, url, query: {}, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    for (const handler of routes[route]) {
        let passed = false;
        // eslint-disable-next-line no-await-in-loop
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    await settle();
    return { code: res.statusCode, body: res.body };
};

const personalToken = { _id: TOKEN, userId: OWNER, name: 'A script', scopes: ['read', 'write'] };

/* [who, the request's identity, the person a decision of theirs is recorded for, whether they decide] */
const CALLERS = [
    ['an owner signed in', { uid: OWNER }, OWNER, true],
    ['a member signed in who may make the change', { uid: MEMBER }, MEMBER, true],
    ['a guest signed in whose role may make the change', { uid: GUEST }, GUEST, false],
    ['an owner\'s own API token', { uid: OWNER, apiToken: personalToken }, OWNER, false],
    ['an agent\'s token', { uid: OWNER, apiToken: { ...personalToken, kind: 'agent', name: 'Claude' } }, OWNER, false],
];

const proposalRows = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS);
const proposal = (id) => proposalRows().find((row) => String(row._id) === String(id));
const comments = () => rows(SCHEMA_TYPE.COMMENTS);
const standingRows = () => rows(SCHEMA_TYPE.AGENT_STANDING_APPROVALS);
const privileged = (uid) => uid === OWNER;

let fx;

const filedOn = async (taskId) => {
    const reply = await rpc(ctx(OWNER), 'task.comment', { taskId, body: 'Looks ready' });
    expect(reply).toMatchObject({ pending: true });
    return reply.proposalId;
};
const filedComment = () => filedOn(fx.top._id);
/* An approval as the person made it before, whoever they are, so that undoing it is theirs to ask for. */
const approvedBy = async (uid) => {
    const id = await filedComment();
    expect((await proposals.approve(CID, id, { decider: { kind: 'human', userId: uid }, isPrivileged: privileged(uid), ip: '' })).error).toBeUndefined();
    return id;
};

/* [what is decided, the route, how the proposal is prepared for the person, the body, the status it starts in, the status a decision leaves] */
const DECISIONS = [
    ['approving', APPROVE, filedComment, {}, 'pending', 'approved'],
    ['approving for every time', APPROVE, filedComment, { always: true }, 'pending', 'approved'],
    ['declining', DECLINE, filedComment, { reason: 'Not now' }, 'pending', 'declined'],
    ['undoing their own approval', UNDO, approvedBy, {}, 'approved', 'undone'],
];

beforeEach(() => {
    jest.clearAllMocks();
    store.reset();
    fx = seed();
    process.env.MCP_TOOLS_WORK = 'on';
    [SCHEMA_TYPE.AGENT_STANDING_APPROVALS, SCHEMA_TYPE.AGENT_PROPOSALS, SCHEMA_TYPE.API_TOKENS].forEach((type) => { mockDb.store[type] = []; });
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude', active: true, scopes: ['read', 'write'], grants: [TASKS_GRANT], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
    rows(SCHEMA_TYPE.RULES).filter((rule) => !rule.isParent).forEach((rule) => { rule.roles = [...rule.roles, { key: 0, permission: true }]; });
    rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === P_OPEN).agentPolicy = { done: projectPolicy.DONE.YES, connected: projectPolicy.CONNECTED.PROPOSE_ALL };
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2'].forEach((key) => { delete process.env[key]; }); });

describe('who decides a proposal', () => {
    it.each(DECISIONS.flatMap(([what, route, prepare, body, from, to]) => CALLERS.map(([who, caller, person, decides]) => [what, who, route, prepare, body, from, to, caller, person, decides])))(
        '%s: %s',
        async (_what, _who, route, prepare, body, from, to, caller, person, decides) => {
            const id = await prepare(person);
            const was = comments().length;
            const out = await send(route, caller, { id }, body);
            if (decides) {
                expect(out).toMatchObject({ code: 200, body: { status: true } });
                expect(proposal(id).status).toBe(to);
                return;
            }
            expect(out).toMatchObject({ code: 403, body: { status: false } });
            expect(proposal(id).status).toBe(from);
            expect(comments()).toHaveLength(was);
            expect(standingRows()).toHaveLength(0);
        },
    );

    it('a member does not approve a change they could not make by hand', async () => {
        const id = await filedComment();
        rows(SCHEMA_TYPE.RULES).find((rule) => rule.key === 'task_comment').roles = [];
        expect(await send(APPROVE, { uid: MEMBER }, { id })).toMatchObject({ code: 403, body: { status: false } });
        expect(proposal(id).status).toBe('pending');
        expect(comments()).toHaveLength(0);
    });
});

describe('what a person reads of the proposals', () => {
    const listed = async (uid) => {
        const out = await send(LIST, { uid });
        expect(out).toMatchObject({ code: 200, body: { status: true } });
        return out.body.data.map((row) => String(row._id));
    };
    /* A change filed in an open project that reaches into another one. */
    const reaching = (into) => String(mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
        agentId: `mcp:${TOKEN}`, agentName: 'Claude (MCP)', source: 'mcp', tokenId: TOKEN, requestedBy: OWNER, projectId: P_OPEN, taskId: String(fx.top._id),
        what: 'Move the task', why: '', status: 'pending', createdAt: new Date(),
        changes: [{ action: 'task.move', params: { taskId: String(fx.top._id), projectId: into }, label: 'Move' }],
    })._id);

    it.each([['a guest', GUEST], ['a member', MEMBER]])('%s is listed only the ones in what they may open', async (_who, uid) => {
        const open = await filedComment();
        const inPrivateList = await filedOn(fx.secret._id);
        const intoPrivateProject = reaching(P_PRIVATE);
        expect(await listed(uid)).toEqual([open]);
        expect(await listed(OWNER)).toEqual(expect.arrayContaining([open, inPrivateList, intoPrivateProject]));
        for (const id of [inPrivateList, intoPrivateProject]) {
            // eslint-disable-next-line no-await-in-loop
            expect(await send(DECLINE, { uid }, { id })).toMatchObject({ code: 404, body: { status: false } });
            expect(proposal(id).status).toBe('pending');
        }
    });

    it('the approval queue shows a guest nothing and a member what they may decide', async () => {
        const open = await filedComment();
        await filedOn(fx.secret._id);
        reaching(P_PRIVATE);
        expect(await queue.readQueue(CID, GUEST)).toEqual([]);
        expect(await queue.readApplied(CID, GUEST)).toEqual([]);
        const mine = await queue.readQueue(CID, MEMBER);
        expect(mine.map((row) => row.proposalId)).toEqual([open]);
        expect(mine[0].locked).toBe(false);
    });
});
