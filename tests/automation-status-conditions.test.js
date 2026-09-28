const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
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
const S = require('../Modules/Automations/helpers/sentenceRules');
const SC = require('../Modules/Automations/helpers/statusConditions');
const R = require('../Modules/Automations/helpers/automationRules');
const matcher = require('../Modules/Automations/engine/matcher');
const { evaluate } = require('../Modules/Automations/engine/expression');
const dryRun = require('../Modules/Automations/helpers/dryRun');
const ctrl = require('../Modules/Automations/controller');

const C = '6f0000000000000000000c01';
const WEB = '6f0000000000000000000a01';
const OPS = '6f0000000000000000000a02';
const LATER = '6f0000000000000000000a03';
const OWNER = '6f0000000000000000000001';

const PROJECTS = [
    {
        _id: WEB,
        ProjectName: 'Web',
        taskStatusData: [
            { key: 1, name: 'To Do', type: 'default_active' },
            { key: 3, name: 'In Progress', type: 'active' },
            { key: 4, name: 'Blocked', type: 'active' },
            { key: 5, name: 'In Review', type: 'active' },
            { key: 6, name: 'Done', type: 'close' },
        ],
    },
    {
        _id: OPS,
        ProjectName: 'Ops',
        taskStatusData: [
            { key: 1, name: 'Open', type: 'default_active' },
            { key: 7, name: 'Blocked', type: 'active' },
            { key: 8, name: 'Code Review', type: 'active' },
            { key: 9, name: 'Complete', type: 'close' },
        ],
    },
];

const STATUSES = SC.catalogueOf(PROJECTS);
const WEB_BLOCKED = `${WEB}:4`;
const OPS_BLOCKED = `${OPS}:7`;

const task = (projectId, statusKey, statusType, over = {}) => ({
    _id: 't1', TaskKey: 'WEB-1', TaskName: 'Fix login', ProjectID: projectId, statusKey, statusType, Task_Priority: 'HIGH', isParentTask: true, ...over,
});

const statusChange = (from, to, changedFields = ['status', 'statusType', 'statusKey']) => ({
    companyId: C,
    type: 'task.status_changed',
    data: to,
    previous: from,
    actor: { kind: 'user', userId: OWNER },
    scope: { projectId: to.ProjectID },
    entity: { kind: 'task', id: to._id },
    changedFields,
});

const holds = (conditions, envelope) => evaluate(conditions, matcher.contextFor(envelope));
const conditionsOf = (sentence, statuses = STATUSES) => {
    const out = S.parseSentence(sentence, { statuses });
    expect(out.errors).toEqual([]);
    return out.rule.conditions;
};

describe('"status is <name>" compiles to the statuses it names, by key', () => {
    test('a name used by two projects becomes both projects\' keys, keeping the name to show', () => {
        expect(conditionsOf('When a task is created, if the status is Blocked, set the priority to HIGH.'))
            .toEqual({ op: 'in', field: 'statusRef', value: [WEB_BLOCKED, OPS_BLOCKED], label: 'Blocked' });
    });

    test('"status is not" is the negation over the same keys', () => {
        expect(conditionsOf('When a task is created, if the status is not blocked, set the priority to HIGH.'))
            .toEqual({ op: 'notIn', field: 'statusRef', value: [WEB_BLOCKED, OPS_BLOCKED], label: 'Blocked' });
    });

    test('a "status is Blocked" rule matches a task in Blocked and no other', () => {
        const conditions = conditionsOf('When a task is created, if the status is Blocked, set the priority to HIGH.');
        const created = (t) => ({ ...statusChange(null, t, []), type: 'task.created' });
        expect(holds(conditions, created(task(WEB, 4, 'active')))).toBe(true);
        expect(holds(conditions, created(task(OPS, 7, 'active')))).toBe(true);
        expect(holds(conditions, created(task(WEB, 5, 'active')))).toBe(false);
        expect(holds(conditions, created(task(OPS, 4, 'active')))).toBe(false);
    });

    test('"Blocked or In Review" names both statuses', () => {
        const sentence = 'When a task is created, if the status is Blocked or In Review, set the priority to HIGH.';
        const out = S.parseSentence(sentence, { statuses: STATUSES });
        expect(out.rule.conditions).toEqual({ op: 'in', field: 'statusRef', value: [WEB_BLOCKED, OPS_BLOCKED, `${WEB}:5`], label: 'Blocked or In Review' });
        expect(S.describeRule(out.rule)).toBe(sentence);
    });

    test('the sentence reads the name back, so sentence → rule → sentence stays fixed', () => {
        const sentence = 'When a task status changes to Blocked, if the status is not In Review, set the priority to HIGH.';
        const out = S.parseSentence(sentence, { statuses: STATUSES });
        expect(out.errors).toEqual([]);
        expect(S.describeRule(out.rule)).toBe(sentence);
    });
});

