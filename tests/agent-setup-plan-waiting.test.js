/* Task 047, S-2: what a plan's card says to the person reading it, and what an approval leaves. Each part is marked
   for a person who may not make it, with why; a part left out that way waits as a plan of its own for someone who
   may; a part that was tried and not made can be tried once more by the person who approved; and a part with
   nothing to show is never approved. */
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
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/aiFields/controller', () => mockStub());
jest.mock('../Modules/Knowledge/ingest/events', () => mockStub());
jest.mock('../utils/planHelper', () => ({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const intentPreview = require('../Modules/Agents/intentPreview');
const approverRights = require('../Modules/Agents/approverRights');
const planFollowUp = require('../Modules/Agents/planFollowUp');
const planShown = require('../Modules/Agents/planShown');
const workRequests = require('../Modules/Agents/workRequests');
const setupRequests = require('../Modules/Agents/setupRequests');
const plans = require('../Modules/Agents/projectSetup');
const access = require('../Modules/Agents/access');
const queue = require('../Modules/Inbox/helpers/approvalQueue');
const matcher = require('../Modules/Automations/engine/matcher');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, TOKEN, FLAGS, ctx, settle } = world;
const { seed, rows, stored, setRule, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const routes = world.routeTable(require('../Modules/Agents/routes').init);

const TOOL = 'project.setup';
const GRANT = 'tasks:manage';
const AGENT = '6f0000000000000000000a11';
const V_LIST = '6f0000000000000000000e11';
const PEOPLE = [OWNER, ADMIN, INSIDER, OUTSIDER, GUEST];
const LIST = 'GET /api/v2/agents/proposals';
const FILE = 'POST /api/v2/agents/proposals';
const APPROVE = 'POST /api/v2/agents/proposals/:id/approve';
const NOTICE = '[S-2] Ready for review';
const BUSY = 'The server was busy. Try again in a minute.';
const CATALOGUE = [
    { key: 1, name: 'To Do', textColor: '#ff9600', bgColor: '#ff960035', isDeleted: false },
    { key: 2, name: 'In Progress', textColor: '#6473e8', bgColor: '#6473e835', isDeleted: false },
    { key: 3, name: 'Done', textColor: '#24c110', bgColor: '#24c11035', isDeleted: false },
    { key: 4, name: 'In Review', textColor: '#111111', bgColor: '#11111135', isDeleted: false },
];
const reviewNotice = () => ({
    trigger: 'task.status_changed',
    conditions: [{ field: 'statusRef', op: 'changedTo', value: 'In Review' }],
    actions: [{ action: 'notify', config: { recipients: ['task_assignees'], message: NOTICE } }],
});
const BUDGET = { name: 'Budget', type: 'money' };
const NEW_STATUS = { projectId: P_OPEN, statuses: ['In Review', 'Blocked'], lists: ['Backlog'], tasks: [{ name: 'Wait for the client', status: 'Blocked' }, { name: 'Write the brief', list: 'Backlog' }] };
const KEEPS_WHAT_A_MEMBER_MAY = { 0: { statuses: [0], lists: [0], tasks: [1] } };
const WITH_LISTS = { projectId: P_OPEN, lists: ['Backlog', 'Later'], fields: [BUDGET], tasks: [{ name: 'Write the brief', list: 'Backlog' }] };
const KINDS = [
    ['statuses', ['project_details'], { statuses: ['In Review'] }],
    ['lists', ['project_sprint_create'], { lists: ['Backlog'] }],
    ['fields', ['project_custom_field', 'task_custom_field'], { fields: [BUDGET] }],
    ['views', ['view_list', 'project_details'], { views: [{ name: 'Mine', mine: true }] }],
];

const view = (_id, keyName, title) => ({ _id, id: _id, keyName, name: title, value: title, title, icon: `${title}.svg`, activeIcon: `${title}-on.svg`, sortIndex: 1, viewStatus: true });
const project = () => stored(SCHEMA_TYPE.PROJECTS, P_OPEN);
const statusNames = () => project().taskStatusData.map((status) => status.name);
const listsNamed = (name) => rows(SCHEMA_TYPE.SPRINTS).filter((row) => row.name === name && String(row.projectId) === P_OPEN && Number(row.deletedStatusKey || 0) === 0);
const liveFields = () => rows(SCHEMA_TYPE.CUSTOM_FIELDS).filter((field) => field.isDelete !== false).map((field) => field.fieldTitle);
const liveRules = () => rows(SCHEMA_TYPE.AUTOMATION_RULES).filter((rule) => Number(rule.deletedStatusKey) !== 1);
const tasksNamed = (name) => rows(SCHEMA_TYPE.TASKS).filter((task) => task.TaskName === name && Number(task.deletedStatusKey || 0) === 0);
const proposal = (id) => stored(SCHEMA_TYPE.AGENT_PROPOSALS, id);
const paramsOf = (id) => JSON.parse(JSON.stringify(proposal(id).changes[0].params));
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const everythingNow = () => JSON.stringify([SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.CUSTOM_FIELDS, SCHEMA_TYPE.TASKS, SCHEMA_TYPE.AUTOMATION_RULES, SCHEMA_TYPE.SETTINGS].map((type) => mockDb.store[type]));
const human = (userId) => ({ kind: 'human', userId });
const privileged = (uid) => [OWNER, ADMIN].includes(uid);
const approve = (id, uid = OWNER, parts = undefined) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: privileged(uid), ip: '', ...(parts ? { parts } : {}) });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid) => {
    const base = ctx(uid);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, grants: [GRANT], _id: tokenOf(uid) } };
};
const filed = async (args, uid = OWNER) => {
    const out = await rpc(as(uid), TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const keptAsRowsOnce = (params) => String(mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
    agentId: AGENT, agentName: 'Planner', runId: null, taskId: null, projectId: P_OPEN, what: 'Set the project up', why: '', status: 'pending', gate: null, priority: 'normal', auditIds: [],
    changes: [{ action: TOOL, params, label: 'Set up', reversible: true }], createdAt: new Date(),
})._id);
/* A plan as one kept before a status new to the company was held back at filing: asked for by `uid`'s connection, with that status in it. */
const filedBefore = async (uid, plan, statuses) => {
    const id = await filed(plan, uid);
    proposal(id).changes[0].params.statuses = [...(plan.statuses || []), ...statuses];
    return id;
};
const viewNamed = (title) => project().ProjectRequiredComponent.find((entry) => entry.title === title);
const fieldIdOf = (title) => String(rows(SCHEMA_TYPE.CUSTOM_FIELDS).find((field) => field.fieldTitle === title)._id);
const previewOf = async (id, uid = OWNER) => (await intentPreview.forProposals(CID, uid, [proposal(id)])).get(String(id))[0];
const picksOf = (preview) => preview.lines.flatMap((line) => [...(line.picks || []), ...(line.pick ? [line.pick] : [])]);
const standing = async (id, uid) => approverRights.standingOf(CID, await access.personOf(CID, uid), proposal(id));
const rowOf = async (id, uid) => (await queue.readQueue(CID, uid)).find((entry) => entry.proposalId === String(id));

