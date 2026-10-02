/* Task 047, S-2b: a connected agent asks for a new project, with or without a plan for it (statuses, lists, fields,
   views). The call makes nothing: it waits as one proposal with one preview. Approved, the project is made by the web
   app's own create route as the person who approved, each part of the plan then runs as it does for a project that
   exists, and undo moves the project to the trash unless it holds work by then. */
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
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const intentPreview = require('../Modules/Agents/intentPreview');
const queue = require('../Modules/Inbox/helpers/approvalQueue');
const fieldCtrl = require('../Modules/CustomField/controller');
const socketEmitter = require('../event/socketEventEmitter');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');
const prompts = require('../Modules/Mcp/prompts');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, TOKEN, BEFORE, FLAGS, ctx, narrowed, readOnly, settle } = world;
const { seed, rows, stored, audits, setRule, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);

const TOOL = 'project.create';
const NAME = 'Website relaunch';
const V_LIST = '6f0000000000000000000e11';
const V_BOARD = '6f0000000000000000000e12';
const PEOPLE = [OWNER, INSIDER, OUTSIDER, GUEST];
const MEMBER_KEYS = ['project_create', 'project_description', 'project_delete', 'project_close', 'project_custom_field', 'view_list'];
const CATALOGUE = [
    { key: 1, name: 'To Do', textColor: '#ff9600', bgColor: '#ff960035', isDeleted: false },
    { key: 2, name: 'In Progress', textColor: '#6473e8', bgColor: '#6473e835', isDeleted: false },
    { key: 3, name: 'Done', textColor: '#24c110', bgColor: '#24c11035', isDeleted: false },
    { key: 4, name: 'In Review', textColor: '#111111', bgColor: '#11111135', isDeleted: false },
];
const PLAN = {
    name: `  ${NAME}\u0007 `,
    description: 'Everything for the new site.',
    statuses: ['In Review'],
    lists: ['Backlog', 'This week'],
    fields: [{ name: 'Budget', type: 'money' }],
    views: [{ name: 'Review board', kind: 'board', groupBy: 'status', showFields: ['Budget'] }],
    reason: 'A client project with a review step',
};

