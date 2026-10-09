/* Task 047, T-4: the tasks a connected agent holds, as a list of rows shows them. Who is told, what the filter
   "an agent is working on it" and the grouping "who is working" bring each person, and what one page of rows costs. */
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
jest.mock('../Modules/Company/controller/updateCompany', () => ({ getCompanyDataFun: jest.fn(async () => [mockDb.store.companies[0]]) }));
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const socketEmitter = require('../event/socketEventEmitter');
const { RULE } = require('../Modules/Agents/manager/rules');
const dailyLook = require('../Modules/Agents/manager/dailyLook');
const workQueue = require('../Modules/Agents/manager/workQueue');
const controller = require('../Modules/Agents/manager/controller');
const server = require('../Modules/Mcp/server');
const { relay, EVENT } = require('../socket/controller/agentSocket');
const { getTaskByQyery } = require('../Modules/Tasks/helpers/getTasksData');
const { getTabSyncTasks } = require('../Modules/Tasks/controller/getTabSyncTasks');
const { agentWorkMatch, agentWorkGroups } = require('../frontend/src/views/Projects/composables/agentWorkQuery');
const { cleanViewSettings, AGENT_WORK_GROUP } = require('../Modules/Project/helpers/viewSettings');
const { validatePipeline } = require('../Modules/Tasks/helpers/taskQueryGuard');
const { agentWorkGroupPage } = require('../scripts/scale/lib/apiProbes');
const { budgetOf } = require('../scripts/scale/lib/report');
const { projectFindingsSchema } = require('../utils/mongo-handler/createSchema');

const { CID, OWNER, MEMBER, OTHER, OUTSIDER, TOKEN, P_OPEN, P_DEST, S_OPEN, S_SECRET, TASKS_GRANT, settle } = world;
const { seed, rows, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const GUEST = OUTSIDER;
const WEDNESDAY = new Date('2026-10-07T09:00:00Z');
const day = (ymd) => new Date(`${ymd}T00:00:00Z`);
const MINUTE = 60 * 1000;
const PRIYAS_CLAUDE = 'Claude, for Priya Other';

const agent = (uid, tokenId = TOKEN) => world.ctx(uid, {
    actor: { kind: 'agent', userId: uid, agentName: 'Claude', viaAccount: 'personal', tokenId },
    token: { _id: tokenId, userId: uid, scopes: ['read', 'write'], grants: [TASKS_GRANT], active: true },
});

const project = (id) => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === String(id));
const stored = () => rows(SCHEMA_TYPE.PROJECT_FINDINGS);
const calm = () => rows(SCHEMA_TYPE.TASKS).filter((row) => [P_OPEN, P_DEST].includes(String(row.ProjectID)))
    .forEach((row) => Object.assign(row, { AssigneeUserId: [OTHER], totalEstimatedTime: 60, updatedAt: day('2026-10-06'), DueDate: day('2026-11-20') }));

let n = 0;
const task = (over = {}) => {
    n += 1;
    return mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskKey: `CASE-${n}`, TaskName: `Case ${n}`, CompanyId: CID, ProjectID: P_OPEN, sprintId: S_OPEN, sprintArray: { id: S_OPEN, name: 'Sprint 1' },
        AssigneeUserId: [OTHER], watchers: [], isParentTask: true, deletedStatusKey: 0, status: { key: 2, text: 'In Progress', type: 'active' }, statusType: 'active', statusKey: 2,
        totalEstimatedTime: 60, updatedAt: day('2026-10-06'), createdAt: day('2026-09-01'), DueDate: day('2026-11-20'), relations: [], ...over,
    });
};
const inSecret = { sprintId: S_SECRET, sprintArray: { id: S_SECRET, name: 'Secret' } };

/* Tasks nobody owns, found by one look of the day, each taken by an agent acting for OTHER through a connection of its own. */
const TOKENS = [TOKEN, '6f0000000000000000000102', '6f0000000000000000000103'];
const heldTasks = async (...overs) => {
    const orphans = overs.map((over) => task({ AssigneeUserId: [], ...over }));
    project(P_OPEN).agentManager = { on: true };
    await dailyLook.runForCompany(CID, WEDNESDAY);
    const held = [];
    for (const [at, orphan] of orphans.entries()) {
        const row = stored().find((found) => found.rule === RULE.NO_OWNER && found.taskId === String(orphan._id));
        // eslint-disable-next-line no-await-in-loop
        await rpc(agent(OTHER, TOKENS[at]), 'queue.claim', { itemId: String(row._id) });
        held.push({ id: String(orphan._id), itemId: String(row._id), tokenId: TOKENS[at] });
    }
    return held;
};