const send = async (route, caller, { params = {}, body = {}, query = {} } = {}) => {
    const [method, path] = route.split(' ');
    const url = Object.entries(params).reduce((text, [name, value]) => text.replace(`:${name}`, value), path);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
    const req = { ...caller, method, originalUrl: url, url, query, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    for (const handler of routes[route]) {
        let passed = false;
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    await settle();
    return { code: res.statusCode, body: res.body };
};

beforeEach(() => {
    seed();
    process.env.MCP_TOOLS_MANAGE = 'on';
    const projectRules = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'project');
    ['project_custom_field', 'view_list'].forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, {
        key, name: key, isParent: false, parentId: String(projectRules._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }],
    }));
    const taskRules = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'task');
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task_create', name: 'task_create', isParent: false, parentId: String(taskRules._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }] });
    ['task_custom_field', 'project_details', 'project_sprint_create'].forEach((key) => setRule(key, false, [0]));
    project().ProjectRequiredComponent = [view(V_LIST, 'ProjectListView', 'List')];
    project().AssigneeUserId = [INSIDER, OUTSIDER];
    mockDb.seed(SCHEMA_TYPE.SETTINGS, { name: 'task_status', totalStatus: 4, settings: CATALOGUE.map((status) => ({ ...status })) });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT, name: 'Planner', ownerId: OWNER, autonomy: 1, allowedActions: [], paused: false, deletedStatusKey: 0 });
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, {
        _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], grants: [GRANT], projectIds: [], expiresAt: new Date(Date.now() + 86400000),
    }));
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
    matcher.invalidateAll();
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('a status the company does not have yet', () => {
    it('is not asked for by the agent of a person who could not add it by hand, on either road', async () => {
        const before = everythingNow();
        const connected = await rpc(as(INSIDER), TOOL, NEW_STATUS);
        expect(connected).toMatchObject({ refused: true, reason: expect.stringMatching(/statuses \("Blocked" does not exist in the company yet, and only an owner or an admin can add a status\)/) });
        const web = await send(FILE, { uid: INSIDER, apiToken: { _id: tokenOf(INSIDER), userId: INSIDER, name: 'Planner', agentId: AGENT, scopes: ['read', 'write'] } }, {
            body: { agentId: AGENT, projectId: P_OPEN, what: 'Set the project up', why: 'Asked for in chat', changes: [{ action: TOOL, params: NEW_STATUS, label: 'Set up' }] },
        });
        expect(web).toMatchObject({ code: 403, body: { status: false, statusText: connected.reason } });
        expect(waiting()).toHaveLength(0);
        expect(everythingNow()).toBe(before);
    });

    it('is marked on the card of a member as one an owner or an admin approves, and on nobody else\'s', async () => {
        const id = await filed(NEW_STATUS);
        expect(await previewOf(id, INSIDER)).toMatchObject({ locked: ['statuses:1'], lockedWhy: { 'statuses:1': 'owner_admin' } });
        for (const uid of [OWNER, ADMIN]) {
            const preview = await previewOf(id, uid);
            expect(preview.locked).toBeUndefined();
            expect(preview.lockedWhy).toBeUndefined();
        }
    });

    it('is not approved by a member who keeps it, and nothing is made', async () => {
        const id = await filed(NEW_STATUS);
        const before = everythingNow();
        for (const parts of [undefined, { 0: { statuses: [0, 1], lists: [0], tasks: [0, 1] } }, { 0: { statuses: [1] } }]) {
            expect(await approve(id, INSIDER, parts)).toMatchObject({ status: 403, reason: 'not_permitted', why: 'owner_admin', error: expect.stringMatching(/^An owner or admin approves a part of this plan/) });
        }
        expect(everythingNow()).toBe(before);
        expect(proposal(id)).toMatchObject({ status: 'pending' });
        expect(proposal(id).decidedBy).toBeUndefined();
    });

    it('waits, with the task that needs it, once a member has approved the rest', async () => {
        const id = await filed(NEW_STATUS);
        const out = await approve(id, INSIDER, KEEPS_WHAT_A_MEMBER_MAY);
        expect(out.error).toBeUndefined();
        expect(out.applied[0].result.notMade).toEqual([]);
        expect(statusNames()).toContain('In Review');
        expect(statusNames()).not.toContain('Blocked');
        expect(tasksNamed('Write the brief')).toHaveLength(1);
        expect(tasksNamed('Wait for the client')).toHaveLength(0);

        expect(out.left).toEqual({ waiting: [expect.any(String)], retry: [] });
        const [left] = out.left.waiting;
        expect(waiting().map((row) => String(row._id))).toEqual([left]);
        expect(proposal(left)).toMatchObject({ status: 'pending', splitFrom: id, source: 'mcp', requestedBy: OWNER, tokenId: tokenOf(OWNER), projectId: P_OPEN });
        expect(proposal(left).retryBy).toBeUndefined();
        expect(paramsOf(left)).toEqual({ projectId: P_OPEN, statuses: ['Blocked'], tasks: [{ name: 'Wait for the client', status: 'Blocked' }] });
    });

    it('then waits for an owner or an admin, who makes it once', async () => {
        const id = await filed(NEW_STATUS);
        const [left] = (await approve(id, INSIDER, KEEPS_WHAT_A_MEMBER_MAY)).left.waiting;
        expect(await standing(left, INSIDER)).toMatchObject({ locked: true, lockedWhy: 'owner_admin' });
        expect(await rowOf(left, INSIDER)).toMatchObject({ locked: true, lockedWhy: 'owner_admin' });
        expect(await standing(left, ADMIN)).toMatchObject({ locked: false });
        expect(await approve(left, INSIDER)).toMatchObject({ status: 403 });

        const out = await approve(left, ADMIN);
        expect(out.error).toBeUndefined();
        expect(out.left).toBeUndefined();
        expect(statusNames()).toContain('Blocked');
        expect(tasksNamed('Wait for the client')).toHaveLength(1);
        expect(tasksNamed('Write the brief')).toHaveLength(1);
        expect(listsNamed('Backlog')).toHaveLength(1);
        expect(waiting()).toHaveLength(0);
    });

    it('is made at once for an owner or an admin, and nothing is left waiting', async () => {
        const out = await approve(await filed(NEW_STATUS), ADMIN);
        expect(out.error).toBeUndefined();
        expect(out.left).toBeUndefined();
        expect(statusNames()).toEqual(expect.arrayContaining(['In Review', 'Blocked']));
        expect(waiting()).toHaveLength(0);
    });
});

