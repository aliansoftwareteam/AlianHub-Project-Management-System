const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskReadAccess', () => ({ canReadTask: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true),
    isWritable: (value) => value === true || value === 1 || value === 2,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const scope = require('../Modules/Agents/scope');
const guard = require('../Config/permissionGuard');
const { canReadTask } = require('../Modules/Tasks/helpers/taskReadAccess');
const { handleNotificationtFun } = require('../Modules/notification/prepare-notification-data/controllerV2');
const registry = require('../Modules/Automations/engine/registry');
const S = require('../Modules/Automations/helpers/sentenceRules');
const { validateRuleV2 } = require('../Modules/Automations/helpers/ruleSchemaV2');
const ctrl = require('../Modules/Automations/controller');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const OTHER_PROJECT = '6f0000000000000000000a02';
const OWNER = '6f0000000000000000000001';
const PRIYA = '6f0000000000000000000011';
const SAM = '6f0000000000000000000012';
const GONE = '6f0000000000000000000014';
const HIDDEN = '6f0000000000000000000015';
const DAY = 24 * 60 * 60 * 1000;
const WRITES = ['save', 'updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'bulkWrite'];

const PEOPLE = [{ id: PRIYA, name: 'Priya Shah' }, { id: SAM, name: 'Sam Lee' }];

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

const seedPeople = () => {
    [OWNER, PRIYA, SAM, HIDDEN].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, isDelete: false, roleType: userId === OWNER ? 1 : 3 }));
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GONE, status: 2, isDelete: true, roleType: 3 });
    [[OWNER, 'Olive Owner'], [PRIYA, 'Priya Shah'], [SAM, 'Sam Lee'], [HIDDEN, 'Hidden Person'], [GONE, 'Gone Person']]
        .forEach(([_id, Employee_Name]) => mockDb.seed(SCHEMA_TYPE.USERS, { _id, Employee_Name }));
};

const seedRule = (over = {}) => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, {
    name: 'Overdue', version: 2, enabled: true, deletedStatusKey: 0, createdBy: OWNER,
    trigger: { type: 'event', event: 'task.due_date_passed' }, scope: { allProjects: true, projectIds: [] }, conditions: {},
    steps: [{ id: 's1', type: 'action', action: 'notify', config: { recipients: ['task_assignees', 'task_creator', GONE], message: '{{task.TaskKey}} is overdue' } }],
    ...over,
});

const seedTask = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Fix login', TaskKey: 'WEB-7', CompanyId: C, ProjectID: PROJECT, sprintId: 'sp1', isParentTask: true,
    deletedStatusKey: 0, Task_Priority: 'HIGH', statusType: 'active', AssigneeUserId: [PRIYA, HIDDEN], watchers: [], Task_Leader: OWNER,
    updatedAt: new Date(), ...over,
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    guard.getRoleType.mockImplementation(async (companyId, uid) => (uid === OWNER ? 1 : 3));
    scope.visibleProjectIds.mockResolvedValue([PROJECT]);
    canReadTask.mockImplementation(async (companyId, uid) => uid !== HIDDEN);
    seedPeople();
});

afterEach(() => { jest.restoreAllMocks(); });

