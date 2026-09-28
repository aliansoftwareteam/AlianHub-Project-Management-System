const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Config/permissionGuard', () => ({
    ROLE_OWNER: 1,
    ROLE_ADMIN: 2,
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true),
    isWritable: (value) => value === true || value === 1 || value === 2,
}));
jest.mock('../Modules/AICore/llmProvider/openaiProvider', () => ({ name: 'openai', model: 'gpt-4.1', isConfigured: true, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/anthropicProvider', () => ({ name: 'anthropic', model: null, isConfigured: false, chat: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider/deepseekProvider', () => ({ name: 'deepseek', model: null, isConfigured: false, chat: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const guard = require('../Config/permissionGuard');
const scope = require('../Modules/Agents/scope');
const adapter = require('../Modules/AICore/llmProvider/openaiProvider');
const aiSwitch = require('../Modules/AICore/aiSwitch');
const { FEATURES } = require('../Modules/AICore/features');
const registry = require('../Modules/Automations/engine/registry');
const { validateRuleV2 } = require('../Modules/Automations/helpers/ruleSchemaV2');
const aiDraft = require('../Modules/Automations/aiDraft');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const PRIYA = '6f0000000000000000000011';
const SECRET = '6f0000000000000000000012';
const WEBSITE = '6f0000000000000000000a01';
const PAYROLL = '6f0000000000000000000a02';
const ROLES = { [OWNER]: 1, [MEMBER]: 3 };
const WRITES = ['save', 'insertOne', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate', 'bulkWrite', 'deleteOne', 'deleteMany'];

const call = async ({ uid = OWNER, body = {} } = {}) => {
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        send(payload) { this.body = payload; return this; },
        json(payload) { this.body = payload; return this; },
    };
    await aiDraft.draftHandler({ uid, body, headers: { companyid: C } }, res);
    return res;
};

const modelSays = (draft) => adapter.chat.mockImplementation(async () => ({
    content: typeof draft === 'string' ? draft : JSON.stringify(draft),
    inputTokens: 900, outputTokens: 300, totalTokens: 1200, model: 'gpt-4.1',
}));

const draftOf = (over = {}) => ({
    trigger: 'task.priority_changed',
    project: null,
    conditions: [{ field: 'Task_Priority', op: 'changedTo', value: 'HIGH' }],
    actions: [{ action: 'add_comment', config: { body: 'Escalated' } }],
    unmapped: [],
    ...over,
});

const ledger = () => mockDb.store[SCHEMA_TYPE.AI_USAGE] || [];
const ruleWrites = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.AUTOMATION_RULES && WRITES.includes(c.method));
const sentPrompt = () => {
    const request = adapter.chat.mock.calls[0][0];
    return `${request.systemPrompt}\n${request.messages.map((m) => m.content).join('\n')}`;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    aiSwitch.forget();
    delete process.env.AI_ENABLED;
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_PRICING;
    guard.getRoleType.mockImplementation(async (companyId, uid) => ROLES[String(uid)] || 0);
    scope.visibleProjectIds.mockResolvedValue([WEBSITE]);
    mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id: WEBSITE, ProjectName: 'Website', deletedStatusKey: 0, AssigneeUserId: [PRIYA, 'tId_team1'],
        taskStatusData: [{ name: 'To Do', type: 'default_active', key: 1 }, { name: 'Done', type: 'active', key: 6 }],
    });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id: PAYROLL, ProjectName: 'Payroll', deletedStatusKey: 0, AssigneeUserId: [SECRET],
        taskStatusData: [{ name: 'Shipped', type: 'active', key: 9 }],
    });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: PRIYA, roleType: 3, status: 2 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: SECRET, roleType: 3, status: 2 });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: PRIYA, Employee_Name: 'Priya Shah', Employee_Email: 'priya@example.test' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: SECRET, Employee_Name: 'Sam Secret', Employee_Email: 'sam@example.test' });
});

