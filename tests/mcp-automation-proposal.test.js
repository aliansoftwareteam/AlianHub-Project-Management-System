/* Task 047, AI-3 (automations): a connected agent proposes one automation for one project, in the catalogue's own
   terms. Every call waits for a person; approved by an owner or an admin, the rule is saved by the Automations
   page's own create route as the person who approved it, and it can be taken back while nobody has changed it. */
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
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const standingApprovals = require('../Modules/Agents/standingApprovals');
const catalogue = require('../Modules/Automations/engine/registry');
const matcher = require('../Modules/Automations/engine/matcher');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, T_OPEN, TOKEN, MISSING, BEFORE, FLAGS, ctx, narrowed, readOnly, routeTable, asPerson, settle } = world;
const { seed, rows, stored, audits, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);
const web = asPerson(routeTable(require('../Modules/Automations/routes').init));

const TOOL = 'automation.create';
const READ = 'automation.catalogue';
const NO_PROJECT = 'not_visible: the project is not one the person behind this token can open';
const PEOPLE = [OWNER, ADMIN, INSIDER, OUTSIDER, GUEST];
const MAY_PROPOSE = ['set_status', 'set_priority', 'add_comment', 'create_subtask', 'assign', 'notify'];
const NOTICE = '[AI bench] Done notice';

const doneNotice = (over = {}) => ({
    projectId: P_OPEN,
    trigger: 'task.status_changed',
    conditions: [{ field: 'statusRef', op: 'changedTo', value: 'Done' }],
    actions: [{ action: 'notify', config: { recipients: ['task_assignees'], message: NOTICE } }],
    ...over,
});
const draftOf = (args) => ({ projectId: args.projectId, trigger: args.trigger, conditions: args.conditions || [], actions: args.actions, enabled: args.enabled === true });

const rules = () => rows(SCHEMA_TYPE.AUTOMATION_RULES);
const liveRules = () => rules().filter((rule) => Number(rule.deletedStatusKey) !== 1);
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const human = (userId) => ({ kind: 'human', userId });
const decision = (uid) => ({ decider: human(uid), isPrivileged: [OWNER, ADMIN].includes(uid), ip: '' });
const approve = (id, uid = OWNER) => proposals.approve(CID, id, decision(uid));
const undo = (id, uid = OWNER) => proposals.undoApproval(CID, id, decision(uid));
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid, over = {}) => {
    const base = ctx(uid, over);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid) } };
};
const filed = async (caller, args) => {
    const out = await rpc(caller, TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const fileDirectly = (uid, params) => proposals.create(CID, {
    agent: { _id: `mcp:${tokenOf(uid)}`, name: 'Claude (MCP)' }, projectId: P_OPEN, what: 'automation.create', why: 'via MCP',
    changes: [{ action: TOOL, params, label: `${TOOL} via MCP` }], source: 'mcp', requestedBy: uid, tokenId: tokenOf(uid), tokenProjectIds: [], allowedActions: [],
});
const setRole = (uid, roleType) => { rows(SCHEMA_TYPE.COMPANY_USERS).find((row) => String(row.userId) === uid).roleType = roleType; };

beforeEach(() => {
    seed();
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], projectIds: [], expiresAt: new Date(Date.now() + 86400000) }));
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
    matcher.invalidateAll();
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag decides whether the tools exist', () => {
    it('off, the tool list and the registry are what they were', async () => {
        delete process.env.MCP_TOOLS_WORK;
        expect(await listed(as(OWNER))).toEqual(BEFORE);
        expect(registry.has(TOOL)).toBe(false);
        expect(registry.has(READ)).toBe(false);
        expect(actions.rating(TOOL)).toBeNull();
        expect((await rpc(as(OWNER), TOOL, doneNotice())).rpcError).toMatchObject({ code: -32601 });
        expect((await rpc(as(OWNER), READ, {})).rpcError).toMatchObject({ code: -32601 });
    });

    it('on, making a rule is a high-risk action that is proposed every time and needs an owner or an admin', async () => {
        expect(await listed(as(OWNER))).toEqual(expect.arrayContaining([TOOL, READ]));
        expect(registry.get(TOOL)).toMatchObject({ risk: 'high', undoable: true, write: true, proposeOnly: true, gate: 'owner_admin' });
        expect(actions.rating(TOOL)).toEqual({ write: true, reversible: true, scope: 'project', money: false });
        expect(registry.get(READ)).toMatchObject({ risk: 'low', write: false });
        expect(scopes.scopeForTool(TOOL)).toBe('tasks:write');
        expect(scopes.scopeForTool(READ)).toBe('projects:read');
        expect(tools.registered().find((tool) => tool.name === TOOL).grant).toBeUndefined();
        expect(standingApprovals.kindRefusal(TOOL)).toMatch(/proposed every time/);
    });
});

