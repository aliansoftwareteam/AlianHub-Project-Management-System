/* The web app's Everything store is tested against frontend/tests/fixtures/everythingResponses.json.
   This test is where that file comes from: the page's own request builder makes the requests, the
   real handler answers them over fakeMongo, and the file must equal what was asked and answered.
   So a request the server would refuse, or a change to the response shape, fails here until the
   fixture is written again with UPDATE_EVERYTHING_FIXTURE=1. */
const fs = require('fs');
const path = require('path');

const mockDb = require('./fixtures/fakeMongo').create();

/* After an $unwind that keeps empty arrays MongoDB drops the field, so nobody's tasks group under
   null; fakeMongo leaves the empty array in place. The recorded answer has to be MongoDB's. */
const mockAsMongoGroups = (rows) => (Array.isArray(rows)
    ? rows.map((row) => (row && Array.isArray(row._id) && !row._id.length ? { ...row, _id: null } : row))
    : rows);
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: async (...args) => mockAsMongoGroups(await mockDb.crud(...args)) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({
    fetchRules: jest.fn(async () => {
        const section = { _id: 'task', key: 'task', isParent: true, roles: [{ key: 3, permission: true }] };
        return [section, ...['task_list', 'task_status', 'task_priority'].map((key) => ({ _id: key, key, isParent: false, parentId: 'task', roles: [{ key: 3, permission: true }] }))];
    }),
}));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

process.env.JWT_SECRET = 'a fixed secret, so the fixture cursors do not change between runs';

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { listEverything } = require('../Modules/Tasks/controller/everything');
const views = require('../Modules/Tasks/controller/everythingViews');
const { DEFAULT_SETTINGS, baseRequest, firstRequest, groupsFrom, groupRequest, viewBody, viewPatch } = require('../frontend/src/views/Everything/everythingRequest');

const FIXTURE = path.join(__dirname, '..', 'frontend', 'tests', 'fixtures', 'everythingResponses.json');
const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const SAM = '6f0000000000000000000002';
const WEB = '6f0000000000000000000a01';
const OPS = '6f0000000000000000000a02';
const SPRINT = '6f0000000000000000000b01';
const at = (iso) => new Date(iso);

const STATUSES = [
    { key: 1, name: 'To Do', type: 'default_active', bgColor: '#6b728035', textColor: '#6b7280' },
    { key: 2, name: 'Doing', type: 'active', bgColor: '#2563eb35', textColor: '#2563eb' },
    { key: 3, name: 'Done', type: 'close', bgColor: '#16a34a35', textColor: '#16a34a' },
];
/* Operations names its statuses differently: a row's choices have to come from its own project. */
const OPS_STATUSES = [
    { key: 1, name: 'To Do', type: 'default_active', bgColor: '#6b728035', textColor: '#6b7280' },
    { key: 2, name: 'Doing', type: 'active', bgColor: '#2563eb35', textColor: '#2563eb' },
    { key: 4, name: 'Waiting on a supplier', type: 'active', bgColor: '#d9770635', textColor: '#d97706' },
    { key: 3, name: 'Done', type: 'close', bgColor: '#16a34a35', textColor: '#16a34a' },
];
const statusOf = (key) => {
    const status = STATUSES.find((s) => s.key === key);
    return { status: { key, text: status.name, type: status.type }, statusKey: key, statusType: status.type };
};