describe('the schema the model is given comes from the registry', () => {
    it('lists every event trigger, condition field with its ops, and action with its config fields', () => {
        const schema = aiDraft.draftSchema();
        const manifest = registry.manifest();
        const eventTriggers = manifest.triggers.filter((t) => t.kind !== 'time').map((t) => t.key);
        expect(schema.triggers.map((t) => t.key)).toEqual(eventTriggers);
        manifest.conditionFields.forEach((f) => {
            const offered = schema.conditionFields.task.find((x) => x.field === f.field);
            expect(offered).toBeDefined();
            expect(offered.ops).toEqual(f.ops);
        });
        manifest.actions.forEach((a) => {
            const offered = schema.actions.find((x) => x.key === a.key);
            expect(offered).toBeDefined();
            expect(Object.keys(offered.config)).toEqual(Object.keys(a.schema || {}));
        });
    });

    it('sends the sentence and those registry keys to the model', async () => {
        modelSays(draftOf());
        await call({ body: { sentence: 'When a task becomes urgent, tell the team' } });
        const prompt = sentPrompt();
        expect(prompt).toContain('When a task becomes urgent, tell the team');
        registry.actionKeys().forEach((key) => expect(prompt).toContain(key));
        registry.CONDITION_FIELDS.forEach((f) => expect(prompt).toContain(f.field));
    });
});

describe('drafting a rule', () => {
    it('answers a rule that passes the v2 validator, with its sentence, and saves nothing', async () => {
        modelSays(draftOf());
        const res = await call({ body: { sentence: 'When a task becomes urgent, tell the team' } });
        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe(true);
        expect(res.body.data.drafted).toBe(true);
        expect(res.body.data.rejected).toEqual([]);
        const { rule } = res.body.data;
        expect(rule.trigger).toEqual({ type: 'event', event: 'task.priority_changed' });
        expect(rule.conditions).toEqual({ op: 'changedTo', field: 'Task_Priority', value: 'HIGH' });
        expect(rule.steps).toEqual([{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'Escalated' } }]);
        expect(rule.scope).toEqual({ allProjects: true, projectIds: [] });
        expect(validateRuleV2(rule).valid).toBe(true);
        expect(res.body.data.sentence).toMatch(/^When a task priority changes to HIGH/);
        expect(ruleWrites()).toEqual([]);
    });

    it('records the spend against the workspace under its own feature tag', async () => {
        modelSays(draftOf());
        await call({ body: { sentence: 'When a task becomes urgent, tell the team' } });
        expect(adapter.chat).toHaveBeenCalledTimes(1);
        expect(ledger()).toHaveLength(1);
        expect(ledger()[0]).toMatchObject({ feature: FEATURES.AUTOMATION_DRAFT, companyId: C, userId: OWNER, totalTokens: 1200 });
        expect(FEATURES.AUTOMATION_DRAFT).toBe('automation_draft');
    });

    it('passes on what the model could not map, with its reason', async () => {
        modelSays(draftOf({
            trigger: null,
            conditions: [],
            actions: [{ action: 'set_priority', config: { priority: 'HIGH' } }],
            unmapped: [{ text: 'when a customer emails', reason: 'there is no email trigger yet' }],
        }));
        const res = await call({ body: { sentence: 'When a customer emails, set the priority to HIGH' } });
        expect(res.body.status).toBe(true);
        expect(res.body.data.rule).toBeNull();
        expect(res.body.data.unmapped).toEqual([{ text: 'when a customer emails', reason: 'there is no email trigger yet' }]);
    });

    it('answers a clear failure when the model does not return JSON', async () => {
        modelSays('Sure! Here is your rule: when stuff happens...');
        const res = await call({ body: { sentence: 'When stuff happens, do things' } });
        expect(res.body.status).toBe(false);
        expect(res.body.statusText).toMatch(/could not/i);
        expect(ruleWrites()).toEqual([]);
    });
});