describe('a kind of part the role of the person reading may not make', () => {
    it.each(KINDS)('marks the %s of a plan for that person, and for nobody whose role may', async (part, keys, plan) => {
        const id = await filed({ projectId: P_OPEN, lists: ['Open work'], ...plan, tasks: [{ name: 'Collect the logins' }] });
        keys.forEach((key) => setRule(key, false, [3]));
        const marked = await previewOf(id, INSIDER);
        expect(marked.locked).toEqual(expect.arrayContaining([`${part}:0`]));
        expect(marked.lockedWhy[`${part}:0`]).toBe('own_rights');
        expect(marked.locked).not.toContain('tasks:0');
        expect((await previewOf(id, ADMIN)).locked).toBeUndefined();
        expect(await approve(id, INSIDER)).toMatchObject({ status: 403, reason: 'not_permitted', why: 'own_rights', error: expect.stringMatching(/^Your role may not make a part of this plan/) });
        expect(proposal(id).status).toBe('pending');
    });

    it('leaves the plan open to that person while it holds a part they may approve, and says who can approve the rest', async () => {
        const id = await filed(WITH_LISTS);
        const only = await filed({ projectId: P_OPEN, lists: ['Backlog'], tasks: [{ name: 'Write the brief', list: 'Backlog' }] });
        setRule('project_sprint_create', false, [3]);
        expect(await standing(id, INSIDER)).toMatchObject({ locked: false, mayDecline: true });
        expect(await standing(only, INSIDER)).toMatchObject({ locked: true, lockedWhy: 'own_rights' });
        expect(await standing(only, ADMIN)).toMatchObject({ locked: false });
    });

    it('waits with the parts that cannot be made without it, and is made once by someone whose role may', async () => {
        const id = await filed(WITH_LISTS);
        setRule('project_sprint_create', false, [3]);
        expect((await previewOf(id, INSIDER)).locked).toEqual(['lists:0', 'lists:1']);
        const out = await approve(id, INSIDER, { 0: { lists: [], fields: [0], tasks: [] } });
        expect(out.error).toBeUndefined();
        expect(liveFields()).toEqual(['Budget']);
        expect(listsNamed('Backlog')).toHaveLength(0);
        const [left] = out.left.waiting;
        expect(paramsOf(left)).toEqual({ projectId: P_OPEN, lists: ['Backlog', 'Later'], tasks: [{ name: 'Write the brief', list: 'Backlog' }] });

        const done = await approve(left, OWNER);
        expect(done.error).toBeUndefined();
        expect(listsNamed('Backlog')).toHaveLength(1);
        expect(listsNamed('Later')).toHaveLength(1);
        expect(tasksNamed('Write the brief')).toHaveLength(1);
        expect(liveFields()).toEqual(['Budget']);
    });

    it('drops what the person chose to leave out, and keeps waiting only what they could not approve', async () => {
        const id = await filed({ projectId: P_OPEN, lists: ['Backlog'], fields: [BUDGET, { name: 'Region', type: 'text' }] });
        setRule('project_sprint_create', false, [3]);
        const out = await approve(id, INSIDER, { 0: { lists: [], fields: [0] } });
        expect(liveFields()).toEqual(['Budget']);
        expect(paramsOf(out.left.waiting[0])).toEqual({ projectId: P_OPEN, lists: ['Backlog'] });
    });
});

