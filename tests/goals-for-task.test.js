/* Task 046 M3, slice G6: the goals a task counts toward, for the task panel. The answer holds only
   goals the caller can read, for a task the caller can open. The handlers run over fakeMongo with the
   real project scope, sprint privacy, task list rule and goal access rule. */
const mockDb = require('./fixtures/fakeMongo').create();
const { taskListRules } = require('./fixtures/taskListRules');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { fetchRules } = require('../Modules/settings/securityPermissions/controller');
const goals = require('../Modules/Goals/controller');
const counts = require('../Modules/Goals/goalCounts');
const sources = require('../Modules/Goals/goalSources');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const AUTHOR = '6f0000000000000000000003';
const NAMED = '6f0000000000000000000004';
const COLLEAGUE = '6f0000000000000000000005';
const GUEST = '6f0000000000000000000006';
const NO_TASK_LIST = '6f0000000000000000000007';
const ROLES = { [OWNER]: 1, [ADMIN]: 2, [AUTHOR]: 3, [NAMED]: 3, [COLLEAGUE]: 3, [GUEST]: 0, [NO_TASK_LIST]: 7 };
const MISSING = '6f00000000000000000000ff';

let seq = 0;
const nextId = (prefix) => `6f${prefix}${String(++seq).padStart(20, '0')}`;
const project = (over = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: nextId('a0'), ProjectName: 'Project', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, ...over });
const list = (proj, over = {}) => String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: nextId('b0'), projectId: String(proj._id), name: 'List', private: false, AssigneeUserId: [], deletedStatusKey: 0, ...over })._id);
const task = (proj, sprintId, over = {}) => String(mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: nextId('f0'), TaskName: 'Task', ProjectID: String(proj._id), sprintId, deletedStatusKey: 0, isParentTask: true, statusType: 'default_active', ...over,
})._id);
const taskRow = (id) => mockDb.store[SCHEMA_TYPE.TASKS].find((row) => String(row._id) === id);

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const call = async (handler, uid, { body, id, targetId, taskId, query, apiToken } = {}) => {
    const res = response();
    await handler({ headers: { companyid: C }, aud: C, uid, body, query: query || {}, params: { id, targetId, taskId }, apiToken }, res);
    return res;
};
const goal = async (uid, body = {}) => (await call(goals.createGoal, uid, { body: { name: 'Ship it', ...body } })).body.data._id;
const link = (uid, id, name, linked) => call(goals.addTarget, uid, { id, body: { name, kind: 'tasks', sources: linked } });
const forTask = (uid, taskId, extra = {}) => call(goals.goalsForTask, uid, { taskId, ...extra });
const shown = async (uid, taskId) => (await forTask(uid, taskId)).body.data.map((row) => [row.goalName, row.targetName, row.through]);
const NOT_FOUND = { status: false, statusText: 'Task not found.', message: 'Task not found.' };

let world;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    myCache.flushAll();
    jest.clearAllMocks();
    fetchRules.mockImplementation(async () => taskListRules({ 0: false, 3: true }));
    Object.entries(ROLES).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));

    const open = project({ ProjectName: 'Website' });
    const other = project({ ProjectName: 'Roadmap' });
    const team = project({ ProjectName: 'Finance', isPrivateSpace: true, AssigneeUserId: [AUTHOR, NAMED] });
    const openList = list(open, { name: 'Launch' });
    const otherList = list(other, { name: 'Quarter plan' });
    const teamList = list(team, { name: 'Budget' });
    const openTask = task(open, openList, { statusType: 'close' });
    world = {
        open, other, team, openList, otherList, teamList, openTask,
        secondOpenTask: task(open, openList),
        subtask: task(open, openList, { isParentTask: false, ParentTaskId: openTask }),
        otherTask: task(other, otherList),
        teamTask: task(team, teamList),
    };
});