describe('"changes to" and "changed from" a named status match status-change events', () => {
    const toBlocked = conditionsOf('When a task status changes to Blocked, post a comment saying "stuck".');

    test('changedTo Blocked compiles to the Blocked keys', () => {
        expect(toBlocked).toEqual({ op: 'changedTo', field: 'statusRef', value: [WEB_BLOCKED, OPS_BLOCKED], label: 'Blocked' });
    });

    test('matches a move into Blocked, not a move elsewhere', () => {
        expect(holds(toBlocked, statusChange(task(WEB, 3, 'active'), task(WEB, 4, 'active')))).toBe(true);
        expect(holds(toBlocked, statusChange(task(WEB, 3, 'active'), task(WEB, 5, 'active')))).toBe(false);
    });

    test('matches when only the key is reported as changed, as between two active statuses', () => {
        expect(holds(toBlocked, statusChange(task(OPS, 8, 'active'), task(OPS, 7, 'active'), ['statusKey']))).toBe(true);
    });

    test('changedFrom Blocked matches a move out of Blocked', () => {
        const fromBlocked = { op: 'changedFrom', field: 'statusRef', value: [WEB_BLOCKED, OPS_BLOCKED], label: 'Blocked' };
        expect(holds(fromBlocked, statusChange(task(WEB, 4, 'active'), task(WEB, 6, 'close')))).toBe(true);
        expect(holds(fromBlocked, statusChange(task(WEB, 3, 'active'), task(WEB, 6, 'close')))).toBe(false);
    });

    test('a task marked Done by name reads as the done type, so every project\'s done status counts', () => {
        const marked = conditionsOf('When a task is marked Done, post a comment saying "shipped".');
        expect(marked).toEqual({ op: 'changedTo', field: 'statusType', value: 'close' });
        expect(holds(marked, statusChange(task(OPS, 7, 'active'), task(OPS, 9, 'close')))).toBe(true);
    });
});

describe('generic words name a status type', () => {
    test('"done" matches any done-type status, whatever the project calls it', () => {
        const conditions = conditionsOf('When a task is updated, if the status is done, post a comment saying "closed".');
        expect(conditions).toEqual({ op: 'eq', field: 'statusType', value: 'close' });
        const updated = (t) => ({ ...statusChange(t, t, ['TaskName']), type: 'task.updated' });
        expect(holds(conditions, updated(task(WEB, 6, 'close')))).toBe(true);
        expect(holds(conditions, updated(task(OPS, 9, 'close')))).toBe(true);
        expect(holds(conditions, updated(task(OPS, 7, 'active')))).toBe(false);
    });

    test('"open" and "closed" map to their types', () => {
        expect(conditionsOf('When a task is created, if the status is open, set the priority to LOW.')).toEqual({ op: 'eq', field: 'statusType', value: 'default_active' });
        expect(conditionsOf('When a task is created, if the status is not closed, set the priority to LOW.')).toEqual({ op: 'neq', field: 'statusType', value: 'close' });
    });

    test('"in progress" is the named status where one is called that', () => {
        expect(conditionsOf('When a task is created, if the status is in progress, set the priority to LOW.'))
            .toEqual({ op: 'in', field: 'statusRef', value: [`${WEB}:3`], label: 'In Progress' });
    });

    test('"in progress" is the active type where no status is called that', () => {
        const opsOnly = STATUSES.filter((s) => s.projectId === OPS);
        expect(conditionsOf('When a task is created, if the status is in progress, set the priority to LOW.', opsOnly))
            .toEqual({ op: 'eq', field: 'statusType', value: 'active' });
    });

    test('a type condition reads back as its word', () => {
        const sentence = 'When a task is created, if the status is done, set the priority to LOW.';
        expect(S.describeRule(S.parseSentence(sentence, { statuses: STATUSES }).rule)).toBe(sentence);
    });
});

