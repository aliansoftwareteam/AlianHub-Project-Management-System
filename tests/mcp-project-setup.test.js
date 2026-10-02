/* Task 047, S-2: a connected agent sends one plan for a project it can open (statuses, lists, fields, views).
   The plan waits as one proposal with one preview; approved, each part runs the web app's own route, a part that
   fails does not hide the others, and undo takes back what the plan made and nothing a person has used since. */
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
const fieldCtrl = require('../Modules/CustomField/controller');
const socketEmitter = require('../event/socketEventEmitter');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');
const prompts = require('../Modules/Mcp/prompts');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, T_OPEN, TOKEN, MISSING, BEFORE, FLAGS, ctx, narrowed, readOnly, settle } = world;
const { seed, rows, stored, audits, setRule, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);

const TOOL = 'project.setup';
const KEYS = ['project.project_details', 'project.project_sprint_create', 'project.project_custom_field', 'task.task_custom_field', 'project.view_list'];
const NO_PROJECT = 'not_visible: the project is not one the person behind this token can open';
const V_LIST = '6f0000000000000000000e11';
const V_BOARD = '6f0000000000000000000e12';
const PEOPLE = [OWNER, INSIDER, OUTSIDER, GUEST];
const CATALOGUE = [
    { key: 1, name: 'To Do', textColor: '#ff9600', bgColor: '#ff960035', isDeleted: false },
    { key: 2, name: 'In Progress', textColor: '#6473e8', bgColor: '#6473e835', isDeleted: false },
    { key: 3, name: 'Done', textColor: '#24c110', bgColor: '#24c11035', isDeleted: false },
    { key: 4, name: 'In Review', textColor: '#111111', bgColor: '#11111135', isDeleted: false },
];
const PLAN = {
    projectId: P_OPEN,
    statuses: ['In Review', ' in progress '],
    lists: ['Backlog', 'This week'],
    fields: [{ name: 'Budget', type: 'money' }, { name: 'Region', type: 'dropdown', options: ['North', 'South'] }],
    views: [{ name: 'Review board', kind: 'board', groupBy: 'status', statuses: ['In Review'], showFields: ['Budget'] }],
    reason: 'A client project with a review step',
};

const view = (_id, keyName, title) => ({ _id, id: _id, keyName, name: title, value: title, title, icon: `${title}.svg`, activeIcon: `${title}-on.svg`, sortIndex: 1, viewStatus: true });
const project = (id = P_OPEN) => stored(SCHEMA_TYPE.PROJECTS, id);
const statusNames = (id = P_OPEN) => project(id).taskStatusData.map((status) => status.name);
const catalogue = () => rows(SCHEMA_TYPE.SETTINGS).find((row) => row.name === 'task_status');
const listsNamed = (name) => rows(SCHEMA_TYPE.SPRINTS).filter((row) => row.name === name && Number(row.deletedStatusKey || 0) === 0);
const fieldNamed = (name) => rows(SCHEMA_TYPE.CUSTOM_FIELDS).find((field) => field.fieldTitle === name);
const liveFields = () => rows(SCHEMA_TYPE.CUSTOM_FIELDS).filter((field) => field.isDelete !== false).map((field) => field.fieldTitle);
const viewTitles = (id = P_OPEN) => project(id).ProjectRequiredComponent.map((entry) => entry.title);
const viewNamed = (title) => project().ProjectRequiredComponent.find((entry) => entry.title === title);
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const everythingNow = () => JSON.stringify([SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.CUSTOM_FIELDS, SCHEMA_TYPE.SETTINGS, SCHEMA_TYPE.TASKS].map((type) => mockDb.store[type]));
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = OWNER) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const undo = (id, uid = OWNER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
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
    ['project_custom_field', 'view_list'].forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, {
        key, name: key, isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }],
    }));
    ['task_custom_field', 'project_details', 'project_sprint_create'].forEach((key) => setRule(key, false, [0]));
    project(P_OPEN).ProjectRequiredComponent = [view(V_LIST, 'ProjectListView', 'List'), view(V_BOARD, 'ProjectKanban', 'Board')];
    mockDb.seed(SCHEMA_TYPE.SETTINGS, { name: 'task_status', totalStatus: 4, settings: CATALOGUE.map((status) => ({ ...status })) });
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

    it('on, it is a rated registry action that is always proposed, under the keys its parts ask for', async () => {
        expect(await listed(as(OWNER))).toContain(TOOL);
        expect(registry.get(TOOL)).toMatchObject({ risk: 'medium', undoable: true, write: true, proposeOnly: true });
        expect(registry.permissionsFor(TOOL)).toEqual([{ key: KEYS[0], anyOf: KEYS, write: true }]);
        expect(actions.rating(TOOL)).toEqual({ write: true, reversible: true, scope: 'project', money: false });
        expect(scopes.scopeForTool(TOOL)).toBe('tasks:write');
        expect(tools.registered().find((tool) => tool.name === TOOL).grant).toBeUndefined();
    });
});