describe('the catalogue an agent reads', () => {
    it('lists the triggers that start from a task and only the steps an agent may propose', async () => {
        const out = await rpc(as(OWNER), READ, {});
        expect(out.triggers.map((trigger) => trigger.key)).toEqual(catalogue.TRIGGERS.filter((trigger) => trigger.entity === 'task').map((trigger) => trigger.key));
        expect(out.steps.map((step) => step.key).sort()).toEqual([...MAY_PROPOSE].sort());
        expect(JSON.stringify(out)).not.toMatch(/run_agent|form\.submitted|reactToAutomation/);
        expect(out.conditionFields.map((field) => field.field)).toEqual(expect.arrayContaining(['statusRef', 'Task_Priority']));
        expect(out.steps.find((step) => step.key === 'notify').config.message).toMatchObject({ required: true });
    });
});

describe('a rule is never made before a person has seen it', () => {
    it('files the rule as one proposal for an owner or an admin, and saves nothing', async () => {
        const id = await filed(as(OWNER), { ...doneNotice(), reason: 'Tell people when work is done' });
        expect(rules()).toHaveLength(0);
        const [proposal] = waiting();
        expect(String(proposal._id)).toBe(id);
        expect(proposal).toMatchObject({ projectId: P_OPEN, source: 'mcp', requestedBy: OWNER, gate: 'owner_admin' });
        expect(proposal.changes).toEqual([expect.objectContaining({ action: TOOL, reversible: true, params: draftOf(doneNotice()) })]);
    });

    it('is held whatever the project lets agents do, and cannot be run directly', async () => {
        const actor = as(OWNER).actor;
        const params = draftOf(doneNotice());
        expect(await projectPolicy.ask({ companyId: CID, actor, action: TOOL, params })).toMatchObject({ decision: 'propose' });
        await expect(actions.perform({ companyId: CID, actor, action: TOOL, params })).rejects.toThrow(/must be proposed/);
        await expect(actions.perform({ companyId: CID, actor, action: TOOL, params: { ...params, __proposal: true } })).rejects.toThrow(/waits for a person's approval/);
        expect(rules()).toHaveLength(0);
    });
});

describe('what an agent may not put in a rule', () => {
    const nothingFiled = () => { expect(waiting()).toHaveLength(0); expect(rules()).toHaveLength(0); };

    it('refuses a step that runs an agent, with the reason', async () => {
        const out = await rpc(as(OWNER), TOOL, doneNotice({ actions: [{ action: 'run_agent', config: { agent: 'Reviewer', skill: 'summarise' } }] }));
        expect(out.rpcError).toMatchObject({ code: -32602, message: expect.stringMatching(/cannot propose a step that runs an AI agent/) });
        nothingFiled();
    });

    it('refuses a step of the catalogue that is not on its list, such as one that sends outside the workspace', async () => {
        const webhook = { key: 'send_webhook', label: 'Call a webhook', appliesTo: ['task'], scopes: [], schema: { url: { type: 'text', label: 'Address', required: true } } };
        const manifest = catalogue.manifest();
        jest.spyOn(catalogue, 'manifest').mockReturnValue({ ...manifest, actions: [...manifest.actions, webhook] });
        const known = catalogue.getAction;
        jest.spyOn(catalogue, 'getAction').mockImplementation((key) => (key === webhook.key ? webhook : known(key)));
        jest.spyOn(catalogue, 'hasAction').mockImplementation((key) => key === webhook.key || Boolean(known(key)));
        const out = await rpc(as(OWNER), TOOL, doneNotice({ actions: [{ action: 'send_webhook', config: { url: 'https://example.test/hook' } }] }));
        expect(out.rpcError).toMatchObject({ code: -32602, message: expect.stringMatching(/outside the workspace/) });
        for (const action of ['send_email', 'slack_message']) {
            expect((await rpc(as(OWNER), TOOL, doneNotice({ actions: [{ action, config: {} }] }))).rpcError).toMatchObject({ code: -32602, message: expect.stringMatching(/outside the workspace/) });
        }
        nothingFiled();
    });

    it('never takes the switch that lets a rule react to automations and agents', async () => {
        expect((await rpc(as(OWNER), TOOL, { ...doneNotice(), reactToAutomation: true })).rpcError).toMatchObject({ code: -32602 });
        nothingFiled();
        const carried = await fileDirectly(OWNER, { ...draftOf(doneNotice()), reactToAutomation: true });
        const out = await approve(String(carried._id));
        expect(out.applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/reacts to changes made by automations or agents/) });
        expect(rules()).toHaveLength(0);
    });

    it('refuses a trigger that does not start from a task, and one the catalogue does not have', async () => {
        expect((await rpc(as(OWNER), TOOL, doneNotice({ trigger: 'form.submitted', conditions: [] }))).rpcError).toMatchObject({ code: -32602, message: expect.stringMatching(/starts from a task/) });
        expect((await rpc(as(OWNER), TOOL, doneNotice({ trigger: 'email.received', conditions: [] }))).rpcError).toMatchObject({ code: -32602, message: expect.stringMatching(/no "email\.received" trigger/) });
        expect((await rpc(as(OWNER), TOOL, doneNotice({ actions: [] }))).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(as(OWNER), TOOL, { ...doneNotice(), name: 'Mine', scope: { allProjects: true } })).rpcError).toMatchObject({ code: -32602 });
        nothingFiled();
    });

    it('says at once what the project does not have, and files nothing', async () => {
        expect(await rpc(as(OWNER), TOOL, doneNotice({ conditions: [{ field: 'statusRef', op: 'changedTo', value: 'Shipped' }] }))).toMatchObject({ ok: false, error: expect.stringMatching(/Shipped/) });
        expect(await rpc(as(OWNER), TOOL, doneNotice({ actions: [{ action: 'assign', config: { mode: 'add', userIds: ['Gus Guest'] } }] }))).toMatchObject({ ok: false, error: expect.stringMatching(/Gus Guest/) });
        expect(await rpc(as(OWNER), TOOL, doneNotice({ actions: [{ action: 'notify', config: { recipients: ['task_assignees'], message: NOTICE, webhook: 'https://example.test' } }] }))).toMatchObject({ ok: false, error: expect.stringMatching(/no setting called "webhook"/) });
        nothingFiled();
    });
});