describe('an automation inside a plan', () => {
    const WITH_RULE = { projectId: P_OPEN, statuses: ['In Review'], lists: ['Backlog'], rules: [reviewNotice()] };

    it('waits for an owner or an admin with the status it names, where that status was left out too', async () => {
        const id = await filed(WITH_RULE);
        expect(await previewOf(id, INSIDER)).toMatchObject({ locked: ['rules:0'], lockedWhy: { 'rules:0': 'owner_admin' } });
        const out = await approve(id, INSIDER, { 0: { statuses: [], lists: [0], rules: [] } });
        expect(out.error).toBeUndefined();
        expect(paramsOf(out.left.waiting[0])).toMatchObject({ projectId: P_OPEN, statuses: ['In Review'], rules: [expect.objectContaining({ trigger: 'task.status_changed' })] });
        expect(paramsOf(out.left.waiting[0]).lists).toBeUndefined();
    });

    it('waits alone where the status it names was made, and is then made by an admin', async () => {
        const id = await filed(WITH_RULE);
        const out = await approve(id, INSIDER, { 0: { statuses: [0], lists: [0], rules: [] } });
        const [left] = out.left.waiting;
        expect(Object.keys(paramsOf(left)).sort()).toEqual(['projectId', 'rules']);
        expect(liveRules()).toHaveLength(0);
        const done = await approve(left, ADMIN);
        expect(done.error).toBeUndefined();
        expect(done.applied[0].result.notMade).toEqual([]);
        expect(liveRules()).toHaveLength(1);
        expect(listsNamed('Backlog')).toHaveLength(1);
    });
});