describe('a plan is never carried out before a person has seen it', () => {
    it('files the whole plan as one proposal with one change, cleaned to plain text, and makes nothing', async () => {
        const before = everythingNow();
        const id = await filed(as(INSIDER), { ...PLAN, lists: ['  Backlog\u0007 ', 'This   week'] });
        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(1);
        const [proposal] = waiting();
        expect(String(proposal._id)).toBe(id);
        expect(proposal).toMatchObject({ projectId: P_OPEN, source: 'mcp', requestedBy: INSIDER });
        expect(proposal.changes).toHaveLength(1);
        expect(proposal.changes[0]).toMatchObject({ action: TOOL, reversible: true });
        expect(proposal.changes[0].params).toEqual({
            projectId: P_OPEN,
            statuses: ['In Review', 'in progress'],
            lists: ['Backlog', 'This week'],
            definitions: [{ name: 'Budget', type: 'money' }, { name: 'Region', type: 'dropdown', options: ['North', 'South'] }],
            views: [{ name: 'Review board', kind: 'board', look: { groupBy: 'status', statuses: ['In Review'] }, showFields: ['Budget'] }],
        });
    });

    it('waits for a person whatever the project is set to, and cannot be run directly', async () => {
        const actor = as(INSIDER).actor;
        const params = { projectId: P_OPEN, lists: ['Backlog'] };
        expect(await projectPolicy.ask({ companyId: CID, actor, action: TOOL, params })).toMatchObject({ decision: 'propose' });
        expect(await projectPolicy.ask({ companyId: CID, actor, action: TOOL, params, approved: true })).toEqual({ decision: 'act', reason: '' });
        const call = (given) => actions.perform({ companyId: CID, actor: as(OWNER).actor, action: TOOL, params: given, reason: 'direct' });
        await expect(call(params)).rejects.toThrow(/must be proposed/);
        await expect(call({ ...params, __proposal: true })).rejects.toThrow(/waits for a person's approval/);
        expect(listsNamed('Backlog')).toHaveLength(0);
    });
});

describe('who may send a plan', () => {
    it('files for an owner and for a member who may make every part', async () => {
        await filed(as(OWNER));
        await filed(as(OUTSIDER));
        await filed(as(INSIDER), { projectId: P_PRIVATE, lists: ['Backlog'] });
        expect(waiting()).toHaveLength(3);
    });

    it('refuses a plan with a part its person may not make by hand, names the part, and files nothing', async () => {
        setRule('project_custom_field', false, [3]);
        setRule('task_custom_field', false, [3]);
        setRule('project_sprint_create', false, [3]);
        const out = await rpc(as(OUTSIDER), TOOL, PLAN);
        expect(out).toMatchObject({ ok: false, refused: true });
        expect(out.reason).toMatch(/permission_denied/);
        expect(out.parts.map((part) => part.part)).toEqual(['lists', 'fields']);
        expect(waiting()).toHaveLength(0);
        await filed(as(OUTSIDER), { projectId: P_OPEN, statuses: ['In Review'], views: [{ name: 'Mine', mine: true }] });
    });

    it('refuses a guest, who may make none of it', async () => {
        const before = everythingNow();
        const out = await rpc(as(GUEST), TOOL, PLAN);
        expect(out).toMatchObject({ ok: false, refused: true, reason: expect.stringMatching(/permission_denied/) });
        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(0);
    });

    it('answers a project the person cannot open, and one outside a narrowed token, as a missing project', async () => {
        const plan = (projectId) => ({ projectId, lists: ['Backlog'] });
        expect(await rpc(as(OWNER), TOOL, plan(MISSING))).toMatchObject({ refused: true, reason: NO_PROJECT });
        for (const [uid, projectId] of [[OUTSIDER, P_PRIVATE], [GUEST, P_PRIVATE], [OWNER, P_PERSONAL]]) {
            expect(await rpc(as(uid), TOOL, plan(projectId))).toMatchObject({ refused: true, reason: NO_PROJECT });
        }
        expect(await rpc({ ...as(INSIDER), projectIds: narrowed(INSIDER, [P_OPEN]).projectIds }, TOOL, plan(P_PRIVATE))).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc(readOnly(OWNER), TOOL, plan(P_OPEN))).toMatchObject({ isError: true, error: 'This token is read-only.' });
        expect(waiting()).toHaveLength(0);
    });

    it('holds each part to its cap and says what is wrong with a plan', async () => {
        const bad = async (plan) => (await rpc(as(OWNER), TOOL, { projectId: P_OPEN, ...plan })).rpcError;
        expect(await bad({})).toMatchObject({ code: -32602, message: expect.stringMatching(/at least one/) });
        expect(await bad({ statuses: Array.from({ length: 11 }, (v, at) => `S${at}`) })).toMatchObject({ code: -32602 });
        expect(await bad({ lists: Array.from({ length: 11 }, (v, at) => `L${at}`) })).toMatchObject({ code: -32602 });
        expect(await bad({ fields: Array.from({ length: 11 }, (v, at) => ({ name: `F${at}`, type: 'text' })) })).toMatchObject({ code: -32602 });
        expect(await bad({ views: Array.from({ length: 6 }, (v, at) => ({ name: `V${at}` })) })).toMatchObject({ code: -32602 });
        expect(await bad({ lists: ['Backlog', ' backlog '] })).toMatchObject({ code: -32602, message: expect.stringMatching(/named twice/) });
        expect(await bad({ statuses: ['  '] })).toMatchObject({ code: -32602 });
        expect(await bad({ fields: [{ name: 'Total', type: 'formula' }] })).toMatchObject({ code: -32602 });
        expect(await bad({ views: [{ name: 'Costs', showFields: ['Budget'] }] })).toMatchObject({ code: -32602, message: expect.stringMatching(/Budget/) });
        expect(await bad({ lists: ['Backlog'], projectName: 'A new one' })).toMatchObject({ code: -32602 });
        expect(await rpc(as(OWNER), TOOL, { projectId: P_OPEN, views: [{ name: 'Dates', kind: 'calendar' }] })).toMatchObject({ ok: false, error: expect.stringMatching(/no calendar view/) });
        expect(waiting()).toHaveLength(0);
    });
});

