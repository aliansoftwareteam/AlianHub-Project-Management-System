/* Task 047, S-2: a plan for a project can also hold automations and first tasks. Each one is made, once the plan
   is approved, as the call an agent would make for it alone: the same action, held to the same rules, with its
   own audit row and its own undo. So a plan asks for nothing its agent could not ask for one at a time. */
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
const projectPolicy = require('../Modules/Agents/projectPolicy');
const intentPreview = require('../Modules/Agents/intentPreview');
const planChoice = require('../Modules/Agents/planChoice');
const projects = require('../Modules/Agents/projectCreate');
const matcher = require('../Modules/Automations/engine/matcher');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const server = require('../Modules/Mcp/server');
const prompts = require('../Modules/Mcp/prompts');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, TOKEN, FLAGS, ctx, settle } = world;
const { seed, rows, stored, audits, setRule, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);

const TOOL = 'project.setup';
const RULE = 'automation.create';
const TASK = 'task.add';
const GRANT = 'tasks:manage';
const V_LIST = '6f0000000000000000000e11';
const PEOPLE = [OWNER, ADMIN, INSIDER, OUTSIDER, GUEST];
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
const TASKS = [
    { name: 'Write the brief', list: 'Backlog', status: 'In Review', assigneeId: INSIDER, dueDate: '2026-11-02' },
    { name: 'Book the kickoff', list: 'Open list' },
    { name: 'Collect the logins' },
];
const PLAN = {
    projectId: P_OPEN,
    statuses: ['In Review'],
    lists: ['Backlog'],
    fields: [{ name: 'Budget', type: 'money' }],
    views: [{ name: 'Mine', mine: true }],
    rules: [reviewNotice()],
    tasks: TASKS,
    reason: 'A client project with a review step',
};
const tasksOnly = (tasks = TASKS, over = {}) => ({ projectId: P_OPEN, lists: ['Backlog'], statuses: ['In Review'], tasks, ...over });