describe('a part that was tried and not made', () => {
    const TWO_LISTS = { projectId: P_OPEN, lists: ['Backlog', 'Later'], fields: [BUDGET] };
    const failOnce = () => {
        const real = workRequests.createList;
        return jest.spyOn(workRequests, 'createList').mockImplementationOnce(async () => { throw new Error(BUSY); }).mockImplementation(real);
    };

    it('can be tried once more by the person who approved, and by nobody else', async () => {
        const id = await filed(TWO_LISTS, INSIDER);
        failOnce();
        const out = await approve(id, INSIDER);
        expect(out.applied[0].result.notMade).toEqual([{ part: 'lists', name: 'Backlog', error: BUSY }]);
        expect(out.left).toEqual({ waiting: [], retry: [expect.any(String)] });
        const [again] = out.left.retry;
        expect(proposal(again)).toMatchObject({ status: 'pending', splitFrom: id, retryBy: INSIDER, retryWhy: BUSY });
        expect(paramsOf(again)).toEqual({ projectId: P_OPEN, lists: ['Backlog'] });

        expect(await rowOf(again, INSIDER)).toMatchObject({ locked: false, retry: { why: BUSY } });
        expect(await standing(again, OUTSIDER)).toMatchObject({ locked: true, lockedWhy: 'first_approver' });
        expect(await standing(again, OWNER)).toMatchObject({ locked: true, lockedWhy: 'first_approver', mayDecline: true });
        for (const uid of [OUTSIDER, OWNER]) expect(await approve(again, uid)).toMatchObject({ status: 403, reason: 'not_permitted', why: 'first_approver' });
        expect(proposal(again).status).toBe('pending');
    });

    it('is made by the second try, and what was made the first time is not made again', async () => {
        const id = await filed(TWO_LISTS, INSIDER);
        failOnce();
        const [again] = (await approve(id, INSIDER)).left.retry;
        const out = await approve(again, INSIDER);
        expect(out.error).toBeUndefined();
        expect(out.left).toBeUndefined();
        expect(listsNamed('Backlog')).toHaveLength(1);
        expect(listsNamed('Later')).toHaveLength(1);
        expect(liveFields()).toEqual(['Budget']);
        expect(waiting()).toHaveLength(0);
    });

    it('is not offered a third time', async () => {
        const id = await filed({ projectId: P_OPEN, lists: ['Backlog'], fields: [BUDGET] }, INSIDER);
        jest.spyOn(workRequests, 'createList').mockImplementation(async () => { throw new Error(BUSY); });
        const [again] = (await approve(id, INSIDER)).left.retry;
        const out = await approve(again, INSIDER);
        expect(out.applied[0]).toMatchObject({ ok: false });
        expect(out.left).toBeUndefined();
        expect(waiting()).toHaveLength(0);
        expect(listsNamed('Backlog')).toHaveLength(0);
    });

    it('is not offered again where trying again cannot change the answer, and the plan keeps why it was not made', async () => {
        const id = keptAsRowsOnce({ projectId: P_OPEN, lists: ['Backlog'], tasks: [{ name: 'Second brief', list: 'Nowhere' }] });
        const out = await approve(id, OWNER);
        expect(out.applied[0].result.notMade).toEqual([{ part: 'tasks', name: 'Second brief', error: 'The list "Nowhere" was not found in this project.' }]);
        expect(out.left).toBeUndefined();
        expect(waiting()).toHaveLength(0);
        expect(listsNamed('Backlog')).toHaveLength(1);
        expect(proposal(id).notMade).toEqual([{ part: 'tasks', name: 'Second brief', error: 'The list "Nowhere" was not found in this project.' }]);
        const done = await send(LIST, { uid: OWNER }, { query: { status: 'all' } });
        expect(done.body.data.find((entry) => String(entry._id) === id).notMade).toHaveLength(1);
    });

    it('keeps nothing of that kind on a plan every part of which was made', async () => {
        const id = await filed({ projectId: P_OPEN, lists: ['Backlog'] });
        await approve(id);
        expect(proposal(id).notMade).toBeUndefined();
    });

    it('is offered again where every part of the plan failed', async () => {
        const id = await filed({ projectId: P_OPEN, lists: ['Backlog'] }, INSIDER);
        failOnce();
        const out = await approve(id, INSIDER);
        expect(out.applied[0]).toMatchObject({ ok: false, error: expect.stringContaining(BUSY) });
        expect(paramsOf(out.left.retry[0])).toEqual({ projectId: P_OPEN, lists: ['Backlog'] });
    });

    it('is not offered again where it was not made because of who asked or who approved', async () => {
        const id = await filed({ projectId: P_OPEN, lists: ['Backlog'], tasks: [{ name: 'Collect the logins' }] }, INSIDER);
        setRule('task_create', false, [3]);
        const out = await approve(id, OWNER);
        expect(out.applied[0].result.notMade).toEqual([{ part: 'tasks', name: 'Collect the logins', error: expect.stringMatching(/permission_denied/) }]);
        expect(out.left).toBeUndefined();

        const lists = await filed({ projectId: P_OPEN, lists: ['Later'], fields: [BUDGET] }, INSIDER);
        setRule('project_sprint_create', false, [3]);
        const barred = await approve(lists, OWNER);
        expect(barred.applied[0].result.parts.find((part) => part.part === 'lists')).toMatchObject({ ok: false, refused: true });
        expect(barred.left).toBeUndefined();
        expect(waiting()).toHaveLength(0);
    });

    it('reads what was not made from what the plan answered, part by part', () => {
        const params = { projectId: P_OPEN, lists: ['Backlog', 'Later', 'Soon'], definitions: [BUDGET], views: [{ name: 'Mine' }], tasks: [{ name: 'Brief' }] };
        const outcome = { ok: true, result: { parts: [
            { part: 'description', ok: false, error: BUSY, items: [] },
            { part: 'lists', ok: false, items: [{ name: 'Backlog', made: true }, { name: 'Later', made: false, error: BUSY, tryAgain: true }, { name: 'Soon', made: false, error: 'That name is taken.' }] },
            { part: 'fields', ok: false, error: BUSY, tryAgain: true, items: [] },
            { part: 'views', ok: false, error: 'views needs 1 to 5 views', items: [] },
            { part: 'tasks', ok: false, items: [{ name: 'Brief', made: false, error: 'permission_denied: task.task_create is not allowed' }] },
        ] } };
        expect(planFollowUp.failedIn(outcome, params)).toEqual([{ key: 'lists:1', error: BUSY }, { key: 'fields:0', error: BUSY }]);
        expect(planFollowUp.failedIn({ ok: false, error: BUSY }, params)).toEqual([]);
    });
});