describe('the sentence compiler understands the new triggers and the notify action', () => {
    const canonical = [
        'When a task due date passes, set the priority to HIGH.',
        'When all subtasks of a task are done, post a comment saying "ready to close".',
        'When a task due date passes, send "This is overdue" to the assignees and the task creator.',
        'When a task is created, send "New work and a deadline" to Priya Shah and the watchers, even if they caused it.',
    ];

    test.each(canonical)('sentence → rule → sentence is a fixed point: %s', (sentence) => {
        const first = S.parseSentence(sentence, { people: PEOPLE });
        expect(first.errors).toEqual([]);
        expect(validateRuleV2(first.rule).errors).toEqual([]);
        expect(S.describeRule(first.rule, { people: PEOPLE })).toBe(sentence);
    });

    it('reads roles, members and the opt-in for whoever caused the event', () => {
        const out = S.parseSentence('When a task due date passes, send "Late" to the assignees and priya, even if they caused it', { people: PEOPLE });
        expect(out.errors).toEqual([]);
        expect(out.rule.trigger.event).toBe('task.due_date_passed');
        expect(out.rule.steps).toEqual([{ id: 's1', type: 'action', action: 'notify', config: { recipients: ['task_assignees', PRIYA], message: 'Late', includeActor: true } }]);
    });

    it('lets another action follow the people', () => {
        const out = S.parseSentence('When all subtasks of a task are done, send "All done" to the task creator and set the priority to LOW', { people: PEOPLE });
        expect(out.errors).toEqual([]);
        expect(out.rule.steps.map((s) => s.action)).toEqual(['notify', 'set_priority']);
    });

    it('names an unknown person instead of guessing', () => {
        const out = S.parseSentence('When a task is created, send "Hi" to Zed', { people: PEOPLE });
        expect(out.rule).toBeNull();
        expect(out.errors.join(' ')).toMatch(/Zed/);
    });

    it('lists the new phrases in its grammar', () => {
        const grammar = S.grammar();
        expect(grammar.triggers).toEqual(expect.arrayContaining(['a task due date passes', 'all subtasks of a task are done']));
        expect(grammar.actions.join(' | ')).toMatch(/send "<text>" to/);
    });

    it('POST /compile resolves the people a notify sentence names, and writes names back', async () => {
        const { body } = await call(ctrl.compileSentence, { body: { sentence: 'When a task due date passes, send "Late" to sam' } });
        expect(body.data.errors).toEqual([]);
        expect(body.data.rule.steps[0].config).toEqual({ recipients: [SAM], message: 'Late' });
        expect(body.data.sentence).toBe('When a task due date passes, send "Late" to Sam Lee.');
    });
});

describe('dry run', () => {
    it('lists who would be notified and who would be skipped, with the message filled in, and sends nothing', async () => {
        const runSpy = jest.spyOn(registry.getAction('notify'), 'run');
        const rule = seedRule();
        const task = seedTask({ DueDate: new Date(Date.now() - DAY) });
        mockDb.calls.length = 0;

        const { body } = await call(ctrl.dryRun, { params: { id: rule._id }, body: { taskId: task._id } });

        expect(body.status).toBe(true);
        const step = body.data.actions[0];
        expect(step.params.message).toBe('WEB-7 is overdue');
        expect(step.notify.wouldNotify).toEqual([{ userId: PRIYA, name: 'Priya Shah' }, { userId: OWNER, name: 'Olive Owner' }]);
        expect(step.notify.skipped).toEqual(expect.arrayContaining([
            { userId: HIDDEN, name: 'Hidden Person', reason: 'no_task_access' },
            { userId: GONE, name: 'Gone Person', reason: 'not_a_member' },
        ]));
        expect(runSpy).not.toHaveBeenCalled();
        expect(handleNotificationtFun).not.toHaveBeenCalled();
        expect(mockDb.calls.filter((c) => WRITES.includes(c.method))).toEqual([]);
    });

    it.each([
        ['a due date that has passed on an open task', { DueDate: new Date(Date.now() - DAY) }, { wouldFire: true, reason: 'due' }],
        ['a due date still ahead', { DueDate: new Date(Date.now() + DAY) }, { wouldFire: false, reason: 'not_due_yet' }],
        ['no due date', { DueDate: null }, { wouldFire: false, reason: 'no_due_date' }],
        ['a closed task', { DueDate: new Date(Date.now() - DAY), statusType: 'close' }, { wouldFire: false, reason: 'task_closed' }],
    ])('says whether the due date trigger would fire for %s', async (_label, over, expected) => {
        const rule = seedRule();
        const task = seedTask(over);
        const { body } = await call(ctrl.dryRun, { params: { id: rule._id }, body: { taskId: task._id } });
        expect(body.data.trigger).toMatchObject({ event: 'task.due_date_passed', ...expected });
    });

    it('says how many subtasks are still open for the subtasks trigger', async () => {
        const rule = seedRule({ trigger: { type: 'event', event: 'task.subtasks_all_done' } });
        const parent = seedTask();
        const sub = (over) => seedTask({ isParentTask: false, ParentTaskId: String(parent._id), ...over });
        sub({ statusType: 'close' });
        const open = sub({ TaskKey: 'WEB-7-b' });
        sub({ TaskKey: 'WEB-7-c', deletedStatusKey: 1 });

        const first = await call(ctrl.dryRun, { params: { id: rule._id }, body: { taskId: parent._id } });
        expect(first.body.data.trigger).toMatchObject({ event: 'task.subtasks_all_done', wouldFire: false, reason: 'subtasks_open', open: 1, total: 2 });

        mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === String(open._id)).statusType = 'done';
        const second = await call(ctrl.dryRun, { params: { id: rule._id }, body: { taskId: parent._id } });
        expect(second.body.data.trigger).toMatchObject({ wouldFire: true, reason: 'subtasks_done', open: 0, total: 2 });

        const lone = seedTask({ TaskKey: 'WEB-9' });
        const third = await call(ctrl.dryRun, { params: { id: rule._id }, body: { taskId: lone._id } });
        expect(third.body.data.trigger).toMatchObject({ wouldFire: false, reason: 'no_subtasks', total: 0 });
    });

    it('adds no trigger note to a rule on an ordinary event', async () => {
        const rule = seedRule({ trigger: { type: 'event', event: 'task.created' } });
        const task = seedTask();
        const { body } = await call(ctrl.dryRun, { params: { id: rule._id }, body: { taskId: task._id } });
        expect(body.data.trigger).toBeUndefined();
    });
});

