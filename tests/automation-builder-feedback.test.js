const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true),
    isWritable: (value) => value === true || value === 1 || value === 2,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const scope = require('../Modules/Agents/scope');
const guard = require('../Config/permissionGuard');
const ctrl = require('../Modules/Automations/controller');
const { validateRuleV2 } = require('../Modules/Automations/helpers/ruleSchemaV2');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const OWNER = '6f0000000000000000000001';
const PERSON = '6f0000000000000000000002';

const call = async (handler, { uid = OWNER, params = {}, body = {} } = {}) => {
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        send(payload) { this.body = payload; return this; },
    };
    await handler({ uid, params, body, headers: { companyid: C } }, res);
    return res;
};

const step = (action, config = {}, id = 's1') => ({ id, type: 'action', action, config });
const ruleWith = (steps, over = {}) => ({
    version: 2,
    trigger: { type: 'event', event: 'task.created' },
    scope: { allProjects: true, projectIds: [] },
    conditions: {},
    steps,
    ...over,
});

const seedRule = (over = {}) => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, {
    name: 'Tell the lead', enabled: true, deletedStatusKey: 0, createdBy: OWNER,
    ...ruleWith([step('add_comment', { body: 'All done' })], { trigger: { type: 'event', event: 'task.subtasks_all_done' } }),
    ...over,
});

const seedTask = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Launch', TaskKey: 'WEB-1', ProjectID: PROJECT, isParentTask: true, deletedStatusKey: 0, statusType: 'in_progress', AssigneeUserId: [], ...over,
});
const seedSubtask = (parent, statusType) => seedTask({ TaskName: 'Part', TaskKey: 'WEB-2', isParentTask: false, ParentTaskId: String(parent._id), statusType });

const dryRun = (rule, task) => call(ctrl.dryRun, { params: { id: rule._id }, body: { taskId: task._id } });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    guard.getRoleType.mockResolvedValue(1);
    scope.visibleProjectIds.mockResolvedValue([PROJECT]);
});

describe('a dry run states one outcome', () => {
    it('says the rule would not run now when its trigger does not apply to the task, and marks no step as running', async () => {
        const rule = seedRule();
        const task = seedTask();
        seedSubtask(task, 'in_progress');

        const { body } = await dryRun(rule, task);
        expect(body.status).toBe(true);
        expect(body.statusText).toBe('The rule would not run now.');
        expect(body.data.matched).toBe(true);
        expect(body.data.wouldRun).toBe(false);
        expect(body.data.trigger).toMatchObject({ wouldFire: false, reason: 'subtasks_open', open: 1, total: 1 });
        expect(body.data.actions.map((a) => a.wouldRun)).toEqual([false]);
    });

    it('says the rule would run when the trigger applies and the conditions hold', async () => {
        const rule = seedRule();
        const task = seedTask();
        seedSubtask(task, 'close');

        const { body } = await dryRun(rule, task);
        expect(body.statusText).toBe('The rule would run.');
        expect(body.data).toMatchObject({ matched: true, wouldRun: true });
        expect(body.data.actions.map((a) => a.wouldRun)).toEqual([true]);
    });

    it('follows the conditions alone for a trigger that a write publishes', async () => {
        const rule = seedRule({ trigger: { type: 'event', event: 'task.priority_changed' }, conditions: { op: 'eq', field: 'Task_Priority', value: 'HIGH' } });
        const high = await dryRun(rule, seedTask({ Task_Priority: 'HIGH' }));
        const low = await dryRun(rule, seedTask({ Task_Priority: 'LOW' }));
        expect(high.body.data).toMatchObject({ matched: true, wouldRun: true });
        expect(high.body.data.trigger).toBeUndefined();
        expect(low.body.data).toMatchObject({ matched: false, wouldRun: false });
        expect(low.body.statusText).toBe('The rule would not run.');
    });
});