const seed = () => {
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ME, roleType: 3, status: 2, isDelete: false });
    const project = (_id, ProjectName, ProjectCode, colour, over = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id, ProjectName, ProjectCode, isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, statusType: 'active',
        projectIcon: { type: 'color', data: colour }, taskStatusData: STATUSES, taskTypeCounts: [{ key: 1, name: 'Task', value: 'task' }, { key: 2, name: 'Bug', value: 'bug' }],
        apps: [{ key: 'Priority' }], ...over,
    });
    project(WEB, 'Website', 'WEB', '#2F3990');
    project(OPS, 'Operations', 'OPS', '#7B68EE', { apps: [], taskStatusData: OPS_STATUSES });
    const task = (n, TaskName, ProjectID, over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
        _id: `6f0000000000000000000f${String(n).padStart(2, '0')}`, TaskName, TaskKey: `${ProjectID === WEB ? 'WEB' : 'OPS'}-${n}`, ProjectID, sprintId: SPRINT,
        deletedStatusKey: 0, isParentTask: true, ...statusOf(1), Task_Priority: 'MEDIUM', TaskType: 'task', TaskTypeKey: 1, AssigneeUserId: [ME], tagsArray: [],
        subTasks: 0, updatedAt: at(`2026-10-0${n}T09:00:00.000Z`), createdAt: at('2026-09-01T09:00:00.000Z'), description: 'never returned', ...over,
    });
    task(1, 'Write the brief', WEB, { DueDate: at('2026-09-28T18:29:59.000Z'), Task_Priority: 'HIGH' });
    task(2, 'Draw the home page', WEB, { ...statusOf(2), DueDate: at('2026-10-01T18:29:59.000Z'), AssigneeUserId: [ME, SAM], subTasks: 2 });
    task(3, 'Fix the footer', WEB, { ...statusOf(2), TaskType: 'bug', TaskTypeKey: 2, DueDate: at('2026-10-03T18:29:59.000Z'), AssigneeUserId: [SAM] });
    task(4, 'Renew the domain', OPS, { DueDate: at('2026-10-20T18:29:59.000Z'), Task_Priority: 'LOW', AssigneeUserId: [] });
    task(5, 'Rotate the keys', OPS, { ...statusOf(2), Task_Priority: 'HIGH', folderObjId: '6f0000000000000000000d01' });
    task(6, 'Archive last year', OPS, { ...statusOf(3) });
    task(7, 'Pick the fonts', WEB, { isParentTask: false, ParentTaskId: '6f0000000000000000000f02', ancestors: ['6f0000000000000000000f02'] });
};

const ask = async (body) => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    await listEverything({ method: 'POST', headers: { companyid: C }, aud: C, uid: ME, body }, res);
    return JSON.parse(JSON.stringify({ request: body, statusCode: res.statusCode, response: res.body }));
};

const VIEWS = '/api/v2/tasks/everything/views';
const SAVED_AT = '2026-10-01T06:30:00.000Z';

/* A changed view answers with the time it was saved, which is the one value here that is not the
   same on every run; the recording keeps a fixed time in its place. */
const askViews = async (handler, { method, body, id }) => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    await handler({ method: method.toUpperCase(), headers: { companyid: C }, aud: C, uid: ME, body, params: id ? { id } : {} }, res);
    const entry = JSON.parse(JSON.stringify({ request: { method, path: id ? `${VIEWS}/${id}` : VIEWS, body }, statusCode: res.statusCode, response: res.body }));
    if (entry.response.data && entry.response.data.updatedAt) entry.response.data.updatedAt = SAVED_AT;
    return entry;
};

/* 12:00 on Thursday 1 October in the viewer's timezone: the week has Friday and Saturday left. */
const VIEWER = { now: new Date('2026-10-01T06:30:00.000Z'), timeZone: 'Asia/Kolkata' };
const PAGE = 2;
const DUE_BUCKETS = ['overdue', 'today', 'week', 'later', 'none'];
const settings = (over = {}) => ({ ...DEFAULT_SETTINGS, ...over });

