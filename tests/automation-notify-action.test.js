process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskReadAccess', () => ({ canReadTask: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { Notification_key } = require('../Config/notificationKey');
const { schema } = require('../utils/mongo-handler/schema');
const { canReadTask } = require('../Modules/Tasks/helpers/taskReadAccess');
const { handleNotificationtFun } = require('../Modules/notification/prepare-notification-data/controllerV2');
const socketEmitter = require('../event/socketEventEmitter');
const registry = require('../Modules/Automations/engine/registry');
const runner = require('../Modules/Automations/engine/runner');
const notices = require('../Modules/Automations/engine/noticeRecipients');
const V2 = require('../Modules/Automations/helpers/ruleSchemaV2');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const RULE = '6f0000000000000000000b01';
const OTHER_RULE = '6f0000000000000000000b02';
const PRIYA = '6f0000000000000000000011';
const SAM = '6f0000000000000000000012';
const LEE = '6f0000000000000000000013';
const GONE = '6f0000000000000000000014';
const HIDDEN = '6f0000000000000000000015';
const INVITED = '6f0000000000000000000016';
const LEADER = '6f0000000000000000000017';
const NAMES = { [PRIYA]: 'Priya Shah', [SAM]: 'Sam Lee', [LEE]: 'Lee Wong', [GONE]: 'Gone Person', [HIDDEN]: 'Hidden Person', [INVITED]: 'Invited Person', [LEADER]: 'Lena Lead' };
const T0 = Date.parse('2026-10-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const notify = () => registry.getAction('notify');

let task;

const seedWorld = (taskOver = {}) => {
    [PRIYA, SAM, LEE, HIDDEN, LEADER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, isDelete: false, roleType: 3 }));
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GONE, status: 2, isDelete: true, roleType: 3 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: INVITED, status: 1, isDelete: false, roleType: 3 });
    Object.entries(NAMES).forEach(([_id, Employee_Name]) => mockDb.seed(SCHEMA_TYPE.USERS, { _id, Employee_Name }));
    mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { _id: RULE, name: 'Tell the team', version: 2, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { _id: OTHER_RULE, name: 'Another rule', version: 2, deletedStatusKey: 0 });
    task = mockDb.seed(SCHEMA_TYPE.TASKS, {
        _id: '6f0000000000000000000d01', TaskName: 'Fix login', TaskKey: 'WEB-7', CompanyId: C, ProjectID: PROJECT, sprintId: 'sp1',
        AssigneeUserId: [PRIYA], watchers: [SAM], Task_Leader: LEADER, deletedStatusKey: 0, statusType: 'active', ...taskOver,
    });
    return task;
};

const context = (over = {}) => ({ runId: 'run1', ruleId: RULE, ruleName: 'Tell the team', stepId: 's1', depth: 0, eventType: 'task.status_changed', actor: { kind: 'user', userId: null }, ...over });
const run = (config, over = {}) => notify().run({ companyId: C, entity: { kind: 'task', id: task._id }, config, context: context(over) });
const sent = () => handleNotificationtFun.mock.calls.map(([req]) => req.body);
const receivers = () => sent().flatMap((body) => body.assigneeUsers);
const ids = (people) => people.map((p) => p.userId);
const tenantCalls = () => mockDb.calls.filter((c) => c.type !== SCHEMA_TYPE.USERS);
const ruleOf = (steps, trigger = 'task.status_changed') => ({ version: 2, trigger: { type: 'event', event: trigger }, conditions: {}, steps });
const stepOf = (config) => ({ id: 's1', type: 'action', action: 'notify', config });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    canReadTask.mockImplementation(async (companyId, uid) => uid !== HIDDEN);
    jest.spyOn(Date, 'now').mockReturnValue(T0);
});

afterEach(() => { jest.restoreAllMocks(); });

describe('the notify action is registered', () => {
    it('appears in the manifest the builder draws from, with recipients, a message and the opt-in for the person who caused the event', () => {
        const described = registry.manifest().actions.find((a) => a.key === 'notify');
        expect(described).toBeDefined();
        expect(described.appliesTo).toEqual(['task']);
        expect(described.schema.recipients).toMatchObject({ type: 'user_multi', required: true, roles: ['task_assignees', 'task_creator', 'task_watchers'] });
        expect(described.schema.message).toMatchObject({ type: 'textarea', required: true, supportsTemplates: true });
        expect(described.schema.includeActor.type).toBe('boolean');
    });

    it('keeps its rate-limit counters in a field the rule schema declares', () => {
        expect(schema.automationRules.notifyWindows).toBeDefined();
    });
});