const projectsNamed = (name = NAME) => rows(SCHEMA_TYPE.PROJECTS).filter((row) => row.ProjectName === name);
const made = () => projectsNamed()[0];
const listsOf = (projectId) => rows(SCHEMA_TYPE.SPRINTS).filter((row) => String(row.projectId) === String(projectId) && Number(row.deletedStatusKey || 0) === 0).map((row) => row.name);
const fieldsOf = (projectId) => rows(SCHEMA_TYPE.CUSTOM_FIELDS).filter((field) => field.isDelete !== false && [].concat(field.projectId || []).map(String).includes(String(projectId))).map((field) => field.fieldTitle);
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const everythingNow = () => JSON.stringify([SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.CUSTOM_FIELDS, SCHEMA_TYPE.SETTINGS, SCHEMA_TYPE.TASKS].map((type) => mockDb.store[type]));
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = INSIDER) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const undo = (id, uid = INSIDER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid, over = {}) => {
    const base = ctx(uid, over);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid) } };
};
const filed = async (caller, args = PLAN) => {
    const out = await rpc(caller, TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const partOf = (result, name) => result.parts.find((part) => part.part === name);
const promptText = (caller) => { const prompt = prompts.get(caller, 'set_up_my_project'); return prompt ? prompt.messages[0].content.text : null; };

beforeEach(() => {
    seed();
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'project');
    MEMBER_KEYS.forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, {
        key, name: key, isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }],
    }));
    ['task_custom_field', 'project_details', 'project_sprint_create'].forEach((key) => setRule(key, false, [0]));
    mockDb.seed(SCHEMA_TYPE.SETTINGS, { name: 'task_status', totalStatus: 4, settings: CATALOGUE.map((status) => ({ ...status })) });
    mockDb.seed(SCHEMA_TYPE.SETTINGS, { name: 'project_status', totalStatus: 5, settings: [] });
    mockDb.seed(SCHEMA_TYPE.SETTINGS, { name: 'task_type', totalStatus: 1, settings: [{ key: 1, name: 'Task', value: 'task', taskImage: 'task.png' }] });
    mockDb.seed(SCHEMA_TYPE.PROJECT_TAB_COMPONENTS, { _id: V_LIST, keyName: 'ProjectListView', name: 'List', icon: 'list.svg', activeIcon: 'list-on.svg' });
    mockDb.seed(SCHEMA_TYPE.PROJECT_TAB_COMPONENTS, { _id: V_BOARD, keyName: 'ProjectKanban', name: 'Board', icon: 'board.svg', activeIcon: 'board-on.svg' });
    ['Priority', 'MultipleAssignees', 'TimeTracking', 'tags', 'CustomFields'].forEach((key) => mockDb.seed(SCHEMA_TYPE.APPS, { key, name: key, appStatus: true }));
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, {
        _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], projectIds: [], expiresAt: new Date(Date.now() + 86400000),
    }));
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag decides whether the tool exists', () => {
    it('off, the tool list and the registry are what they were', async () => {
        delete process.env.MCP_TOOLS_WORK;
        expect(await listed(as(OWNER))).toEqual(BEFORE);
        expect(registry.has(TOOL)).toBe(false);
        expect(actions.rating(TOOL)).toBeNull();
        expect((await rpc(as(OWNER), TOOL, PLAN)).rpcError).toMatchObject({ code: -32601 });
        expect(waiting()).toHaveLength(0);
    });

    it('on, it is a rated registry action that is always proposed, under the key that creates a project by hand', async () => {
        expect(await listed(as(OWNER))).toContain(TOOL);
        expect(registry.get(TOOL)).toMatchObject({ risk: 'medium', undoable: true, write: true, proposeOnly: true });
        expect(registry.permissionsFor(TOOL)).toEqual([{ key: 'project.project_create', write: true }]);
        expect(actions.rating(TOOL)).toEqual({ write: true, reversible: true, scope: 'workspace', money: false });
        expect(scopes.scopeForTool(TOOL)).toBe('tasks:write');
        expect(tools.registered().find((tool) => tool.name === TOOL).grant).toBeUndefined();
        expect(registry.isNever('project.delete')).toBe(true);
    });
});

