/* Task 047, S-2: a setup plan is one thing whatever road files it. It is stored in one shape, asked the same
   questions before it is stored, shown with the same parts on its card, and each part is approved by a person
   who may approve that part. */
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
const plans = require('../Modules/Agents/projectSetup');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const intentPreview = require('../Modules/Agents/intentPreview');
const approverRights = require('../Modules/Agents/approverRights');
const access = require('../Modules/Agents/access');
const queue = require('../Modules/Inbox/helpers/approvalQueue');
const matcher = require('../Modules/Automations/engine/matcher');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, TOKEN, FLAGS, ctx, settle } = world;
const { seed, rows, stored, audits, setRule, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const routes = world.routeTable(require('../Modules/Agents/routes').init);

const TOOL = 'project.setup';
const NEW_PROJECT = 'project.create';
const GRANT = 'tasks:manage';
const AGENT = '6f0000000000000000000a11';
const V_LIST = '6f0000000000000000000e11';
const PEOPLE = [OWNER, ADMIN, INSIDER, OUTSIDER, GUEST];
const FILE = 'POST /api/v2/agents/proposals';
const APPROVE = 'POST /api/v2/agents/proposals/:id/approve';
const NOTICE = '[S-2] Ready for review';
const CATALOGUE = [
    { key: 1, name: 'To Do', textColor: '#ff9600', bgColor: '#ff960035', isDeleted: false },
    { key: 2, name: 'In Progress', textColor: '#6473e8', bgColor: '#6473e835', isDeleted: false },
    { key: 3, name: 'Done', textColor: '#24c110', bgColor: '#24c11035', isDeleted: false },
    { key: 4, name: 'In Review', textColor: '#111111', bgColor: '#11111135', isDeleted: false },
];
const reviewNotice = (over = {}) => ({
    trigger: 'task.status_changed',
    conditions: [{ field: 'statusRef', op: 'changedTo', value: 'In Review' }],
    actions: [{ action: 'notify', config: { recipients: ['task_assignees'], message: NOTICE } }],
    ...over,
});
const BUDGET = { name: 'Budget', type: 'money' };
const AS_SENT = { projectId: P_OPEN, lists: ['Backlog', 'Later'], fields: [BUDGET], views: [{ name: 'Mine', mine: true, showFields: ['Budget'] }] };
const AS_KEPT = { projectId: P_OPEN, lists: ['Backlog', 'Later'], definitions: [BUDGET], views: [{ name: 'Mine', kind: 'list', look: { mine: true }, showFields: ['Budget'] }] };
const WITH_WORK = { projectId: P_OPEN, statuses: ['In Review'], lists: ['Backlog'], rules: [reviewNotice()], tasks: [{ name: 'Write the brief', list: 'Backlog' }, { name: 'Collect the logins' }] };

const view = (_id, keyName, title) => ({ _id, id: _id, keyName, name: title, value: title, title, icon: `${title}.svg`, activeIcon: `${title}-on.svg`, sortIndex: 1, viewStatus: true });
const project = (id = P_OPEN) => stored(SCHEMA_TYPE.PROJECTS, id);
const listsNamed = (name) => rows(SCHEMA_TYPE.SPRINTS).filter((row) => row.name === name && String(row.projectId) === P_OPEN && Number(row.deletedStatusKey || 0) === 0);
const liveFields = () => rows(SCHEMA_TYPE.CUSTOM_FIELDS).filter((field) => field.isDelete !== false).map((field) => field.fieldTitle);
const viewTitles = () => project().ProjectRequiredComponent.map((entry) => entry.title);
const liveRules = () => rows(SCHEMA_TYPE.AUTOMATION_RULES).filter((rule) => Number(rule.deletedStatusKey) !== 1);
const taskNamed = (name) => rows(SCHEMA_TYPE.TASKS).find((task) => task.TaskName === name && Number(task.deletedStatusKey || 0) === 0);
const proposal = (id) => stored(SCHEMA_TYPE.AGENT_PROPOSALS, id);
const paramsOf = (id) => JSON.parse(JSON.stringify(proposal(id).changes[0].params));
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const everythingNow = () => JSON.stringify([SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.CUSTOM_FIELDS, SCHEMA_TYPE.TASKS, SCHEMA_TYPE.AUTOMATION_RULES].map((type) => mockDb.store[type]));
const human = (userId) => ({ kind: 'human', userId });
const privileged = (uid) => [OWNER, ADMIN].includes(uid);
const approve = (id, uid = OWNER, over = {}) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: privileged(uid), ip: '', ...over });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid, over = {}) => {
    const base = ctx(uid, over);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, grants: [GRANT], ...(over.token || {}), _id: tokenOf(uid) } };
};
const filedByConnection = async (args, caller = as(OWNER)) => {
    const out = await rpc(caller, TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const previewOf = async (id, uid = OWNER) => (await intentPreview.forProposals(CID, uid, [proposal(id)])).get(String(id))[0];
const picksOf = (preview) => preview.lines.flatMap((line) => [...(line.picks || []), ...(line.pick ? [line.pick] : [])]);

const send = async (route, caller, { params = {}, body = {} } = {}) => {
    const [method, path] = route.split(' ');
    const url = Object.entries(params).reduce((text, [name, value]) => text.replace(`:${name}`, value), path);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
    const req = { ...caller, method, originalUrl: url, url, query: {}, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    for (const handler of routes[route]) {
        let passed = false;
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    await settle();
    return { code: res.statusCode, body: res.body };
};
const agentOf = (uid) => ({ uid, apiToken: { _id: tokenOf(uid), userId: uid, name: 'Planner', agentId: AGENT, scopes: ['read', 'write'] } });
const fileOnWeb = (uid, params, action = TOOL) => send(FILE, agentOf(uid), {
    body: { agentId: AGENT, ...(params.projectId ? { projectId: params.projectId } : {}), what: 'Set the project up', why: 'Asked for in chat', changes: [{ action, params, label: 'Set up' }] },
});
const filedOnWeb = async (params, uid = OWNER, action = TOOL) => {
    const out = await fileOnWeb(uid, params, action);
    expect(out).toMatchObject({ code: 200, body: { status: true } });
    return String(out.body.data._id);
};
const keptAsRowsOnce = (params, action = TOOL) => String(mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
    agentId: AGENT, agentName: 'Planner', runId: null, taskId: null, projectId: P_OPEN, what: 'Set the project up', why: '', status: 'pending', gate: null, priority: 'normal', auditIds: [],
    changes: [{ action, params, label: 'Set up', reversible: true }], createdAt: new Date(),
})._id);

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

describe('a plan is stored in one shape', () => {
    it.each([['as it is sent', AS_SENT], ['as it is kept', AS_KEPT]])('keeps a plan filed on the web road, %s, as the connected road keeps it', async (name, plan) => {
        const web = await filedOnWeb(plan);
        const connected = await filedByConnection(AS_SENT);
        expect(paramsOf(web)).toEqual(paramsOf(connected));
        expect(paramsOf(web)).toEqual(AS_KEPT);
    });

    it('keeps a new project and its plan the same way', async () => {
        const web = await filedOnWeb({ name: '  Client work ', lists: ['Backlog'], fields: [BUDGET], views: [{ name: 'Mine', mine: true }] }, OWNER, NEW_PROJECT);
        expect(paramsOf(web)).toEqual({ name: 'Client work', lists: ['Backlog'], definitions: [BUDGET], views: [{ name: 'Mine', kind: 'list', look: { mine: true } }] });
    });

    it('shows every part on the card with its place in the plan', async () => {
        const preview = await previewOf(await filedOnWeb(AS_SENT));
        expect(picksOf(preview)).toEqual(['lists:0', 'lists:1', 'fields:0', 'views:0']);
        expect(preview.lines).toEqual(expect.arrayContaining([
            { kind: 'field', name: 'Budget', type: 'money', options: [], pick: 'fields:0' },
            { kind: 'planView', name: 'Mine', layout: 'list', pick: 'views:0' },
            { kind: 'mine', under: 'views:0' },
        ]));
        expect(preview.needs).toEqual({ 'views:0': ['fields:0'] });
        const created = await previewOf(await filedOnWeb({ name: 'Client work', fields: [BUDGET] }, OWNER, NEW_PROJECT));
        expect(picksOf(created)).toEqual(['fields:0']);
    });

    it('makes only the parts the approver kept', async () => {
        const id = await filedOnWeb(AS_SENT);
        const out = await approve(id, OWNER, { parts: { 0: { lists: [0] } } });
        expect(out.error).toBeUndefined();
        expect(out.applied[0].result.parts.map((part) => part.part)).toEqual(['lists']);
        expect(listsNamed('Backlog')).toHaveLength(1);
        expect(listsNamed('Later')).toHaveLength(0);
        expect(liveFields()).toEqual([]);
        expect(viewTitles()).toEqual(['List']);
    });

    it('refuses a kept view whose field is left out', async () => {
        const id = await filedOnWeb(AS_SENT);
        expect((await approve(id, OWNER, { parts: { 0: { views: [0] } } })).error).toBe('The view "Mine" needs the field "Budget", which is left out. Keep both, or leave both out.');
        expect(proposal(id).status).toBe('pending');
    });

    it('reads a stored plan the same way whatever keys its row holds', async () => {
        const id = keptAsRowsOnce(AS_SENT);
        expect(picksOf(await previewOf(id))).toEqual(['lists:0', 'lists:1', 'fields:0', 'views:0']);
        const out = await approve(id, OWNER, { parts: { 0: { lists: [1] } } });
        expect(out.error).toBeUndefined();
        expect(listsNamed('Later')).toHaveLength(1);
        expect(liveFields()).toEqual([]);
        expect(viewTitles()).toEqual(['List']);
        expect(paramsOf(id)).toEqual({ projectId: P_OPEN, lists: ['Later'] });
    });

    it('keeps an edited plan in the same shape', async () => {
        const id = keptAsRowsOnce({ projectId: P_OPEN, lists: ['Backlog'] });
        const out = await approve(id, OWNER, { changes: [{ action: TOOL, params: { projectId: P_OPEN, fields: [BUDGET] }, label: 'Set up' }] });
        expect(out.error).toBeUndefined();
        expect(paramsOf(id)).toEqual({ projectId: P_OPEN, definitions: [BUDGET] });
        expect(liveFields()).toEqual(['Budget']);
    });
});

describe('the web road asks of a plan what the connected road asks', () => {
    const answeredAlike = async (uid, plan) => {
        const before = everythingNow();
        const connected = await rpc(as(uid), TOOL, plan);
        const web = await fileOnWeb(uid, plan);
        expect(waiting()).toHaveLength(0);
        expect(everythingNow()).toBe(before);
        return { connected, web };
    };

    it('answers a plan that is not one, or is over a cap, with what is wrong with it', async () => {
        const wrong = async (plan) => {
            const web = await fileOnWeb(OWNER, { projectId: P_OPEN, ...plan });
            expect(web).toMatchObject({ code: 400, body: { status: false, statusText: plans.setupProblem(plan) } });
            expect(plans.setupProblem(plan)).not.toBe('');
        };
        await wrong({});
        await wrong({ lists: Array.from({ length: 11 }, (v, at) => `List ${at}`) });
        await wrong({ lists: ['Backlog', 'backlog'] });
        await wrong({ fields: [{ name: 'Budget' }] });
        await wrong({ views: [{ name: 'Mine', showFields: ['Nowhere'] }] });
        await wrong({ tasks: Array.from({ length: 31 }, (v, at) => ({ name: `Task ${at}` })) });
        await wrong({ tasks: [{ name: 'Brief', dueDate: 'tomorrow' }] });
        await wrong({ rules: [reviewNotice({ enabled: true })] });
        await wrong({ rules: [reviewNotice({ actions: [{ action: 'send_email', config: {} }] })] });
        expect(waiting()).toHaveLength(0);
        const web = await fileOnWeb(OWNER, { name: 'Cl' }, NEW_PROJECT);
        expect(web).toMatchObject({ code: 400, body: { statusText: 'name needs 3 to 100 characters' } });
        expect(waiting()).toHaveLength(0);
    });

    it('answers what a rule or a task names that is in neither the plan nor the project, in the same words', async () => {
        for (const plan of [
            { projectId: P_OPEN, rules: [reviewNotice({ conditions: [{ field: 'statusRef', op: 'changedTo', value: 'Nowhere' }] })] },
            { projectId: P_OPEN, tasks: [{ name: 'Brief', list: 'Nowhere' }] },
            { projectId: P_OPEN, tasks: [{ name: 'Brief', status: 'Nowhere' }] },
        ]) {
            const { connected, web } = await answeredAlike(OWNER, plan);
            expect(connected).toMatchObject({ ok: false, error: expect.stringMatching(/^(rules|tasks)\[0\]/) });
            expect(web).toMatchObject({ code: 400, body: { status: false, statusText: connected.error } });
        }
    });

    it('answers a first task for someone who cannot be assigned in the project, in the same words', async () => {
        const { connected, web } = await answeredAlike(INSIDER, { projectId: P_PRIVATE, tasks: [{ name: 'Brief', assigneeId: OUTSIDER }] });
        expect(connected).toMatchObject({ ok: false, error: expect.stringMatching(/^tasks\[0\] \(Brief\): /) });
        expect(web).toMatchObject({ code: 400, body: { statusText: connected.error } });
    });

    it('answers a view of a kind the project has none of to start from', async () => {
        const { connected, web } = await answeredAlike(OWNER, { projectId: P_OPEN, views: [{ name: 'Board', kind: 'board' }] });
        expect(connected).toMatchObject({ ok: false, error: expect.stringMatching(/no board view/) });
        expect(web).toMatchObject({ code: 400, body: { statusText: connected.error } });
    });

    it('refuses what the person behind the agent could not ask for one at a time, and records it', async () => {
        const { connected, web } = await answeredAlike(INSIDER, { projectId: P_OPEN, rules: [reviewNotice({ conditions: [] })] });
        expect(connected).toMatchObject({ refused: true });
        expect(web).toMatchObject({ code: 403, body: { status: false, statusText: connected.reason } });
        expect(audits(TOOL).map((row) => row.meta.ran)).toEqual([false, false]);

        setRule('task_create', false, [3]);
        const tasks = await answeredAlike(INSIDER, { projectId: P_OPEN, tasks: [{ name: 'Collect the logins' }] });
        expect(tasks.connected).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: task\.task_create/) });
        expect(tasks.web).toMatchObject({ code: 403, body: { statusText: tasks.connected.reason } });
    });

    it('refuses a first task that closes itself where the project has people close its tasks', async () => {
        await projectPolicy.save(CID, P_OPEN, { done: 'never' }, OWNER);
        const { connected, web } = await answeredAlike(INSIDER, { projectId: P_OPEN, tasks: [{ name: 'Already done', status: 'Done' }] });
        expect(connected).toMatchObject({ refused: true, reason: expect.stringMatching(/people close its tasks/) });
        expect(web).toMatchObject({ code: 403, body: { statusText: connected.reason } });
    });

    it('refuses a part the person behind the agent may not make by hand', async () => {
        setRule('project_sprint_create', false, [3]);
        const { connected, web } = await answeredAlike(INSIDER, { projectId: P_OPEN, lists: ['Backlog'] });
        expect(connected).toMatchObject({ refused: true, reason: expect.stringMatching(/may not make these parts of the plan by hand/) });
        expect(web).toMatchObject({ code: 403, body: { statusText: connected.reason } });
    });

    it('files a plan that passes, and an owner approves it as before', async () => {
        const id = await filedOnWeb(WITH_WORK);
        const out = await approve(id);
        expect(out.error).toBeUndefined();
        expect(out.applied[0].result.parts.map((part) => [part.part, part.ok])).toEqual([['statuses', true], ['lists', true], ['rules', true], ['tasks', true]]);
        expect(liveRules()).toHaveLength(1);
        expect(taskNamed('Write the brief')).toBeTruthy();
        expect(proposal(id).status).toBe('approved');
    });
});