describe('undoing an approval that left parts to be made later', () => {
    const undo = (id, uid) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: privileged(uid), ip: '' });
    const failOnce = () => {
        const real = workRequests.createList;
        return jest.spyOn(workRequests, 'createList').mockImplementationOnce(async () => { throw new Error(BUSY); }).mockImplementation(real);
    };

    it('takes back the rows it left, those waiting for someone else and those to be tried again', async () => {
        const id = await filed({ ...NEW_STATUS, lists: ['Backlog', 'Later'] });
        failOnce();
        const out = await approve(id, INSIDER, KEEPS_WHAT_A_MEMBER_MAY);
        expect(out.left).toEqual({ waiting: [expect.any(String)], retry: [expect.any(String)] });
        expect((await undo(id, INSIDER)).error).toBeUndefined();
        for (const left of [...out.left.waiting, ...out.left.retry]) expect(proposal(left)).toMatchObject({ status: 'declined', decidedBy: 'system' });
        expect(waiting()).toHaveLength(0);
        expect(await approve(out.left.waiting[0], ADMIN)).toMatchObject({ status: 409 });
    });

    it('leaves no plan that names what the undo removed', async () => {
        const id = await filed({ projectId: P_OPEN, statuses: ['In Review'], lists: ['Backlog'], rules: [reviewNotice()] });
        const out = await approve(id, INSIDER, { 0: { statuses: [0], lists: [0], rules: [] } });
        await undo(id, INSIDER);
        expect(statusNames()).not.toContain('In Review');
        expect(proposal(out.left.waiting[0]).status).toBe('declined');
        expect(liveRules()).toHaveLength(0);
    });

    it('takes back what a second try made, too', async () => {
        const id = await filed({ projectId: P_OPEN, lists: ['Backlog', 'Later'], fields: [BUDGET] });
        failOnce();
        const [again] = (await approve(id, OWNER)).left.retry;
        expect((await approve(again, OWNER)).error).toBeUndefined();
        expect([listsNamed('Backlog').length, listsNamed('Later').length, liveFields()]).toEqual([1, 1, ['Budget']]);
        const undone = await undo(id, OWNER);
        expect(undone.error).toBeUndefined();
        expect([listsNamed('Backlog').length, listsNamed('Later').length, liveFields()]).toEqual([0, 0, []]);
        expect(proposal(again).status).toBe('undone');
        expect(undone.results.every((result) => result.ok)).toBe(true);
    });

    it('leaves what someone else approved from it as it is', async () => {
        const id = await filed(NEW_STATUS);
        const [left] = (await approve(id, INSIDER, KEEPS_WHAT_A_MEMBER_MAY)).left.waiting;
        await approve(left, ADMIN);
        await undo(id, INSIDER);
        expect(proposal(left).status).toBe('approved');
        expect(statusNames()).toContain('Blocked');
    });
});

describe('a view that shows a field of the same plan', () => {
    const MONEY = { projectId: P_OPEN, fields: [BUDGET], views: [{ name: 'Money', kind: 'list', showFields: ['Budget'] }] };
    const shown = (title) => JSON.stringify(viewNamed(title).settings || viewNamed(title));

    it('waits with the field by its id once the field is made, and is then made showing it', async () => {
        const id = await filed(MONEY);
        ['view_list', 'project_details'].forEach((key) => setRule(key, false, [3]));
        const out = await approve(id, INSIDER, { 0: { fields: [0], views: [] } });
        expect(liveFields()).toEqual(['Budget']);
        const [left] = out.left.waiting;
        expect(paramsOf(left)).toEqual({ projectId: P_OPEN, views: [{ name: 'Money', kind: 'list', look: { showFieldIds: [fieldIdOf('Budget')] } }] });

        const done = await approve(left, ADMIN);
        expect(done.error).toBeUndefined();
        expect(done.applied[0]).toMatchObject({ ok: true, result: { notMade: [], parts: [{ part: 'views', ok: true, items: [{ name: 'Money', made: true, leftOut: [] }] }] } });
        expect(shown('Money')).toContain(fieldIdOf('Budget'));
        expect(waiting()).toHaveLength(0);
    });

    it('is tried again with the field by its id, and is made showing it', async () => {
        const real = setupRequests.createView;
        jest.spyOn(setupRequests, 'createView').mockImplementationOnce(async () => { throw new Error(BUSY); }).mockImplementation(real);
        const out = await approve(await filed(MONEY), OWNER);
        const [again] = out.left.retry;
        expect(paramsOf(again)).toEqual({ projectId: P_OPEN, views: [{ name: 'Money', kind: 'list', look: { showFieldIds: [fieldIdOf('Budget')] } }] });
        const done = await approve(again, OWNER);
        expect(done.applied[0]).toMatchObject({ ok: true, result: { notMade: [] } });
        expect(shown('Money')).toContain(fieldIdOf('Budget'));
    });

    it('keeps the field by its name where both wait together', async () => {
        const id = await filed({ ...MONEY, lists: ['Backlog'] });
        ['view_list', 'project_details', 'project_custom_field', 'task_custom_field'].forEach((key) => setRule(key, false, [3]));
        const out = await approve(id, INSIDER, { 0: { lists: [0], fields: [], views: [] } });
        expect(paramsOf(out.left.waiting[0])).toEqual({ projectId: P_OPEN, definitions: [BUDGET], views: [{ name: 'Money', kind: 'list', look: {}, showFields: ['Budget'] }] });
        expect((await approve(out.left.waiting[0], ADMIN)).applied[0]).toMatchObject({ ok: true, result: { notMade: [] } });
    });
});