describe('a status name the compiler cannot place is an error naming the choices', () => {
    test('an unknown name lists the statuses there are', () => {
        const out = S.parseSentence('When a task is created, if the status is Frozen, set the priority to HIGH.', { statuses: STATUSES });
        expect(out.ok).toBe(false);
        expect(out.rule).toBeNull();
        expect(out.errors).toEqual(['I do not know a status called "Frozen". The statuses are To Do, In Progress, Blocked, In Review, Done, Open, Code Review and Complete.']);
    });

    test('a partial name that fits two statuses asks for the full name', () => {
        const out = S.parseSentence('When a task is created, if the status is Review, set the priority to HIGH.', { statuses: STATUSES });
        expect(out.ok).toBe(false);
        expect(out.errors).toEqual(['"Review" could be In Review or Code Review — use the full name.']);
    });

    test('a status changes to an unknown name is an error too', () => {
        const out = S.parseSentence('When a task status changes to Frozen, set the priority to HIGH.', { statuses: STATUSES });
        expect(out.ok).toBe(false);
        expect(out.errors[0]).toMatch(/^I do not know a status called "Frozen"/);
    });

    test('with no statuses to resolve against, a name is unknown rather than guessed', () => {
        const out = S.parseSentence('When a task is created, if the status is Blocked, set the priority to HIGH.');
        expect(out.ok).toBe(false);
        expect(out.errors).toEqual(['I do not know a status called "Blocked".']);
    });
});

describe('a rule stored with a status name still matches before the migration runs', () => {
    const seedRule = (conditions, over = {}) => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, {
        name: 'Legacy', version: 2, enabled: true, deletedStatusKey: 0, createdBy: OWNER,
        trigger: { type: 'event', event: 'task.status_changed' }, scope: { allProjects: true, projectIds: [] },
        conditions, steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'x' } }], ...over,
    });

    beforeEach(() => {
        Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
        matcher.invalidateAll();
        PROJECTS.forEach((p) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { ...p, deletedStatusKey: 0 }));
    });

    test('statusType "Blocked" resolves to the Blocked statuses of the task\'s project', async () => {
        seedRule({ op: 'eq', field: 'statusType', value: 'Blocked' });
        expect(await matcher.match(C, statusChange(task(OPS, 8, 'active'), task(OPS, 7, 'active')))).toHaveLength(1);
        expect(await matcher.match(C, statusChange(task(OPS, 7, 'active'), task(OPS, 8, 'active')))).toHaveLength(0);
    });

    test('changedTo "In Review" on a legacy rule matches the move into In Review', async () => {
        seedRule({ op: 'changedTo', field: 'statusType', value: 'In Review' });
        expect(await matcher.match(C, statusChange(task(WEB, 3, 'active'), task(WEB, 5, 'active')))).toHaveLength(1);
    });

    test('a name no project has still matches nothing, rather than everything', async () => {
        seedRule({ op: 'eq', field: 'statusType', value: 'Frozen' });
        expect(await matcher.match(C, statusChange(task(WEB, 3, 'active'), task(WEB, 4, 'active')))).toHaveLength(0);
    });

    test('a type value is left as the type', async () => {
        seedRule({ op: 'changedTo', field: 'statusType', value: 'close' });
        expect(await matcher.match(C, statusChange(task(WEB, 4, 'active'), task(WEB, 6, 'close')))).toHaveLength(1);
    });

    test('an all-projects rule keyed to Blocked also matches Blocked in a project made after it was saved', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: LATER, deletedStatusKey: 0, taskStatusData: [{ key: 2, name: 'Blocked', type: 'active' }] });
        seedRule({ op: 'changedTo', field: 'statusRef', value: [WEB_BLOCKED], label: 'Blocked' });
        expect(await matcher.match(C, statusChange(task(LATER, 1, 'default_active'), task(LATER, 2, 'active')))).toHaveLength(1);
        expect(await matcher.match(C, statusChange(task(WEB, 3, 'active'), task(WEB, 4, 'active')))).toHaveLength(1);
    });

    test('a rule scoped to one project resolves the name in that project only', () => {
        const { conditions } = SC.normaliseStatusConditions(
            { op: 'eq', field: 'statusType', value: 'Blocked' }, STATUSES, { allProjects: false, projectIds: [OPS] },
        );
        expect(conditions).toEqual({ op: 'in', field: 'statusRef', value: [OPS_BLOCKED], label: 'Blocked' });
    });
});