describe('the model output is validated strictly against the registry', () => {
    const rejectedFor = async (draft) => {
        modelSays(draft);
        const res = await call({ body: { sentence: 'When something happens, do something' } });
        expect(res.body.status).toBe(true);
        expect(res.body.data.rule).toBeNull();
        expect(res.body.data.rejected.length).toBeGreaterThan(0);
        return res.body.data.rejected.join(' | ');
    };

    it('rejects an invented action', async () => {
        expect(await rejectedFor(draftOf({ actions: [{ action: 'send_email', config: { to: 'boss@example.test' } }] }))).toContain('send_email');
    });

    it('rejects an invented trigger', async () => {
        expect(await rejectedFor(draftOf({ trigger: 'email.received' }))).toContain('email.received');
    });

    it('rejects an invented condition field', async () => {
        expect(await rejectedFor(draftOf({ conditions: [{ field: 'customerEmail', op: 'eq', value: 'x' }] }))).toContain('customerEmail');
    });

    it('rejects an operator the field does not allow', async () => {
        expect(await rejectedFor(draftOf({ conditions: [{ field: 'Task_Priority', op: 'gt', value: 'LOW' }] }))).toContain('gt');
    });

    it('rejects a value outside a field\'s options', async () => {
        expect(await rejectedFor(draftOf({ actions: [{ action: 'set_priority', config: { priority: 'URGENT' } }] }))).toContain('URGENT');
    });

    it('rejects a config field the action does not have', async () => {
        expect(await rejectedFor(draftOf({ actions: [{ action: 'set_priority', config: { priority: 'HIGH', colour: 'red' } }] }))).toContain('colour');
    });

    it('rejects an unknown top-level key', async () => {
        expect(await rejectedFor({ ...draftOf(), webhook: 'https://example.test' })).toContain('webhook');
    });

    it('rejects a draft with no action', async () => {
        await rejectedFor(draftOf({ actions: [] }));
    });

    it('rejects a "changed" condition on a trigger that carries no before and after', async () => {
        await rejectedFor(draftOf({ trigger: 'task.created', conditions: [{ field: 'Task_Priority', op: 'changedTo', value: 'HIGH' }] }));
    });
});

describe('people, statuses and projects resolve only among what the caller may use', () => {
    it('resolves a visible project by name to its id', async () => {
        modelSays(draftOf({ project: 'website' }));
        const res = await call({ body: { sentence: 'When a task in Website becomes urgent, tell the team' } });
        expect(res.body.data.rule.scope).toEqual({ allProjects: false, projectIds: [WEBSITE] });
    });

    it('refuses a project the caller cannot open, even by id', async () => {
        modelSays(draftOf({ project: 'Payroll' }));
        const byName = await call({ body: { sentence: 'When a Payroll task becomes urgent, tell the team' } });
        expect(byName.body.data.rule).toBeNull();
        expect(byName.body.data.rejected.join(' ')).toContain('Payroll');

        modelSays(draftOf({ project: PAYROLL }));
        const byId = await call({ body: { sentence: 'When a Payroll task becomes urgent, tell the team' } });
        expect(byId.body.data.rule).toBeNull();
    });

    it('resolves a person on a visible project to their id', async () => {
        modelSays(draftOf({ conditions: [{ field: 'Task_Leader', op: 'eq', value: 'Priya Shah' }] }));
        const res = await call({ body: { sentence: 'When a task Priya leads becomes urgent, tell the team' } });
        expect(res.body.data.rule.conditions).toEqual({ op: 'eq', field: 'Task_Leader', value: PRIYA });
    });

    it('refuses a person the caller shares no project with, by name or by id', async () => {
        modelSays(draftOf({ conditions: [{ field: 'Task_Leader', op: 'eq', value: 'Sam Secret' }] }));
        const byName = await call({ body: { sentence: 'When a task Sam leads becomes urgent, tell the team' } });
        expect(byName.body.data.rule).toBeNull();
        expect(byName.body.data.rejected.join(' ')).toContain('Sam Secret');

        modelSays(draftOf({ conditions: [{ field: 'AssigneeUserId', op: 'contains', value: SECRET }] }));
        const byId = await call({ body: { sentence: 'When a task assigned to Sam becomes urgent, tell the team' } });
        expect(byId.body.data.rule).toBeNull();
    });

    it('resolves a status to its canonical name in a visible project, and refuses one only a hidden project has', async () => {
        modelSays(draftOf({ actions: [{ action: 'set_status', config: { status: 'done' } }] }));
        const known = await call({ body: { sentence: 'When a task becomes urgent, mark it done' } });
        expect(known.body.data.rule.steps[0].config).toEqual({ status: 'Done' });

        modelSays(draftOf({ actions: [{ action: 'set_status', config: { status: 'Shipped' } }] }));
        const hidden = await call({ body: { sentence: 'When a task becomes urgent, mark it shipped' } });
        expect(hidden.body.data.rule).toBeNull();
        expect(hidden.body.data.rejected.join(' ')).toContain('Shipped');
    });
});

