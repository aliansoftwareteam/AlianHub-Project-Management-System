/* Task 046 M3: a counted target is sent with the names of its sources, to each reader only for the
   lists and tasks that reader can open through the list and task reads themselves. The handlers run
   over fakeMongo with the real project scope, sprint privacy and task list rule. */
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

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const logger = require('../Config/loggerConfig');
const { fetchRules } = require('../Modules/settings/securityPermissions/controller');
const goals = require('../Modules/Goals/controller');
const sources = require('../Modules/Goals/goalSources');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const AUTHOR = '6f0000000000000000000003';
const NAMED = '6f0000000000000000000004';
const COLLEAGUE = '6f0000000000000000000005';
const GUEST = '6f0000000000000000000006';
const NO_TASK_LIST = '6f0000000000000000000007';
const ROLE_WITHOUT_TASK_LIST = 7;
const ROLES = { [OWNER]: 1, [ADMIN]: 2, [AUTHOR]: 3, [NAMED]: 3, [COLLEAGUE]: 3, [GUEST]: 0, [NO_TASK_LIST]: ROLE_WITHOUT_TASK_LIST };

let seq = 0;
const nextId = (prefix) => `6f${prefix}${String(++seq).padStart(20, '0')}`;
const project = (over = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: nextId('a0'), ProjectName: 'Project', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, ...over });
const list = (proj, over = {}) => String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: nextId('b0'), projectId: String(proj._id), name: 'List', private: false, AssigneeUserId: [], deletedStatusKey: 0, ...over })._id);
const task = (proj, sprintId, over = {}) => String(mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: nextId('f0'), TaskName: 'Task', ProjectID: String(proj._id), sprintId, deletedStatusKey: 0, isParentTask: true, statusType: 'default_active', ...over,
})._id);

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const call = async (handler, uid, { body, id, targetId, query } = {}) => {
    const res = response();
    await handler({ headers: { companyid: C }, aud: C, uid, body, query: query || {}, params: { id, targetId } }, res);
    return res;
};
const goal = async (uid, body = {}) => (await call(goals.createGoal, uid, { body: { name: 'Ship it', ...body } })).body.data._id;
const link = (uid, id, linked) => call(goals.addTarget, uid, { id, body: { name: 'Tasks done', kind: 'tasks', sources: linked } });
const read = async (uid, id) => (await call(goals.getGoal, uid, { id })).body.data.targets[0];
const idsOf = (names) => ({ sprintIds: Object.keys(names.sprintIds), taskIds: Object.keys(names.taskIds) });
const saysNone = (body, texts) => texts.forEach((text) => expect(JSON.stringify(body)).not.toContain(text));

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
    const privateList = list(open, { name: 'Hiring', private: true, AssigneeUserId: [AUTHOR] });
    world = {
        open, other, team, openList, otherList, teamList, privateList,
        openTask: task(open, openList, { TaskName: 'Write the copy', TaskKey: 'WEB-1' }),
        otherTask: task(other, otherList, { TaskName: 'Pick the dates', TaskKey: 'RM-4' }),
        teamTask: task(team, teamList, { TaskName: 'Close the books', TaskKey: 'FIN-2' }),
        privateListTask: task(open, privateList, { TaskName: 'Offer letter', TaskKey: 'WEB-9' }),
    };
});

const closeOther = () => Object.assign(world.other, { isPrivateSpace: true, AssigneeUserId: [AUTHOR] });
const OF_OTHER = ['Quarter plan', 'Pick the dates', 'RM-4', 'Roadmap'];

