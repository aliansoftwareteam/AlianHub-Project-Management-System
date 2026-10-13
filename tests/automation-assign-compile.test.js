const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Config/projectAccess', () => ({ canReadProject: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true),
    isWritable: (value) => value === true || value === 1 || value === 2,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const scope = require('../Modules/Agents/scope');
const guard = require('../Config/permissionGuard');
const { canReadProject } = require('../Config/projectAccess');
const registry = require('../Modules/Automations/engine/registry');
const S = require('../Modules/Automations/helpers/sentenceRules');
const ctrl = require('../Modules/Automations/controller');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const OWNER = '6f0000000000000000000001';
const PRIYA = '6f0000000000000000000011';
const SAM = '6f0000000000000000000012';
const SAM_RAY = '6f0000000000000000000018';
const GONE = '6f0000000000000000000014';
const HIDDEN = '6f0000000000000000000015';

const PEOPLE = [
    { id: PRIYA, name: 'Priya Shah' },
    { id: SAM, name: 'Sam Lee' },
    { id: HIDDEN, name: 'Hidden Person' },
];

const stepOf = (sentence, people = PEOPLE) => {
    const out = S.parseSentence(sentence, { people });
    expect(out.errors).toEqual([]);
    return out.rule.steps;
};

describe('the sentence compiler understands assignment', () => {
    it('"assign to <full name>" adds that person', () => {
        expect(stepOf('When a task is created, assign to Priya Shah.')).toEqual([
            { id: 's1', type: 'action', action: 'assign', config: { mode: 'add', userIds: [PRIYA] } },
        ]);
    });

    it('a first name that names one person is enough, in any case', () => {
        expect(stepOf('When a task is created, assign to priya')[0].config.userIds).toEqual([PRIYA]);
    });

    it('"assign to A and B" names two people, and an action after them is still an action', () => {
        const steps = stepOf('When a task is created, assign to Priya and Sam and set the priority to HIGH');
        expect(steps[0].config.userIds).toEqual([PRIYA, SAM]);
        expect(steps[1]).toMatchObject({ action: 'set_priority', config: { priority: 'HIGH' } });
    });

    it('"assign to the task creator" and "the form submitter" name the role, not a person', () => {
        expect(stepOf('When a task is created, assign to the task creator')[0].config.userIds).toEqual(['task_creator']);
        expect(stepOf('When a form is submitted, assign to the form submitter')[0].config.userIds).toEqual(['form_submitter']);
    });

    it('"rotate between A and B" takes turns', () => {
        expect(stepOf('When a task is created, rotate between Priya and Sam')[0].config).toEqual({ mode: 'add', userIds: [PRIYA, SAM], roundRobin: true });
    });

    it('"reassign to", "unassign" and "unassign everyone" replace, remove and clear', () => {
        expect(stepOf('When a task is created, reassign to Sam')[0].config).toEqual({ mode: 'replace', userIds: [SAM] });
        expect(stepOf('When a task is created, unassign Sam')[0].config).toEqual({ mode: 'remove', userIds: [SAM] });
        expect(stepOf('When a task is created, unassign everyone')[0].config).toEqual({ mode: 'clear', userIds: [] });
    });

    it('names someone it does not know as an error instead of guessing', () => {
        const out = S.parseSentence('When a task is created, assign to Zed', { people: PEOPLE });
        expect(out.ok).toBe(false);
        expect(out.errors.join(' ')).toMatch(/Zed/);
    });

    it('asks for the full name when a first name fits two people', () => {
        const out = S.parseSentence('When a task is created, assign to Sam', { people: [...PEOPLE, { id: SAM_RAY, name: 'Sam Ray' }] });
        expect(out.ok).toBe(false);
        expect(out.errors.join(' ')).toMatch(/Sam Lee/);
        expect(out.errors.join(' ')).toMatch(/Sam Ray/);
    });

    it('round-trips: the sentence written for a rule compiles back to the same rule', () => {
        [
            'When a task is created, assign to Priya Shah and Sam Lee.',
            'When a task is created, rotate between Priya Shah and Sam Lee.',
            'When a task is created, reassign in turn to Priya Shah and Sam Lee.',
            'When a task is created, reassign to Sam Lee.',
            'When a task is created, unassign Sam Lee.',
            'When a task is created, unassign everyone.',
            'When a task is created, assign to the task creator.',
        ].forEach((sentence) => {
            const rule = S.parseSentence(sentence, { people: PEOPLE }).rule;
            expect(S.describeRule(rule, { people: PEOPLE })).toBe(sentence);
        });
    });

    it('lists the assignment phrases in its grammar', () => {
        expect(S.grammar().actions.join(' | ')).toMatch(/assign to/);
        expect(S.grammar().actions.join(' | ')).toMatch(/rotate between/);
    });
});

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

const WRITES = ['save', 'updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'bulkWrite'];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    guard.getRoleType.mockImplementation(async (companyId, uid) => (uid === OWNER ? 1 : 3));
    scope.visibleProjectIds.mockResolvedValue([PROJECT]);
    canReadProject.mockImplementation(async (companyId, uid) => (uid === HIDDEN ? { allowed: false, statusCode: 404 } : { allowed: true }));
    seedPeople();
});