const view = (_id, keyName, title) => ({ _id, id: _id, keyName, name: title, value: title, title, icon: `${title}.svg`, activeIcon: `${title}-on.svg`, sortIndex: 1, viewStatus: true });
const project = (id = P_OPEN) => stored(SCHEMA_TYPE.PROJECTS, id);
const statusNames = () => project().taskStatusData.map((status) => status.name);
const listsNamed = (name) => rows(SCHEMA_TYPE.SPRINTS).filter((row) => row.name === name && String(row.projectId) === P_OPEN && Number(row.deletedStatusKey || 0) === 0);
const liveRules = () => rows(SCHEMA_TYPE.AUTOMATION_RULES).filter((rule) => Number(rule.deletedStatusKey) !== 1);
const taskNamed = (name) => rows(SCHEMA_TYPE.TASKS).find((task) => task.TaskName === name && Number(task.deletedStatusKey || 0) === 0);
const proposal = (id) => stored(SCHEMA_TYPE.AGENT_PROPOSALS, id);
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const everythingNow = () => JSON.stringify([SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.CUSTOM_FIELDS, SCHEMA_TYPE.TASKS, SCHEMA_TYPE.AUTOMATION_RULES].map((type) => mockDb.store[type]));
const human = (userId) => ({ kind: 'human', userId });
const privileged = (uid) => [OWNER, ADMIN].includes(uid);
const approve = (id, uid = OWNER, parts = undefined) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: privileged(uid), ip: '', ...(parts ? { parts } : {}) });
const undo = (id, uid = OWNER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: privileged(uid), ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid, over = {}) => {
    const base = ctx(uid, over);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, grants: [GRANT], ...(over.token || {}), _id: tokenOf(uid) } };
};
const filed = async (args = PLAN, caller = as(OWNER)) => {
    const out = await rpc(caller, TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const partOf = (out, name) => out.applied[0].result.parts.find((part) => part.part === name);
const previewOf = async (id, uid = OWNER) => (await intentPreview.forProposals(CID, uid, [proposal(id)])).get(id)[0];

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
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, {
        _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], grants: [GRANT], projectIds: [], expiresAt: new Date(Date.now() + 86400000),
    }));
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
    matcher.invalidateAll();
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('a plan with automations and first tasks waits like any other', () => {
    it('files them inside the one change, cleaned to what each is made of, and makes nothing', async () => {
        const before = everythingNow();
        const id = await filed({ ...PLAN, tasks: [{ ...TASKS[0], name: '  Write the\u0007   brief ' }, TASKS[1], TASKS[2]] });
        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(1);
        expect(proposal(id).changes).toHaveLength(1);
        expect(proposal(id).changes[0].params).toMatchObject({
            projectId: P_OPEN,
            statuses: ['In Review'],
            lists: ['Backlog'],
            rules: [{ trigger: 'task.status_changed', conditions: [{ field: 'statusRef', op: 'changedTo', value: 'In Review' }], actions: [{ action: 'notify', config: { recipients: ['task_assignees'], message: NOTICE } }] }],
            tasks: [
                { name: 'Write the brief', list: 'Backlog', status: 'In Review', assigneeId: INSIDER, dueDate: '2026-11-02' },
                { name: 'Book the kickoff', list: 'Open list' },
                { name: 'Collect the logins' },
            ],
        });
        expect(Object.keys(proposal(id).changes[0].params.rules[0]).sort()).toEqual(['actions', 'conditions', 'trigger']);
    });

    it('takes a plan that is only first tasks, or only automations', async () => {
        await filed({ projectId: P_OPEN, tasks: [{ name: 'Collect the logins' }] }, as(INSIDER));
        await filed({ projectId: P_OPEN, rules: [reviewNotice({ conditions: [{ field: 'statusRef', op: 'changedTo', value: 'Done' }] })] });
        expect(waiting()).toHaveLength(2);
    });

    it('holds automations and tasks to their caps and to what each may be made of', async () => {
        const bad = async (plan) => (await rpc(as(OWNER), TOOL, { projectId: P_OPEN, ...plan })).rpcError;
        expect(await bad({ rules: Array.from({ length: 6 }, () => reviewNotice()) })).toMatchObject({ code: -32602 });
        expect(await bad({ tasks: Array.from({ length: 31 }, (v, at) => ({ name: `Task ${at}` })) })).toMatchObject({ code: -32602 });
        expect(await bad({ rules: [] })).toMatchObject({ code: -32602 });
        expect(await bad({ tasks: [] })).toMatchObject({ code: -32602 });
        expect(await bad({ rules: [reviewNotice({ enabled: true })] })).toMatchObject({ code: -32602 });
        expect(await bad({ rules: [reviewNotice({ reactToAutomation: true })] })).toMatchObject({ code: -32602 });
        expect(await bad({ rules: [reviewNotice({ actions: [{ action: 'run_agent', config: {} }] })] })).toMatchObject({ code: -32602, message: expect.stringMatching(/rules\[0\].*AI agent/) });
        expect(await bad({ rules: [reviewNotice({ actions: [{ action: 'send_email', config: {} }] })] })).toMatchObject({ code: -32602, message: expect.stringMatching(/rules\[0\]/) });
        expect(await bad({ rules: [reviewNotice({ trigger: 'schedule.daily' })] })).toMatchObject({ code: -32602 });
        expect(await bad({ rules: [reviewNotice({ actions: Array.from({ length: 11 }, () => ({ action: 'notify', config: {} })) })] })).toMatchObject({ code: -32602 });
        expect(await bad({ tasks: [{ list: 'Backlog' }] })).toMatchObject({ code: -32602 });
        expect(await bad({ tasks: [{ name: '   ' }] })).toMatchObject({ code: -32602, message: expect.stringMatching(/needs a name/) });
        expect(await bad({ tasks: [{ name: 'Brief', dueDate: '2026-13-40' }] })).toMatchObject({ code: -32602 });
        expect(await bad({ tasks: [{ name: 'Brief', dueDate: 'tomorrow' }] })).toMatchObject({ code: -32602 });
        expect(await bad({ tasks: [{ name: 'Brief', assigneeId: 'Ian' }] })).toMatchObject({ code: -32602 });
        expect(await bad({ tasks: [{ name: 'Brief', description: 'x' }] })).toMatchObject({ code: -32602 });
        expect(waiting()).toHaveLength(0);
    });

    it('keeps automations and tasks out of the plan of a project that is not there yet', async () => {
        expect(projects.draftOf({ name: 'Client work', lists: ['Backlog'], rules: [reviewNotice()], tasks: [{ name: 'Brief' }] })).toEqual({ name: 'Client work', lists: ['Backlog'] });
        expect((await rpc(as(OWNER), 'project.create', { name: 'Client work', tasks: [{ name: 'Brief' }] })).rpcError).toMatchObject({ code: -32602 });
    });
});