describe('a project is never made before a person has seen it', () => {
    it('files the project and its plan as one proposal with one change, cleaned to plain text, and makes nothing', async () => {
        const before = everythingNow();
        const id = await filed(as(INSIDER));
        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(1);
        const [proposal] = waiting();
        expect(String(proposal._id)).toBe(id);
        expect(proposal).toMatchObject({ projectId: null, source: 'mcp', requestedBy: INSIDER });
        expect(proposal.changes).toHaveLength(1);
        expect(proposal.changes[0]).toMatchObject({ action: TOOL, reversible: true });
        expect(proposal.changes[0].params).toEqual({
            name: NAME,
            description: 'Everything for the new site.',
            statuses: ['In Review'],
            lists: ['Backlog', 'This week'],
            definitions: [{ name: 'Budget', type: 'money' }],
            views: [{ name: 'Review board', kind: 'board', look: { groupBy: 'status' }, showFields: ['Budget'] }],
        });
    });

    it('files a project with a name alone', async () => {
        await filed(as(INSIDER), { name: 'Hiring' });
        expect(waiting()[0].changes[0].params).toEqual({ name: 'Hiring' });
    });

    it('waits for a person whatever is set, and cannot be run directly', async () => {
        const actor = as(INSIDER).actor;
        expect(await projectPolicy.ask({ companyId: CID, actor, action: TOOL, params: { name: NAME } })).toMatchObject({ decision: 'propose' });
        const call = (given) => actions.perform({ companyId: CID, actor: as(OWNER).actor, action: TOOL, params: given, reason: 'direct' });
        await expect(call({ name: NAME })).rejects.toThrow(/must be proposed/);
        await expect(call({ name: NAME, __proposal: true })).rejects.toThrow(/waits for a person's approval/);
        expect(projectsNamed()).toHaveLength(0);
    });
});

describe('who may ask for a project', () => {
    it('refuses, with the reason, a person who may not create a project by hand, and files nothing', async () => {
        setRule('project_create', false, [3]);
        const before = everythingNow();
        const out = await rpc(as(OUTSIDER), TOOL, PLAN);
        expect(out).toMatchObject({ refused: true });
        expect(out.reason).toMatch(/^permission_denied: the person behind this token may not create a project by hand/);
        expect(audits(TOOL).map((row) => row.meta.ran)).toEqual([false]);
        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(0);
        await filed(as(OWNER));
    });

    it('refuses a guest', async () => {
        expect(await rpc(as(GUEST), TOOL, { name: NAME })).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: /) });
        expect(waiting()).toHaveLength(0);
    });

    it('refuses a plan with a part its person may not make by hand, and names the part', async () => {
        setRule('project_sprint_create', false, [3]);
        setRule('project_description', false, [3]);
        const out = await rpc(as(OUTSIDER), TOOL, PLAN);
        expect(out).toMatchObject({ refused: true });
        expect(out.reason).toMatch(/^permission_denied: .*: description \(project\.project_description is not granted\); lists \(project\.project_sprint_create is not granted\)$/);
        expect(waiting()).toHaveLength(0);
        await filed(as(OUTSIDER), { name: NAME, statuses: ['In Review'] });
    });

    it('refuses a token kept to some projects, and a token that only reads', async () => {
        const kept = { ...as(INSIDER), projectIds: narrowed(INSIDER, [P_OPEN]).projectIds };
        expect(await rpc(kept, TOOL, { name: NAME })).toMatchObject({ refused: true, reason: expect.stringMatching(/^not_visible: .*kept to some projects/) });
        expect(await rpc(readOnly(OWNER), TOOL, { name: NAME })).toMatchObject({ isError: true, error: 'This token is read-only.' });
        expect(waiting()).toHaveLength(0);
    });

    it('holds the name and each part to its limit and says what is wrong', async () => {
        const bad = async (args) => (await rpc(as(OWNER), TOOL, args)).rpcError;
        expect(await bad({})).toMatchObject({ code: -32602 });
        expect(await bad({ name: ' a ' })).toMatchObject({ code: -32602, message: expect.stringMatching(/name/) });
        expect(await bad({ name: 'x'.repeat(101) })).toMatchObject({ code: -32602 });
        expect(await bad({ name: NAME, projectId: P_OPEN })).toMatchObject({ code: -32602 });
        expect(await bad({ name: NAME, lists: Array.from({ length: 11 }, (v, at) => `L${at}`) })).toMatchObject({ code: -32602 });
        expect(await bad({ name: NAME, lists: ['Backlog', ' backlog '] })).toMatchObject({ code: -32602, message: expect.stringMatching(/named twice/) });
        expect(await bad({ name: NAME, fields: [{ name: 'Total', type: 'formula' }] })).toMatchObject({ code: -32602 });
        expect(await bad({ name: NAME, views: [{ name: 'Costs', showFields: ['Budget'] }] })).toMatchObject({ code: -32602, message: expect.stringMatching(/Budget/) });
        expect(await bad({ name: NAME, views: [{ name: 'Dates', kind: 'calendar' }] })).toMatchObject({ code: -32602 });
        expect(await bad({ name: NAME, views: [{ name: 'Mine', assigneeIds: [INSIDER] }] })).toMatchObject({ code: -32602 });
        expect(waiting()).toHaveLength(0);
    });
});