describe('saving a rule that notifies', () => {
    it('accepts roles and members as recipients', () => {
        const out = V2.validateRuleV2(ruleOf([stepOf({ recipients: ['task_assignees', PRIYA], message: 'Look at {{task.TaskName}}' })]));
        expect(out.errors).toEqual([]);
    });

    it.each([
        ['nobody to tell', { recipients: [], message: 'x' }, /recipients/],
        ['a recipient that is neither a role nor a member id', { recipients: ['everyone'], message: 'x' }, /everyone/],
        ['no message', { recipients: ['task_creator'], message: '' }, /message/],
        ['a message longer than the limit', { recipients: ['task_creator'], message: 'x'.repeat(notices.MAX_MESSAGE + 1) }, /message/],
    ])('refuses %s', (_label, config, pattern) => {
        const out = V2.validateRuleV2(ruleOf([stepOf(config)]));
        expect(out.valid).toBe(false);
        expect(out.errors.join(' ')).toMatch(pattern);
    });
});

describe('who it reaches', () => {
    it('sends one notice to the assignees, the creator, the watchers and the named members, each once', async () => {
        seedWorld({ AssigneeUserId: [PRIYA, SAM], watchers: [SAM, LEADER] });
        const out = await run({ recipients: ['task_assignees', 'task_creator', 'task_watchers', LEE, PRIYA], message: 'Please look' });

        expect(sent()).toHaveLength(1);
        expect([...sent()[0].assigneeUsers].sort()).toEqual([PRIYA, SAM, LEE, LEADER].sort());
        expect(out.changed).toBe(true);
        expect(ids(out.notified).sort()).toEqual([PRIYA, SAM, LEE, LEADER].sort());
        expect(out.notified.find((p) => p.userId === PRIYA).name).toBe('Priya Shah');
        expect(out.skipped).toEqual([]);
    });

    it('goes through the notification pipeline as a task notice from the rule, so each person\'s settings decide Inbox, push and email', async () => {
        seedWorld();
        await run({ recipients: ['task_assignees'], message: 'Please look' });

        expect(sent()[0]).toMatchObject({
            key: Notification_key.TASK_NOTIFICATION,
            type: 'tasks',
            changeType: 'automation_notify',
            companyId: C,
            projectId: PROJECT,
            taskId: String(task._id),
            sprintId: 'sp1',
            userId: RULE,
            assigneeUsers: [PRIYA],
            notSeen: [PRIYA],
            message: 'Please look',
            changeData: { ruleId: RULE, ruleName: 'Tell the team', taskKey: 'WEB-7', taskName: 'Fix login', text: 'Please look' },
        });
    });

    it('skips a removed member, an invitation nobody accepted and someone who cannot open the task', async () => {
        seedWorld();
        const out = await run({ recipients: [PRIYA, GONE, INVITED, HIDDEN], message: 'Please look' });

        expect(receivers()).toEqual([PRIYA]);
        expect(out.skipped).toEqual(expect.arrayContaining([
            { userId: GONE, name: 'Gone Person', reason: 'not_a_member' },
            { userId: INVITED, name: 'Invited Person', reason: 'not_a_member' },
            { userId: HIDDEN, name: 'Hidden Person', reason: 'no_task_access' },
        ]));
        expect(canReadTask).toHaveBeenCalledWith(C, PRIYA, expect.objectContaining({ ProjectID: PROJECT }));
    });

    it('skips a watcher who cannot open the task, even though the task lists them', async () => {
        seedWorld({ watchers: [HIDDEN, SAM] });
        await run({ recipients: ['task_watchers'], message: 'Please look' });
        expect(receivers()).toEqual([SAM]);
    });

    it('sends nothing and says so when nobody is left to tell', async () => {
        seedWorld({ AssigneeUserId: [] });
        const out = await run({ recipients: ['task_assignees'], message: 'Please look' });
        expect(sent()).toEqual([]);
        expect(out).toMatchObject({ changed: false, notified: [] });
    });

    it('refuses a task that is not there', async () => {
        seedWorld();
        await expect(notify().run({ companyId: C, entity: { kind: 'task', id: '6f00000000000000000000ff' }, config: { recipients: [PRIYA], message: 'x' }, context: context() }))
            .rejects.toMatchObject({ deterministic: true });
        expect(sent()).toEqual([]);
    });

    it('reads and writes only in the company of the run', async () => {
        seedWorld();
        await run({ recipients: ['task_assignees', LEE], message: 'Please look' });
        expect(tenantCalls().length).toBeGreaterThan(0);
        expect(tenantCalls().every((c) => c.companyId === C)).toBe(true);
    });

    it('changes no task and announces nothing on the task socket', async () => {
        const emit = jest.spyOn(socketEmitter, 'emit');
        seedWorld();
        await run({ recipients: ['task_assignees'], message: 'Please look' });
        expect(emit).not.toHaveBeenCalled();
        expect(mockDb.calls.some((c) => c.type === SCHEMA_TYPE.TASKS && c.method !== 'findOne' && c.method !== 'find')).toBe(false);
    });
});

