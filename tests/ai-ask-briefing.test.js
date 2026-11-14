const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Agents/skillRecord', () => ({ listSkills: jest.fn().mockResolvedValue([]) }));
jest.mock('../Modules/Tasks/helpers/taskListProjects', () => ({ keepTaskListProjectIds: jest.fn(async (c, u, ids) => ids.map(String)) }));
jest.mock('../utils/companyMembers', () => ({
    memberProfiles: jest.fn(async (c, ids) => ids.filter((id) => mockPeople[id]).map((id) => ({ _id: id, Employee_Name: mockPeople[id] }))),
}));

const mockPeople = {
    '6f0000000000000000000001': 'Mia Me',
    '6f0000000000000000000002': 'Raj Iyer',
    '6f0000000000000000000003': 'Grace Kim',
};

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { keepTaskListProjectIds } = require('../Modules/Tasks/helpers/taskListProjects');
const briefing = require('../Modules/AI/askBriefing');
const { pin } = require('../Modules/AI/askContext');

const C = '6f0000000000000000000c01';
const OPEN = '6f0000000000000000000a01';
const OTHER_PROJECT = '6f0000000000000000000a02';
const ME = '6f0000000000000000000001';
const RAJ = '6f0000000000000000000002';
const GRACE = '6f0000000000000000000003';
const LIST = '6f0000000000000000000d01';
const PRIVATE_LIST = '6f0000000000000000000d02';

const NOW = new Date('2026-11-02T12:00:00Z').getTime();
const day = (n) => new Date(NOW + n * 24 * 60 * 60 * 1000);
const STATUSES = [
    { key: 1, name: 'Backlog', type: 'default_active' },
    { key: 2, name: 'In Progress', type: 'active' },
    { key: 3, name: 'Done', type: 'close' },
];
const PROJECTS = [{ _id: OPEN, ProjectName: 'Platform' }];

const task = (over) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    ProjectID: OPEN, TaskName: 'Task', TaskKey: `ENG-${Math.floor(Math.random() * 1e6)}`, deletedStatusKey: 0, sprintId: LIST,
    statusKey: 1, statusType: 'default_active', status: { text: 'Backlog', key: 1, type: 'default_active' },
    AssigneeUserId: [], updatedAt: day(-20), ...over,
});
const done = { statusKey: 3, statusType: 'close', status: { text: 'Done', key: 3, type: 'close' } };
const active = { statusKey: 2, statusType: 'active', status: { text: 'In Progress', key: 2, type: 'active' } };

const seedProject = () => {
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN, ProjectName: 'Platform', description: 'Release 4.18', taskStatusData: STATUSES, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: LIST, projectId: OPEN, name: 'Release board', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_LIST, projectId: OPEN, name: 'Salaries', private: true, AssigneeUserId: [GRACE], deletedStatusKey: 0 });
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(3);
});

describe('which questions ask for a briefing', () => {
    it.each([
        'What is going on in this project?', "what's happening with Platform", 'Give me a status update', 'Summarize progress this week',
        'How is the release doing?', 'Any blockers or risks?', 'Who is working on what?', 'catch me up', 'Is it on track?',
    ])('reads %p as an overview', (q) => expect(briefing.isOverviewQuestion(q)).toBe(true));

    it.each(['Find the onboarding doc', 'Create a task for the invoice export', 'Who owns ENG-12?', ''])(
        'does not read %p as one', (q) => expect(briefing.isOverviewQuestion(q)).toBe(false),
    );
});