describe('a rule that cannot be saved says what is missing in parts the builder can word', () => {
    it('names the step, its action and the field for a required field left empty, and keeps the error text it always gave', () => {
        const check = validateRuleV2(ruleWith([step('set_status', { status: '' })]));
        expect(check.valid).toBe(false);
        expect(check.errors).toContain('steps[0].config.status: required by "set_status"');
        expect(check.issues).toEqual([{ step: 0, action: 'set_status', field: 'status', code: 'required', text: 'required by "set_status"' }]);
    });

    it('counts steps from the one that is wrong', () => {
        const check = validateRuleV2(ruleWith([step('add_comment', { body: 'Hi' }), step('create_subtask', {}, 's2')]));
        expect(check.issues).toEqual([expect.objectContaining({ step: 1, action: 'create_subtask', field: 'title', code: 'required' })]);
    });

    it('tells a value that is not one of the choices from a missing one', () => {
        const check = validateRuleV2(ruleWith([step('set_priority', { priority: 'URGENT' })]));
        expect(check.issues).toEqual([expect.objectContaining({ step: 0, action: 'set_priority', field: 'priority', code: 'not_an_option' })]);
    });

    it('carries an action\'s own reason in words, without the path', () => {
        const check = validateRuleV2(ruleWith([step('notify', { recipients: [], message: '' })]));
        expect(check.issues.map((issue) => `${issue.field}:${issue.code}`).sort()).toEqual(['message:required', 'recipients:required']);
        check.issues.forEach((issue) => expect(issue).toMatchObject({ step: 0, action: 'notify' }));
        check.issues.forEach((issue) => expect(issue.text).not.toMatch(/steps\[|\.config\./));
        const named = validateRuleV2(ruleWith([step('notify', { recipients: ['somebody'], message: 'Hi' })]));
        expect(named.issues).toEqual([{ step: 0, action: 'notify', field: 'recipients', code: 'other', text: '"somebody" is not a person of this workspace' }]);
    });

    it('says a rule has no action without naming a path, and never asks for a name the builder does not have', () => {
        const check = validateRuleV2(ruleWith([]));
        expect(check.errors).toEqual(expect.arrayContaining(['steps: at least one action is required', 'name: required']));
        expect(check.issues).toEqual([{ code: 'no_steps', text: 'at least one action is required' }]);
    });

    it('has no issues for a rule that can be saved', () => {
        expect(validateRuleV2(ruleWith([step('add_comment', { body: 'Hi' })]))).toMatchObject({ valid: true, issues: [] });
    });
});

describe('the builder endpoints hand the parts over', () => {
    it('compiling a rule answers its issues beside the errors', async () => {
        const { body } = await call(ctrl.compileSentence, { body: { rule: ruleWith([step('set_status', { status: '' })]) } });
        expect(body.status).toBe(true);
        expect(body.data.errors).toEqual(['steps[0].config.status: required by "set_status"']);
        expect(body.data.issues).toEqual([expect.objectContaining({ step: 0, action: 'set_status', field: 'status', code: 'required' })]);
        expect(body.data.parseErrors).toEqual([]);
    });

    it('compiling a sentence keeps what it could not read apart from what the rule lacks', async () => {
        const unreadable = await call(ctrl.compileSentence, { body: { sentence: 'purple monkey dishwasher' } });
        expect(unreadable.body.data.parseErrors.length).toBeGreaterThan(0);
        expect(unreadable.body.data.parseErrors).toEqual(unreadable.body.data.errors);
        expect(unreadable.body.data.issues).toEqual([]);
    });

    it('a refused save answers the issues too', async () => {
        const { body } = await call(ctrl.createRuleV2, { body: ruleWith([step('set_status', { status: '' })]) });
        expect(body.status).toBe(false);
        expect(body.issues).toEqual([expect.objectContaining({ step: 0, field: 'status', code: 'required' })]);
        expect(mockDb.store[SCHEMA_TYPE.AUTOMATION_RULES] || []).toHaveLength(0);
    });
});

describe('running on changes another automation or an agent made', () => {
    const body = (over = {}) => ruleWith([step('add_comment', { body: 'Hi' })], { trigger: { type: 'event', event: 'task.subtasks_all_done' }, ...over });
    const stored = () => mockDb.store[SCHEMA_TYPE.AUTOMATION_RULES][0];

    it('is off unless the builder asks for it, and is saved when it does', async () => {
        await call(ctrl.createRuleV2, { body: body() });
        expect(stored().reactToAutomation).toBe(false);
        await call(ctrl.updateRuleV2, { params: { id: stored()._id }, body: body({ reactToAutomation: true }) });
        expect(stored().reactToAutomation).toBe(true);
        await call(ctrl.updateRuleV2, { params: { id: stored()._id }, body: body({ reactToAutomation: 'yes' }) });
        expect(stored().reactToAutomation).toBe(false);
    });

    it('is bounded by the event depth limit, which drops an event more than three automations deep', () => {
        const bus = require('../event/domainEventBus');
        const heard = jest.fn();
        bus.bus.on('task.subtasks_all_done', heard);
        const task = { _id: '6f0000000000000000000b01', ProjectID: PROJECT, TaskName: 'Launch' };
        const actor = { kind: 'automation', ruleId: PERSON };
        bus.publishTaskEvent({ companyId: C, type: 'task.subtasks_all_done', doc: task, actor, depth: bus.MAX_DEPTH });
        bus.publishTaskEvent({ companyId: C, type: 'task.subtasks_all_done', doc: task, actor, depth: bus.MAX_DEPTH + 1 });
        bus.bus.off('task.subtasks_all_done', heard);
        expect(bus.MAX_DEPTH).toBe(3);
        expect(heard).toHaveBeenCalledTimes(1);
    });
});