describe('the person who caused the event', () => {
    it('is never told by default', async () => {
        seedWorld({ AssigneeUserId: [PRIYA, SAM] });
        const out = await run({ recipients: ['task_assignees'], message: 'Please look' }, { actor: { kind: 'user', userId: PRIYA } });
        expect(receivers()).toEqual([SAM]);
        expect(out.skipped).toEqual([{ userId: PRIYA, name: 'Priya Shah', reason: 'caused_event' }]);
    });

    it('is told when the rule says so', async () => {
        seedWorld({ AssigneeUserId: [PRIYA, SAM] });
        await run({ recipients: ['task_assignees'], message: 'Please look', includeActor: true }, { actor: { kind: 'user', userId: PRIYA } });
        expect([...receivers()].sort()).toEqual([PRIYA, SAM].sort());
    });
});

describe('the message', () => {
    const execute = (message, taskOver = {}) => {
        seedWorld(taskOver);
        const envelope = {
            type: 'task.status_changed', companyId: C, depth: 0, actor: { kind: 'user', userId: null },
            entity: { kind: 'task', id: String(task._id), key: task.TaskKey },
            data: { _id: String(task._id), TaskName: task.TaskName, TaskKey: task.TaskKey, ProjectID: PROJECT },
        };
        return runner.executeStep(stepOf({ recipients: ['task_assignees'], message }), { companyId: C, envelope, outputs: {}, context: context() });
    };

    it('fills the same placeholders other actions use', async () => {
        await execute('{{task.TaskKey}} {{task.TaskName}} needs you');
        expect(sent()[0].message).toBe('WEB-7 Fix login needs you');
    });

    it('escapes markup a task name or the rule author carries, for the surfaces that render HTML', async () => {
        await execute('<b>Late</b>: {{task.TaskName}}', { TaskName: '<img src=x onerror=alert(1)>' });
        const body = sent()[0];
        expect(body.message).not.toMatch(/<img|<b>/);
        expect(body.message).toBe('&lt;b&gt;Late&lt;/b&gt;: &lt;img src=x onerror=alert(1)&gt;');
        expect(body.changeData.text).toBe('<b>Late</b>: <img src=x onerror=alert(1)>');
    });

    it('does not escape twice a name the web app already stored escaped', async () => {
        await execute('{{task.TaskName}}', { TaskName: 'Fix &lt;login&gt; &amp; logout' });
        expect(sent()[0].message).toBe('Fix &lt;login&gt; &amp; logout');
        expect(sent()[0].changeData.text).toBe('Fix <login> & logout');
    });

    it('refuses a message that renders empty', async () => {
        seedWorld();
        await expect(run({ recipients: ['task_assignees'], message: '   ' })).rejects.toMatchObject({ deterministic: true });
        expect(sent()).toEqual([]);
    });
});

describe('rate limit per rule and recipient', () => {
    const config = { recipients: [PRIYA], message: 'Please look' };

    it('stops telling one person once the rule has reached its hourly limit for them, and says who was skipped', async () => {
        seedWorld();
        for (let i = 0; i < notices.MAX_PER_HOUR; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await run(config);
        }
        expect(sent()).toHaveLength(notices.MAX_PER_HOUR);

        const out = await run(config);
        expect(sent()).toHaveLength(notices.MAX_PER_HOUR);
        expect(out).toMatchObject({ changed: false, notified: [], skipped: [{ userId: PRIYA, name: 'Priya Shah', reason: 'rate_limited' }] });
    });

    it('still tells other people, and lets another rule tell the same person', async () => {
        seedWorld();
        for (let i = 0; i < notices.MAX_PER_HOUR; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await run(config);
        }
        handleNotificationtFun.mockClear();

        await run({ recipients: [PRIYA, SAM], message: 'Please look' });
        expect(receivers()).toEqual([SAM]);

        handleNotificationtFun.mockClear();
        await run(config, { ruleId: OTHER_RULE });
        expect(receivers()).toEqual([PRIYA]);
    });

    it('tells them again in the next hour', async () => {
        seedWorld();
        for (let i = 0; i < notices.MAX_PER_HOUR + 1; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await run(config);
        }
        handleNotificationtFun.mockClear();
        Date.now.mockReturnValue(T0 + HOUR);
        await run(config);
        expect(receivers()).toEqual([PRIYA]);
    });
});

describe('preview for the dry run', () => {
    it('answers who would be told and who would be skipped, and sends and writes nothing', async () => {
        seedWorld({ AssigneeUserId: [PRIYA, HIDDEN] });
        const out = await notify().preview({ companyId: C, task, config: { recipients: ['task_assignees', 'task_creator', GONE], message: 'Please look' }, context: context() });

        expect(ids(out.wouldNotify).sort()).toEqual([PRIYA, LEADER].sort());
        expect(out.wouldNotify.find((p) => p.userId === LEADER).name).toBe('Lena Lead');
        expect(out.skipped).toEqual(expect.arrayContaining([
            { userId: HIDDEN, name: 'Hidden Person', reason: 'no_task_access' },
            { userId: GONE, name: 'Gone Person', reason: 'not_a_member' },
        ]));
        expect(sent()).toEqual([]);
        expect(mockDb.calls.every((c) => ['find', 'findOne', 'countDocuments', 'aggregate'].includes(c.method))).toBe(true);
    });
});