describe('the names of a counted target\'s sources', () => {
    it('are sent to the owner for every list and task they can open, with where each one is', async () => {
        const id = await goal(AUTHOR);
        const res = await link(AUTHOR, id, { sprintIds: [world.openList, world.privateList], taskIds: [world.teamTask, world.privateListTask] });
        expect(res.statusCode).toBe(200);
        const open = String(world.open._id);
        const team = String(world.team._id);
        expect(res.body.data.targets[0].sourceNames).toEqual({
            sprintIds: {
                [world.openList]: { id: world.openList, name: 'Launch', projectId: open, projectName: 'Website' },
                [world.privateList]: { id: world.privateList, name: 'Hiring', projectId: open, projectName: 'Website' },
            },
            taskIds: {
                [world.teamTask]: { id: world.teamTask, name: 'Close the books', key: 'FIN-2', projectId: team, projectName: 'Finance' },
                [world.privateListTask]: { id: world.privateListTask, name: 'Offer letter', key: 'WEB-9', projectId: open, projectName: 'Website' },
            },
        });
        expect((await read(AUTHOR, id)).sourceNames).toEqual(res.body.data.targets[0].sourceNames);
    });

    it('are sent to someone the goal is shared with, for what the goal counts', async () => {
        const id = await goal(AUTHOR, { visibility: 'people', sharedWith: [NAMED] });
        await link(AUTHOR, id, { sprintIds: [world.teamList], taskIds: [world.teamTask] });
        const seen = await read(NAMED, id);
        expect(seen.sourceNames.sprintIds[world.teamList]).toMatchObject({ name: 'Budget', projectName: 'Finance' });
        expect(seen.sourceNames.taskIds[world.teamTask]).toMatchObject({ name: 'Close the books', key: 'FIN-2' });
    });

    it('come with every goal a list read returns, each target with its own', async () => {
        const first = await goal(AUTHOR, { name: 'A' });
        const second = await goal(AUTHOR, { name: 'B' });
        await link(AUTHOR, first, { sprintIds: [world.openList] });
        await link(AUTHOR, second, { taskIds: [world.otherTask] });
        const listed = (await call(goals.listGoals, AUTHOR)).body.data;
        expect(listed.map((row) => idsOf(row.targets[0].sourceNames))).toEqual([
            { sprintIds: [world.openList], taskIds: [] },
            { sprintIds: [], taskIds: [world.otherTask] },
        ]);
    });

    it('are left off a target that is not counted from tasks, and empty for one with nothing linked', async () => {
        const id = await goal(AUTHOR, { targets: [{ name: 'Signed', kind: 'boolean' }, { name: 'Tasks done', kind: 'tasks' }] });
        const res = await call(goals.getGoal, AUTHOR, { id });
        expect('sourceNames' in res.body.data.targets[0]).toBe(false);
        expect(res.body.data.targets[1].sourceNames).toEqual({ sprintIds: {}, taskIds: {} });
    });

    it.each([
        ['a member', COLLEAGUE],
        ['a guest the goal is shared with', GUEST],
    ])('are not sent to %s for a source they cannot open, while the last count still holds it', async (_who, uid) => {
        const id = await goal(AUTHOR, { visibility: 'workspace', sharedWith: [GUEST] });
        await link(AUTHOR, id, { sprintIds: [world.openList, world.otherList], taskIds: [world.otherTask] });
        expect(idsOf((await read(uid, id)).sourceNames)).toEqual({ sprintIds: [world.openList, world.otherList], taskIds: [world.otherTask] });

        closeOther();
        const res = await call(goals.getGoal, uid, { id });
        const seen = res.body.data.targets[0];
        expect(seen.sources).toEqual({ sprintIds: [world.openList, world.otherList], taskIds: [world.otherTask] });
        expect(idsOf(seen.sourceNames)).toEqual({ sprintIds: [world.openList], taskIds: [] });
        saysNone(res.body, OF_OTHER);
        saysNone((await call(goals.listGoals, uid)).body, OF_OTHER);
    });

    it('are not sent to the owner for a source they have been taken off, which they are still shown by id', async () => {
        const id = await goal(AUTHOR);
        await link(AUTHOR, id, { sprintIds: [world.teamList], taskIds: [world.teamTask, world.privateListTask] });
        world.team.AssigneeUserId = [NAMED];
        mockDb.store[SCHEMA_TYPE.SPRINTS].find((row) => String(row._id) === world.privateList).AssigneeUserId = [NAMED];
        const res = await call(goals.getGoal, AUTHOR, { id });
        expect(res.body.data.targets[0].sources).toEqual({ sprintIds: [world.teamList], taskIds: [world.teamTask, world.privateListTask] });
        expect(res.body.data.targets[0].sourceNames).toEqual({ sprintIds: {}, taskIds: {} });
        saysNone(res.body, ['Budget', 'Close the books', 'Offer letter', 'Finance']);
    });

    it('name a task only for a role that may list tasks, and its list for anyone who can open the project', async () => {
        const id = await goal(AUTHOR, { visibility: 'workspace' });
        await link(AUTHOR, id, { sprintIds: [world.openList], taskIds: [world.openTask] });
        const res = await call(goals.getGoal, NO_TASK_LIST, { id });
        expect(idsOf(res.body.data.targets[0].sourceNames)).toEqual({ sprintIds: [world.openList], taskIds: [] });
        saysNone(res.body, ['Write the copy', 'WEB-1']);
        expect(idsOf((await read(COLLEAGUE, id)).sourceNames)).toEqual({ sprintIds: [world.openList], taskIds: [world.openTask] });
    });

    it('never name a chat row or a list outside every project', async () => {
        const chatSpace = mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: nextId('c0'), default: false });
        const channel = list(chatSpace, { name: 'general' });
        const chatRow = task(chatSpace, channel, { TaskName: 'hello there', mainChat: true, AssigneeUserId: [OWNER] });
        const names = await sources.namesFor(C, OWNER, { sprintIds: [channel, world.openList], taskIds: [chatRow] });
        expect(idsOf(names)).toEqual({ sprintIds: [world.openList], taskIds: [] });
    });

    it('lets an admin who edits a workspace goal read the name of a source left out of the count', async () => {
        const id = await goal(AUTHOR, { visibility: 'workspace' });
        await link(AUTHOR, id, { sprintIds: [world.otherList] });
        closeOther();
        const forAdmin = await read(ADMIN, id);
        expect(forAdmin.sources.sprintIds).toEqual([world.otherList]);
        expect(forAdmin.sourceNames.sprintIds[world.otherList]).toMatchObject({ name: 'Quarter plan', projectName: 'Roadmap' });
    });

    it('answer without names when they could not be read, and say so in the log only', async () => {
        const id = await goal(AUTHOR);
        await link(AUTHOR, id, { sprintIds: [world.openList] });
        const original = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === SCHEMA_TYPE.SPRINTS) throw new Error('the database went away');
            return original(companyId, query, method);
        });
        const res = await call(goals.getGoal, AUTHOR, { id });
        mockDb.crud.mockImplementation(original);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.targets[0]).toMatchObject({ sources: { sprintIds: [world.openList] }, sourceNames: { sprintIds: {}, taskIds: {} } });
        expect(logger.error).toHaveBeenCalledTimes(1);
    });
});