describe('a status new to the company in a plan asked for by someone who cannot add one', () => {
    const NOT_THIS_PLAN = /cannot be added through this plan/;

    it('is marked on every card as a part this plan cannot make, and the plan stays open for the rest', async () => {
        const id = await filedBefore(INSIDER, { projectId: P_OPEN, statuses: ['In Review'], lists: ['Backlog'] }, ['Blocked']);
        for (const uid of [INSIDER, ADMIN, OWNER]) {
            expect(await previewOf(id, uid)).toMatchObject({ locked: ['statuses:1'], lockedWhy: { 'statuses:1': 'not_this_plan' } });
            expect(await standing(id, uid)).toMatchObject({ locked: false });
        }
    });

    it('is not kept waiting by a member who approves the rest', async () => {
        const id = await filedBefore(INSIDER, { projectId: P_OPEN, statuses: ['In Review'], lists: ['Backlog'], tasks: [{ name: 'Collect the logins' }] }, ['Blocked']);
        proposal(id).changes[0].params.tasks.push({ name: 'Wait for the client', status: 'Blocked' });
        const out = await approve(id, INSIDER, { 0: { statuses: [0], lists: [0], tasks: [0] } });
        expect(out.error).toBeUndefined();
        expect(out.left).toBeUndefined();
        expect(waiting()).toHaveLength(0);
        expect(statusNames()).toContain('In Review');
        expect(listsNamed('Backlog')).toHaveLength(1);
    });

    it('is said plainly, with the rest made, where an owner or admin approves the plan whole', async () => {
        const id = await filedBefore(INSIDER, { projectId: P_OPEN, lists: ['Later'] }, ['Parked']);
        const out = await approve(id, ADMIN);
        expect(out.error).toBeUndefined();
        expect(listsNamed('Later')).toHaveLength(1);
        expect(out.applied[0].result.notMade).toEqual([{ part: 'statuses', name: 'Parked', error: expect.stringMatching(NOT_THIS_PLAN) }]);
        expect(out.applied[0].result.notMade[0].error).toMatch(/An owner or admin can add it in Settings, or ask their own AI/);
        expect(out.left).toBeUndefined();
        expect(statusNames()).not.toContain('Parked');
        expect(waiting()).toHaveLength(0);
    });

    it('leaves a plan that holds nothing else for nobody to approve, and anyone who could decline it still can', async () => {
        const id = await filedBefore(INSIDER, { projectId: P_OPEN, lists: ['Later'] }, ['Parked']);
        delete proposal(id).changes[0].params.lists;
        const before = everythingNow();
        for (const uid of [INSIDER, ADMIN]) {
            expect(await standing(id, uid)).toMatchObject({ locked: true, lockedWhy: 'not_this_plan', mayDecline: true });
            expect(await approve(id, uid)).toMatchObject({ status: 403, why: 'not_this_plan', error: expect.stringMatching(/cannot be made through it/) });
        }
        expect(everythingNow()).toBe(before);
        expect(proposal(id).status).toBe('pending');
    });

    it('still waits for an owner or admin where the person who asked is one', async () => {
        const id = await filed(NEW_STATUS, ADMIN);
        expect(await previewOf(id, INSIDER)).toMatchObject({ lockedWhy: { 'statuses:1': 'owner_admin' } });
        expect((await previewOf(id, OWNER)).locked).toBeUndefined();
    });
});

describe('what a list of waiting plans reads', () => {
    it('reads the rights behind a plan once for each reader, for the queue and for the AI Inbox list', async () => {
        await filed(WITH_LISTS);
        const asked = jest.spyOn(plans, 'whyNot');
        const partsAsked = () => asked.mock.calls.map((call) => call[3]).sort();
        await queue.readQueue(CID, INSIDER);
        expect(partsAsked()).toEqual(['fields', 'lists']);
        asked.mockClear();
        await send(LIST, { uid: INSIDER }, { query: { status: 'pending' } });
        expect(partsAsked()).toEqual(['fields', 'lists']);
    });

    it('builds a card for each row it returns and for no other', async () => {
        await filed(WITH_LISTS);
        await filed({ projectId: P_OPEN, lists: ['Later on'] });
        const built = jest.spyOn(intentPreview, 'forProposals');
        const page = await send(LIST, { uid: OWNER }, { query: { status: 'pending', limit: '1' } });
        expect(page.body.data).toHaveLength(1);
        expect(built.mock.calls.map((call) => call[2].length)).toEqual([1]);
    });
});