describe('the v1 rules path matches status names too', () => {
    test('matchTask finds a task in the named status', () => {
        expect(R.matchTask(task(WEB, 4, 'active'), { statusType: 'Blocked' }, STATUSES)).toBe(true);
        expect(R.matchTask(task(WEB, 5, 'active'), { statusType: 'Blocked' }, STATUSES)).toBe(false);
        expect(R.matchTask(task(WEB, 6, 'close'), { statusType: 'close' }, STATUSES)).toBe(true);
    });

    test('buildMatch queries the named status by project and key', () => {
        const match = R.buildMatch({ statusType: 'Blocked', projectId: OPS }, (id) => id, STATUSES);
        expect(match.statusType).toBeUndefined();
        expect(match.$or).toEqual([{ ProjectID: OPS, statusKey: 7 }]);
    });

    test('a status type still queries the type', () => {
        expect(R.buildMatch({ statusType: 'close' }, (id) => id, STATUSES).statusType).toBe('close');
    });
});

describe('the dry run and backtest show status names', () => {
    const rule = {
        _id: 'r1', name: 'Blocked watch', version: 2, enabled: true,
        trigger: { type: 'event', event: 'task.status_changed' }, scope: { allProjects: true, projectIds: [] },
        conditions: { op: 'in', field: 'statusRef', value: [WEB_BLOCKED, OPS_BLOCKED], label: 'Blocked' },
        steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'x' } }],
    };

    test('a clause that fails names the status the task is in and the one the rule wants', () => {
        const plan = dryRun.plan({ rule, task: task(WEB, 5, 'active'), statuses: STATUSES });
        expect(plan.matched).toBe(false);
        expect(plan.conditions[0]).toMatchObject({ field: 'statusRef', passed: false, valueName: 'Blocked', actualName: 'In Review' });
        expect(plan.reasons[0]).toBe('The status is "In Review", and the rule needs the status to be "Blocked".');
    });

    test('a legacy name condition is resolved before the dry run evaluates it', () => {
        const legacy = { ...rule, conditions: { op: 'eq', field: 'statusType', value: 'Blocked' } };
        expect(dryRun.plan({ rule: legacy, task: task(WEB, 4, 'active'), statuses: STATUSES }).matched).toBe(true);
    });

    describe('POST /api/v2/automations/backtest', () => {
        beforeEach(() => {
            Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
            guard.getRoleType.mockResolvedValue(1);
            scope.visibleProjectIds.mockResolvedValue([WEB, OPS]);
            PROJECTS.forEach((p) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { ...p, deletedStatusKey: 0 }));
            [[WEB, 4, 'WEB-4'], [OPS, 7, 'OPS-7'], [WEB, 5, 'WEB-5']].forEach(([projectId, key, TaskKey]) => {
                const stored = task(projectId, key, 'active', { TaskKey });
                delete stored._id;
                mockDb.seed(SCHEMA_TYPE.TASKS, { ...stored, updatedAt: new Date(), deletedStatusKey: 0 });
            });
        });

        const backtest = async (conditions) => {
            const res = { status() { return this; }, send(payload) { this.body = payload; return this; } };
            await ctrl.backtest({ uid: OWNER, params: {}, body: { rule: { ...rule, conditions } }, headers: { companyid: C } }, res);
            return res.body;
        };

        test('counts the tasks in the named status and names each sample\'s status', async () => {
            const body = await backtest({ op: 'changedTo', field: 'statusRef', value: [WEB_BLOCKED, OPS_BLOCKED], label: 'Blocked' });
            expect(body.status).toBe(true);
            expect(body.data.matched).toBe(2);
            expect(body.data.sample.map((s) => s.status).sort()).toEqual(['Blocked', 'Blocked']);
        });

        test('a legacy name condition counts the tasks in that status', async () => {
            const body = await backtest({ op: 'eq', field: 'statusType', value: 'In Review' });
            expect(body.data.matched).toBe(1);
            expect(body.data.sample[0]).toMatchObject({ key: 'WEB-5', status: 'In Review' });
        });
    });
});