describe('a plan asks for nothing its agent could not ask for one at a time', () => {
    const refusedFor = async (caller, plan, reason) => {
        const before = everythingNow();
        const out = await rpc(caller, TOOL, plan);
        expect(out).toMatchObject({ refused: true, reason: expect.stringMatching(reason) });
        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(0);
    };

    it('refuses automations from a person who may not have one proposed, as the tool for one does', async () => {
        const alone = await rpc(as(INSIDER), RULE, { projectId: P_OPEN, ...reviewNotice({ conditions: [] }) });
        expect(alone).toMatchObject({ refused: true });
        await refusedFor(as(INSIDER), { projectId: P_OPEN, rules: [reviewNotice({ conditions: [] })] }, new RegExp(alone.reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        expect(audits(TOOL).map((row) => row.meta.ran)).toEqual([false]);
    });

    it('refuses first tasks from a connection that may not create a task with its details', async () => {
        const plan = tasksOnly();
        await refusedFor(as(INSIDER, { token: { grants: [] } }), plan, /^permission_denied: .*is not allowed to use/);
        delete process.env.MCP_TOOLS_MANAGE;
        await refusedFor(as(INSIDER), plan, /^permission_denied: .*is not allowed to use/);
    });

    it('refuses what the skills of the connection leave out', async () => {
        await refusedFor(as(INSIDER, { allowedActions: [TOOL] }), tasksOnly(), /^permission_denied: .*is not allowed to use/);
        await refusedFor(as(OWNER, { allowedActions: [TOOL, TASK] }), { projectId: P_OPEN, rules: [reviewNotice({ conditions: [] })] }, /^permission_denied: .*is not allowed to use/);
        await filed(tasksOnly(), as(INSIDER, { allowedActions: [TOOL, TASK] }));
    });

    it('refuses first tasks from a person who may not create one, or may not set what a task names', async () => {
        setRule('task_assignee', false, [3]);
        await refusedFor(as(INSIDER), tasksOnly(), /^permission_denied: task\.task_assignee/);
        setRule('task_create', false, [3]);
        await refusedFor(as(INSIDER), tasksOnly([TASKS[2]]), /^permission_denied: task\.task_create/);
        setRule('task_create', true, [3]);
        await filed(tasksOnly([TASKS[1], TASKS[2]]), as(INSIDER));
    });

    it('refuses a first task that closes itself where the project has people close its tasks', async () => {
        await projectPolicy.save(CID, P_OPEN, { done: 'never' }, OWNER);
        await refusedFor(as(INSIDER), tasksOnly([{ name: 'Already done', status: 'Done' }]), /only people close tasks/);
        await filed(tasksOnly([{ name: 'Still open', status: 'In Progress' }]), as(INSIDER));
    });

    it('answers at once what a rule or a task names that is in neither the plan nor the project', async () => {
        const answer = async (plan, error) => {
            expect(await rpc(as(OWNER), TOOL, { projectId: P_OPEN, ...plan })).toMatchObject({ ok: false, error: expect.stringMatching(error) });
        };
        await answer({ rules: [reviewNotice()] }, /^rules\[0\]: .*In Review/);
        await answer({ tasks: [{ name: 'Brief', list: 'Nowhere' }] }, /^tasks\[0\] \(Brief\): "Nowhere" is not a list in this plan or in the project/);
        await answer({ tasks: [{ name: 'Brief', status: 'Nowhere' }] }, /^tasks\[0\] \(Brief\): "Nowhere" is not a status in this plan or in the project/);
        expect(await rpc(as(OUTSIDER), TOOL, { projectId: P_OPEN, tasks: [{ name: 'Brief', list: 'Private list' }] })).toMatchObject({ ok: false, error: expect.stringMatching(/^tasks\[0\] \(Brief\): "Private list" is not a list/) });
        expect(await rpc(as(INSIDER), TOOL, { projectId: P_PRIVATE, tasks: [{ name: 'Brief', assigneeId: OUTSIDER }] })).toMatchObject({ ok: false, error: expect.stringMatching(/^tasks\[0\] \(Brief\): /) });
        expect(waiting()).toHaveLength(0);
        await filed({ projectId: P_OPEN, statuses: ['In Review'], rules: [reviewNotice()] });
    });
});

describe('approving makes each automation and each task as its own action, after the rest', () => {
    it('makes the statuses and lists, the fields, the views, then the automations, then the tasks', async () => {
        const id = await filed();
        const out = await approve(id);
        expect(out.error).toBeUndefined();
        const { result } = out.applied[0];
        expect(result.parts.map((part) => [part.part, part.ok])).toEqual([['statuses', true], ['lists', true], ['fields', true], ['views', true], ['rules', true], ['tasks', true]]);
        expect(result).toMatchObject({ made: 8, notMade: [] });

        expect(liveRules()).toHaveLength(1);
        const [rule] = liveRules();
        expect(rule).toMatchObject({ enabled: false, createdBy: OWNER, scope: { allProjects: false, projectIds: [P_OPEN] }, trigger: { type: 'event', event: 'task.status_changed' } });
        expect(JSON.stringify(rule.conditions)).toContain(`${P_OPEN}:4`);
        expect(partOf(out, 'rules').items).toEqual([{ name: expect.stringContaining(NOTICE), made: true, ruleId: String(rule._id), auditId: expect.any(String) }]);

        const [backlog] = listsNamed('Backlog');
        expect(String(taskNamed('Write the brief').ProjectID)).toBe(P_OPEN);
        expect(taskNamed('Write the brief')).toMatchObject({ sprintId: String(backlog._id), statusKey: 4, AssigneeUserId: [INSIDER] });
        expect(new Date(taskNamed('Write the brief').DueDate).toISOString().slice(0, 10)).toBe('2026-11-02');
        expect(taskNamed('Book the kickoff')).toMatchObject({ sprintId: L_OPEN, statusKey: 1, AssigneeUserId: [] });
        expect(taskNamed('Collect the logins')).toMatchObject({ statusKey: 1 });
        expect(partOf(out, 'tasks').items.map((item) => [item.name, item.made])).toEqual([['Write the brief', true], ['Book the kickoff', true], ['Collect the logins', true]]);
    });

    it('leaves an audit row for each, under the action a call for it alone leaves', async () => {
        const id = await filed();
        await approve(id);
        expect(audits(TOOL, 'applied')).toHaveLength(1);
        expect(audits(RULE, 'applied')).toHaveLength(1);
        expect(audits(TASK, 'applied')).toHaveLength(3);
        expect(audits(RULE, 'applied')[0].meta).toMatchObject({ onBehalfOf: OWNER, undo: { kind: 'automation', projectId: P_OPEN } });
        expect(audits(TASK, 'applied')[0].meta).toMatchObject({ onBehalfOf: OWNER, undo: { kind: 'task', projectId: P_OPEN } });
        expect(proposal(id).auditIds).toHaveLength(5);
    });

    it('makes an automation only for an owner or an admin who approves, and the rest for anyone who may', async () => {
        const id = await filed();
        const out = await approve(id, INSIDER);
        expect(out.error).toBeUndefined();
        expect(partOf(out, 'rules')).toMatchObject({ ok: false, items: [{ made: false, error: expect.stringMatching(/owner or an admin/) }] });
        expect(out.applied[0].result.notMade).toEqual([{ part: 'rules', name: 'automation number 1', error: expect.stringMatching(/owner or an admin/) }]);
        expect(liveRules()).toHaveLength(0);
        expect(partOf(out, 'tasks').ok).toBe(true);
        expect(taskNamed('Write the brief')).toBeTruthy();
    });

    it('makes no task for an approver who may not create one', async () => {
        ['project_custom_field', 'view_list', 'project_details', 'project_sprint_create'].forEach((key) => setRule(key, true, [3, 0]));
        const id = await filed(tasksOnly([TASKS[2]]), as(INSIDER));
        const out = await approve(id, GUEST);
        expect(partOf(out, 'lists').ok).toBe(true);
        expect(partOf(out, 'tasks')).toMatchObject({ ok: false, items: [{ name: 'Collect the logins', made: false, error: expect.stringMatching(/person approving may not/) }] });
        expect(taskNamed('Collect the logins')).toBeUndefined();
    });

    it('asks the person behind the token again when the plan is approved', async () => {
        const id = await filed(tasksOnly([TASKS[1], TASKS[2]]), as(INSIDER));
        setRule('task_create', false, [3]);
        const out = await approve(id);
        expect(partOf(out, 'lists').ok).toBe(true);
        expect(partOf(out, 'tasks').items.map((item) => item.error)).toEqual([expect.stringMatching(/permission_denied/), expect.stringMatching(/permission_denied/)]);
        expect(taskNamed('Book the kickoff')).toBeUndefined();
        expect(audits(TASK).map((row) => row.meta.ran)).toEqual([false, false]);
    });

    it('holds a task to the project\'s rule for agents as it stands when the plan is approved', async () => {
        const id = await filed(tasksOnly([{ name: 'Already done', status: 'Done' }, TASKS[2]]), as(INSIDER));
        await projectPolicy.save(CID, P_OPEN, { done: 'never' }, OWNER);
        const out = await approve(id);
        expect(partOf(out, 'tasks').items).toEqual([
            { name: 'Already done', made: false, error: expect.stringMatching(/only people close tasks/) },
            { name: 'Collect the logins', made: true, taskId: expect.any(String), auditId: expect.any(String) },
        ]);
        expect(taskNamed('Already done')).toBeUndefined();
    });

    it('holds a plan to the skills it was filed with, whoever filed it', async () => {
        const saved = await proposals.create(CID, {
            agent: { _id: `mcp:${tokenOf(OWNER)}`, name: 'Claude (MCP)' }, projectId: P_OPEN, what: TOOL, why: 'via MCP',
            changes: [{ action: TOOL, params: { projectId: P_OPEN, lists: ['Backlog'], rules: [reviewNotice({ conditions: [] })], tasks: [{ name: 'Brief' }] }, label: TOOL }],
            source: 'mcp', requestedBy: OWNER, tokenId: tokenOf(OWNER), tokenProjectIds: [], allowedActions: [TOOL],
        });
        const out = await approve(String(saved._id));
        expect(partOf(out, 'lists').ok).toBe(true);
        expect(partOf(out, 'rules').items[0]).toMatchObject({ made: false, error: expect.stringMatching(/is not switched on for this connection/) });
        expect(partOf(out, 'tasks').items[0]).toMatchObject({ made: false, error: expect.stringMatching(/is not switched on for this connection/) });
        expect(liveRules()).toHaveLength(0);
        expect(taskNamed('Brief')).toBeUndefined();
    });

    it('is not approved once the token no longer holds what the first tasks need', async () => {
        const id = await filed(tasksOnly(), as(INSIDER));
        stored(SCHEMA_TYPE.API_TOKENS, tokenOf(INSIDER)).grants = [];
        expect(await approve(id)).toMatchObject({ status: 403, error: expect.stringMatching(/grant/) });
        expect(proposal(id).status).toBe('pending');
        expect(listsNamed('Backlog')).toHaveLength(0);
        const kept = await approve(id, OWNER, { 0: { lists: [0], statuses: [0] } });
        expect(kept.error).toBeUndefined();
        expect(listsNamed('Backlog')).toHaveLength(1);
    });

    it('reports a task that could not be made beside the ones that were', async () => {
        const id = await filed(tasksOnly([TASKS[1], TASKS[2]]), as(INSIDER));
        stored(SCHEMA_TYPE.SPRINTS, L_OPEN).deletedStatusKey = 1;
        const out = await approve(id);
        expect(out.applied[0].ok).toBe(true);
        expect(partOf(out, 'tasks').items[0]).toMatchObject({ name: 'Book the kickoff', made: false, error: expect.stringMatching(/Open list/) });
        expect(out.applied[0].result.notMade).toEqual([{ part: 'tasks', name: 'Book the kickoff', error: expect.stringMatching(/Open list/) }]);
    });
});

describe('the person leaves out single automations and tasks', () => {
    it('makes only the ticked ones', async () => {
        const id = await filed();
        const out = await approve(id, OWNER, { 0: { statuses: [0], lists: [0], tasks: [0, 2] } });
        expect(out.error).toBeUndefined();
        expect(out.applied[0].result.parts.map((part) => part.part)).toEqual(['statuses', 'lists', 'tasks']);
        expect(liveRules()).toHaveLength(0);
        expect(taskNamed('Write the brief')).toBeTruthy();
        expect(taskNamed('Book the kickoff')).toBeUndefined();
        expect(taskNamed('Collect the logins')).toBeTruthy();
    });

    it('refuses a task kept without the list or the status it names, and an automation kept without its status', async () => {
        const id = await filed();
        const before = everythingNow();
        expect((await approve(id, OWNER, { 0: { statuses: [0], tasks: [0] } })).error).toBe('The task "Write the brief" needs the list "Backlog", which is left out. Keep both, or leave both out.');
        expect((await approve(id, OWNER, { 0: { lists: [0], tasks: [0] } })).error).toBe('The task "Write the brief" needs the status "In Review", which is left out. Keep both, or leave both out.');
        expect((await approve(id, OWNER, { 0: { lists: [0], rules: [0] } })).error).toBe('The automation number 1 needs the status "In Review", which is left out. Keep both, or leave both out.');
        expect(everythingNow()).toBe(before);
        expect(proposal(id).status).toBe('pending');
    });

    it('knows what each automation and task needs', () => {
        expect(planChoice.needsOf({ ...PLAN, definitions: PLAN.fields })).toEqual({ 'rules:0': ['statuses:0'], 'tasks:0': ['lists:0', 'statuses:0'] });
        expect(planChoice.needsOf({ projectId: P_OPEN, statuses: ['Blocked', 'In Review'], rules: [reviewNotice({ conditions: [{ field: 'statusRef', op: 'changedTo', value: 'blocked or in review' }], actions: [{ action: 'set_status', config: { status: 'Blocked' } }] })] }))
            .toEqual({ 'rules:0': ['statuses:0', 'statuses:1'] });
    });
});

describe('undo takes back the tasks and the automations with the rest', () => {
    it('removes them newest first, then what the plan set up', async () => {
        const id = await filed();
        await approve(id);
        const out = await undo(id);
        expect(out.error).toBeUndefined();
        expect(out.results.map((result) => result.ok)).toEqual([true, true, true, true, true]);
        expect(taskNamed('Write the brief')).toBeUndefined();
        expect(taskNamed('Collect the logins')).toBeUndefined();
        expect(liveRules()).toHaveLength(0);
        expect(listsNamed('Backlog')).toHaveLength(0);
        expect(statusNames()).toEqual(['To Do', 'In Progress', 'Done']);
        expect(listsNamed('Open list')).toHaveLength(1);
    });
});

describe('the "Set up my project" prompt', () => {
    const promptText = (caller) => prompts.get(caller, 'set_up_my_project').messages[0].content.text;

    it('puts the automations and the first tasks in the one plan on a connection that may ask for each', () => {
        expect(promptText(as(OWNER))).toMatch(/Then send the statuses, lists, fields and views, the automations and the first tasks together in one call of `project\.setup`/);
        expect(promptText(as(OWNER))).toMatch(/can leave any part out before I approve/);
        expect(promptText(as(OWNER))).not.toMatch(/automations are a part I have to make myself/);
    });

    it('leaves the first tasks to the calls after the approval on a connection that may not create a task with its details', () => {
        const plain = promptText(as(OWNER, { token: { grants: [] } }));
        expect(plain).toMatch(/Then send the statuses, lists, fields and views and the automations together in one call/);
        expect(plain).toMatch(/Then make the rest of what I approved: .*tasks with `task\.create`/);
    });

    it('leaves the automations to the person on a connection kept away from them', () => {
        const kept = promptText(as(OWNER, { allowedActions: ['tasks.search', 'task.add', 'task.assignees.set', 'project.setup'] }));
        expect(kept).toMatch(/automations are a part I have to make myself/);
        expect(kept).toMatch(/Then send the statuses, lists, fields and views and the first tasks together in one call/);
    });
});

describe('the preview lists the automations and the first tasks as parts of their own', () => {
    it('says each automation in a sentence and each task with where it goes, and what each needs', async () => {
        const preview = await previewOf(await filed());
        const extra = preview.lines.filter((line) => ['planRule', 'planTask'].includes(line.kind));
        expect(extra).toEqual([
            { kind: 'planRule', text: expect.stringContaining(NOTICE), pick: 'rules:0' },
            { kind: 'planTask', name: 'Write the brief', list: 'Backlog', status: 'In Review', assignee: 'Ian Insider', hidden: 0, due: '2026-11-02', pick: 'tasks:0' },
            { kind: 'planTask', name: 'Book the kickoff', list: 'Open list', status: '', assignee: '', hidden: 0, due: '', pick: 'tasks:1' },
            { kind: 'planTask', name: 'Collect the logins', list: '', status: '', assignee: '', hidden: 0, due: '', pick: 'tasks:2' },
        ]);
        expect(extra[0].text).toContain('In Review');
        expect(preview.lines.map((line) => line.kind).slice(0, 5)).toEqual(['place', 'newStatuses', 'newLists', 'field', 'planView']);
        expect(preview.needs).toEqual({ 'rules:0': ['statuses:0'], 'tasks:0': ['lists:0', 'statuses:0'] });
    });

    it('says why instead, for an automation that cannot be made', async () => {
        const saved = await proposals.create(CID, {
            agent: { _id: `mcp:${tokenOf(OWNER)}`, name: 'Claude (MCP)' }, projectId: P_OPEN, what: TOOL, why: 'via MCP',
            changes: [{ action: TOOL, params: { projectId: P_OPEN, rules: [reviewNotice({ conditions: [{ field: 'statusRef', op: 'changedTo', value: 'Nowhere' }] })] }, label: TOOL }],
            source: 'mcp', requestedBy: OWNER, tokenId: tokenOf(OWNER), tokenProjectIds: [], allowedActions: [],
        });
        const preview = await previewOf(String(saved._id));
        expect(preview.lines[1]).toEqual({ kind: 'planRule', problem: expect.stringContaining('Nowhere'), pick: 'rules:0' });
    });

    it('shows nothing of the plan to someone who cannot open the project', async () => {
        const id = await filed({ projectId: P_PRIVATE, tasks: [{ name: 'Secret brief', assigneeId: INSIDER }] }, as(INSIDER));
        expect(await previewOf(id, OUTSIDER)).toBeNull();
        expect((await previewOf(id, INSIDER)).lines[1]).toMatchObject({ kind: 'planTask', name: 'Secret brief', assignee: 'Ian Insider' });
    });
});