describe('approving makes the project as the web app would, as the person who approved', () => {
    it('creates it with only the approver on it, then makes each part of the plan and says what each made', async () => {
        const id = await filed(as(INSIDER));
        const out = await approve(id);
        expect(out.error).toBeUndefined();
        expect(out.applied).toHaveLength(1);
        expect(out.applied[0]).toMatchObject({ action: TOOL, ok: true });
        const { result } = out.applied[0];

        expect(projectsNamed()).toHaveLength(1);
        const project = made();
        const projectId = String(project._id);
        expect(project).toMatchObject({ ProjectName: NAME, ProjectCode: 'WR', CompanyId: CID, projectCreatedBy: INSIDER, AssigneeUserId: [INSIDER], LeadUserId: [], isPrivateSpace: true, isGlobalPermission: true });
        expect(Number(project.deletedStatusKey || 0)).toBe(0);
        expect(result).toMatchObject({ projectId, name: NAME, code: 'WR', made: 6, notMade: [] });
        expect(result.parts.map((part) => [part.part, part.ok])).toEqual([['description', true], ['statuses', true], ['lists', true], ['fields', true], ['views', true]]);

        expect(project.descriptionBlock.blocks).toEqual([{ type: 'paragraph', data: { text: 'Everything for the new site.' } }]);
        expect(project.taskStatusData.map((status) => status.name)).toEqual(['To Do', 'In Progress', 'In Review', 'Done']);
        expect(listsOf(projectId)).toEqual(['List', 'Backlog', 'This week']);
        expect(fieldsOf(projectId)).toEqual(['Budget']);
        expect(project.ProjectRequiredComponent.map((view) => view.title || view.name)).toEqual(['List', 'Board', 'Review board']);
        expect(partOf(result, 'views').items).toEqual([expect.objectContaining({ name: 'Review board', kind: 'board', made: true, leftOut: [] })]);

        expect(audits(TOOL, 'applied')[0]).toMatchObject({ entityType: 'project', entityId: projectId, meta: { onBehalfOf: INSIDER, undo: { kind: 'project', projectId } } });
        expect(socketEmitter.emit).toHaveBeenCalledWith('insert', expect.objectContaining({ module: 'project', companyId: CID, data: expect.objectContaining({ ProjectName: NAME }) }));
    });

    it('makes only the parts of its plan the approver kept, and the project either way', async () => {
        const id = await filed(as(INSIDER));
        const out = await proposals.approve(CID, id, { decider: human(INSIDER), isPrivileged: false, ip: '', parts: { 0: { lists: [1], fields: [0] } } });
        expect(out.error).toBeUndefined();
        const project = made();
        expect(project.ProjectName).toBe(NAME);
        expect(out.applied[0].result.parts.map((part) => part.part)).toEqual(['description', 'lists', 'fields']);
        expect(project.taskStatusData.map((status) => status.name)).toEqual(['To Do', 'In Progress', 'Done']);
        expect(listsOf(project._id)).toEqual(['List', 'This week']);
        expect(fieldsOf(project._id)).toEqual(['Budget']);
        expect(project.ProjectRequiredComponent.map((view) => view.title || view.name)).toEqual(['List', 'Board']);

        const refused = await proposals.approve(CID, await filed(as(INSIDER), { ...PLAN, name: 'Second site' }), { decider: human(INSIDER), isPrivileged: false, ip: '', parts: { 0: { views: [0] } } });
        expect(refused).toMatchObject({ status: 400, error: 'The view "Review board" needs the field "Budget", which is left out. Keep both, or leave both out.' });
        expect(projectsNamed('Second site')).toHaveLength(0);
    });

    it('creates a project asked for by its name alone', async () => {
        const out = await approve(await filed(as(INSIDER), { name: 'Hiring' }));
        expect(out.applied[0]).toMatchObject({ ok: true, result: { name: 'Hiring', code: 'H', made: 0, parts: [], notMade: [] } });
        const [project] = projectsNamed('Hiring');
        expect(project.taskStatusData.map((status) => status.name)).toEqual(['To Do', 'In Progress', 'Done']);
        expect(listsOf(project._id)).toEqual(['List']);
    });

    it('gives a second project of the same name a key of its own', async () => {
        await approve(await filed(as(INSIDER), { name: NAME }));
        const out = await approve(await filed(as(INSIDER), { name: NAME }));
        expect(out.applied[0].result.code).toBe('WR2');
        expect(projectsNamed().map((project) => project.ProjectCode)).toEqual(['WR', 'WR2']);
    });

    it('refuses an approver who may not create a project by hand, and makes nothing', async () => {
        const id = await filed(as(INSIDER));
        const before = everythingNow();
        expect(await approve(id, GUEST)).toMatchObject({ status: 403, error: expect.stringMatching(/approver may not/) });
        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(1);
    });

    it('refuses the approval when the token that asked has since been kept to some projects', async () => {
        const id = await filed(as(INSIDER));
        stored(SCHEMA_TYPE.API_TOKENS, tokenOf(INSIDER)).projectIds = [P_OPEN];
        expect(await approve(id)).toMatchObject({ status: 403, error: expect.stringMatching(/outside the token's project list/) });
        expect(projectsNamed()).toHaveLength(0);
    });

    it('asks the person behind the token again, and makes nothing when they may no longer create a project', async () => {
        const id = await filed(as(OUTSIDER));
        setRule('project_create', false, [3]);
        const out = await approve(id, OWNER);
        expect(out.applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/permission_denied/) });
        expect(projectsNamed()).toHaveLength(0);
    });

    it('makes the project for an approver who is not the person who asked, and none of a plan that person cannot reach', async () => {
        const id = await filed(as(OUTSIDER));
        const out = await approve(id, OWNER);
        expect(out.applied[0].ok).toBe(true);
        const { result } = out.applied[0];
        expect(made()).toMatchObject({ projectCreatedBy: OWNER, AssigneeUserId: [OWNER], isPrivateSpace: true });
        expect(result.made).toBe(0);
        expect(result.parts.map((part) => [part.part, part.ok])).toEqual([['description', false], ['statuses', false], ['lists', false], ['fields', false], ['views', false]]);
        expect(result.notMade.map((entry) => entry.part)).toEqual(['description', 'statuses', 'lists', 'lists', 'fields', 'views']);
        expect(result.notMade[0].error).toMatch(/is not on it yet/);
        expect(listsOf(made()._id)).toEqual(['List']);
    });

    it('keeps the project and the parts that worked when one part fails', async () => {
        jest.spyOn(fieldCtrl, 'insertCustomFieldPromise').mockRejectedValue(new Error('disk full'));
        const out = await approve(await filed(as(INSIDER)));
        const { result } = out.applied[0];
        expect(out.applied[0].ok).toBe(true);
        expect(partOf(result, 'fields')).toMatchObject({ ok: false });
        expect(partOf(result, 'lists')).toMatchObject({ ok: true });
        expect(result.notMade.map((entry) => [entry.part, entry.name])).toEqual([['fields', 'Budget']]);
        expect(projectsNamed()).toHaveLength(1);
    });
});

describe('undo moves the project to the trash', () => {
    it('trashes it, where a person can restore it, and deletes nothing', async () => {
        const id = await filed(as(INSIDER));
        await approve(id);
        const projectId = String(made()._id);
        const out = await undo(id);
        expect(out.error).toBeUndefined();
        expect(out.results[0]).toMatchObject({ ok: true, result: { projectId, name: NAME, trashed: true } });
        expect(projectsNamed()).toHaveLength(1);
        expect(Number(made().deletedStatusKey)).toBe(1);
        expect(audits(TOOL, 'applied')[0].meta.undoneAt).toBeTruthy();
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'project', companyId: CID, updatedFields: { deletedStatusKey: 1 } }));
        expect(rows(SCHEMA_TYPE.SPRINTS).filter((row) => String(row.projectId) === projectId)).toHaveLength(3);
    });

    it('leaves a project that holds a task or a doc by then, and says why', async () => {
        const first = await filed(as(INSIDER));
        await approve(first);
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Draft the brief', ProjectID: String(made()._id), CompanyId: CID, statusKey: 1, deletedStatusKey: 0 });
        expect((await undo(first)).results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/"Website relaunch" holds a task now, so it stays/) });
        expect(Number(made().deletedStatusKey || 0)).toBe(0);
        expect(audits(TOOL, 'applied')[0].meta.undoneAt).toBeFalsy();

        const second = await filed(as(INSIDER), { name: 'Hiring' });
        await approve(second);
        const [hiring] = projectsNamed('Hiring');
        mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Role notes', ProjectID: String(hiring._id), createdBy: INSIDER, deletedStatusKey: 0 });
        expect((await undo(second)).results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/holds a doc now/) });
        expect(Number(projectsNamed('Hiring')[0].deletedStatusKey || 0)).toBe(0);
    });

    it('is refused for a person who may not delete a project by hand', async () => {
        const id = await filed(as(INSIDER));
        await approve(id);
        setRule('project_delete', false, [3]);
        setRule('project_close', false, [3]);
        const out = await undo(id);
        expect(out.results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/may not delete/) });
        expect(Number(made().deletedStatusKey || 0)).toBe(0);
    });
});

