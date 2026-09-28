const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/projectAccess', () => ({ canReadProject: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskMongo/updateAssignment', () => ({ updateAssignee: jest.fn(async () => ({ status: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { canReadProject } = require('../Config/projectAccess');
const { updateAssignee } = require('../Modules/Tasks/helpers/taskMongo/updateAssignment');
const socketEmitter = require('../event/socketEventEmitter');
const registry = require('../Modules/Automations/engine/registry');
const matcher = require('../Modules/Automations/engine/matcher');
const { MAX_DEPTH } = require('../event/domainEventBus');
const V2 = require('../Modules/Automations/helpers/ruleSchemaV2');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const PROJECT = '6f0000000000000000000a01';
const RULE = '6f0000000000000000000b01';
const PRIYA = '6f0000000000000000000011';
const SAM = '6f0000000000000000000012';
const LEE = '6f0000000000000000000013';
const GONE = '6f0000000000000000000014';
const HIDDEN = '6f0000000000000000000015';
const AGENT = '6f0000000000000000000016';
const LEADER = '6f0000000000000000000017';
const OWNER = '6f0000000000000000000001';

const NAMES = { [PRIYA]: 'Priya Shah', [SAM]: 'Sam Lee', [LEE]: 'Lee Wong', [GONE]: 'Gone Person', [HIDDEN]: 'Hidden Person', [LEADER]: 'Lena Lead', [OWNER]: 'Olive Owner' };

const assign = () => registry.getAction('assign');

let emitSpy;
let task;

const seedWorld = (taskOver = {}) => {
    [PRIYA, SAM, LEE, HIDDEN, LEADER, OWNER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, isDelete: false, roleType: 3 }));
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GONE, status: 2, isDelete: true, roleType: 3 });
    Object.entries(NAMES).forEach(([_id, Employee_Name]) => mockDb.seed(SCHEMA_TYPE.USERS, { _id, Employee_Name }));
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT, name: 'Reviewer', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Web', CompanyId: C });
    mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { _id: RULE, name: 'Triage', version: 2, createdBy: OWNER, deletedStatusKey: 0 });
    task = mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskName: 'Fix login', TaskKey: 'WEB-7', CompanyId: C, ProjectID: PROJECT, sprintId: 'sp1',
        AssigneeUserId: [], watchers: [], Task_Leader: LEADER, deletedStatusKey: 0, ...taskOver,
    });
    return task;
};

const context = (over = {}) => ({ runId: 'run1', ruleId: RULE, ruleName: 'Triage', stepId: 's1', depth: 0, eventType: 'task.created', task: { _id: task._id, ProjectID: PROJECT }, ...over });
const run = (config, over = {}) => assign().run({ companyId: C, entity: { kind: 'task', id: task._id }, config, context: context(over) });
const stored = () => mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === String(task._id));
const tenantCalls = () => mockDb.calls.filter((c) => c.type !== SCHEMA_TYPE.USERS);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    canReadProject.mockImplementation(async (companyId, uid) => (uid === HIDDEN ? { allowed: false, statusCode: 404 } : { allowed: true }));
    emitSpy = jest.spyOn(socketEmitter, 'emit').mockImplementation(() => true);
});

afterEach(() => { jest.restoreAllMocks(); });

describe('the assign action is registered', () => {
    it('appears in the manifest the builder draws from, with its modes and a people field', () => {
        const described = registry.manifest().actions.find((a) => a.key === 'assign');
        expect(described).toBeDefined();
        expect(described.schema.mode.options).toEqual(['add', 'replace', 'remove', 'clear']);
        expect(described.schema.userIds.type).toBe('user_multi');
        expect(described.schema.roundRobin.type).toBe('boolean');
    });
});