const through = async (handler, req) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; } };
    await handler(req, res, () => {});
    await settle();
    return { code: res.statusCode, body: res.body };
};
const held = async (uid) => (await through(controller.getHeldTasks, { uid, method: 'GET', headers: { companyid: CID }, params: {}, query: {}, body: {} })).body.data;
const heldIds = async (uid) => (await held(uid)).map((entry) => entry.taskId).sort();

/* The List's search, as the web app sends it with the filter on. */
const narrowed = async (uid, condition) => {
    const findQuery = [{ $match: { $and: [{ $and: [{ ProjectID: { objId: { $in: [P_OPEN] } } }, { deletedStatusKey: { $in: [0] } }] }, condition] } }];
    const found = await through(getTaskByQyery, { uid, aud: CID, headers: { companyid: CID }, body: { findQuery } });
    return (found.body || []).map((row) => String(row._id)).sort();
};
const filtered = (uid, ids) => narrowed(uid, agentWorkMatch(ids));

/* The groups a view builds from what the marks read brought this person, and the rows each group asks for. */
const NO_AGENT = 'No agent';
const groupsFor = async (uid) => agentWorkGroups((await held(uid)).filter((entry) => entry.projectId === P_OPEN), NO_AGENT);
const rowsIn = (uid, group) => narrowed(uid, group.conditions[0]);

const reads = (type) => mockDb.crud.mock.calls.filter(([, q, method]) => q.type === type && method === 'find').length;

beforeAll(() => mockDb.uniqueFromSchema(SCHEMA_TYPE.PROJECT_FINDINGS, projectFindingsSchema));

beforeEach(() => {
    jest.clearAllMocks();
    n = 0;
    seed();
    process.env.MCP_TOOLS_WORK = 'on';
    calm();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
});
afterEach(settle);
afterAll(() => { process.env.MCP_TOOLS_WORK = 'off'; });

describe('the tasks an agent holds, for the rows of a list', () => {
    it('say who holds each and since when, to the people who can open the task', async () => {
        const [open] = await heldTasks({});
        const since = new Date(stored().find((row) => String(row._id) === open.itemId).claim.at).toISOString();
        const entry = { taskId: open.id, projectId: P_OPEN, name: PRIYAS_CLAUDE, since };
        expect(await held(MEMBER)).toEqual([entry]);
        expect(await held(OWNER)).toEqual([entry]);
        expect(JSON.stringify(await held(MEMBER))).not.toMatch(/token:|userId|until/);
    });

    it('keep the time the agent first took the task when it keeps its claim longer', async () => {
        const [open] = await heldTasks({});
        const claimed = stored().find((row) => String(row._id) === open.itemId).claim;
        claimed.at = new Date(Date.now() - 20 * MINUTE);
        const first = claimed.at.toISOString();
        await rpc(agent(OTHER, open.tokenId), 'queue.claim', { itemId: open.itemId });
        expect(await held(MEMBER)).toMatchObject([{ taskId: open.id, since: first }]);
    });

    it('leave out a task in a private list for a member outside it, and every task for a guest', async () => {
        const [open, secret] = await heldTasks({}, inSecret);
        expect(await heldIds(OWNER)).toEqual([open.id, secret.id].sort());
        expect(await heldIds(OTHER)).toEqual([open.id, secret.id].sort());
        expect(await heldIds(MEMBER)).toEqual([open.id]);
        expect(await held(GUEST)).toEqual([]);
    });

    it('leave out a claim that ran out, one given back, and one whose person can no longer open the task, and change nothing', async () => {
        const [ranOut, givenBack, lost] = await heldTasks({}, {}, inSecret);
        const claimOf = (itemId) => stored().find((row) => String(row._id) === itemId).claim;
        expect(await heldIds(OWNER)).toEqual([ranOut.id, givenBack.id, lost.id].sort());

        claimOf(ranOut.itemId).until = new Date(Date.now() - MINUTE);
        await rpc(agent(OTHER, givenBack.tokenId), 'queue.release', { itemId: givenBack.itemId });
        rows(SCHEMA_TYPE.SPRINTS).find((row) => String(row._id) === S_SECRET).AssigneeUserId = [];
        expect(await held(OWNER)).toEqual([]);
        expect(claimOf(lost.itemId)).toBeDefined();
    });

    it('show nothing in a project whose switch is off, and nothing to a caller with no company', async () => {
        await heldTasks({});
        project(P_OPEN).agentManager = { on: false };
        expect(await held(OWNER)).toEqual([]);
        expect((await through(controller.getHeldTasks, { uid: OWNER, headers: {}, params: {}, query: {}, body: {} })).code).toBe(401);
    });

    it('cost one read of the claims for a page of rows, however many rows it has', async () => {
        project(P_OPEN).agentManager = { on: true };
        const now = Date.now();
        const hold = (count) => Array.from({ length: count }, () => task()).forEach((row) => mockDb.seed(SCHEMA_TYPE.PROJECT_FINDINGS, {
            projectId: P_OPEN, key: `${RULE.NO_OWNER}:${row._id}`, rule: RULE.NO_OWNER, status: 'open', taskId: String(row._id), taskIds: [String(row._id)], openedAt: WEDNESDAY,
            proposalId: null, leftQueue: null, claim: { by: `token:${TOKEN}`, userId: OTHER, name: PRIYAS_CLAUDE, at: new Date(now), until: new Date(now + 30 * MINUTE) },
        }));
        const cost = async () => {
            mockDb.crud.mockClear();
            const listed = await held(MEMBER);
            return { listed: listed.length, claims: reads(SCHEMA_TYPE.PROJECT_FINDINGS), all: mockDb.crud.mock.calls.length };
        };
        hold(5);
        const few = await cost();
        hold(30);
        const page = await cost();
        expect(few).toMatchObject({ listed: 5, claims: 1 });
        expect(page).toMatchObject({ listed: 35, claims: 1 });
        expect(page.all).toBe(few.all);
    });
});