describe('POST /api/v2/automations/compile resolves statuses among the projects the author can use', () => {
    beforeEach(() => {
        Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
        guard.getRoleType.mockResolvedValue(1);
        scope.visibleProjectIds.mockResolvedValue([WEB]);
        PROJECTS.forEach((p) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { ...p, deletedStatusKey: 0 }));
    });

    const compile = async (body) => {
        const res = { status() { return this; }, send(payload) { this.body = payload; return this; } };
        await ctrl.compileSentence({ uid: OWNER, params: {}, body, headers: { companyid: C } }, res);
        return res.body;
    };

    test('an unscoped sentence resolves in the visible projects only', async () => {
        const body = await compile({ sentence: 'When a task is created, if the status is Blocked, set the priority to HIGH.' });
        expect(body.data.errors).toEqual([]);
        expect(body.data.rule.conditions).toEqual({ op: 'in', field: 'statusRef', value: [WEB_BLOCKED], label: 'Blocked' });
    });

    test('a scoped sentence resolves in the rule\'s project and keeps the scope', async () => {
        scope.visibleProjectIds.mockResolvedValue([WEB, OPS]);
        const body = await compile({ sentence: 'When a task is created, if the status is Code Review, set the priority to HIGH.', scope: { allProjects: false, projectIds: [OPS] } });
        expect(body.data.errors).toEqual([]);
        expect(body.data.rule.scope).toEqual({ allProjects: false, projectIds: [OPS] });
        expect(body.data.rule.conditions.value).toEqual([`${OPS}:8`]);
    });

    test('a name only a hidden project has is not offered as a choice', async () => {
        const body = await compile({ sentence: 'When a task is created, if the status is Code Review, set the priority to HIGH.' });
        expect(body.data.rule).toBeNull();
        expect(body.data.errors).toEqual(['I do not know a status called "Code Review". The statuses are To Do, In Progress, Blocked, In Review and Done.']);
    });

    test('saving a rule with a status name stores the keys, and an unknown name is refused', async () => {
        const res = () => ({ status() { return this; }, send(payload) { this.body = payload; return this; } });
        const base = {
            version: 2, trigger: { type: 'event', event: 'task.created' }, scope: { allProjects: true, projectIds: [] },
            steps: [{ id: 's1', type: 'action', action: 'set_priority', config: { priority: 'HIGH' } }],
        };
        const ok = res();
        await ctrl.createRuleV2({ uid: OWNER, params: {}, body: { ...base, conditions: { op: 'eq', field: 'statusType', value: 'Blocked' } }, headers: { companyid: C } }, ok);
        expect(ok.body.status).toBe(true);
        expect(ok.body.data.conditions).toEqual({ op: 'in', field: 'statusRef', value: [WEB_BLOCKED], label: 'Blocked' });

        const refused = res();
        await ctrl.createRuleV2({ uid: OWNER, params: {}, body: { ...base, conditions: { op: 'eq', field: 'statusType', value: 'Frozen' } }, headers: { companyid: C } }, refused);
        expect(refused.body.status).toBe(false);
        expect(refused.body.statusText).toMatch(/I do not know a status called "Frozen"/);
    });
});