describe('who may ask for a rule', () => {
    it('files for an owner and for an admin, as the Automations page saves for them', async () => {
        await filed(as(OWNER), doneNotice());
        await filed(as(ADMIN), doneNotice({ enabled: true }));
        expect(waiting()).toHaveLength(2);
    });

    it.each([['a member', INSIDER], ['a member who holds every company setting', OUTSIDER], ['a guest', GUEST]])('refuses %s, whom the Automations page refuses, and files nothing', async (_who, uid) => {
        const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'settings', name: 'Settings', isParent: true, roles: [] });
        mockDb.seed(SCHEMA_TYPE.RULES, { key: 'settings_edit_company', name: 'settings_edit_company', isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: uid === OUTSIDER }, { key: 0, permission: false }] });
        const body = { trigger: { type: 'event', event: 'task.created' }, scope: { allProjects: false, projectIds: [P_OPEN] }, conditions: {}, steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'hi' } }] };
        expect((await web('POST /api/v2/automations', uid, { body })).code).toBe(403);
        expect(await rpc(as(uid), TOOL, doneNotice())).toMatchObject({ refused: true, reason: expect.stringMatching(/owners and admins/i) });
        expect(waiting()).toHaveLength(0);
        expect(rules()).toHaveLength(0);
        expect(audits(TOOL).filter((row) => row.action === 'agent.action_refused')).toHaveLength(1);
    });

    it('answers a project the person cannot open, and one outside a narrowed token, as a missing project', async () => {
        expect(await rpc(as(OWNER), TOOL, doneNotice({ projectId: MISSING }))).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc(as(OWNER), TOOL, doneNotice({ projectId: P_PERSONAL }))).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc(as(INSIDER), TOOL, doneNotice({ projectId: MISSING }))).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc({ ...as(OWNER), projectIds: narrowed(OWNER, [P_PRIVATE]).projectIds }, TOOL, doneNotice())).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc(readOnly(OWNER), TOOL, doneNotice())).toMatchObject({ isError: true, error: 'This token is read-only.' });
        expect(waiting()).toHaveLength(0);
    });

    it('keeps a narrowed token inside its projects when the rule is approved', async () => {
        const inside = { ...as(OWNER), projectIds: narrowed(OWNER, [P_OPEN]).projectIds };
        const id = await filed(inside, doneNotice());
        stored(SCHEMA_TYPE.AGENT_PROPOSALS, id).tokenProjectIds = [P_PRIVATE];
        expect(await approve(id)).toMatchObject({ status: 403, error: expect.stringMatching(/outside the token's project list/) });
        expect(rules()).toHaveLength(0);
    });
});

describe('approving saves the rule the Automations page would save, as the person who approved', () => {
    it('saves one rule for that project alone, switched off, owned by the approver', async () => {
        const id = await filed(as(OWNER), doneNotice());
        const out = await approve(id);
        expect(out.error).toBeUndefined();
        expect(liveRules()).toHaveLength(1);
        const [rule] = liveRules();
        expect(rule).toMatchObject({
            version: 2, enabled: false, createdBy: OWNER, deletedStatusKey: 0, reactToAutomation: false,
            trigger: { type: 'event', event: 'task.status_changed' }, scope: { allProjects: false, projectIds: [P_OPEN] },
            steps: [{ id: 's1', type: 'action', action: 'notify', config: { recipients: ['task_assignees'], message: NOTICE } }],
        });
        expect(rule.name).toContain(NOTICE);
        expect(out.applied[0]).toMatchObject({ action: TOOL, ok: true, result: { projectId: P_OPEN, ruleId: String(rule._id), enabled: false, ownerId: OWNER, sentence: expect.stringContaining(NOTICE) } });
        expect(audits(TOOL, 'applied')[0]).toMatchObject({ entityType: 'project', entityId: P_OPEN, meta: { undo: { kind: 'automation', projectId: P_OPEN, ruleId: String(rule._id) } } });
    });

    it('stores what the route stores for the same rule made by hand', async () => {
        const id = await filed(as(OWNER), doneNotice());
        await approve(id);
        const [made] = liveRules();
        const byHand = await web('POST /api/v2/automations', OWNER, { body: { trigger: made.trigger, scope: made.scope, conditions: made.conditions, steps: made.steps } });
        expect(byHand.body.status).toBe(true);
        const [, hand] = liveRules();
        const shape = ({ name, version, trigger, scope, conditions, steps, reactToAutomation, limits, enabled, createdBy }) => ({ name, version, trigger, scope, conditions, steps, reactToAutomation, limits, enabled, createdBy });
        expect(shape(made)).toEqual(shape(hand));
    });

    it('switches it on only when the proposal said so', async () => {
        const id = await filed(as(OWNER), doneNotice({ enabled: true }));
        await approve(id);
        expect(liveRules()[0]).toMatchObject({ enabled: true, reactToAutomation: false });
    });

    it('makes the approver the owner when someone else\'s agent asked', async () => {
        const id = await filed(as(ADMIN), doneNotice());
        const out = await approve(id, OWNER);
        expect(out.applied[0]).toMatchObject({ ok: true, result: { ownerId: OWNER } });
        expect(liveRules()[0].createdBy).toBe(OWNER);
        expect(JSON.stringify(liveRules()[0])).not.toMatch(/Claude/);
    });

    it('needs an owner or an admin to approve it', async () => {
        const id = await filed(as(OWNER), doneNotice());
        expect(await approve(id, INSIDER)).toMatchObject({ status: 403, error: expect.stringMatching(/Owner or Admin/) });
        expect(rules()).toHaveLength(0);
    });

    it('asks the person behind the token again, and saves nothing when they may not any more', async () => {
        const id = await filed(as(ADMIN), doneNotice());
        setRole(ADMIN, 3);
        const out = await approve(id, OWNER);
        expect(out.applied[0]).toMatchObject({ ok: false });
        expect(rules()).toHaveLength(0);
    });

    it('saves nothing when the project lost what the rule names before it was approved', async () => {
        const id = await filed(as(OWNER), doneNotice({ conditions: [{ field: 'statusRef', op: 'changedTo', value: 'In Progress' }] }));
        stored(SCHEMA_TYPE.PROJECTS, P_OPEN).taskStatusData = stored(SCHEMA_TYPE.PROJECTS, P_OPEN).taskStatusData.filter((status) => status.name !== 'In Progress');
        const out = await approve(id);
        expect(out.applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/In Progress/) });
        expect(rules()).toHaveLength(0);
    });

    it('does not run on an agent\'s change, as any rule that did not opt in', async () => {
        const id = await filed(as(OWNER), doneNotice({ enabled: true, conditions: [] }));
        await approve(id);
        const event = (kind) => ({ type: 'task.status_changed', data: { _id: T_OPEN }, scope: { projectId: P_OPEN }, actor: { kind }, changedFields: ['statusKey'] });
        expect(await matcher.match(CID, event('user'))).toHaveLength(1);
        expect(await matcher.match(CID, event('agent'))).toHaveLength(0);
        expect(await matcher.match(CID, event('automation'))).toHaveLength(0);
    });
});

