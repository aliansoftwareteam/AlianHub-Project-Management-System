/* A proposal is approved by a person who could make its change by hand, declined by a person who could approve it or whose
 * agent asked, and counted for a person only when it is theirs to decide. */
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
const queue = require('../Modules/Inbox/helpers/approvalQueue');
const access = require('../Modules/Agents/access');
const { matchesLikeMongo, oid } = require('./fixtures/storedForms');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, ADMIN, MEMBER, OTHER, OUTSIDER, TOKEN, P_OPEN, P_PRIVATE, PL_OTHER, TASKS_GRANT, settle } = world;
const { seed, rows } = world.create(mockDb);
const store = persistence.useInMemory();

const GUEST = OUTSIDER;
const AGENT = '6f0000000000000000000a11';
const DAY = 24 * 60 * 60 * 1000;
const GATED = 'owner_admin';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers.flat(); };
require('../Modules/Agents/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: () => {} });

const LIST = 'GET /api/v2/agents/proposals';
const APPROVE = 'POST /api/v2/agents/proposals/:id/approve';
const DECLINE = 'POST /api/v2/agents/proposals/:id/decline';

const send = async (route, uid, params = {}, body = {}, query = {}) => {
    const [method, path] = route.split(' ');
    const url = Object.entries(params).reduce((text, [name, value]) => text.replace(`:${name}`, value), path);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
    const req = { uid, method, originalUrl: url, url, query, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    for (const handler of routes[route]) {
        let passed = false;
        // eslint-disable-next-line no-await-in-loop
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    await settle();
    return { code: res.statusCode, body: res.body };
};

const stored = (id) => rows(SCHEMA_TYPE.AGENT_PROPOSALS).find((row) => String(row._id) === String(id));
const comments = () => rows(SCHEMA_TYPE.COMMENTS);
const withoutRight = (key) => { rows(SCHEMA_TYPE.RULES).find((rule) => !rule.isParent && rule.key === key).roles = []; };

let fx;

const commentOn = (task) => ({ action: 'task.comment', params: { taskId: String(task._id), body: 'Looks ready' }, label: 'Comment', reversible: true });
const priorityOf = (task) => ({ action: 'task.update', params: { taskId: String(task._id), fields: { Task_Priority: 'HIGH' } }, label: 'Raise the priority', reversible: true });
const runBy = (uid) => String(mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT, agentName: 'Reviewer', status: 'running', startedBy: uid, startedAt: new Date(), taskId: String(fx.top._id), projectId: P_OPEN })._id);
const file = (over = {}) => String(mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
    what: 'Say it is ready', why: 'The checks passed', status: 'pending', gate: null, priority: 'normal', runId: null, auditIds: [],
    projectId: P_OPEN, taskId: String(fx.top._id), changes: [commentOn(fx.top)], createdAt: new Date(), ...over,
})._id);

/* [who filed it, the fields that say so] */
const FILERS = [
    ['a workspace agent', () => ({ agentId: AGENT, agentName: 'Reviewer' })],
    ['the daily look of a project', () => ({ agentId: 'manager', agentName: 'Project check', source: 'system', allowedActions: ['task.comment', 'task.update'] })],
    ['a connected agent', () => ({ agentId: `mcp:${TOKEN}`, agentName: 'Claude (MCP)', source: 'mcp', tokenId: TOKEN, requestedBy: OWNER, tokenProjectIds: [], allowedActions: ['task.comment', 'task.update'] })],
];
const byAgent = FILERS[0][1];
const byConnection = (uid) => ({ ...FILERS[2][1](), requestedBy: uid });

beforeEach(() => {
    jest.clearAllMocks();
    store.reset();
    fx = seed();
    process.env.MCP_TOOLS_WORK = 'on';
    [SCHEMA_TYPE.AGENT_STANDING_APPROVALS, SCHEMA_TYPE.AGENT_PROPOSALS, SCHEMA_TYPE.API_TOKENS, SCHEMA_TYPE.AGENTS, SCHEMA_TYPE.AGENT_RUNS].forEach((type) => { mockDb.store[type] = []; });
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude', active: true, scopes: ['read', 'write'], grants: [TASKS_GRANT], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT, name: 'Reviewer', ownerId: OWNER, autonomy: 1, spendCapUsd: 1, paused: false, deletedStatusKey: 0, projectIds: [] });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2'].forEach((key) => { delete process.env[key]; }); });