describe('the goals a task counts toward', () => {
    it('are the targets that count its list or name it, with the goal\'s progress', async () => {
        const id = await goal(AUTHOR, { name: 'Launch the site', color: '#2F3990' });
        const listed = (await link(AUTHOR, id, 'Launch tasks', { sprintIds: [world.openList] })).body.data;
        await link(AUTHOR, id, 'Books closed', { taskIds: [world.teamTask] });

        const res = await forTask(AUTHOR, world.openTask);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            status: true,
            statusText: 'Goals fetched successfully.',
            data: [{
                goalId: id, goalName: 'Launch the site', color: '#2F3990', progressPct: 25,
                targetId: listed.targets[0].id, targetName: 'Launch tasks', targetProgressPct: 50, through: 'list',
            }],
        });
        expect(await shown(AUTHOR, world.teamTask)).toEqual([['Launch the site', 'Books closed', 'task']]);
        expect(await shown(AUTHOR, world.otherTask)).toEqual([]);
    });

    it('lists every target of every goal that counts it, by goal and then by target', async () => {
        const second = await goal(AUTHOR, { name: 'B goal' });
        const first = await goal(AUTHOR, { name: 'A goal' });
        await link(AUTHOR, second, 'Z target', { sprintIds: [world.openList] });
        await link(AUTHOR, second, 'M target', { taskIds: [world.openTask] });
        await link(AUTHOR, second, 'Elsewhere', { sprintIds: [world.otherList] });
        await link(AUTHOR, first, 'Only target', { sprintIds: [world.openList], taskIds: [world.openTask] });
        expect(await shown(AUTHOR, world.openTask)).toEqual([['A goal', 'Only target', 'task'], ['B goal', 'M target', 'task'], ['B goal', 'Z target', 'list']]);
    });

    it('count a subtask only where it is named, as a list counts its top-level tasks', async () => {
        const id = await goal(AUTHOR);
        await link(AUTHOR, id, 'The list', { sprintIds: [world.openList] });
        expect(await shown(AUTHOR, world.subtask)).toEqual([]);
        await link(AUTHOR, id, 'The subtask', { taskIds: [world.subtask] });
        expect(await shown(AUTHOR, world.subtask)).toEqual([['Ship it', 'The subtask', 'task']]);
    });

    it('leave out an archived goal', async () => {
        const id = await goal(AUTHOR);
        await link(AUTHOR, id, 'The list', { sprintIds: [world.openList] });
        await call(goals.archiveGoal, AUTHOR, { id });
        expect(await shown(AUTHOR, world.openTask)).toEqual([]);
    });

    it('leave out a target whose source is no longer counted', async () => {
        const id = await goal(AUTHOR, { visibility: 'workspace' });
        await link(AUTHOR, id, 'Roadmap tasks', { sprintIds: [world.otherList] });
        expect(await shown(AUTHOR, world.otherTask)).toEqual([['Ship it', 'Roadmap tasks', 'list']]);

        Object.assign(world.other, { isPrivateSpace: true, AssigneeUserId: [AUTHOR] });
        mockDb.store[SCHEMA_TYPE.GOALS][0].targets[0].counted.at = new Date(Date.now() - counts.STALE_AFTER_MS);
        await counts.refresh(C, id);
        expect(await shown(AUTHOR, world.otherTask)).toEqual([]);
    });

    it('are read with one query of the goals, whose branches are the stored sources', async () => {
        const id = await goal(AUTHOR);
        await link(AUTHOR, id, 'The list', { sprintIds: [world.openList] });
        mockDb.calls.length = 0;
        await forTask(AUTHOR, world.openTask);
        const reads = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.GOALS);
        expect(reads).toHaveLength(1);
        expect(reads[0].method).toBe('find');
        expect(sources.namingTask({ _id: world.openTask, sprintId: world.openList, isParentTask: true })).toEqual({
            $or: [
                { targets: { $elemMatch: { kind: 'tasks', 'sources.taskIds': world.openTask } } },
                { targets: { $elemMatch: { kind: 'tasks', 'sources.sprintIds': world.openList } } },
            ],
        });
        expect(sources.namingTask({ _id: world.subtask, sprintId: world.openList, isParentTask: false }).$or).toHaveLength(1);
    });
});