describe('the filter "an agent is working on it"', () => {
    it('brings each person the held tasks they can open, whatever ids it is sent', async () => {
        const [open, secret] = await heldTasks({}, inSecret);
        task();
        const every = [open.id, secret.id];

        expect(await filtered(OWNER, await heldIds(OWNER))).toEqual(every.slice().sort());
        expect(await filtered(OTHER, await heldIds(OTHER))).toEqual(every.slice().sort());
        expect(await filtered(MEMBER, await heldIds(MEMBER))).toEqual([open.id]);
        expect(await filtered(MEMBER, every)).toEqual([open.id]);
        expect(await filtered(GUEST, await heldIds(GUEST))).toEqual([]);
        expect(await filtered(GUEST, every)).toEqual([]);
    });

    it('brings nothing when no agent is working', async () => {
        task();
        expect(await filtered(OWNER, [])).toEqual([]);
    });
});

describe('the grouping "who is working"', () => {
    it('puts the held tasks under the agent the mark names, and every other task under the last group', async () => {
        const [open, secret] = await heldTasks({}, inSecret);
        const free = String(task()._id);
        const [agent, nobody, ...rest] = await groupsFor(OWNER);

        expect(rest).toEqual([]);
        expect(agent.name).toBe(PRIYAS_CLAUDE);
        expect(nobody.name).toBe(NO_AGENT);
        expect(await rowsIn(OWNER, agent)).toEqual([open.id, secret.id].sort());
        const others = await rowsIn(OWNER, nobody);
        expect(others).toContain(free);
        expect(others).not.toContain(open.id);
        expect(others).not.toContain(secret.id);
        expect([...await rowsIn(OWNER, agent), ...others].sort()).toEqual(await narrowed(OWNER, {}));
    });

    it('shows each person the same tasks as their marks, whatever ids the groups are sent with', async () => {
        const [open, secret] = await heldTasks({}, inSecret);
        const [agent, nobody] = await groupsFor(MEMBER);
        expect(await rowsIn(MEMBER, agent)).toEqual([open.id]);
        expect(await rowsIn(MEMBER, nobody)).not.toContain(secret.id);

        const [ownersAgent, ownersNobody] = await groupsFor(OWNER);
        expect(await rowsIn(MEMBER, ownersAgent)).toEqual([open.id]);
        expect(await rowsIn(MEMBER, ownersNobody)).not.toContain(secret.id);
        expect(await rowsIn(GUEST, ownersAgent)).toEqual([]);
        expect(await rowsIn(GUEST, ownersNobody)).toEqual([]);
    });

    it('is one group holding every task while no agent is working', async () => {
        task();
        const groups = await groupsFor(OWNER);
        expect(groups.map((group) => group.name)).toEqual([NO_AGENT]);
        expect(await rowsIn(OWNER, groups[0])).toEqual(await narrowed(OWNER, {}));
    });

    it('is kept on a saved view', () => {
        expect(cleanViewSettings({ groupBy: AGENT_WORK_GROUP }).groupBy).toBe(AGENT_WORK_GROUP);
        expect(cleanViewSettings({ groupBy: `${AGENT_WORK_GROUP}.x` }).groupBy).toBe(0);
    });

    it('has a page the speed check measures against the budget of a List page', () => {
        const page = agentWorkGroupPage({ projectId: P_OPEN, sprintId: S_OPEN, heldIds: [P_DEST] });
        expect(() => validatePipeline(page)).not.toThrow();
        expect(page[0].$match._id).toEqual({ objId: { $nin: [P_DEST] } });
        expect(budgetOf('api.listByAgentWork')).toEqual(budgetOf('api.listFirstPage'));
    });
});