describe('approving', () => {
    it.each(FILERS)('a change filed by %s is applied for a member who could make it by hand', async (_who, filer) => {
        const id = file(filer());
        expect(await send(APPROVE, MEMBER, { id })).toMatchObject({ code: 200, body: { status: true, data: { applied: [{ ok: true }] } } });
        expect(stored(id)).toMatchObject({ status: 'approved', decidedBy: MEMBER });
        expect(comments()).toHaveLength(1);
    });

    it.each(FILERS)('a change filed by %s keeps waiting when the member could not make it by hand, and the answer says why', async (_who, filer) => {
        const id = file(filer());
        withoutRight('task_comment');
        const out = await send(APPROVE, MEMBER, { id });
        expect(out).toMatchObject({ code: 403, body: { status: false, statusText: expect.stringMatching(/may not make this change|right to make this change/) } });
        expect(stored(id).status).toBe('pending');
        expect(stored(id).decidedBy).toBeUndefined();
        expect(comments()).toHaveLength(0);

        expect(await send(APPROVE, OWNER, { id })).toMatchObject({ code: 200, body: { status: true, data: { applied: [{ ok: true }] } } });
        expect(stored(id)).toMatchObject({ status: 'approved', decidedBy: OWNER });
        expect(comments()).toHaveLength(1);
    });

    it.each(FILERS.slice(0, 2))('a change filed by %s keeps waiting when it reaches a list the member cannot open', async (_who, filer) => {
        const id = file({ ...filer(), changes: [commentOn(fx.secret)] });
        expect(await send(APPROVE, MEMBER, { id })).toMatchObject({ code: 403, body: { status: false, statusText: expect.stringMatching(/cannot open what this change touches/) } });
        expect(stored(id).status).toBe('pending');
        expect(comments()).toHaveLength(0);
    });

    it('a member approves the part they could make by hand once the other part is taken out', async () => {
        const id = file({ ...byAgent(), changes: [commentOn(fx.top), commentOn(fx.secret)] });
        expect(await send(APPROVE, MEMBER, { id })).toMatchObject({ code: 403 });
        expect(await send(APPROVE, MEMBER, { id }, { changes: [commentOn(fx.top)] })).toMatchObject({ code: 200, body: { data: { applied: [{ ok: true }] } } });
        expect(stored(id).status).toBe('edited');
        expect(comments()).toHaveLength(1);
    });

    it('a change that needs an owner or an admin is not approved by a member who edits it in', async () => {
        const id = file(byAgent());
        const gatedChange = { action: 'deploy.staging', params: {}, label: 'Deploy' };
        expect(await send(APPROVE, MEMBER, { id }, { changes: [gatedChange] })).toMatchObject({ code: 403, body: { statusText: expect.stringMatching(/Owner or Admin/) } });
        expect(stored(id).status).toBe('pending');
    });
});

describe('declining', () => {
    /* [what, who declines, how it was filed, the right taken from members first, whether it is declined] */
    const CASES = [
        ['a member declines one they could approve', MEMBER, () => byAgent(), null, true],
        ['a member does not decline one that needs an owner or an admin', MEMBER, () => ({ ...byAgent(), gate: GATED }), null, false],
        ['a member does not decline a workspace agent\'s change they could not make by hand', MEMBER, () => ({ ...byAgent(), runId: runBy(OWNER) }), 'task_comment', false],
        ['a member does not decline a connected agent\'s change they could not make by hand', MEMBER, () => byConnection(OWNER), 'task_comment', false],
        ['a member takes back what their own connected agent asked for', MEMBER, () => byConnection(MEMBER), 'task_comment', true],
        ['a member takes back what the run they started asked for', MEMBER, () => ({ ...byAgent(), runId: runBy(MEMBER), gate: GATED }), null, true],
        ['the holder of a personal list declines what waits in it', OTHER, () => ({ ...byAgent(), gate: GATED, projectId: PL_OTHER, taskId: String(fx.personal._id), changes: [commentOn(fx.personal)] }), null, true],
        ['an admin declines one that needs an owner or an admin', ADMIN, () => ({ ...byAgent(), gate: GATED }), null, true],
        ['an owner declines one whose task is gone', OWNER, () => ({ ...byAgent(), changes: [priorityOf({ _id: '6f00000000000000000000ff' })] }), null, true],
    ];

    it.each(CASES)('%s', async (_what, uid, filed, right, declined) => {
        const id = file(filed());
        if (right) withoutRight(right);
        const out = await send(DECLINE, uid, { id }, { reason: 'Not now' });
        if (declined) {
            expect(out).toMatchObject({ code: 200, body: { status: true } });
            expect(stored(id)).toMatchObject({ status: 'declined', decidedBy: uid });
            return;
        }
        expect(out).toMatchObject({ code: 403, body: { status: false, reason: 'not_permitted', statusText: expect.stringMatching(/could approve/) } });
        expect(stored(id).status).toBe('pending');
        expect(stored(id).decidedBy).toBeUndefined();
    });
});