describe('approving carries out each part as the web app would', () => {
    it('adds the statuses, lists, fields and views, and says what each part made', async () => {
        const id = await filed(as(INSIDER));
        const out = await approve(id);
        expect(out.error).toBeUndefined();
        expect(out.applied).toHaveLength(1);
        const { result } = out.applied[0];
        expect(out.applied[0]).toMatchObject({ action: TOOL, ok: true });
        expect(result).toMatchObject({ projectId: P_OPEN, made: 6, notMade: [] });
        expect(result.parts.map((part) => [part.part, part.ok])).toEqual([['statuses', true], ['lists', true], ['fields', true], ['views', true]]);

        expect(statusNames()).toEqual(['To Do', 'In Progress', 'In Review', 'Done']);
        expect(project().taskStatusData[2]).toMatchObject({ key: 4, name: 'In Review', textColor: '#111111', bgColor: '#11111135', type: 'active' });
        expect(partOf(result, 'statuses').items).toEqual([{ name: 'In Review', made: true, statusKey: 4 }, { name: 'In Progress', made: false, statusKey: 2 }]);
        expect(catalogue().settings).toHaveLength(4);

        expect(listsNamed('Backlog')).toHaveLength(1);
        expect(listsNamed('This week')).toHaveLength(1);
        expect(String(listsNamed('Backlog')[0].projectId)).toBe(P_OPEN);

        expect(fieldNamed('Budget')).toMatchObject({ global: false, projectId: [P_OPEN], type: 'task', isDelete: true, userId: INSIDER });
        expect(fieldNamed('Region').fieldOptions.map((option) => option.label)).toEqual(['North', 'South']);

        expect(viewTitles()).toEqual(['List', 'Board', 'Review board']);
        const made = viewNamed('Review board');
        expect(made.keyName).toBe('ProjectKanban');
        expect(made.settings.columns.shown).toEqual([`cf:${String(fieldNamed('Budget')._id)}`]);
        expect(made.settings.filters[0]).toMatchObject({ values: [4] });
        expect(partOf(result, 'views').items).toEqual([{ name: 'Review board', kind: 'board', made: true, viewId: String(made._id), leftOut: [] }]);

        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'project', updatedFields: expect.objectContaining({ taskStatusData: expect.any(Array) }) }));
        expect(audits(TOOL, 'applied')[0]).toMatchObject({ entityType: 'project', entityId: P_OPEN, meta: { onBehalfOf: INSIDER, undo: { kind: 'setup', projectId: P_OPEN, statusKeys: [4] } } });
    });

    it('adds a status the company does not have yet only for an owner or admin, as the settings screen does', async () => {
        const plan = { projectId: P_OPEN, statuses: ['Client check', 'In Review'] };
        const member = await approve(await filed(as(INSIDER), plan));
        expect(member.applied[0].ok).toBe(true);
        expect(partOf(member.applied[0].result, 'statuses')).toMatchObject({ ok: false, items: [{ name: 'Client check', made: false, error: expect.stringMatching(/owner or an admin/) }, { name: 'In Review', made: true }] });
        expect(member.applied[0].result.notMade).toEqual([{ part: 'statuses', name: 'Client check', error: expect.stringMatching(/owner or an admin/) }]);
        expect(statusNames()).toEqual(['To Do', 'In Progress', 'In Review', 'Done']);
        expect(catalogue().settings).toHaveLength(4);

        const owner = await approve(await filed(as(OWNER), plan));
        expect(partOf(owner.applied[0].result, 'statuses').items).toEqual([{ name: 'Client check', made: true, statusKey: 5 }, { name: 'In Review', made: false, statusKey: 4 }]);
        expect(statusNames()).toEqual(['To Do', 'In Progress', 'In Review', 'Client check', 'Done']);
        expect(catalogue().settings.map((status) => status.name)).toContain('Client check');
    });

    it('makes for the approver only the parts the approver may make by hand', async () => {
        setRule('view_list', true, [3, 0]);
        const id = await filed(as(INSIDER));
        const out = await approve(id, GUEST);
        expect(out.error).toBeUndefined();
        const { result } = out.applied[0];
        expect(result.parts.map((part) => [part.part, part.ok])).toEqual([['statuses', false], ['lists', false], ['fields', false], ['views', true]]);
        expect(partOf(result, 'lists').error).toMatch(/approver may not/);
        expect(statusNames()).toEqual(['To Do', 'In Progress', 'Done']);
        expect(listsNamed('Backlog')).toHaveLength(0);
        expect(liveFields()).toEqual([]);
        expect(viewTitles()).toEqual(['List', 'Board', 'Review board']);
        expect(partOf(result, 'views').items[0].leftOut).toEqual(expect.arrayContaining(['filters']));
    });

    it('asks the person behind the token again, and makes nothing they may no longer make', async () => {
        const id = await filed(as(OUTSIDER), { projectId: P_OPEN, lists: ['Backlog'], fields: [{ name: 'Budget', type: 'money' }] });
        setRule('project_sprint_create', false, [3]);
        const out = await approve(id);
        const { result } = out.applied[0];
        expect(partOf(result, 'lists')).toMatchObject({ ok: false, error: expect.stringMatching(/permission_denied/) });
        expect(partOf(result, 'fields')).toMatchObject({ ok: true });
        expect(listsNamed('Backlog')).toHaveLength(0);
        expect(liveFields()).toEqual(['Budget']);
    });

    it('keeps the parts that worked when one fails, and names what was not made', async () => {
        const save = fieldCtrl.insertCustomFieldPromise;
        jest.spyOn(fieldCtrl, 'insertCustomFieldPromise').mockImplementation((definition, ...rest) => (definition.fieldTitle === 'Budget' ? Promise.reject(new Error('disk full')) : save(definition, ...rest)));
        const id = await filed(as(INSIDER));
        project().ProjectRequiredComponent = [view(V_LIST, 'ProjectListView', 'List')];
        const out = await approve(id);
        const { result } = out.applied[0];
        expect(out.applied[0].ok).toBe(true);
        expect(result.parts.map((part) => [part.part, part.ok])).toEqual([['statuses', true], ['lists', true], ['fields', false], ['views', false]]);
        expect(result.notMade.map((entry) => [entry.part, entry.name])).toEqual([['fields', 'Budget'], ['views', 'Review board']]);
        expect(result.made).toBe(4);
        expect(liveFields()).toEqual(['Region']);
        expect(listsNamed('Backlog')).toHaveLength(1);
        expect(statusNames()).toContain('In Review');
    });

    it('reports the change as failed when no part could be made', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, views: [{ name: 'Review board', kind: 'board' }] });
        project().ProjectRequiredComponent = [view(V_LIST, 'ProjectListView', 'List')];
        const out = await approve(id);
        expect(out.applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/Review board/) });
        expect(audits(TOOL, 'applied')).toHaveLength(0);
    });
});