describe('modes', () => {
    it('add puts the named people on the task, keeps who was there, and makes them watchers', async () => {
        seedWorld({ AssigneeUserId: [LEE] });
        const out = await run({ mode: 'add', userIds: [PRIYA, SAM] });

        expect(stored().AssigneeUserId).toEqual([LEE, PRIYA, SAM]);
        expect(stored().watchers).toEqual(expect.arrayContaining([PRIYA, SAM]));
        expect(out).toMatchObject({ changed: true, mode: 'add', skipped: [] });
        expect(out.assigned).toEqual([{ userId: PRIYA, name: 'Priya Shah' }, { userId: SAM, name: 'Sam Lee' }]);
        expect(out.assignees).toEqual([LEE, PRIYA, SAM]);
    });

    it('replace leaves exactly the named people', async () => {
        seedWorld({ AssigneeUserId: [LEE, SAM] });
        const out = await run({ mode: 'replace', userIds: [PRIYA] });

        expect(stored().AssigneeUserId).toEqual([PRIYA]);
        expect(out.assigned).toEqual([{ userId: PRIYA, name: 'Priya Shah' }]);
        expect(out.removed.map((p) => p.userId).sort()).toEqual([LEE, SAM].sort());
    });

    it('remove takes the named people off and leaves the rest', async () => {
        seedWorld({ AssigneeUserId: [LEE, SAM, PRIYA] });
        const out = await run({ mode: 'remove', userIds: [SAM] });

        expect(stored().AssigneeUserId).toEqual([LEE, PRIYA]);
        expect(out.removed).toEqual([{ userId: SAM, name: 'Sam Lee' }]);
    });

    it('clear leaves nobody assigned and needs no people', async () => {
        seedWorld({ AssigneeUserId: [LEE, SAM] });
        const out = await run({ mode: 'clear', userIds: [] });

        expect(stored().AssigneeUserId).toEqual([]);
        expect(out.changed).toBe(true);
    });

    it('a change that changes nothing writes nothing, emits nothing and records no history', async () => {
        seedWorld({ AssigneeUserId: [PRIYA] });
        const out = await run({ mode: 'add', userIds: [PRIYA] });

        expect(out.changed).toBe(false);
        expect(mockDb.calls.some((c) => c.type === SCHEMA_TYPE.TASKS && c.method === 'findOneAndUpdate')).toBe(false);
        expect(emitSpy).not.toHaveBeenCalled();
        expect(updateAssignee).not.toHaveBeenCalled();
    });

    it('records history and notifications through the task panel\'s assignee helper, as the rule, without a second write', async () => {
        seedWorld();
        await run({ mode: 'add', userIds: [PRIYA] });

        expect(updateAssignee).toHaveBeenCalledTimes(1);
        const [args] = updateAssignee.mock.calls[0];
        expect(args).toMatchObject({ type: 'assigneeAdd', isUpdateTask: false, firebaseObj: { AssigneeUserId: PRIYA } });
        expect(args.employeeName).toBe('Priya Shah');
        expect(args.userData.id).toBe(OWNER);
        expect(args.userData.Employee_Name).toMatch(/Triage/);
        expect(args.projectData).toMatchObject({ _id: PROJECT, CompanyId: C, ProjectName: 'Web' });
        expect(args.taskData).toMatchObject({ _id: String(task._id), TaskName: 'Fix login', sprintId: 'sp1' });
    });

    it('refuses an unknown mode deterministically', async () => {
        seedWorld();
        await expect(run({ mode: 'swap', userIds: [PRIYA] })).rejects.toMatchObject({ deterministic: true });
    });
});