describe('a part only an owner or an admin approves', () => {
    const KEEPS_ALL_BUT_RULES = { 0: { statuses: [0], lists: [0], rules: [], tasks: [0, 1] } };
    const personOf = (uid) => access.personOf(CID, uid);
    const standing = async (id, uid) => approverRights.standingOf(CID, await personOf(uid), proposal(id));
    const FILED = [
        ['a connected agent', (plan) => filedByConnection(plan)],
        ['a workspace agent', (plan) => filedOnWeb(plan)],
    ];

    describe.each(FILED)('in a plan filed by %s', (name, file) => {
        it('is marked on the card of a member, and on nobody else\'s', async () => {
            const id = await file(WITH_WORK);
            expect((await previewOf(id, INSIDER)).locked).toEqual(['rules:0']);
            expect((await previewOf(id, OWNER)).locked).toBeUndefined();
            expect((await previewOf(id, ADMIN)).locked).toBeUndefined();
        });

        it('is not approved by a member who keeps it, and nothing is made', async () => {
            const id = await file(WITH_WORK);
            const before = everythingNow();
            for (const kept of [{}, { parts: {} }, { parts: { 0: { statuses: [0], rules: [0] } } }]) {
                expect(await approve(id, INSIDER, kept)).toMatchObject({ status: 403, reason: 'not_permitted', error: 'An owner or admin approves a part of this plan. Leave that part out, or ask an owner or admin to approve it.' });
            }
            expect(everythingNow()).toBe(before);
            expect(proposal(id).status).toBe('pending');
            expect(proposal(id).decidedBy).toBeUndefined();
        });

        it('is left out by a member, who approves the rest', async () => {
            const id = await file(WITH_WORK);
            const out = await approve(id, INSIDER, { parts: KEEPS_ALL_BUT_RULES });
            expect(out.error).toBeUndefined();
            expect(out.applied[0].result.parts.map((part) => [part.part, part.ok])).toEqual([['statuses', true], ['lists', true], ['tasks', true]]);
            expect(out.applied[0].result.notMade).toEqual([]);
            expect(liveRules()).toHaveLength(0);
            expect(taskNamed('Write the brief')).toBeTruthy();
        });

        it('is approved by an owner or an admin as before', async () => {
            const out = await approve(await file(WITH_WORK), ADMIN);
            expect(out.error).toBeUndefined();
            expect(liveRules()).toHaveLength(1);
        });

        it('leaves the plan open to a member while it holds a part they may approve', async () => {
            expect(await standing(await file(WITH_WORK), INSIDER)).toMatchObject({ locked: false, mayDecline: true });
            expect(await standing(await file({ projectId: P_OPEN, rules: [reviewNotice({ conditions: [] })] }), INSIDER)).toMatchObject({ locked: true, lockedWhy: 'owner_admin' });
        });
    });

    it('holds a first task to what the approver\'s role may make', async () => {
        ['project_custom_field', 'view_list', 'project_details', 'project_sprint_create'].forEach((key) => setRule(key, true, [3, 0]));
        const id = await filedByConnection({ projectId: P_OPEN, lists: ['Backlog'], tasks: [{ name: 'Collect the logins' }] }, as(INSIDER));
        expect((await previewOf(id, GUEST)).locked).toEqual(['tasks:0']);
        expect((await previewOf(id, INSIDER)).locked).toBeUndefined();
        expect(await approve(id, GUEST)).toMatchObject({ status: 403, reason: 'not_permitted' });
        expect(proposal(id).status).toBe('pending');
        expect(listsNamed('Backlog')).toHaveLength(0);
        const out = await approve(id, GUEST, { parts: { 0: { lists: [0], tasks: [] } } });
        expect(out.error).toBeUndefined();
        expect(listsNamed('Backlog')).toHaveLength(1);
        expect(taskNamed('Collect the logins')).toBeUndefined();
    });

    it('reaches the approval queue of a member as a row they can decide, with the part marked', async () => {
        const id = await filedByConnection(WITH_WORK);
        const row = (await queue.readQueue(CID, INSIDER)).find((entry) => entry.proposalId === id);
        expect(row).toMatchObject({ locked: false });
        expect(row.changes[0].preview.locked).toEqual(['rules:0']);
        const owners = (await queue.readQueue(CID, OWNER)).find((entry) => entry.proposalId === id);
        expect(owners.changes[0].preview.locked).toBeUndefined();
    });

    it('answers the approve route the same way', async () => {
        const id = await filedByConnection(WITH_WORK);
        const kept = await send(APPROVE, { uid: INSIDER }, { params: { id }, body: {} });
        expect(kept).toMatchObject({ code: 403, body: { status: false, statusText: expect.stringMatching(/^An owner or admin approves a part of this plan/), reason: 'not_permitted' } });
        expect(proposal(id).status).toBe('pending');
        const left = await send(APPROVE, { uid: INSIDER }, { params: { id }, body: { parts: KEEPS_ALL_BUT_RULES } });
        expect(left).toMatchObject({ code: 200, body: { status: true } });
        expect(liveRules()).toHaveLength(0);
    });
});

describe('an approval that leaves nothing out', () => {
    it('is kept as approved, with or without a choice of parts', async () => {
        for (const [at, parts] of [undefined, {}, { 0: { lists: [0, 1] } }].entries()) {
            const id = await filedByConnection({ projectId: P_OPEN, lists: [`Backlog ${at}`, `Later ${at}`] });
            const out = await approve(id, OWNER, parts === undefined ? {} : { parts });
            expect(out.error).toBeUndefined();
            expect(listsNamed(`Later ${at}`)).toHaveLength(1);
            expect(proposal(id).status).toBe('approved');
        }
    });

    it('is kept as edited once a part is left out', async () => {
        const id = await filedByConnection(WITH_WORK);
        await approve(id, OWNER, { parts: { 0: { statuses: [0], lists: [0], tasks: [0, 1] } } });
        expect(proposal(id).status).toBe('edited');
    });
});