describe('a list grouped by who is working, read again when its tab comes back', () => {
    /* The stored page request of one group, as the web app sends it again: JSON, so every id is text. */
    const tabReturn = async (uid, group) => {
        mockDb.calls.length = 0;
        const body = { pid: P_OPEN, sprintId: S_OPEN, istableTask: false, tabLeaveTime: 0, userId: uid, showAllTasks: true, item: JSON.parse(JSON.stringify(group)) };
        const answer = await through(getTabSyncTasks, { uid, headers: { companyid: CID }, body });
        const [pipeline] = mockDb.calls.find((call) => call.type === SCHEMA_TYPE.TASKS && call.method === 'aggregate').data;
        const counted = pipeline.find((stage) => stage.$facet).$facet.count[0].$match;
        const [operator, ids] = Object.entries(counted.$and[1]._id)[0];
        return { code: answer.code, operator, ids, rows: answer.body[0].result.map((row) => String(row._id)).sort(), count: answer.body[0].count[0]?.count || 0 };
    };
    const isObjectId = (id) => id && id._bsontype === 'ObjectId';

    it('asks the database for the ids of each group as ids, and counts the rows the group holds', async () => {
        const [open] = await heldTasks({});
        const free = String(task()._id);
        const [agent, nobody] = await groupsFor(OWNER);

        const held = await tabReturn(OWNER, agent);
        expect(held).toMatchObject({ code: 200, operator: '$in', rows: [open.id], count: 1 });
        expect(held.ids.map(String)).toEqual([open.id]);
        expect(held.ids.every(isObjectId)).toBe(true);

        const rest = await tabReturn(OWNER, nobody);
        expect(rest).toMatchObject({ code: 200, operator: '$nin' });
        expect(rest.ids.every(isObjectId)).toBe(true);
        expect(rest.rows).toContain(free);
        expect(rest.rows).not.toContain(open.id);
        expect(rest.count).toBe(rest.rows.length);
    });

    it('still refuses a group whose condition the task query would refuse', async () => {
        const answer = await through(getTabSyncTasks, {
            uid: OWNER, headers: { companyid: CID },
            body: { pid: P_OPEN, sprintId: S_OPEN, istableTask: false, tabLeaveTime: 0, userId: OWNER, item: { indexName: 'groupByStatusIndex', conditions: [{ $where: 'true' }] } },
        });
        expect(answer.code).toBe(400);
    });
});

describe('a claim that changes', () => {
    const told = () => socketEmitter.emit.mock.calls.filter(([event, sent]) => event === 'update' && sent.module === 'agent' && sent.data.kind === 'claim').map(([, sent]) => sent);

    it('tells the open pages of that company, and says nothing of the task', async () => {
        const [{ itemId }] = await heldTasks({});
        expect(told()).toEqual([expect.objectContaining({ type: 'update', companyId: CID, data: { kind: 'claim' } })]);
        await rpc(agent(OTHER), 'queue.release', { itemId });
        expect(told()).toHaveLength(2);
    });

    it('is told when a person takes the item back', async () => {
        const [{ itemId }] = await heldTasks({});
        expect((await workQueue.takeBack(CID, OWNER, itemId)).error).toBeUndefined();
        expect(told()).toHaveLength(2);
    });

    it('reaches the browsers as the signal the live agent surfaces already listen to', async () => {
        const emit = jest.fn();
        const roomName = `selected_companies_${CID}**s1`;
        require('../socket/helper').upsertRoom({ roomName, socketId: 's1', socket: { id: 's1', rooms: new Set([roomName]), identity: { companyId: CID, uid: OWNER } }, namespace: { to: jest.fn(() => ({ emit })) } });
        await relay({ type: 'update', module: 'agent', companyId: CID, data: { kind: 'claim' } });
        expect(emit).toHaveBeenCalledWith(EVENT, { kind: 'claim' });
    });
});