describe('whose goals a reader of the task is shown', () => {
    it('shows a private goal to its owner alone, whatever the role of who asks', async () => {
        const id = await goal(AUTHOR, { name: 'Quiet plan' });
        await link(AUTHOR, id, 'Hidden target', { sprintIds: [world.openList], taskIds: [world.openTask] });
        for (const uid of [OWNER, ADMIN, NAMED, COLLEAGUE, GUEST]) {
            const res = await forTask(uid, world.openTask);
            expect({ uid, statusCode: res.statusCode, data: res.body.data }).toEqual({ uid, statusCode: 200, data: [] });
            expect(JSON.stringify(res.body)).not.toContain('Quiet plan');
            expect(JSON.stringify(res.body)).not.toContain('Hidden target');
        }
        expect(await shown(AUTHOR, world.openTask)).toEqual([['Quiet plan', 'Hidden target', 'task']]);
    });

    it('shows a goal shared with people to them and its owner', async () => {
        const id = await goal(AUTHOR, { visibility: 'people', sharedWith: [NAMED] });
        await link(AUTHOR, id, 'Team tasks', { sprintIds: [world.teamList] });
        expect(await shown(NAMED, world.teamTask)).toEqual([['Ship it', 'Team tasks', 'list']]);
        expect(await shown(AUTHOR, world.teamTask)).toEqual([['Ship it', 'Team tasks', 'list']]);
        expect(await shown(ADMIN, world.teamTask)).toEqual([]);
    });

    it('shows a workspace goal to every member, and to a guest only when it is shared with them by name', async () => {
        const id = await goal(AUTHOR, { visibility: 'workspace' });
        await link(AUTHOR, id, 'Launch tasks', { sprintIds: [world.openList] });
        expect(await shown(COLLEAGUE, world.openTask)).toEqual([['Ship it', 'Launch tasks', 'list']]);
        expect(await shown(GUEST, world.openTask)).toEqual([]);
        await call(goals.updateGoal, AUTHOR, { id, body: { sharedWith: [GUEST] } });
        expect(await shown(GUEST, world.openTask)).toEqual([['Ship it', 'Launch tasks', 'list']]);
    });
});

describe('a task the caller cannot open', () => {
    const answers = async (uid, taskId) => {
        const res = await forTask(uid, taskId);
        return { statusCode: res.statusCode, body: res.body };
    };
    const missing = { statusCode: 404, body: NOT_FOUND };

    it('answers as a task that does not exist, though a goal they can read counts it', async () => {
        const id = await goal(AUTHOR, { visibility: 'workspace' });
        await link(AUTHOR, id, 'Roadmap tasks', { sprintIds: [world.otherList], taskIds: [world.otherTask] });
        expect(await shown(COLLEAGUE, world.otherTask)).toEqual([['Ship it', 'Roadmap tasks', 'task']]);

        Object.assign(world.other, { isPrivateSpace: true, AssigneeUserId: [AUTHOR] });
        expect(await answers(COLLEAGUE, world.otherTask)).toEqual(missing);
        expect(await answers(COLLEAGUE, MISSING)).toEqual(missing);
        expect(await answers(COLLEAGUE, 'not-an-id')).toEqual(missing);
        expect(await shown(AUTHOR, world.otherTask)).toEqual([['Ship it', 'Roadmap tasks', 'task']]);
    });

    it('is so for a task in a private project they are not on, and in a private list they are not on', async () => {
        const hiddenList = list(world.open, { name: 'Hiring', private: true, AssigneeUserId: [AUTHOR] });
        const hiddenTask = task(world.open, hiddenList);
        expect(await answers(COLLEAGUE, world.teamTask)).toEqual(missing);
        expect(await answers(COLLEAGUE, hiddenTask)).toEqual(missing);
        expect((await forTask(AUTHOR, hiddenTask)).statusCode).toBe(200);
    });

    it('is so for a role that may not list tasks, and for a task that is deleted', async () => {
        expect(await answers(NO_TASK_LIST, world.openTask)).toEqual(missing);
        taskRow(world.secondOpenTask).deletedStatusKey = 1;
        expect(await answers(AUTHOR, world.secondOpenTask)).toEqual(missing);
    });

    it('reads no goal for it', async () => {
        mockDb.calls.length = 0;
        await forTask(COLLEAGUE, world.teamTask);
        expect(mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.GOALS)).toEqual([]);
    });
});

describe('the route', () => {
    it('is refused to a token limited to some projects, and to someone without a seat', async () => {
        expect((await forTask(AUTHOR, world.openTask, { apiToken: { projectIds: [String(world.open._id)] } })).statusCode).toBe(403);
        expect((await forTask('6f00000000000000000000ee', world.openTask)).statusCode).toBe(403);
        expect((await forTask('', world.openTask)).statusCode).toBe(401);
    });

    it('is registered under the goals prefix, ahead of the read of one goal', () => {
        const routes = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Goals', 'routes.js'), 'utf8');
        const at = (line) => routes.indexOf(line);
        expect(at("app.get('/api/v2/goals/for-task/:taskId', ctrl.goalsForTask);")).toBeGreaterThan(-1);
        expect(at("app.get('/api/v2/goals/for-task/:taskId', ctrl.goalsForTask);")).toBeLessThan(at("app.get('/api/v2/goals/:id', ctrl.getGoal);"));
    });
});