describe('a part with nothing to show', () => {
    const MESSY = { projectId: P_OPEN, statuses: ['In Review', ''], lists: ['Backlog', '   '], definitions: [BUDGET, { type: 'text' }], views: [{ name: '', kind: 'list', look: {} }], tasks: [{ name: 'Brief' }, { list: 'Backlog' }] };
    const ALL = ['statuses:0', 'statuses:1', 'lists:0', 'lists:1', 'fields:0', 'fields:1', 'views:0', 'tasks:0', 'tasks:1'];
    const BLANK = ['statuses:1', 'lists:1', 'fields:1', 'views:0', 'tasks:1'];

    it('is counted on the card and has no line there, so every part is either shown or named as not shown', async () => {
        const preview = await previewOf(keptAsRowsOnce(MESSY));
        expect(preview.blank).toEqual(BLANK);
        expect([...picksOf(preview), ...preview.blank].sort()).toEqual([...ALL].sort());
        expect((await previewOf(await filed(NEW_STATUS))).blank).toBeUndefined();
    });

    it('is not approved: an approval that keeps one is answered with why, and nothing is made', async () => {
        const id = keptAsRowsOnce(MESSY);
        const before = everythingNow();
        for (const parts of [undefined, { 0: { lists: [0, 1] } }, { 0: { lists: [0], tasks: [1] } }]) {
            expect(await approve(id, OWNER, parts)).toMatchObject({ status: 400, error: planShown.REFUSAL.error });
        }
        expect(everythingNow()).toBe(before);
        expect(proposal(id).status).toBe('pending');
    });

    it('is left out by an approval of the parts that are shown', async () => {
        const id = keptAsRowsOnce(MESSY);
        const out = await approve(id, OWNER, { 0: { statuses: [0], lists: [0], fields: [0], views: [], tasks: [0] } });
        expect(out.error).toBeUndefined();
        expect(listsNamed('Backlog')).toHaveLength(1);
        expect(liveFields()).toEqual(['Budget']);
        expect(tasksNamed('Brief')).toHaveLength(1);
        expect(out.left).toBeUndefined();
    });

    it('counts a part past what a card lists of its kind', () => {
        const lists = Array.from({ length: 12 }, (v, at) => `List ${at}`);
        expect(planShown.blankIn(TOOL, { projectId: P_OPEN, lists })).toEqual(['lists:10', 'lists:11']);
        expect(planShown.blankIn('task.add', { title: '' })).toEqual([]);
    });
});

describe('the list the AI Inbox reads', () => {
    it('gives a person the card of each waiting change, with the parts they may not approve marked', async () => {
        const id = await filed(NEW_STATUS);
        const members = await send(LIST, { uid: INSIDER }, { query: { status: 'pending' } });
        expect(members).toMatchObject({ code: 200, body: { status: true } });
        const row = members.body.data.find((entry) => String(entry._id) === id);
        expect(row).toMatchObject({ locked: false });
        expect(row.changes[0].preview).toMatchObject({ kind: 'setup', locked: ['statuses:1'], lockedWhy: { 'statuses:1': 'owner_admin' } });
        expect(picksOf(row.changes[0].preview)).toEqual(['statuses:0', 'statuses:1', 'lists:0', 'tasks:0', 'tasks:1']);

        const owners = await send(LIST, { uid: OWNER }, { query: { status: 'pending' } });
        expect(owners.body.data.find((entry) => String(entry._id) === id).changes[0].preview.locked).toBeUndefined();
    });

    it('takes the parts a person kept on that card through the approve route, and says what was left waiting', async () => {
        const id = await filed(NEW_STATUS);
        const out = await send(APPROVE, { uid: INSIDER }, { params: { id }, body: { parts: KEEPS_WHAT_A_MEMBER_MAY } });
        expect(out).toMatchObject({ code: 200, body: { status: true, data: { left: { waiting: [expect.any(String)], retry: [] } } } });
        const after = await send(LIST, { uid: INSIDER }, { query: { status: 'pending' } });
        expect(after.body.data.map((entry) => [String(entry._id), entry.locked, entry.lockedWhy])).toEqual([[out.body.data.left.waiting[0], true, 'owner_admin']]);
        expect(after.body.counts.waiting).toBe(0);
    });

    it('gives no card of a change that is decided', async () => {
        const id = await filed({ projectId: P_OPEN, lists: ['Backlog'] });
        await approve(id);
        const done = await send(LIST, { uid: OWNER }, { query: { status: 'all' } });
        expect(done.body.data.find((entry) => String(entry._id) === id).changes[0].preview).toBeUndefined();
    });
});