describe('backtest', () => {
    const backtest = (rule) => call(ctrl.backtest, { body: { rule } });
    const ruleOn = (event, over = {}) => ({ trigger: { type: 'event', event }, conditions: {}, scope: { allProjects: true }, steps: [], ...over });

    it('counts open tasks whose due date passed in the window for the due date trigger', async () => {
        seedTask({ DueDate: new Date(Date.now() - DAY) });
        seedTask({ TaskKey: 'WEB-8', DueDate: new Date(Date.now() - 2 * DAY), Task_Priority: 'LOW' });
        seedTask({ TaskKey: 'WEB-9', DueDate: new Date(Date.now() - DAY), statusType: 'close' });
        seedTask({ TaskKey: 'WEB-10', DueDate: new Date(Date.now() + DAY) });
        seedTask({ TaskKey: 'WEB-11', DueDate: new Date(Date.now() - 45 * DAY) });
        seedTask({ TaskKey: 'WEB-12', DueDate: new Date(Date.now() - DAY), ProjectID: OTHER_PROJECT });

        const all = await backtest(ruleOn('task.due_date_passed'));
        expect(all.body.data).toMatchObject({ matched: 2, basisKey: 'due_date_passed' });
        expect(all.body.data.sample.map((t) => t.key).sort()).toEqual(['WEB-7', 'WEB-8']);

        const high = await backtest(ruleOn('task.due_date_passed', { conditions: { op: 'eq', field: 'Task_Priority', value: 'HIGH' } }));
        expect(high.body.data.matched).toBe(1);
    });

    it('counts parents whose subtasks are all done for the subtasks trigger', async () => {
        const finished = seedTask({ TaskKey: 'WEB-20' });
        const unfinished = seedTask({ TaskKey: 'WEB-21' });
        seedTask({ TaskKey: 'WEB-22' });
        const sub = (parent, over) => seedTask({ isParentTask: false, ParentTaskId: String(parent._id), ...over });
        sub(finished, { statusType: 'close' });
        sub(finished, { statusType: 'done' });
        sub(unfinished, { statusType: 'close' });
        sub(unfinished, { statusType: 'active' });

        const { body } = await backtest(ruleOn('task.subtasks_all_done'));
        expect(body.data).toMatchObject({ matched: 1, basisKey: 'subtasks_all_done' });
        expect(body.data.sample.map((t) => t.key)).toEqual(['WEB-20']);
    });

    it('keeps the touched-tasks count for every other trigger', async () => {
        seedTask();
        const { body } = await backtest(ruleOn('task.created'));
        expect(body.data).toMatchObject({ matched: 1, basisKey: 'touched' });
    });

    it('names the people each notify step would tell, and sends nothing', async () => {
        const rule = ruleOn('task.created', { steps: [{ id: 's1', type: 'action', action: 'notify', config: { recipients: ['task_assignees', PRIYA, GONE], message: 'Hi' } }] });
        const { body } = await backtest(rule);
        expect(body.data.notifications).toEqual([{
            stepId: 's1',
            people: [{ userId: PRIYA, name: 'Priya Shah' }, { userId: 'task_assignees', name: null }],
            skipped: [{ userId: GONE, name: 'Gone Person', reason: 'not_a_member' }],
        }]);
        expect(handleNotificationtFun).not.toHaveBeenCalled();
    });
});