describe('the assign action takes people as a list', () => {
    it('resolves each named person to their id and keeps a role the action accepts', async () => {
        modelSays(draftOf({ actions: [{ action: 'assign', config: { mode: 'add', userIds: ['Priya', 'task_creator'] } }] }));
        const res = await call({ body: { sentence: 'When a task becomes urgent, assign it to Priya and the creator' } });
        expect(res.body.data.rejected).toEqual([]);
        expect(res.body.data.rule.steps[0].config).toEqual({ mode: 'add', userIds: [PRIYA, 'task_creator'] });
        expect(res.body.data.sentence).toContain('Priya Shah');
    });

    it('rejects the draft when one of the people is outside the caller\'s projects', async () => {
        modelSays(draftOf({ actions: [{ action: 'assign', config: { mode: 'add', userIds: ['Priya', 'Sam Secret'] } }] }));
        const res = await call({ body: { sentence: 'When a task becomes urgent, assign it to Priya and Sam' } });
        expect(res.body.data.rule).toBeNull();
        expect(res.body.data.rejected.join(' ')).toContain('Sam Secret');
    });

    it('lets the action\'s own validator refuse a mode that needs people but names none', async () => {
        modelSays(draftOf({ actions: [{ action: 'assign', config: { mode: 'add', userIds: [] } }] }));
        const res = await call({ body: { sentence: 'When a task becomes urgent, assign it' } });
        expect(res.body.data.rule).toBeNull();
        expect(res.body.data.rejected.join(' ')).toMatch(/userIds/);
    });
});

describe('who may draft, and when AI is off', () => {
    it('refuses a member without calling the model', async () => {
        modelSays(draftOf());
        const res = await call({ uid: MEMBER, body: { sentence: 'When a task becomes urgent, tell the team' } });
        expect(res.statusCode).toBe(403);
        expect(adapter.chat).not.toHaveBeenCalled();
    });

    it('requires a sentence', async () => {
        const res = await call({ body: { sentence: '   ' } });
        expect(res.statusCode).toBe(400);
        expect(adapter.chat).not.toHaveBeenCalled();
    });

    it('makes no call and says so when AI is off for the workspace', async () => {
        mockDb.seed(dbCollections.COMPANIES, { _id: C, aiSwitch: { enabled: false } });
        modelSays(draftOf());
        const res = await call({ body: { sentence: 'When a task becomes urgent, tell the team' } });
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ status: false, code: aiSwitch.AI_OFF, aiState: 'off_workspace' });
        expect(res.body.statusText).toMatch(/turned off/i);
        expect(adapter.chat).not.toHaveBeenCalled();
        expect(ledger()).toHaveLength(0);
    });

    it('makes no call when AI is off for the instance', async () => {
        process.env.AI_ENABLED = 'false';
        modelSays(draftOf());
        const res = await call({ body: { sentence: 'When a task becomes urgent, tell the team' } });
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ code: aiSwitch.AI_OFF, aiState: 'off_instance' });
        expect(adapter.chat).not.toHaveBeenCalled();
    });
});
