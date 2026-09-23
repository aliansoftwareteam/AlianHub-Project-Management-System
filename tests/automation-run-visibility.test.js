const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Modules/Automations/engine/matcher', () => ({ invalidate: jest.fn() }));
jest.mock('../Modules/Automations/engine/tools', () => ({ updateTask: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const scope = require('../Modules/Agents/scope');
const guard = require('../Config/permissionGuard');
const ctrl = require('../Modules/Automations/controller');

const C = '6f0000000000000000000c01';
const OPEN = '6f0000000000000000000a01';
const PRIVATE = '6f0000000000000000000a02';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const ROLES = { [OWNER]: 1, [MEMBER]: 3 };
const RULE = '6f0000000000000000000b01';

const RUN_KEYS = ['_id', 'status', 'eventType', 'entity', 'envelope', 'steps', 'error', 'startedAt', 'finishedAt'];
const TASK_SNAPSHOT_ONLY = ['Task_Priority', 'AssigneeUserId', 'Task_Leader', 'DueDate', 'statusKey', 'previous', 'changedFields', 'actor', 'outputs', 'traceId', 'About Visible task'];

const listRuns = async (uid, id = RULE) => {
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        send(payload) { this.body = payload; return this; },
    };
    await ctrl.listRuns({ uid, params: { id }, query: {}, body: {}, headers: { companyid: C } }, res);
    return res;
};

let minute = 0;
const seedRun = ({ projectId, taskId, key, name, ...over }) => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RUNS, {
    ruleId: RULE,
    ruleName: 'Escalate',
    eventId: `e-${taskId}-${minute}`,
    eventType: 'task.priority_changed',
    entity: { kind: 'task', id: taskId, key },
    envelope: {
        id: `e-${taskId}-${minute}`,
        companyId: C,
        type: 'task.priority_changed',
        actor: { userId: OWNER, kind: 'user' },
        scope: { projectId, sprintId: 'sp-1' },
        entity: { kind: 'task', id: taskId, key },
        data: {
            _id: taskId, TaskKey: key, TaskName: name, Task_Priority: 'HIGH', statusKey: 'wip',
            AssigneeUserId: [OWNER], Task_Leader: OWNER, DueDate: '2026-10-01', ProjectID: projectId, sprintId: 'sp-1',
        },
        previous: { Task_Priority: 'LOW' },
        changedFields: ['Task_Priority'],
    },
    traceId: 'trace-1',
    status: 'success',
    cursor: 1,
    attempts: 1,
    steps: [{ id: 's1', type: 'action', action: 'add_comment', input: { body: `About ${name}` }, output: { changed: true, commentId: 'c-1' }, durationMs: 12 }],
    outputs: { s1: { commentId: 'c-1', body: `About ${name}` } },
    startedAt: new Date(Date.UTC(2026, 8, 20, 10, minute++)),
    finishedAt: new Date(Date.UTC(2026, 8, 20, 10, minute, 1)),
    ...over,
});

const openRun = () => seedRun({ projectId: OPEN, taskId: 't-open', key: 'WEB-1', name: 'Visible task' });
const privateRun = () => seedRun({ projectId: PRIVATE, taskId: 't-private', key: 'SEC-9', name: 'Hidden roadmap item' });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    minute = 0;
    guard.getRoleType.mockImplementation(async (companyId, uid) => (uid in ROLES ? ROLES[uid] : null));
    scope.visibleProjectIds.mockImplementation(async (companyId, uid) => (uid === OWNER ? [OPEN, PRIVATE] : [OPEN]));
});

describe('GET /api/v2/automations/:id/runs', () => {
    it('answers a member only the runs for tasks in projects they can open', async () => {
        openRun();
        privateRun();
        const res = await listRuns(MEMBER);
        expect(res.body.status).toBe(true);
        expect(res.body.data.map((r) => r.entity.id)).toEqual(['t-open']);
        expect(scope.visibleProjectIds).toHaveBeenCalledWith(C, MEMBER);
    });

    it('leaves nothing of a run in a project the member cannot open in the response', async () => {
        privateRun();
        const res = await listRuns(MEMBER);
        expect(res.body).toEqual({ status: true, data: [] });
        const text = JSON.stringify(res.body);
        ['t-private', 'SEC-9', 'Hidden roadmap item', PRIVATE].forEach((value) => expect(text).not.toContain(value));
    });

    it('still answers the owner every run of the rule', async () => {
        openRun();
        privateRun();
        const res = await listRuns(OWNER);
        expect(res.body.data.map((r) => r.entity.id)).toEqual(['t-private', 't-open']);
    });

    it('filters before the newest-50 limit, so hidden runs cannot crowd out a visible one', async () => {
        openRun();
        for (let i = 0; i < 55; i += 1) privateRun();
        const res = await listRuns(MEMBER);
        expect(res.body.data.map((r) => r.entity.id)).toEqual(['t-open']);
    });

    it('answers only the fields the run history shows', async () => {
        openRun();
        const [run] = (await listRuns(OWNER)).body.data;
        expect(RUN_KEYS).toEqual(expect.arrayContaining(Object.keys(run)));
        expect(run.entity).toEqual({ kind: 'task', id: 't-open', key: 'WEB-1' });
        expect(run.envelope).toEqual({ scope: { projectId: OPEN, sprintId: 'sp-1' }, data: { TaskName: 'Visible task' } });
        expect(run.steps).toEqual([{ id: 's1', type: 'action', action: 'add_comment', durationMs: 12, output: { changed: true } }]);
        expect(run).toMatchObject({ status: 'success', eventType: 'task.priority_changed' });
        expect(new Date(run.startedAt).getTime()).toBeLessThan(new Date(run.finishedAt).getTime());
        const text = JSON.stringify(run);
        TASK_SNAPSHOT_ONLY.forEach((value) => expect(text).not.toContain(value));
    });

    it('keeps a failed run\'s error and a stopped run\'s condition step', async () => {
        seedRun({
            projectId: OPEN, taskId: 't-open', key: 'WEB-1', name: 'Visible task', status: 'failed', error: 'no such status',
            steps: [{ id: 'c1', type: 'condition', output: { passed: false, detail: 'x' } }, { id: 's1', type: 'action', action: 'set_status', error: 'no such status', durationMs: 3 }],
        });
        const [run] = (await listRuns(MEMBER)).body.data;
        expect(run.error).toBe('no such status');
        expect(run.steps).toEqual([
            { id: 'c1', type: 'condition', output: { passed: false } },
            { id: 's1', type: 'action', action: 'set_status', error: 'no such status', durationMs: 3 },
        ]);
    });

    it('shows a run that names no project and no task without any of its event data', async () => {
        mockDb.seed(SCHEMA_TYPE.AUTOMATION_RUNS, {
            ruleId: RULE, eventId: 'sched-1', eventType: 'schedule.due', status: 'success',
            entity: { kind: 'schedule', id: 'sched', key: 'Every Monday' },
            envelope: { scope: { projectId: null }, entity: { kind: 'schedule' }, data: { note: 'internal' } },
            steps: [], startedAt: new Date(),
        });
        const [run] = (await listRuns(MEMBER)).body.data;
        expect(run.entity).toEqual({ kind: 'schedule', id: 'sched' });
        expect(run.envelope).toEqual({ scope: { projectId: null }, data: {} });
    });

    it('does not show a member a task run that names no project', async () => {
        seedRun({ projectId: null, taskId: 't-orphan', key: 'X-1', name: 'Orphan' });
        expect((await listRuns(MEMBER)).body.data).toEqual([]);
    });
});
