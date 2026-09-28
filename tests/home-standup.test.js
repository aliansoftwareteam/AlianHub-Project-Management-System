const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent' }));
jest.mock('../Modules/Tasks/helpers/taskQueryGuard', () => ({
    ...jest.requireActual('../Modules/Tasks/helpers/taskQueryGuard'),
    visibilityStage: jest.fn(async () => null),
}));

const fs = require('fs');
const path = require('path');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibilityStage } = require('../Modules/Tasks/helpers/taskQueryGuard');
const team = require('../Modules/Agents/team');
const ctrl = require('../Modules/Agents/controller');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ME = '6f0000000000000000000a01';
const SOMEONE = '6f0000000000000000000a02';
const P = '6f0000000000000000000701';
const HIDDEN_P = '6f0000000000000000000702';

const T1 = '6f0000000000000000000b01';
const T2 = '6f0000000000000000000b02';
const T3 = '6f0000000000000000000b03';
const T4 = '6f0000000000000000000b04';

const WEDNESDAY = new Date('2026-09-30T10:00:00.000Z').getTime();
const MONDAY = new Date('2026-09-28T10:00:00.000Z').getTime();
const at = (iso) => new Date(iso);

describe('standupWindow', () => {
    it('covers yesterday and today in UTC when no offset is given', () => {
        const w = team.standupWindow({ now: WEDNESDAY });
        expect(w.since).toBe('yesterday');
        expect(w.yesterdayStart.toISOString()).toBe('2026-09-29T00:00:00.000Z');
        expect(w.todayStart.toISOString()).toBe('2026-09-30T00:00:00.000Z');
        expect(w.todayEnd.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    });

    it('looks back to Friday on a Monday', () => {
        const w = team.standupWindow({ now: MONDAY });
        expect(w.since).toBe('friday');
        expect(w.yesterdayStart.toISOString()).toBe('2026-09-25T00:00:00.000Z');
        expect(w.todayStart.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    });

    it('draws the day where the viewer lives', () => {
        const w = team.standupWindow({ now: new Date('2026-09-29T20:00:00.000Z').getTime(), tzOffset: -330 });
        expect(w.todayStart.toISOString()).toBe('2026-09-29T18:30:00.000Z');
        expect(w.yesterdayStart.toISOString()).toBe('2026-09-28T18:30:00.000Z');
    });

    it.each([['text', 'abc'], ['a huge offset', 5000], ['a fraction', 12.5]])('ignores %s as the offset', (_name, tzOffset) => {
        expect(team.standupWindow({ now: WEDNESDAY, tzOffset }).todayStart.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    });
});

describe('personalStandup', () => {
    const window = team.standupWindow({ now: WEDNESDAY });
    const task = (id, over = {}) => ({ _id: id, TaskName: `Task ${id}`, TaskKey: `K-${id}`, ProjectID: P, sprintId: 's1', statusType: 'active', status: { text: 'In Progress', type: 'active' }, ...over });

    it('sorts yesterday into completed, moved and commented, one line per task', () => {
        const out = team.personalStandup({
            window,
            now: WEDNESDAY,
            moves: [{ TaskId: 't1' }, { TaskId: 't2' }, { TaskId: 't2' }],
            comments: [{ taskId: 't2' }, { taskId: 't3' }],
            tasks: { t1: task('t1', { statusType: 'close', status: { text: 'Done', type: 'close' } }), t2: task('t2'), t3: task('t3') },
            open: [],
            timer: null,
        });
        expect(out.since).toBe('yesterday');
        expect(out.yesterday.map((i) => [i.kind, i.task.taskId])).toEqual([['completed', 't1'], ['moved', 't2'], ['commented', 't3']]);
        expect(out.yesterday[0].task).toEqual({ taskId: 't1', taskKey: 'K-t1', taskName: 'Task t1', projectId: P, sprintId: 's1', folderId: '' });
    });

    it('leaves out a task the viewer can no longer open', () => {
        const out = team.personalStandup({ window, now: WEDNESDAY, moves: [{ TaskId: 'gone' }], comments: [{ taskId: 'gone' }], tasks: {}, open: [], timer: null });
        expect(out.yesterday).toEqual([]);
    });

    it('puts the running timer first today, then what is due today', () => {
        const out = team.personalStandup({
            window,
            now: WEDNESDAY,
            moves: [],
            comments: [],
            tasks: { t9: task('t9') },
            open: [
                task('t4', { DueDate: at('2026-09-30T17:00:00.000Z') }),
                task('t5', { DueDate: at('2026-10-04T17:00:00.000Z') }),
                task('t9'),
            ],
            timer: { TicketID: 't9' },
        });
        expect(out.today.map((i) => [i.kind, i.task.taskId])).toEqual([['tracking', 't9'], ['due_today', 't4']]);
    });

    it('lists overdue and blocked work, the latest first, with the days late', () => {
        const out = team.personalStandup({
            window,
            now: WEDNESDAY,
            moves: [],
            comments: [],
            tasks: {},
            open: [
                task('t6', { DueDate: at('2026-09-28T12:00:00.000Z') }),
                task('t7', { status: { text: 'Blocked', type: 'active' } }),
                task('t8', { relations: [{ taskId: 'x', type: 'blocked_by' }], DueDate: at('2026-09-20T12:00:00.000Z') }),
                task('t10', { DueDate: at('2026-10-02T12:00:00.000Z') }),
            ],
            timer: null,
        });
        expect(out.blocked.map((i) => [i.kind, i.task.taskId, i.days])).toEqual([['blocked', 't8', 10], ['overdue', 't6', 2], ['blocked', 't7', 0]]);
    });

    it('counts everything but shows at most six lines a section', () => {
        const open = Array.from({ length: 9 }, (_, n) => task(`o${n}`, { DueDate: at('2026-09-30T15:00:00.000Z') }));
        const out = team.personalStandup({ window, now: WEDNESDAY, moves: [], comments: [], tasks: {}, open, timer: null });
        expect(out.today).toHaveLength(6);
        expect(out.totals).toEqual({ yesterday: 0, today: 9, blocked: 0 });
    });
});

describe('GET /api/v2/agents/team/standup', () => {
    const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
    const call = async (over = {}) => { const r = res(); await ctrl.myStandup({ headers: { companyid: C }, query: {}, uid: ME, ...over }, r); return r; };

    beforeEach(() => {
        Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
        mockDb.calls.length = 0;
        jest.clearAllMocks();
        jest.spyOn(Date, 'now').mockReturnValue(WEDNESDAY);
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T1, TaskName: 'Ship the invoice export', ProjectID: P, sprintId: 's1', statusType: 'close', status: { text: 'Done', type: 'close' }, AssigneeUserId: [ME], deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T2, TaskName: 'Secret roadmap', ProjectID: HIDDEN_P, sprintId: 's2', statusType: 'active', status: { text: 'In Progress', type: 'active' }, AssigneeUserId: [SOMEONE], deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T3, TaskName: 'Due today', ProjectID: P, sprintId: 's1', statusType: 'active', status: { text: 'In Progress', type: 'active' }, AssigneeUserId: [ME], DueDate: at('2026-09-30T16:00:00.000Z'), deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T4, TaskName: 'Someone else\'s late task', ProjectID: P, sprintId: 's1', statusType: 'active', status: { text: 'In Progress', type: 'active' }, AssigneeUserId: [SOMEONE], DueDate: at('2026-09-20T16:00:00.000Z'), deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.HISTORY, { Key: 'Task_Status', TaskId: T1, UserId: ME, ProjectId: P, createdAt: at('2026-09-29T11:00:00.000Z') });
        mockDb.seed(SCHEMA_TYPE.HISTORY, { Key: 'Task_Status', TaskId: T2, UserId: ME, ProjectId: HIDDEN_P, createdAt: at('2026-09-29T12:00:00.000Z') });
        mockDb.seed(SCHEMA_TYPE.HISTORY, { Key: 'Task_Status', TaskId: T3, UserId: SOMEONE, ProjectId: P, createdAt: at('2026-09-29T12:00:00.000Z') });
        mockDb.seed(SCHEMA_TYPE.HISTORY, { Key: 'Task_Status', TaskId: T3, UserId: ME, ProjectId: P, createdAt: at('2026-09-27T12:00:00.000Z') });
    });
    afterEach(() => jest.restoreAllMocks());

    it('is registered beside the team board', () => {
        const routes = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Agents', 'routes.js'), 'utf8');
        expect(routes).toContain("app.get('/api/v2/agents/team/standup', ctrl.myStandup)");
        expect(routes.indexOf("'/api/v2/agents/team/standup'")).toBeLessThan(routes.indexOf("'/api/v2/agents/:id'"));
    });

    it('refuses a caller without a session', async () => {
        expect((await call({ uid: undefined })).code).toBe(401);
    });

    it('builds the caller\'s own standup from their activity alone', async () => {
        const r = await call();
        expect(r.body.status).toBe(true);
        const { yesterday, today, blocked } = r.body.data;
        expect(yesterday.map((i) => [i.kind, i.task.taskId])).toEqual([['completed', T1], ['moved', T2]]);
        expect(today.map((i) => i.task.taskId)).toEqual([T3]);
        expect(blocked).toEqual([]);
    });

    it('reads only the company in the header', async () => {
        await call();
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(mockDb.calls.every((c) => c.companyId === C)).toBe(true);
        expect(mockDb.calls.some((c) => c.companyId === OTHER_COMPANY)).toBe(false);
    });

    it('never names a task a member cannot open', async () => {
        const { toObjectIds } = jest.requireActual('../Modules/Tasks/helpers/taskQueryGuard');
        visibilityStage.mockResolvedValue({ $match: { ProjectID: { $in: toObjectIds([P]) } } });
        const r = await call();
        const named = JSON.stringify(r.body.data);
        expect(named).not.toContain('Secret roadmap');
        expect(r.body.data.yesterday.map((i) => i.task.taskId)).toEqual([T1]);
        expect(visibilityStage).toHaveBeenCalledWith(C, ME);
    });
});