describe('the preview says what will be made', () => {
    const previewFor = async (uid, proposal) => (await intentPreview.forProposals(CID, uid, [proposal])).get(String(proposal._id));

    it('names the project, who will be on it, and every part of the plan', async () => {
        await filed(as(INSIDER));
        expect(await previewFor(INSIDER, waiting()[0])).toEqual([{
            kind: 'project',
            title: NAME,
            lines: [
                { kind: 'members', only: 'approver' },
                { kind: 'description', text: 'Everything for the new site.', more: false },
                { kind: 'newStatuses', names: ['In Review'], picks: ['statuses:0'] },
                { kind: 'newLists', names: ['Backlog', 'This week'], picks: ['lists:0', 'lists:1'] },
                { kind: 'field', name: 'Budget', type: 'money', options: [], pick: 'fields:0' },
                { kind: 'planView', name: 'Review board', layout: 'board', pick: 'views:0' },
                { kind: 'group', by: 'status', field: '', under: 'views:0' },
                { kind: 'columns', names: ['Budget'], others: 0, under: 'views:0' },
            ],
            needs: { 'views:0': ['fields:0'] },
        }]);
    });

    it('shows the proposal in the queue of the person who asked and of an owner, and of nobody else', async () => {
        const id = await filed(as(INSIDER));
        const idsFor = async (uid) => (await queue.readQueue(CID, uid)).map((row) => row.proposalId);
        expect(await idsFor(INSIDER)).toContain(id);
        expect(await idsFor(OWNER)).toContain(id);
        expect(await idsFor(OUTSIDER)).not.toContain(id);
        const row = (await queue.readQueue(CID, INSIDER)).find((entry) => entry.proposalId === id);
        expect(row.changes[0].preview).toMatchObject({ kind: 'project', title: NAME });
    });
});

describe('the "Set up my project" prompt', () => {
    it('sends the agent to the tool for a project that is not there yet, only on a connection that can run it', () => {
        expect(promptText(as(OWNER))).toContain('`project.create`');
        expect(promptText(as(OWNER))).not.toMatch(/You cannot make a project yourself/);
        expect(promptText({ ...as(OWNER), allowedActions: ['tasks.search', 'task.create', 'project.setup'] })).not.toContain('`project.create`');
        expect(promptText({ ...as(OWNER), allowedActions: ['tasks.search', 'task.create', 'project.setup'] })).toMatch(/You cannot make a project yourself/);
        delete process.env.MCP_TOOLS_WORK;
        expect(promptText(as(OWNER))).not.toContain('`project.create`');
        expect(promptText(as(OWNER))).toMatch(/You cannot make a project yourself/);
    });
});
