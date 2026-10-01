/* The web app's Everything store is tested against frontend/tests/fixtures/everythingResponses.json.
   This test is where that file comes from: the real handler answers a fixed set of requests over
   fakeMongo, and the file must equal what it answered. A change to the response shape fails here
   until the fixture is written again with UPDATE_EVERYTHING_FIXTURE=1. */
const fs = require('fs');
const path = require('path');

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
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
    project(OPS, 'Operations', 'OPS', '#7B68EE', { apps: [] });
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

const OPEN = ['default_active', 'active'];

const record = async () => {
    const out = {};
    out.all = await ask({ limit: 3, filter: { statusType: OPEN } });
    out.allNext = await ask({ limit: 3, filter: { statusType: OPEN }, cursor: out.all.response.data.nextCursor });
    out.withDone = await ask({ limit: 50 });
    out.withSubtasks = await ask({ limit: 50, includeSubtasks: true });
    out.byStatus = await ask({ group: 'status', limit: 1, filter: { statusType: OPEN } });
    out.statusDoing = await ask({ limit: 2, filter: { statusType: OPEN, status: ['Doing'] } });
    out.statusDoingNext = await ask({ limit: 2, filter: { statusType: OPEN, status: ['Doing'] }, cursor: out.statusDoing.response.data.nextCursor });
    out.statusToDo = await ask({ limit: 2, filter: { statusType: OPEN, status: ['To Do'] } });
    out.byProject = await ask({ group: 'project', limit: 1, filter: { statusType: OPEN } });
    out.byPriority = await ask({ group: 'priority', limit: 1, filter: { statusType: OPEN } });
    out.byDueDate = await ask({ group: 'dueDate', limit: 1, timezone: 'Asia/Kolkata', filter: { statusType: OPEN } });
    out.nothing = await ask({ limit: 50, filter: { statusType: OPEN, search: 'nothing is called this' } });
    out.staleCursor = await ask({ limit: 2, filter: { statusType: OPEN, status: ['To Do'] }, cursor: out.statusDoing.response.data.nextCursor });
    return out;
};

beforeAll(seed);

test('the fixture the web app is tested against is what the handler answers', async () => {
    const recorded = await record();

    expect(recorded.all.response.data.rows).toHaveLength(3);
    expect(recorded.all.response.data.nextCursor).toEqual(expect.any(String));
    expect(recorded.allNext.response.data.groups).toBeNull();
    expect(recorded.byStatus.response.data.groups).toEqual([{ key: 'Doing', count: 3 }, { key: 'To Do', count: 2 }]);
    expect(recorded.statusDoing.response.data.nextCursor).toEqual(expect.any(String));
    expect(recorded.statusDoingNext.response.data.rows).toHaveLength(1);
    expect(recorded.byDueDate.response.data.groups.map((g) => g.key)).toEqual([null, '2026-09-28', '2026-10-01', '2026-10-03', '2026-10-20']);
    expect(recorded.nothing.response.data).toEqual({ rows: [], groups: [{ key: null, count: 0 }], nextCursor: null, projects: {} });
    expect(recorded.staleCursor).toMatchObject({ statusCode: 400, response: { status: false, field: 'cursor' } });

    if (process.env.UPDATE_EVERYTHING_FIXTURE === '1') {
        fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
        fs.writeFileSync(FIXTURE, `${JSON.stringify(recorded, null, 2)}\n`);
    }
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(recorded);
});