describe('undo removes the rule while nobody has changed it', () => {
    const made = async () => {
        const id = await filed(as(OWNER), doneNotice());
        await approve(id);
        return { id, ruleId: String(liveRules()[0]._id) };
    };

    it('removes it as the Automations page does', async () => {
        const { id, ruleId } = await made();
        const out = await undo(id);
        expect(out.error).toBeUndefined();
        expect(out.results[0]).toMatchObject({ ok: true, result: { projectId: P_OPEN, ruleId, removed: true } });
        expect(liveRules()).toHaveLength(0);
        expect(stored(SCHEMA_TYPE.AUTOMATION_RULES, ruleId)).toMatchObject({ deletedStatusKey: 1, enabled: false });
    });

    it('still removes it after a person switched it on', async () => {
        const { id, ruleId } = await made();
        expect((await web('PATCH /api/v2/automations/:id/enabled', OWNER, { params: { id: ruleId }, body: { enabled: true } })).body.status).toBe(true);
        expect((await undo(id)).results[0]).toMatchObject({ ok: true, result: { removed: true } });
        expect(liveRules()).toHaveLength(0);
    });

    it('leaves a rule someone has edited since, and says so', async () => {
        const { id, ruleId } = await made();
        const rule = stored(SCHEMA_TYPE.AUTOMATION_RULES, ruleId);
        const edited = { trigger: rule.trigger, scope: rule.scope, conditions: rule.conditions, steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'Done, thank you' } }] };
        expect((await web('PUT /api/v2/automations/:id', OWNER, { params: { id: ruleId }, body: edited })).body.status).toBe(true);
        const out = await undo(id);
        expect(out.results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/was changed after it was made, so it stays/) });
        expect(liveRules()).toHaveLength(1);
        expect(liveRules()[0].steps[0].action).toBe('add_comment');
    });

    it('is refused for someone the Automations page would not let delete it', async () => {
        const { id } = await made();
        const out = await proposals.undoApproval(CID, id, { ...decision(OUTSIDER), isPrivileged: true });
        expect(JSON.stringify(out)).not.toMatch(/"removed":true/);
        expect(liveRules()).toHaveLength(1);
    });
});