describe('undo takes back what the plan made', () => {
    it('removes its statuses, lists, fields and views, and nothing that was there or added by hand', async () => {
        const id = await filed(as(INSIDER));
        await approve(id);
        project().ProjectRequiredComponent.push(view('6f0000000000000000000e19', 'ProjectListView', 'By hand'));
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { fieldTitle: 'By hand', fieldType: 'text', type: 'task', isDelete: true, global: false, projectId: [P_OPEN] });
        const out = await undo(id);
        expect(out.error).toBeUndefined();
        expect(out.results[0]).toMatchObject({ ok: true, result: { projectId: P_OPEN, kept: [] } });
        expect(out.results[0].result.removed).toEqual({ views: ['Review board'], fields: ['Budget', 'Region'], lists: ['Backlog', 'This week'], statuses: ['In Review'] });
        expect(statusNames()).toEqual(['To Do', 'In Progress', 'Done']);
        expect(listsNamed('Backlog')).toHaveLength(0);
        expect(listsNamed('This week')).toHaveLength(0);
        expect(listsNamed('Open list')).toHaveLength(1);
        expect(liveFields()).toEqual(['By hand']);
        expect(viewTitles()).toEqual(['List', 'Board', 'By hand']);
        expect(catalogue().settings.map((status) => status.name)).toContain('In Review');
    });

    it('leaves a status, a list or a field that is in use now, and says why', async () => {
        const id = await filed(as(INSIDER));
        await approve(id);
        const task = stored(SCHEMA_TYPE.TASKS, T_OPEN);
        task.statusKey = 4;
        task.customField = { [String(fieldNamed('Budget')._id)]: { fieldValue: '1200' } };
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Planned', ProjectID: P_OPEN, sprintId: String(listsNamed('Backlog')[0]._id), CompanyId: CID, statusKey: 1, deletedStatusKey: 0 });
        const out = await undo(id);
        const { removed, kept } = out.results[0].result;
        expect(removed).toEqual({ views: ['Review board'], fields: ['Region'], lists: ['This week'], statuses: [] });
        expect(kept.map((entry) => [entry.part, entry.name])).toEqual([['fields', 'Budget'], ['lists', 'Backlog'], ['statuses', 'In Review']]);
        expect(kept.find((entry) => entry.part === 'statuses').reason).toMatch(/task/);
        expect(statusNames()).toContain('In Review');
        expect(listsNamed('Backlog')).toHaveLength(1);
        expect(liveFields()).toEqual(['Budget']);
        expect(stored(SCHEMA_TYPE.TASKS, T_OPEN).statusKey).toBe(4);
        expect(String(stored(SCHEMA_TYPE.SPRINTS, L_OPEN).deletedStatusKey)).toBe('0');
    });
});