describe('counts', () => {
    it('counts every task once, by the project\'s own statuses and in its order', () => {
        const tasks = [
            { _id: 'a', ...done, updatedAt: day(-1) },
            { _id: 'b', ...active, AssigneeUserId: [RAJ], DueDate: day(-2), Task_Priority: 'HIGH' },
            { _id: 'c', statusKey: 1, statusType: 'default_active', status: { text: 'Backlog' }, AssigneeUserId: [RAJ, GRACE], DueDate: day(3) },
            { _id: 'd', statusKey: 1, statusType: 'default_active', status: { text: 'Blocked by vendor' }, relations: [{ type: 'blocked_by', taskId: 'x' }] },
            { _id: 'e', ...done, updatedAt: day(-30) },
        ];
        const s = briefing.summarize(tasks, { statuses: STATUSES, now: NOW });
        expect(s).toMatchObject({ total: 5, done: 2, open: 3, pctDone: 40, overdue: 1, dueSoon: 1, blocked: 1, high: 1, active: 1, unassigned: 1, noDue: 1, recentlyDone: 1 });
        expect(s.byStatus).toEqual([{ name: 'Backlog', count: 1 }, { name: 'In Progress', count: 1 }, { name: 'Done', count: 2 }, { name: 'Blocked by vendor', count: 1 }]);
        expect(s.people.get(RAJ)).toMatchObject({ open: 2, overdue: 1, active: 1 });
        expect(s.people.get(GRACE)).toMatchObject({ open: 1, overdue: 0 });
        expect(briefing.healthOf(s)).toBe('off track');
    });

    it('names a project with nothing late on track, and one with nothing open done', () => {
        expect(briefing.healthOf(briefing.summarize([{ _id: 'a', ...active }], { now: NOW }))).toBe('on track');
        expect(briefing.healthOf(briefing.summarize([{ _id: 'a', ...done }], { now: NOW }))).toBe('everything is done');
        expect(briefing.healthOf(briefing.summarize([], { now: NOW }))).toBe('no tasks yet');
    });

    it('picks overdue work first, oldest due first, and lists every reason once', () => {
        const picks = briefing.pickTasks([
            { _id: 'late2', ...active, DueDate: day(-1), Task_Priority: 'urgent' },
            { _id: 'late1', statusType: 'default_active', DueDate: day(-5) },
            { _id: 'soon', statusType: 'default_active', DueDate: day(2) },
            { _id: 'idle', statusType: 'default_active' },
        ], { now: NOW });
        expect(picks.map((p) => p.task._id)).toEqual(['late1', 'late2', 'soon']);
        expect(picks[1].reasons).toEqual(['overdue', 'high priority', 'started']);
    });

    it('reads a history line as text with the task key', () => {
        const line = briefing.activityLine(
            { Message: '<b>Raj Iyer</b> has changed <b> Status</b> as <b>QA</b>.', TaskId: 't1', createdAt: day(-1) },
            { keys: new Map([['t1', 'ENG-7']]), timeZone: 'UTC' },
        );
        expect(line).toBe('- 2026-11-01 · Raj Iyer has changed Status as QA. [ENG-7]');
    });
});

describe('project briefing', () => {
    it('sends exact counts, the activity and the tasks at risk, from the asker\'s company only', async () => {
        seedProject();
        const blocker = task({ ProjectID: OTHER_PROJECT, TaskKey: 'SUP-3', TaskName: 'Vendor fix' });
        task({ TaskKey: 'ENG-1', TaskName: 'Export times out', ...active, AssigneeUserId: [RAJ], DueDate: day(-3), relations: [{ type: 'blocked_by', taskId: String(blocker._id) }] });
        task({ TaskKey: 'ENG-2', TaskName: 'Docs', ...done, AssigneeUserId: [GRACE], updatedAt: day(-1) });
        task({ TaskKey: 'ENG-3', TaskName: 'Login', AssigneeUserId: [ME], DueDate: day(2) });
        const hidden = task({ TaskKey: 'ENG-9', TaskName: 'Pay rise', sprintId: PRIVATE_LIST, DueDate: day(-9) });
        mockDb.seed(SCHEMA_TYPE.HISTORY, { ProjectId: OPEN, TaskId: String(hidden._id), Message: '<b>Grace</b> changed pay', createdAt: day(-1) });
        const shown = mockDb.store[SCHEMA_TYPE.TASKS].find((t) => t.TaskKey === 'ENG-1');
        mockDb.seed(SCHEMA_TYPE.HISTORY, { ProjectId: OPEN, TaskId: String(shown._id), Message: '<b>Raj Iyer</b> has changed <b>Status</b> as <b>In Progress</b>.', createdAt: day(-1) });
        mockDb.seed(SCHEMA_TYPE.HISTORY, { ProjectId: OPEN, TaskId: '', Message: '<b>Raj Iyer</b> has changed <b>Status</b> as <b>In Progress</b>.', createdAt: day(-1) });
        mockDb.seed(SCHEMA_TYPE.HISTORY, { ProjectId: OPEN, TaskId: String(shown._id), Message: 'Too old', createdAt: day(-40) });

        const out = await briefing.projectBriefing(C, ME, { project: PROJECTS[0], openIds: [OPEN, OTHER_PROJECT], now: NOW, timeZone: 'UTC' });

        const [overview, activity, ...tasks] = out;
        expect(overview).toMatchObject({ kind: 'project', id: OPEN, ref: `project:${OPEN.slice(-6)}`, matchedBy: 'briefing' });
        expect(overview.detail).toContain('3 tasks: 1 done, 2 open (33% done)');
        expect(overview.detail).toContain('1 overdue');
        expect(overview.detail).toContain('1 blocked');
        expect(overview.detail).toContain('By status: Backlog 1, In Progress 1, Done 1.');
        expect(overview.detail).toContain('- Raj Iyer: 1 open, 1 started, 1 overdue');
        expect(overview.detail).not.toMatch(/Pay rise|Salaries/);
        expect(activity.kind).toBe('activity');
        expect(activity.detail).toContain('Raj Iyer has changed Status as In Progress. [ENG-1]');
        expect(activity.detail).not.toMatch(/pay|Too old/);
        expect(activity.detail.match(/has changed Status as In Progress/g)).toHaveLength(1);
        expect(tasks.map((t) => t.ref)).toEqual(['ENG-1', 'ENG-3', 'ENG-2']);
        expect(tasks[0].detail).toContain('overdue, blocked, started · In Progress · Raj Iyer · due 2026-10-30');
        expect(tasks[0].detail).toContain('blocked by SUP-3');
        expect(mockDb.calls.every((call) => call.companyId === C || call.companyId === 'global')).toBe(true);
    });

    it('sends no briefing where the asker may not list tasks', async () => {
        seedProject();
        task({ TaskKey: 'ENG-1' });
        keepTaskListProjectIds.mockResolvedValueOnce([]);
        expect(await briefing.projectBriefing(C, ME, { project: PROJECTS[0], now: NOW })).toBeNull();
    });

    it('lets an owner read every list', async () => {
        getRoleType.mockResolvedValue(1);
        seedProject();
        task({ TaskKey: 'ENG-9', sprintId: PRIVATE_LIST });
        const [overview] = await briefing.projectBriefing(C, ME, { project: PROJECTS[0], now: NOW });
        expect(overview.detail).toContain('1 task: 0 done, 1 open');
    });
});