describe('who may be named', () => {
    it('skips a removed member, a member who cannot open the project and an agent, and reports each', async () => {
        seedWorld();
        const out = await run({ mode: 'add', userIds: [PRIYA, GONE, HIDDEN, AGENT] });

        expect(stored().AssigneeUserId).toEqual([PRIYA]);
        expect(out.skipped).toEqual(expect.arrayContaining([
            { userId: GONE, name: 'Gone Person', reason: 'not_a_member' },
            { userId: HIDDEN, name: 'Hidden Person', reason: 'no_project_access' },
            { userId: AGENT, name: 'Reviewer', reason: 'agent' },
        ]));
        expect(out.skipped).toHaveLength(3);
    });

    it('checks project access against the task\'s own project', async () => {
        seedWorld();
        await run({ mode: 'add', userIds: [PRIYA] });
        expect(canReadProject).toHaveBeenCalledWith(C, PRIYA, PROJECT);
    });

    it('never widens access: with nobody eligible it writes nothing', async () => {
        seedWorld();
        const out = await run({ mode: 'replace', userIds: [GONE, HIDDEN] });

        expect(out.changed).toBe(false);
        expect(stored().AssigneeUserId).toEqual([]);
        expect(out.skipped.map((s) => s.reason).sort()).toEqual(['no_project_access', 'not_a_member']);
    });

    it('removing someone needs no access check: taking a person off never widens access', async () => {
        seedWorld({ AssigneeUserId: [HIDDEN, PRIYA] });
        const out = await run({ mode: 'remove', userIds: [HIDDEN] });
        expect(stored().AssigneeUserId).toEqual([PRIYA]);
        expect(out.skipped).toEqual([]);
    });

    it('assigns the task creator when asked', async () => {
        seedWorld();
        const out = await run({ mode: 'add', userIds: ['task_creator'] });
        expect(stored().AssigneeUserId).toEqual([LEADER]);
        expect(out.assigned).toEqual([{ userId: LEADER, name: 'Lena Lead' }]);
    });

    it('assigns the form submitter when the event carries a signed-in person', async () => {
        seedWorld();
        await run({ mode: 'add', userIds: ['form_submitter'] }, { eventType: 'form.submitted', actor: { kind: 'user', userId: SAM } });
        expect(stored().AssigneeUserId).toEqual([SAM]);
    });

    it('reports a form submitter it cannot name rather than guessing one', async () => {
        seedWorld();
        const out = await run({ mode: 'add', userIds: ['form_submitter'] }, { eventType: 'form.submitted', actor: { kind: 'system', userId: null } });
        expect(out.changed).toBe(false);
        expect(out.skipped).toEqual([{ userId: 'form_submitter', name: null, reason: 'no_submitter' }]);
    });
});

describe('round robin', () => {
    const rr = { mode: 'add', userIds: [PRIYA, SAM], roundRobin: true };

    it('rotates through the listed people one run at a time and keeps the cursor on the rule', async () => {
        seedWorld();
        const picked = [];
        for (let i = 0; i < 3; i++) {
            stored().AssigneeUserId = [];
            // eslint-disable-next-line no-await-in-loop
            const out = await run(rr, { runId: `run${i}` });
            picked.push(out.assigned.map((p) => p.userId));
        }
        expect(picked).toEqual([[PRIYA], [SAM], [PRIYA]]);
        const rule = mockDb.store[SCHEMA_TYPE.AUTOMATION_RULES].find((r) => String(r._id) === RULE);
        expect(rule.assignCursors.s1).toBe(3);
    });

    it('passes over someone who can no longer be assigned and reports them', async () => {
        seedWorld();
        const out = await run({ mode: 'add', userIds: [HIDDEN, SAM], roundRobin: true });
        expect(out.assigned).toEqual([{ userId: SAM, name: 'Sam Lee' }]);
        expect(out.skipped).toEqual([{ userId: HIDDEN, name: 'Hidden Person', reason: 'no_project_access' }]);
    });

    it('keeps one cursor per step, so two assign steps in a rule rotate independently', async () => {
        seedWorld();
        await run(rr, { stepId: 's1' });
        stored().AssigneeUserId = [];
        const out = await run(rr, { stepId: 's2' });
        expect(out.assigned).toEqual([{ userId: PRIYA, name: 'Priya Shah' }]);
    });
});