describe('the preview lists every part', () => {
    const previewFor = async (uid, proposal) => (await intentPreview.forProposals(CID, uid, [proposal])).get(String(proposal._id));

    it('names the project, the statuses, the lists, each field and each view with what it shows', async () => {
        await filed(as(INSIDER));
        expect(await previewFor(OWNER, waiting()[0])).toEqual([{
            kind: 'setup',
            title: 'Open',
            lines: [
                { kind: 'place', project: 'Open', list: '' },
                { kind: 'newStatuses', names: ['In Review', 'in progress'] },
                { kind: 'newLists', names: ['Backlog', 'This week'] },
                { kind: 'field', name: 'Budget', type: 'money', options: [] },
                { kind: 'field', name: 'Region', type: 'dropdown', options: ['North', 'South'] },
                { kind: 'planView', name: 'Review board', layout: 'board' },
                { kind: 'group', by: 'status', field: '' },
                { kind: 'statuses', names: ['In Review'] },
                { kind: 'columns', names: ['Budget'], others: 0 },
            ],
        }]);
    });

    it('lists nothing for someone who cannot open the project', async () => {
        await filed(as(INSIDER), { projectId: P_PRIVATE, lists: ['Secret plan'] });
        expect(await previewFor(OUTSIDER, waiting()[0])).toEqual([null]);
        expect((await previewFor(INSIDER, waiting()[0]))[0]).toMatchObject({ kind: 'setup', title: 'Private' });
    });
});

describe('the "Set up my project" prompt', () => {
    it('sends the agent to the tool only on a connection that can run it', () => {
        expect(promptText(as(OWNER))).toContain('`project.setup`');
        expect(promptText(as(OWNER))).not.toMatch(/I have to make myself in AlianHub, such as statuses/);
        expect(promptText({ ...as(OWNER), allowedActions: ['tasks.search', 'task.create', 'list.create'] })).not.toContain('`project.setup`');
        delete process.env.MCP_TOOLS_WORK;
        expect(promptText(as(OWNER))).not.toContain('`project.setup`');
        expect(promptText(as(OWNER))).toMatch(/statuses, fields, views and automations/);
        expect(promptText(readOnly(OWNER))).toBeNull();
    });
});