const record = async () => {
    const out = {};
    const groupOf = (counts, chosen, groupId) => groupsFrom(out[counts].response.data.groups, chosen, VIEWER).find((g) => g.id === groupId);
    const page = (counts, chosen, groupId, after) => ask(groupRequest(
        baseRequest(chosen, VIEWER),
        groupOf(counts, chosen, groupId).filter,
        { cursor: after ? out[after].response.data.nextCursor : null, limit: PAGE },
    ));

    out.all = await ask(firstRequest(settings(), VIEWER, PAGE));
    out.allNext = await page('all', settings(), 'all', 'all');
    out.allLast = await page('all', settings(), 'all', 'allNext');
    out.withDone = await ask(firstRequest(settings({ hideDone: false }), VIEWER, PAGE));
    out.withSubtasks = await ask(firstRequest(settings({ showSubtasks: true }), VIEWER, PAGE));
    out.mine = await ask(firstRequest(settings({ assignee: [ME] }), VIEWER, PAGE));
    out.nothing = await ask(firstRequest(settings({ search: 'nothing is called this' }), VIEWER, PAGE));

    const byStatus = settings({ group: 'status' });
    out.statusCounts = await ask(firstRequest(byStatus, VIEWER, PAGE));
    out.statusDoing = await page('statusCounts', byStatus, 'status:Doing');
    out.statusDoingNext = await page('statusCounts', byStatus, 'status:Doing', 'statusDoing');
    out.statusToDo = await page('statusCounts', byStatus, 'status:To Do');
    out.staleCursor = await page('statusCounts', byStatus, 'status:To Do', 'statusDoing');

    const byProject = settings({ group: 'project' });
    out.projectCounts = await ask(firstRequest(byProject, VIEWER, PAGE));
    out.projectWebsite = await page('projectCounts', byProject, `project:${WEB}`);
    const byPriority = settings({ group: 'priority' });
    out.priorityCounts = await ask(firstRequest(byPriority, VIEWER, PAGE));
    out.priorityHigh = await page('priorityCounts', byPriority, 'priority:HIGH');
    const byAssignee = settings({ group: 'assignee' });
    out.assigneeCounts = await ask(firstRequest(byAssignee, VIEWER, PAGE));
    out.assigneeNobody = await page('assigneeCounts', byAssignee, 'assignee:unassigned');
    const byDue = settings({ group: 'dueDate' });
    out.dueCounts = await ask(firstRequest(byDue, VIEWER, PAGE));
    for (const bucket of DUE_BUCKETS) out[`due_${bucket}`] = await page('dueCounts', byDue, `dueDate:${bucket}`);

    const board = settings({ mode: 'board', hideDone: false });
    out.boardCounts = await ask(firstRequest(board, VIEWER, PAGE));
    out.boardDone = await page('boardCounts', board, 'status:Done');
    out.boardDoing = await page('boardCounts', board, 'status:Doing');

    out.viewsNone = await askViews(views.listViews, { method: 'get' });
    out.viewCreated = await askViews(views.createView, { method: 'post', body: viewBody('My board', board) });
    const id = out.viewCreated.response.data._id;
    out.viewsOne = await askViews(views.listViews, { method: 'get' });
    out.viewRenamed = await askViews(views.updateView, { method: 'patch', id, body: viewPatch({ name: 'Board, with done' }) });
    out.viewDefault = await askViews(views.updateView, { method: 'patch', id, body: viewPatch({ isDefault: true }) });
    out.viewChanged = await askViews(views.updateView, { method: 'patch', id, body: viewPatch({ settings: settings({ mode: 'table', group: 'project' }) }) });
    out.viewRefused = await askViews(views.createView, { method: 'post', body: { ...viewBody('Not a view', board), projectId: WEB } });
    out.viewDeleted = await askViews(views.deleteView, { method: 'delete', id });
    return out;
};

const taskNames = (entry) => entry.response.data.rows.map((row) => row.TaskName);

beforeAll(seed);