describe('company scoping', () => {
    it('reads and writes only this company, apart from the global user names', async () => {
        seedWorld();
        await run({ mode: 'add', userIds: [PRIYA], roundRobin: false });
        expect(tenantCalls().length).toBeGreaterThan(0);
        expect(tenantCalls().every((c) => c.companyId === C)).toBe(true);
    });

    it('refuses a task that belongs to another company', async () => {
        seedWorld({ CompanyId: OTHER_COMPANY });
        await expect(run({ mode: 'add', userIds: [PRIYA] })).rejects.toMatchObject({ deterministic: true });
        expect(emitSpy).not.toHaveBeenCalled();
    });
});

describe('loop guard', () => {
    const selfRule = {
        _id: RULE, enabled: true, deletedStatusKey: 0, version: 2,
        trigger: { type: 'event', event: 'task.assignee_changed' }, scope: { allProjects: true }, conditions: {},
        steps: [{ id: 's1', type: 'action', action: 'assign', config: { mode: 'add', userIds: [PRIYA] } }],
    };

    it('announces its change as the automation, one level deeper than the event that started it', async () => {
        seedWorld();
        await run({ mode: 'add', userIds: [PRIYA] }, { depth: 1 });

        expect(emitSpy).toHaveBeenCalledTimes(1);
        const [name, payload] = emitSpy.mock.calls[0];
        expect(name).toBe('update');
        expect(payload.actor).toEqual({ kind: 'automation', userId: null });
        expect(payload.depth).toBe(2);
        expect(Object.keys(payload.updatedFields)).toContain('AssigneeUserId');
    });

    it('so an assign rule on "assignee changes" does not wake itself', async () => {
        seedWorld();
        await run({ mode: 'add', userIds: [PRIYA] });
        const [, payload] = emitSpy.mock.calls[0];
        expect(matcher.acceptsActor(selfRule, { actor: payload.actor })).toBe(false);
    });

    it('and a rule that opts in to automation events is still stopped by the depth cap', async () => {
        seedWorld();
        await run({ mode: 'add', userIds: [PRIYA] }, { depth: MAX_DEPTH });
        const [, payload] = emitSpy.mock.calls[0];
        expect(payload.depth).toBeGreaterThan(MAX_DEPTH);
    });
});

describe('saving a rule with an assign step', () => {
    const rule = (config, event = 'task.created') => ({
        name: 'Assign', trigger: { event }, conditions: {},
        steps: [{ id: 's1', type: 'action', action: 'assign', config }],
    });

    it('accepts each mode with the people it needs', () => {
        expect(V2.validateRuleV2(rule({ mode: 'add', userIds: [PRIYA] })).valid).toBe(true);
        expect(V2.validateRuleV2(rule({ mode: 'replace', userIds: [PRIYA, SAM], roundRobin: true })).valid).toBe(true);
        expect(V2.validateRuleV2(rule({ mode: 'remove', userIds: [PRIYA] })).valid).toBe(true);
        expect(V2.validateRuleV2(rule({ mode: 'clear' })).valid).toBe(true);
    });

    it('refuses a mode that names nobody', () => {
        const out = V2.validateRuleV2(rule({ mode: 'add', userIds: [] }));
        expect(out.valid).toBe(false);
        expect(out.errors.join(' ')).toMatch(/userIds/);
    });

    it('refuses round robin on remove and on a single person', () => {
        expect(V2.validateRuleV2(rule({ mode: 'remove', userIds: [PRIYA, SAM], roundRobin: true })).valid).toBe(false);
        expect(V2.validateRuleV2(rule({ mode: 'add', userIds: [PRIYA], roundRobin: true })).valid).toBe(false);
    });

    it('refuses the form submitter on a trigger that has none', () => {
        expect(V2.validateRuleV2(rule({ mode: 'add', userIds: ['form_submitter'] })).valid).toBe(false);
        expect(V2.validateRuleV2(rule({ mode: 'add', userIds: ['form_submitter'] }, 'form.submitted')).valid).toBe(true);
    });

    it('refuses an entry that is neither a person nor a known role', () => {
        expect(V2.validateRuleV2(rule({ mode: 'add', userIds: ['everyone'] })).valid).toBe(false);
    });
});