describe('what is counted as waiting for a person', () => {
    const listed = async (uid, query = {}) => {
        const out = await send(LIST, uid, {}, {}, query);
        expect(out).toMatchObject({ code: 200, body: { status: true } });
        return out.body;
    };
    const waitingIn = async (uid) => queue.waitingCount(await queue.readQueue(CID, uid));

    let ids;
    beforeEach(() => {
        withoutRight('task_priority');
        ids = {
            open: file(byAgent()),
            connected: file(byConnection(OWNER)),
            gated: file({ ...byAgent(), gate: GATED }),
            noRight: file({ ...byAgent(), changes: [priorityOf(fx.top)] }),
            ownNoRight: file({ ...byConnection(MEMBER), changes: [priorityOf(fx.top)] }),
            hiddenList: file({ ...byAgent(), taskId: String(fx.secret._id), changes: [commentOn(fx.secret)] }),
            reaching: file({ ...byConnection(OWNER), changes: [{ action: 'task.move', params: { taskId: String(fx.top._id), projectId: P_PRIVATE }, label: 'Move' }] }),
        };
        file({ ...byAgent(), status: 'approved', decidedBy: OWNER });
        file({ ...byConnection(OWNER), status: 'declined', decidedBy: OWNER, changes: [{ action: 'task.move', params: { taskId: String(fx.top._id), projectId: P_PRIVATE }, label: 'Move' }] });
    });

    /* [who, the proposals they may decide, the ones listed for them as not theirs to approve, what the other tabs count] */
    const VIEWERS = [
        ['an owner', OWNER, ['open', 'connected', 'gated', 'noRight', 'ownNoRight', 'hiddenList', 'reaching'], [], { doneByAi: 1, declined: 1 }],
        ['a member', MEMBER, ['open', 'connected'], ['gated', 'noRight', 'ownNoRight'], { doneByAi: 1, declined: 0 }],
        ['a guest', GUEST, [], ['open', 'connected', 'gated', 'noRight', 'ownNoRight'], { doneByAi: 1, declined: 0 }],
    ];

    it.each(VIEWERS)('%s: the count is the proposals they may decide', async (_who, uid, mine, held, others) => {
        const { data, counts } = await listed(uid);
        const open = data.filter((row) => !row.locked).map((row) => String(row._id));
        expect(open.sort()).toEqual(mine.map((key) => ids[key]).sort());
        expect(data.filter((row) => row.locked).map((row) => String(row._id)).sort()).toEqual(held.map((key) => ids[key]).sort());
        expect(counts).toMatchObject({ waiting: mine.length, ...others });
        expect(counts.primary + counts.later).toBe(mine.length);
        expect(await waitingIn(uid)).toBe(mine.length);
    });

    it('the count does not move with the tab that is open', async () => {
        expect((await listed(MEMBER, { status: 'all' })).counts).toMatchObject({ waiting: 2, doneByAi: 1, declined: 0 });
        expect((await listed(MEMBER, { status: 'declined' })).counts).toMatchObject({ waiting: 2 });
    });

    it('a row says why it is not the reader\'s to approve, and whether they may still decline it', async () => {
        const row = async (uid, key) => (await listed(uid)).data.find((p) => String(p._id) === ids[key]);
        expect(await row(MEMBER, 'gated')).toMatchObject({ locked: true, lockedWhy: 'owner_admin', mayDecline: false });
        expect(await row(MEMBER, 'noRight')).toMatchObject({ locked: true, lockedWhy: 'own_rights', mayDecline: false });
        expect(await row(MEMBER, 'ownNoRight')).toMatchObject({ locked: true, lockedWhy: 'own_rights', mayDecline: true });
        expect(await row(MEMBER, 'open')).toMatchObject({ locked: false, mayDecline: true });

        const queued = await queue.readQueue(CID, MEMBER);
        const inQueue = (key) => queued.find((p) => p.proposalId === ids[key]);
        expect(inQueue('noRight')).toMatchObject({ locked: true, lockedWhy: 'own_rights', mayDecline: false, always: false });
        expect(inQueue('ownNoRight')).toMatchObject({ locked: true, lockedWhy: 'own_rights', mayDecline: true });
        expect(inQueue('gated')).toMatchObject({ locked: true, lockedWhy: 'owner_admin', mayDecline: false });
        expect(inQueue('open')).toMatchObject({ locked: false, mayDecline: true });
    });
});

describe('a change that reaches into a project the reader cannot open', () => {
    const OPEN = [P_OPEN];
    const moveTo = (params) => ({ changes: [{ action: 'task.move', params: { taskId: 't1', ...params } }] });

    /* [what the proposal's changes name, the row, whether it stays inside the projects the reader may open] */
    const ROWS = [
        ['no project', moveTo({}), true],
        ['a project the reader may open, as text', moveTo({ projectId: P_OPEN }), true],
        ['a project the reader may open, as an id', moveTo({ projectId: oid(P_OPEN) }), true],
        ['an empty project', moveTo({ projectId: '' }), true],
        ['a project that is null', moveTo({ projectId: null }), true],
        ['another project, as text', moveTo({ projectId: P_PRIVATE }), false],
        ['another project, as an id', moveTo({ projectId: oid(P_PRIVATE) }), false],
        ['a list in another project', moveTo({ listProjectId: P_PRIVATE, sprintId: 's1' }), false],
        ['another project in its second change', { changes: [...moveTo({ projectId: P_OPEN }).changes, ...moveTo({ projectId: P_PRIVATE }).changes] }, false],
        ['no changes at all', { changes: [] }, true],
    ];

    it.each(ROWS)('the count\'s clause and the list\'s check agree on %s', (_what, row, inside) => {
        expect(access.staysInside(OPEN)(row)).toBe(inside);
        expect(matchesLikeMongo(access.reachesOutsideClause(OPEN))(row)).toBe(!inside);
    });
});