afterEach(() => { jest.restoreAllMocks(); });

describe('POST /api/v2/automations/compile — names become people of this company', () => {
    it('resolves the names in a sentence to the active members they name', async () => {
        const { body } = await call(ctrl.compileSentence, { body: { sentence: 'When a task is created, rotate between priya and sam' } });
        expect(body.status).toBe(true);
        expect(body.data.errors).toEqual([]);
        expect(body.data.rule.steps[0].config).toEqual({ mode: 'add', userIds: [PRIYA, SAM], roundRobin: true });
        expect(body.data.sentence).toBe('When a task is created, rotate between Priya Shah and Sam Lee.');
    });

    it('does not resolve a removed member', async () => {
        const { body } = await call(ctrl.compileSentence, { body: { sentence: 'When a task is created, assign to Gone Person' } });
        expect(body.data.rule).toBeNull();
        expect(body.data.errors.join(' ')).toMatch(/Gone Person/);
    });

    it('writes the sentence for an edited rule with names, not ids', async () => {
        const rule = {
            trigger: { type: 'event', event: 'task.created' }, conditions: {},
            steps: [{ id: 's1', type: 'action', action: 'assign', config: { mode: 'replace', userIds: [SAM] } }],
        };
        const { body } = await call(ctrl.compileSentence, { body: { rule } });
        expect(body.data.sentence).toBe('When a task is created, reassign to Sam Lee.');
    });
});

const seedRule = (config, over = {}) => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, {
    name: 'Triage', version: 2, enabled: true, deletedStatusKey: 0, createdBy: OWNER,
    trigger: { type: 'event', event: 'task.created' }, scope: { allProjects: true, projectIds: [] }, conditions: {},
    steps: [{ id: 's1', type: 'action', action: 'assign', config }],
    ...over,
});

const seedTask = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Fix login', TaskKey: 'WEB-7', CompanyId: C, ProjectID: PROJECT, sprintId: 'sp1', isParentTask: true,
    deletedStatusKey: 0, Task_Priority: 'HIGH', statusType: 'in_progress', AssigneeUserId: [], Task_Leader: OWNER, ...over,
});

describe('dry run and backtest say who would be assigned', () => {
    it('the dry run lists who would be assigned and who would be skipped, without running or writing', async () => {
        const runSpy = jest.spyOn(registry.getAction('assign'), 'run');
        const rule = seedRule({ mode: 'add', userIds: [PRIYA, GONE, HIDDEN, 'task_creator'] });
        const task = seedTask();
        mockDb.calls.length = 0;

        const { body } = await call(ctrl.dryRun, { params: { id: rule._id }, body: { taskId: task._id } });

        expect(body.status).toBe(true);
        const step = body.data.actions[0];
        expect(step.assign.mode).toBe('add');
        expect(step.assign.wouldAssign).toEqual([{ userId: PRIYA, name: 'Priya Shah' }, { userId: OWNER, name: 'Olive Owner' }]);
        expect(step.assign.skipped).toEqual(expect.arrayContaining([
            { userId: GONE, name: 'Gone Person', reason: 'not_a_member' },
            { userId: HIDDEN, name: 'Hidden Person', reason: 'no_project_access' },
        ]));
        expect(runSpy).not.toHaveBeenCalled();
        expect(mockDb.calls.filter((c) => WRITES.includes(c.method))).toEqual([]);
    });

    it('the dry run of a round robin names the next person in turn and does not move the turn on', async () => {
        const rule = seedRule({ mode: 'add', userIds: [PRIYA, SAM], roundRobin: true }, { assignCursors: { s1: 1 } });
        const task = seedTask();

        const { body } = await call(ctrl.dryRun, { params: { id: rule._id }, body: { taskId: task._id } });

        expect(body.data.actions[0].assign.wouldAssign).toEqual([{ userId: SAM, name: 'Sam Lee' }]);
        const stored = mockDb.store[SCHEMA_TYPE.AUTOMATION_RULES].find((r) => String(r._id) === String(rule._id));
        expect(stored.assignCursors.s1).toBe(1);
    });

    it('the backtest names the people each assign step would use', async () => {
        const rule = {
            trigger: { type: 'event', event: 'task.created' }, conditions: {}, scope: { allProjects: true },
            steps: [{ id: 's1', type: 'action', action: 'assign', config: { mode: 'add', userIds: [PRIYA, SAM, GONE], roundRobin: true } }],
        };
        const { body } = await call(ctrl.backtest, { body: { rule } });

        expect(body.status).toBe(true);
        expect(body.data.assignments).toEqual([{
            stepId: 's1', mode: 'add', roundRobin: true,
            people: [{ userId: PRIYA, name: 'Priya Shah' }, { userId: SAM, name: 'Sam Lee' }],
            skipped: [{ userId: GONE, name: 'Gone Person', reason: 'not_a_member' }],
        }]);
    });
});