describe('list and person briefings', () => {
    it('briefs one list and refuses a private one the asker is not on', async () => {
        seedProject();
        task({ TaskKey: 'ENG-1', ...active });
        task({ TaskKey: 'ENG-9', sprintId: PRIVATE_LIST });
        const out = await briefing.listBriefing(C, ME, { listId: LIST, projects: PROJECTS, now: NOW });
        expect(out[0]).toMatchObject({ kind: 'list', id: LIST, title: 'Release board' });
        expect(out[0].detail).toContain('1 task: 0 done, 1 open');
        expect(out[0].detail).toContain('list "Release board"');
        expect(await briefing.listBriefing(C, ME, { listId: PRIVATE_LIST, projects: PROJECTS, now: NOW })).toBeNull();
        expect(await briefing.listBriefing(C, ME, { listId: LIST, projects: [], now: NOW })).toBeNull();
    });

    it('briefs a person\'s work inside the projects the asker can open only', async () => {
        seedProject();
        task({ TaskKey: 'ENG-1', AssigneeUserId: [RAJ], DueDate: day(-1) });
        task({ TaskKey: 'HR-1', ProjectID: OTHER_PROJECT, AssigneeUserId: [RAJ] });
        const out = await briefing.personBriefing(C, ME, { personId: RAJ, projects: PROJECTS, now: NOW });
        expect(out[0]).toMatchObject({ kind: 'person', title: 'Raj Iyer' });
        expect(out[0].detail).toContain('1 task: 0 done, 1 open');
        expect(out[0].detail).toContain('- Platform: 1 open');
        expect(out.map((s) => s.ref)).not.toContain('HR-1');
        expect(await briefing.personBriefing(C, ME, { personId: '6f00000000000000000000ff', projects: PROJECTS, now: NOW })).toBeNull();
    });
});

describe('pin() adds the briefing', () => {
    it('for a whole-project question in a one-project scope, before what the search found', async () => {
        seedProject();
        task({ TaskKey: 'ENG-1', ...active });
        const gathered = { sources: [{ kind: 'page', id: 'g1', ref: 'page:g1' }], projects: PROJECTS, scopedProjectIds: [OPEN] };
        const out = await pin(C, ME, gathered, { question: 'What is going on in this project?' });
        expect(out.gathered.sources[0]).toMatchObject({ kind: 'project', id: OPEN, matchedBy: 'briefing' });
        expect(out.gathered.sources.map((s) => s.ref)).toContain('page:g1');
        expect(out.system).toMatch(/BRIEFING/);
        expect(out.system).not.toMatch(/attached/);
    });

    it('for a project attached with @, and says it was attached', async () => {
        seedProject();
        task({ TaskKey: 'ENG-1' });
        const out = await pin(C, ME, { sources: [], projects: PROJECTS, scopedProjectIds: [OPEN] }, { question: 'anything to worry about', context: [{ kind: 'project', id: OPEN }] });
        expect(out.gathered.sources.filter((s) => s.kind === 'project')).toHaveLength(1);
        expect(out.gathered.sources[0].matchedBy).toBe('briefing');
        expect(out.system).toContain(`[project:${OPEN.slice(-6)}]`);
    });

    it('not for a question that asks for something else, or with several projects in scope', async () => {
        seedProject();
        const gathered = { sources: [], projects: PROJECTS, scopedProjectIds: [OPEN] };
        expect((await pin(C, ME, gathered, { question: 'find the onboarding doc' })).system).toBe('');
        const wide = { sources: [], projects: [...PROJECTS, { _id: OTHER_PROJECT, ProjectName: 'HR' }], scopedProjectIds: [OPEN, OTHER_PROJECT] };
        expect((await pin(C, ME, wide, { question: 'what is going on?' })).system).toBe('');
    });

    it('never for a project outside what the asker can open', async () => {
        seedProject();
        const out = await pin(C, ME, { sources: [], projects: [], scopedProjectIds: [] }, { question: 'status?', context: [{ kind: 'project', id: OPEN }] });
        expect(out.gathered.sources).toEqual([]);
    });
});