test('the fixture the web app is tested against is what the handler answers to the page\'s own requests', async () => {
    const recorded = await record();

    Object.entries(recorded).filter(([name]) => !['staleCursor', 'viewRefused'].includes(name)).forEach(([name, entry]) => {
        expect({ name, statusCode: entry.statusCode, message: entry.response.message }).toEqual({ name, statusCode: 200, message: undefined });
    });
    expect(recorded.staleCursor).toMatchObject({ statusCode: 400, response: { status: false, field: 'cursor' } });

    expect(taskNames(recorded.all)).toEqual(['Rotate the keys', 'Renew the domain']);
    expect(taskNames(recorded.allNext)).toEqual(['Fix the footer', 'Draw the home page']);
    expect(taskNames(recorded.allLast)).toEqual(['Write the brief']);
    expect(recorded.all.response.data.groups).toEqual([{ key: null, count: 5 }]);
    expect(recorded.allNext.response.data.groups).toBeNull();
    expect(recorded.allLast.response.data.nextCursor).toBeNull();
    expect(recorded.withDone.response.data.groups).toEqual([{ key: null, count: 6 }]);
    expect(recorded.withSubtasks.response.data.groups).toEqual([{ key: null, count: 6 }]);
    expect(taskNames(recorded.mine)).toEqual(['Rotate the keys', 'Draw the home page']);
    expect(recorded.nothing.response.data).toEqual({ rows: [], groups: [{ key: null, count: 0 }], nextCursor: null, projects: {} });

    expect(recorded.statusCounts.response.data.groups).toEqual([{ key: 'Doing', count: 3 }, { key: 'To Do', count: 2 }]);
    expect(taskNames(recorded.statusDoing)).toEqual(['Rotate the keys', 'Fix the footer']);
    expect(taskNames(recorded.statusDoingNext)).toEqual(['Draw the home page']);
    expect(taskNames(recorded.statusToDo)).toEqual(['Renew the domain', 'Write the brief']);
    expect(taskNames(recorded.projectWebsite)).toEqual(['Fix the footer', 'Draw the home page']);
    expect(taskNames(recorded.priorityHigh)).toEqual(['Rotate the keys', 'Write the brief']);
    expect(taskNames(recorded.assigneeNobody)).toEqual(['Renew the domain']);
    expect(recorded.dueCounts.response.data.groups.map((g) => g.key)).toEqual([null, '2026-09-28', '2026-10-01', '2026-10-03', '2026-10-20']);
    expect(Object.fromEntries(DUE_BUCKETS.map((bucket) => [bucket, taskNames(recorded[`due_${bucket}`])]))).toEqual({
        overdue: ['Write the brief'], today: ['Draw the home page'], week: ['Fix the footer'], later: ['Renew the domain'], none: ['Rotate the keys'],
    });

    expect(recorded.boardCounts.request).toEqual({ ...recorded.statusCounts.request, filter: {} });
    expect(recorded.boardCounts.response.data.groups).toEqual([{ key: 'Doing', count: 3 }, { key: 'Done', count: 1 }, { key: 'To Do', count: 2 }]);
    expect(taskNames(recorded.boardDone)).toEqual(['Archive last year']);

    expect(recorded.viewsNone.response.data).toEqual([]);
    expect(recorded.viewCreated.response.data).toMatchObject({ name: 'My board', isDefault: false, settings: { mode: 'board', hideDone: false, group: 'none' } });
    expect(recorded.viewsOne.response.data).toEqual([recorded.viewCreated.response.data]);
    expect(recorded.viewRenamed.response.data).toMatchObject({ name: 'Board, with done', updatedAt: SAVED_AT });
    expect(recorded.viewDefault.response.data.isDefault).toBe(true);
    expect(recorded.viewChanged.response.data.settings).toMatchObject({ mode: 'table', group: 'project', hideDone: true });
    expect(recorded.viewRefused).toMatchObject({ statusCode: 400, response: { status: false, field: 'projectId' } });
    expect(recorded.viewDeleted.response).toEqual({ status: true, statusText: 'View deleted.' });

    if (process.env.UPDATE_EVERYTHING_FIXTURE === '1') {
        fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
        fs.writeFileSync(FIXTURE, `${JSON.stringify(recorded, null, 2)}\n`);
    }
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(recorded);
});
