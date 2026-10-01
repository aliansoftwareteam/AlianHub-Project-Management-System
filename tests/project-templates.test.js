const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDbs;
const mockDbOf = (companyId) => {
    mockDbs[companyId] = mockDbs[companyId] || fakeMongo.create();
    return mockDbs[companyId];
};
let mockCompany;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => mockDbOf(companyId).crud(companyId, ...rest),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Project/helpers/projectHistory', () => ({ recordProjectCreated: jest.fn(async () => undefined) }));
jest.mock('../Modules/Automations/engine/matcher', () => ({ invalidate: jest.fn() }));
jest.mock('../Modules/Project/helpers/projectQuota', () => ({
    stepProjectCount: jest.fn(async (companyId, isPrivateSpace, step) => {
        const bucket = isPrivateSpace === true ? 'privateCount' : 'publicCount';
        mockCompany.projectCount.projectCount += step;
        mockCompany.projectCount[bucket] += step;
        return { data: JSON.parse(JSON.stringify(mockCompany)) };
    }),
}));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const socketEmitter = require('../event/socketEventEmitter');
const { stepProjectCount } = require('../Modules/Project/helpers/projectQuota');
const { recordProjectCreated } = require('../Modules/Project/helpers/projectHistory');
const { INLINE_TASK_LIMIT } = require('../Modules/ProjectDuplicate/rules');
const { MAX_TASKS, MAX_TEMPLATES, TASKS_PER_ROW } = require('../Modules/ProjectSnapshots/rules');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MEMBER = 'a00000000000000000000003';
const OUTSIDER = 'a00000000000000000000004';
const SHAPE = 'f00000000000000000000001';
const MEMBER_ROLE = 3;
const DAY = 24 * 60 * 60 * 1000;
const oid = () => new mongoose.Types.ObjectId().toString();
const asId = (id) => new mongoose.Types.ObjectId(String(id));
const iso = (value) => new Date(value).toISOString();

const routesOf = (init) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers.flat(); };
    init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });
    return table;
};
const routes = () => ({
    ...routesOf(require('../Modules/ProjectDuplicate/routes').init),
    ...routesOf(require('../Modules/ProjectSnapshots/routes').init),
});

const settle = async () => { for (let i = 0; i < 200; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const run = async (route, { uid = OWNER, company = C, id, body, wait = true } = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    const req = verified({ uid, params: { id }, body, query: {}, headers: { companyid: company } });
    for (const handler of routes()[route]) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    if (wait) await settle();
    return res;
};

const SAVE = 'POST /api/v2/projects/:id/template';
const LIST = 'GET /api/v2/projects/templates';
const EDIT = 'PATCH /api/v2/projects/templates/:id';
const REMOVE = 'DELETE /api/v2/projects/templates/:id';
const USE = 'POST /api/v2/projects/templates/:id/use';
const PROGRESS = 'GET /api/v2/projects/:id/duplicate';

const EVERYTHING = { tasks: true, assignees: true, dates: true, automations: true };
const STRUCTURE_ONLY = { tasks: false, assignees: false, dates: false, automations: false };
const WITH_TASKS = { ...STRUCTURE_ONLY, tasks: true };

const save = (id, body = {}, options = {}) => run(SAVE, { ...options, id, body: { name: 'Launch plan', include: STRUCTURE_ONLY, ...body } });
const use = (id, body = {}, options = {}) => run(USE, { ...options, id, body: { name: 'Autumn launch', include: EVERYTHING, ...body } });
const list = (options = {}) => run(LIST, options);
const saved = async (body, options) => {
    const res = await save(launch.id, body, options);
    expect(res.body).toMatchObject({ status: true });
    return res.body.data.template;
};

const db = (company = C) => mockDbOf(company);
const rowsOf = (type, company = C) => db(company).store[type] || [];
const seed = (type, doc, company = C) => db(company).seed(type, { _id: oid(), ...doc });
const inProject = (type, projectId, field = 'projectId') => rowsOf(type).filter((row) => String(row[field]) === String(projectId));
const byName = (rows, name, field = 'name') => rows.find((row) => row[field] === name);
const stored = () => rowsOf(SCHEMA_TYPE.PROJECT_SNAPSHOTS);
const headOf = (template) => stored().find((row) => String(row._id) === String(template._id));
const storedTasks = (template) => stored().filter((row) => row.kind === 'tasks' && String(row.templateId) === String(template._id)).flatMap((row) => row.tasks);

const seedCompany = () => {
    db().seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    db().seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ADMIN, roleType: 2, status: 2, isDelete: false });
    [MEMBER, OUTSIDER].forEach((userId) => db().seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: MEMBER_ROLE, status: 2, isDelete: false }));
};

const STATUSES = [
    { key: 1, name: 'To Do', type: 'default_active', value: 'to_do' },
    { key: 2, name: 'Review', type: 'active', value: 'review' },
    { key: 3, name: 'Done', type: 'close', value: 'done' },
];

/* Launch: Backlog at the top, Design holding Wireframes, and Icons inside Design holding the private Glyphs. */
const seedLaunch = (extra = {}) => {
    const project = seed(SCHEMA_TYPE.PROJECTS, {
        ProjectName: 'Launch', ProjectCode: 'LAU', CompanyId: asId(C), isPrivateSpace: false, isGlobalPermission: true,
        AssigneeUserId: [OWNER, MEMBER], LeadUserId: [OWNER], projectCreatedBy: OWNER, projectIcon: { type: 'color', data: 'blue' },
        taskStatusData: STATUSES, taskTypeCounts: [{ key: 1, value: 'task', name: 'Task', taskCount: 4 }, { key: 2, value: 'bug', name: 'Bug', taskCount: 0 }],
        apps: ['Priority', 'CustomFields'], workingDays: [1, 2, 3, 4], lastTaskId: 4,
        StartDate: new Date('2026-01-05'), DueDate: new Date('2026-03-01'), deletedStatusKey: 0,
        favouriteTasks: [{ userId: MEMBER }], watchers: { [MEMBER]: true }, attachments: [{ url: 'wasabi://launch/brief.pdf' }],
        ...extra,
    });
    const id = String(project._id);
    const folder = (name, more = {}) => String(seed(SCHEMA_TYPE.FOLDERS, { name, projectId: asId(id), deletedStatusKey: 0, ...more })._id);
    const sprint = (name, more = {}) => String(seed(SCHEMA_TYPE.SPRINTS, { name, projectId: asId(id), private: false, deletedStatusKey: 0, tasks: 0, ...more })._id);
    const design = folder('Design');
    const icons = folder('Icons', { parentFolderId: asId(design) });
    const backlog = sprint('Backlog');
    const wireframes = sprint('Wireframes', { folderId: asId(design), startDate: new Date('2026-01-12'), endDate: new Date('2026-01-26') });
    const glyphs = sprint('Glyphs', { folderId: asId(icons), private: true, AssigneeUserId: [OWNER] });
    db().store[SCHEMA_TYPE.PROJECTS].find((row) => String(row._id) === id).ProjectRequiredComponent = [
        { id: 'view-list', keyName: 'ListView', name: 'List', settings: { groupBy: 'status', filters: [{ field: 'sprintId', value: wireframes }] } },
        { id: 'view-board', keyName: 'ProjectKanban', name: 'Board', settings: { groupBy: 'priority' } },
    ];
    return { id, design, icons, backlog, wireframes, glyphs, folder, sprint };
};

const seedTask = (project, sprintId, doc = {}) => {
    const sprint = rowsOf(SCHEMA_TYPE.SPRINTS).find((row) => String(row._id) === String(sprintId));
    sprint.tasks += 1;
    return seed(SCHEMA_TYPE.TASKS, {
        TaskName: 'Task', TaskKey: `LAU-${rowsOf(SCHEMA_TYPE.TASKS).length + 1}`, TaskType: 'task', TaskTypeKey: 1,
        ProjectID: asId(project.id), CompanyId: asId(C), sprintId: asId(sprintId), sprintArray: { id: asId(sprintId), name: sprint.name },
        status: { key: 1, text: 'To Do', type: 'default_active' }, statusKey: 1, statusType: 'default_active',
        Task_Priority: 'MEDIUM', Task_Leader: OWNER, isParentTask: true, ParentTaskId: '', deletedStatusKey: 0,
        AssigneeUserId: [], watchers: [], groupByStatusIndex: 0,
        ...doc,
    });
};

/* A task, a subtask and a sub-subtask in the private list, plus one task at the top of the project. */
const seedTree = (project) => {
    const top = seedTask(project, project.glyphs, {
        TaskName: 'Draw the set', AssigneeUserId: [MEMBER], watchers: [MEMBER], subTasks: 1, Task_Priority: 'HIGH',
        status: { key: 3, text: 'Done', type: 'close' }, statusKey: 3, statusType: 'close',
        DueDate: new Date('2026-02-10'), startDate: new Date('2026-02-01'), dueDateDeadLine: [{ date: new Date('2026-02-08') }],
        rawDescription: 'Every glyph on the grid', checklistArray: [{ id: 'c1', name: 'Grid', isChecked: true, AssigneeUserId: [MEMBER] }],
        customField: { [SHAPE]: { fieldValue: 'Round', _id: SHAPE } }, tagsArray: ['brand'],
        attachments: [{ url: 'wasabi://launch/icon.png' }], links: [{ url: 'https://example.test/pr/1' }],
        completion: { badge: 'HUMAN' }, favouriteTasks: [{ userId: MEMBER }], totalEstimatedTime: 120, points: 5,
    });
    const middle = seedTask(project, project.glyphs, {
        TaskName: 'Arrows', isParentTask: false, ParentTaskId: String(top._id), ancestors: [String(top._id)], subTasks: 1, TaskType: 'bug', TaskTypeKey: 2,
    });
    const leaf = seedTask(project, project.glyphs, {
        TaskName: 'Arrow left', isParentTask: false, ParentTaskId: String(middle._id), ancestors: [String(top._id), String(middle._id)],
    });
    const loose = seedTask(project, project.backlog, { TaskName: 'Kickoff' });
    seed(SCHEMA_TYPE.COMMENTS, { taskId: asId(top._id), projectId: asId(project.id), sprintId: asId(project.glyphs), message: 'Looks good to ship' });
    return { top, middle, leaf, loose };
};

const seedRule = (project, more = {}) => seed(SCHEMA_TYPE.AUTOMATION_RULES, {
    name: 'Close out', enabled: true, version: 2, deletedStatusKey: 0, scope: { allProjects: false, projectIds: [project.id] },
    trigger: { type: 'event', event: 'task.status_changed' }, conditions: { all: [{ field: 'status', value: `${project.id}:3` }] },
    steps: [{ id: 's1', type: 'move', sprintId: project.wireframes }], stats: { fired: 9 }, lastRunCount: 3, createdBy: MEMBER,
    ...more,
});

const madeFrom = (res) => {
    expect(res.body).toMatchObject({ status: true });
    const id = String(res.body.data.project._id);
    return {
        id,
        project: rowsOf(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === id),
        folders: inProject(SCHEMA_TYPE.FOLDERS, id),
        lists: inProject(SCHEMA_TYPE.SPRINTS, id),
        tasks: inProject(SCHEMA_TYPE.TASKS, id, 'ProjectID'),
        notes: res.body.data.notes,
    };
};

const refused = (res, code) => {
    expect(res.statusCode).toBe(code);
    expect(res.body).toMatchObject({ status: false, statusText: expect.any(String) });
    return res.body.statusText;
};

const sourceIdsOf = (project, tree = {}) => [
    project.id, project.design, project.icons, project.backlog, project.wireframes, project.glyphs,
    ...Object.values(tree).map((task) => String(task._id)),
];

let launch;
beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDbs = {};
    mockCompany = { planFeature: { project: null, maxPublicProject: null, maxPrivateProject: null }, projectCount: { projectCount: 1, publicCount: 1, privateCount: 0 } };
    seedCompany();
    launch = seedLaunch();
    seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: SHAPE, fieldTitle: 'Shape', fieldType: 'text', global: false, isDelete: true, projectId: [launch.id] });
});

afterEach(() => { delete process.env.PERMISSION_ENFORCEMENT_MODE; });

describe('saving a project as a template', () => {
    it('answers the template with its counts and stores nothing in the project collections', async () => {
        seedTree(launch);
        const before = JSON.stringify([SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.FOLDERS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.TASKS].map((type) => rowsOf(type)));
        const res = await save(launch.id, { description: '  How we launch  ', include: WITH_TASKS });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.template).toMatchObject({
            name: 'Launch plan', description: 'How we launch', createdBy: OWNER, canManage: true,
            include: WITH_TASKS, counts: { folders: 2, lists: 3, tasks: 4, automations: 0 },
        });
        expect(res.body.data.template.statuses.map((status) => status.name)).toEqual(['To Do', 'Review', 'Done']);
        expect(res.body.data.template.snapshot).toBeUndefined();
        expect(JSON.stringify([SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.FOLDERS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.TASKS].map((type) => rowsOf(type)))).toBe(before);
        expect(stepProjectCount).not.toHaveBeenCalled();
    });

    it('keeps a snapshot under ids of its own, naming nothing of the project it came from', async () => {
        const tree = seedTree(launch);
        seedRule(launch);
        const template = await saved({ include: EVERYTHING });
        const kept = JSON.stringify(stored());
        sourceIdsOf(launch, tree).forEach((id) => expect(kept).not.toContain(id));
        expect(kept).not.toContain('"Launch"');
        expect(headOf(template).snapshot.folders.map((folder) => folder.name).sort()).toEqual(['Design', 'Icons']);
        expect(storedTasks(template)).toHaveLength(4);
    });

    it('never keeps comments, files, links, watchers, favourites or who completed a task', async () => {
        seedTree(launch);
        const template = await saved({ include: EVERYTHING });
        const kept = JSON.stringify(stored());
        ['wasabi://', 'example.test', 'Looks good to ship', 'HUMAN', 'favouriteTasks', 'watchers', 'attachments'].forEach((text) => expect(kept).not.toContain(text));
        expect(storedTasks(template).find((task) => task.TaskName === 'Draw the set')).toMatchObject({
            rawDescription: 'Every glyph on the grid', Task_Priority: 'HIGH', TaskType: 'task', totalEstimatedTime: 120, points: 5,
            tagsArray: ['brand'], customField: { [SHAPE]: { fieldValue: 'Round', _id: SHAPE } },
        });
    });

    it('keeps dates as distances from the start of the project, and no date at all unless asked', async () => {
        seedTree(launch);
        const dated = await saved({ include: { ...WITH_TASKS, dates: true } });
        const top = storedTasks(dated).find((task) => task.TaskName === 'Draw the set');
        expect(top.dateOffsets).toEqual({ DueDate: 36 * DAY, startDate: 27 * DAY, dueDateDeadLine: [34 * DAY] });
        expect(top.DueDate).toBeUndefined();
        expect(headOf(dated).snapshot.project.dateOffsets).toMatchObject({ StartDate: 0, DueDate: 55 * DAY });
        expect(byName(headOf(dated).snapshot.lists, 'Wireframes').dateOffsets).toEqual({ startDate: 7 * DAY, endDate: 21 * DAY });

        const bare = await saved({ name: 'Bare', include: WITH_TASKS });
        const undated = JSON.stringify([headOf(bare).snapshot, storedTasks(bare)]);
        ['dateOffsets', 'StartDate', 'DueDate', 'startDate', 'endDate', '2026-0'].forEach((text) => expect(undated).not.toContain(text));
    });

    it('keeps people only when asked, as ids', async () => {
        seedTree(launch);
        const bare = await saved({ include: WITH_TASKS });
        expect(JSON.stringify([headOf(bare), storedTasks(bare)])).not.toContain(MEMBER);
        const full = await saved({ name: 'Full', include: { ...WITH_TASKS, assignees: true } });
        const top = storedTasks(full).find((task) => task.TaskName === 'Draw the set');
        expect(top.AssigneeUserId).toEqual([MEMBER]);
        expect(top.checklistArray).toEqual([{ id: 'c1', name: 'Grid', isChecked: false, AssigneeUserId: [MEMBER] }]);
        expect(headOf(full).snapshot.people.sort()).toEqual([OWNER, MEMBER].sort());
    });

    it('keeps the people a field of a task names only with the assignees, and the files a field holds never', async () => {
        const reviewers = String(seed(SCHEMA_TYPE.CUSTOM_FIELDS, { fieldTitle: 'Reviewers', fieldType: 'people', global: false, isDelete: true, projectId: [launch.id] })._id);
        const brief = String(seed(SCHEMA_TYPE.CUSTOM_FIELDS, { fieldTitle: 'Brief', fieldType: 'files', global: false, isDelete: true, projectId: [launch.id] })._id);
        const gone = oid();
        seedTask(launch, launch.backlog, {
            TaskName: 'Reviewed',
            customField: { [reviewers]: { fieldValue: [MEMBER], _id: reviewers }, [brief]: { fieldValue: [{ url: 'wasabi://launch/brief.pdf' }], _id: brief }, [gone]: { fieldValue: 'stale' } },
        });
        expect(storedTasks(await saved({ include: WITH_TASKS }))[0].customField).toEqual({});
        const full = await saved({ name: 'Full', include: { ...WITH_TASKS, assignees: true } });
        expect(storedTasks(full)[0].customField).toEqual({ [reviewers]: { fieldValue: [MEMBER], _id: reviewers } });
    });

    it('keeps the automations only when asked', async () => {
        seedRule(launch);
        expect(headOf(await saved()).snapshot.rules).toEqual([]);
        const withRules = await saved({ name: 'With rules', include: { ...STRUCTURE_ONLY, automations: true } });
        expect(withRules.counts.automations).toBe(1);
        expect(headOf(withRules).snapshot.rules).toHaveLength(1);
    });

    it('is a copy, not a link: what happens to the project afterwards does not reach it', async () => {
        seedTree(launch);
        const template = await saved({ include: WITH_TASKS });
        rowsOf(SCHEMA_TYPE.SPRINTS).find((row) => String(row._id) === launch.wireframes).name = 'Renamed since';
        rowsOf(SCHEMA_TYPE.FOLDERS).find((row) => String(row._id) === launch.icons).deletedStatusKey = 1;
        rowsOf(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === launch.id).deletedStatusKey = 1;
        db().store[SCHEMA_TYPE.TASKS] = [];
        const made = madeFrom(await use(template._id));
        expect(made.lists.map((row) => row.name).sort()).toEqual(['Backlog', 'Glyphs', 'Wireframes']);
        expect(made.folders.map((row) => row.name).sort()).toEqual(['Design', 'Icons']);
        expect(made.tasks).toHaveLength(4);
    });

    it('refuses a project with more tasks than a template holds, and says how many that is', async () => {
        const bulk = Array.from({ length: MAX_TASKS + 1 }, (unused, at) => ({
            _id: oid(), TaskName: `Bulk ${at}`, ProjectID: asId(launch.id), sprintId: asId(launch.backlog), ParentTaskId: '', deletedStatusKey: 0,
        }));
        db().store[SCHEMA_TYPE.TASKS] = bulk;
        const res = await save(launch.id, { include: WITH_TASKS });
        expect(refused(res, 400)).toMatch(/2,000 tasks/);
        expect(stored()).toHaveLength(0);
        expect((await save(launch.id)).statusCode).toBe(200);
    });

    it('refuses another template once the workspace holds as many as it can', async () => {
        for (let n = 0; n < MAX_TEMPLATES; n += 1) seed(SCHEMA_TYPE.PROJECT_SNAPSHOTS, { kind: 'template', name: `T${n}`, createdBy: OWNER, everyone: true, deletedStatusKey: 0 });
        expect(refused(await save(launch.id), 400)).toMatch(/templates/i);
    });

    it('takes back the task rows it wrote when the save breaks part way', async () => {
        seedTree(launch);
        const real = db().crud.getMockImplementation();
        db().crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === SCHEMA_TYPE.PROJECT_SNAPSHOTS && method === 'save') throw new Error('disk full');
            return real(companyId, query, method);
        });
        refused(await save(launch.id, { include: WITH_TASKS }), 500);
        expect(stored()).toHaveLength(0);
    });
});

describe('the request to save', () => {
    const bad = async (body) => {
        const res = await run(SAVE, { id: launch.id, body });
        expect(stored()).toHaveLength(0);
        return refused(res, 400);
    };

    it('needs a name', async () => {
        expect(await bad({ include: STRUCTURE_ONLY })).toMatch(/name/i);
        expect(await bad({ name: '   ', include: STRUCTURE_ONLY })).toMatch(/name/i);
        expect(await bad({ name: 'x'.repeat(256), include: STRUCTURE_ONLY })).toMatch(/name/i);
    });

    it('needs the four choices as booleans', async () => {
        expect(await bad({ name: 'Launch plan' })).toMatch(/include/i);
        expect(await bad({ name: 'Launch plan', include: { ...STRUCTURE_ONLY, tasks: 'yes' } })).toMatch(/include\.tasks/);
        expect(await bad({ name: 'Launch plan', include: { tasks: false, assignees: false, dates: false } })).toMatch(/include\.automations/);
    });

    it('takes a description as text of a bounded length, and the sharing choice as a boolean', async () => {
        expect(await bad({ name: 'Launch plan', include: STRUCTURE_ONLY, description: 42 })).toMatch(/description/);
        expect(await bad({ name: 'Launch plan', include: STRUCTURE_ONLY, description: 'x'.repeat(2001) })).toMatch(/description/);
        expect(await bad({ name: 'Launch plan', include: STRUCTURE_ONLY, everyone: 'yes' })).toMatch(/everyone/);
    });

    it('refuses a key it does not know', async () => {
        expect(await bad({ name: 'Launch plan', include: STRUCTURE_ONLY, createdBy: MEMBER })).toMatch(/createdBy/);
        expect(await bad({ name: 'Launch plan', include: { ...STRUCTURE_ONLY, comments: true } })).toMatch(/include\.comments/);
    });
});

describe('a project made from a template', () => {
    it('has the folder, the subfolder, a list in each and the three task levels', async () => {
        seedTree(launch);
        const template = await saved({ include: WITH_TASKS });
        const res = await use(template._id);
        expect(res.body).toMatchObject({ status: true, data: { counts: { folders: 2, lists: 3, tasks: 4 }, job: null } });
        const made = madeFrom(res);
        const design = byName(made.folders, 'Design');
        const icons = byName(made.folders, 'Icons');
        expect(design.parentFolderId == null).toBe(true);
        expect(String(icons.parentFolderId)).toBe(String(design._id));
        expect(byName(made.lists, 'Backlog').folderId == null).toBe(true);
        expect(String(byName(made.lists, 'Wireframes').folderId)).toBe(String(design._id));
        expect(String(byName(made.lists, 'Glyphs').folderId)).toBe(String(icons._id));

        const top = byName(made.tasks, 'Draw the set', 'TaskName');
        const middle = byName(made.tasks, 'Arrows', 'TaskName');
        const leaf = byName(made.tasks, 'Arrow left', 'TaskName');
        expect(top).toMatchObject({ isParentTask: true, subTasks: 1, ParentTaskId: '' });
        expect(middle).toMatchObject({ isParentTask: false, ParentTaskId: String(top._id), ancestors: [String(top._id)], subTasks: 1, TaskType: 'bug', TaskTypeKey: 2 });
        expect(leaf).toMatchObject({ isParentTask: false, ParentTaskId: String(middle._id), ancestors: [String(top._id), String(middle._id)] });
        expect(String(top.sprintId)).toBe(String(byName(made.lists, 'Glyphs')._id));
        expect(top.sprintArray).toMatchObject({ name: 'Glyphs', folderName: 'Icons' });
        expect(String(byName(made.tasks, 'Kickoff', 'TaskName').sprintId)).toBe(String(byName(made.lists, 'Backlog')._id));
        expect(byName(made.lists, 'Glyphs').tasks).toBe(3);
        expect(byName(made.lists, 'Backlog').tasks).toBe(1);
    });

    it('carries the statuses, task types, apps, working days, a field value and a view whose filter names a list', async () => {
        seedTree(launch);
        const template = await saved({ include: WITH_TASKS });
        const res = await use(template._id);
        const made = madeFrom(res);
        expect(made.project.taskStatusData).toEqual(STATUSES);
        expect(made.project.taskTypeCounts.map((type) => [type.key, type.taskCount])).toEqual([[1, 3], [2, 1]]);
        expect(made.project.apps).toEqual(['Priority', 'CustomFields']);
        expect(made.project.workingDays).toEqual([1, 2, 3, 4]);
        expect(made.project.ProjectRequiredComponent.map((view) => view.keyName)).toEqual(['ListView', 'ProjectKanban']);
        expect(made.project.ProjectRequiredComponent[0].settings).toEqual({ groupBy: 'status', filters: [{ field: 'sprintId', value: String(byName(made.lists, 'Wireframes')._id) }] });
        expect(byName(made.tasks, 'Draw the set', 'TaskName')).toMatchObject({
            customField: { [SHAPE]: { fieldValue: 'Round', _id: SHAPE } }, rawDescription: 'Every glyph on the grid',
            Task_Priority: 'HIGH', totalEstimatedTime: 120, points: 5, tagsArray: ['brand'],
        });
        expect(res.body.data.sharedFields).toEqual([SHAPE]);
        expect(rowsOf(SCHEMA_TYPE.CUSTOM_FIELDS).find((row) => String(row._id) === SHAPE).projectId).toEqual([launch.id, made.id]);
    });

    it('takes the name sent, a key of its own, and the person who made it as its owner', async () => {
        const template = await saved();
        const made = madeFrom(await use(template._id, {}, { uid: ADMIN }));
        expect(made.project).toMatchObject({ ProjectName: 'Autumn launch', projectCreatedBy: ADMIN, LeadUserId: [ADMIN], deletedStatusKey: 0, lastTaskId: 0, isPrivateSpace: false });
        expect(made.project.ProjectCode).toMatch(/^[A-Z0-9]{2,6}$/);
        expect(made.project.ProjectCode).not.toBe('LAU');
        expect(made.project.AssigneeUserId).toEqual([ADMIN]);
        expect(String(made.project.CompanyId)).toBe(C);
        expect(stepProjectCount.mock.calls).toEqual([[C, false, 1]]);
        expect(recordProjectCreated).toHaveBeenCalledWith(expect.objectContaining({ companyId: C, actorId: ADMIN }));
    });

    it('has ids of its own everywhere: nothing in it names the source or the template', async () => {
        const tree = seedTree(launch);
        seedRule(launch);
        const template = await saved({ include: EVERYTHING });
        const head = headOf(template);
        const templateIds = [
            String(template._id), String(head.snapshot.project._id),
            ...head.snapshot.folders.map((row) => String(row._id)), ...head.snapshot.lists.map((row) => String(row._id)),
            ...storedTasks(template).map((row) => String(row._id)),
        ];
        const res = await use(template._id);
        const made = madeFrom(res);
        const rule = rowsOf(SCHEMA_TYPE.AUTOMATION_RULES).find((row) => String(row.scope.projectIds[0]) === made.id);
        const written = JSON.stringify([made.project, made.folders, made.lists, made.tasks, rule, res.body.data]);
        [...sourceIdsOf(launch, tree), ...templateIds].forEach((id) => expect(written).not.toContain(id));
        const ids = [made.project, ...made.folders, ...made.lists, ...made.tasks].map((row) => String(row._id));
        expect(new Set(ids).size).toBe(ids.length);
        expect(made.tasks).toHaveLength(4);
    });

    it('gets its dates relative to its own start', async () => {
        seedTree(launch);
        const template = await saved({ include: { ...WITH_TASKS, dates: true } });
        const made = madeFrom(await use(template._id, { startDate: '2026-06-01' }));
        const top = byName(made.tasks, 'Draw the set', 'TaskName');
        expect(iso(made.project.StartDate)).toBe(iso('2026-06-01'));
        expect(iso(made.project.DueDate)).toBe(iso('2026-07-26'));
        expect(iso(top.DueDate)).toBe(iso('2026-07-07'));
        expect(iso(top.startDate)).toBe(iso('2026-06-28'));
        expect(top.dueDateDeadLine.map((entry) => iso(entry.date))).toEqual([iso('2026-07-05')]);
        expect(iso(byName(made.lists, 'Wireframes').startDate)).toBe(iso('2026-06-08'));
        expect(iso(byName(made.lists, 'Wireframes').endDate)).toBe(iso('2026-06-22'));
        expect(byName(made.tasks, 'Kickoff', 'TaskName').DueDate).toBeUndefined();
    });

    it('starts today when no start is sent, and has no dates when they are not wanted', async () => {
        seedTree(launch);
        const template = await saved({ include: { ...WITH_TASKS, dates: true } });
        const days = [Date.now(), 0].map((at) => at - (at % DAY));
        const today = madeFrom(await use(template._id));
        days[1] = Date.now() - (Date.now() % DAY);
        expect(days.map((day) => iso(day + 36 * DAY))).toContain(iso(byName(today.tasks, 'Draw the set', 'TaskName').DueDate));
        expect(days.map(iso)).toContain(iso(today.project.StartDate));

        const undated = madeFrom(await use(template._id, { name: 'Undated', include: { ...EVERYTHING, dates: false } }));
        expect(undated.project.DueDate).toBeFalsy();
        expect(byName(undated.tasks, 'Draw the set', 'TaskName').DueDate).toBeUndefined();
        expect(byName(undated.lists, 'Wireframes').startDate).toBeUndefined();
    });

    it('starts every task in the first status with its checklist unticked', async () => {
        seedTree(launch);
        const template = await saved({ include: WITH_TASKS });
        const top = byName(madeFrom(await use(template._id)).tasks, 'Draw the set', 'TaskName');
        expect(top).toMatchObject({ status: { key: 1, text: 'To Do', type: 'default_active' }, statusKey: 1, statusType: 'default_active' });
        expect(top.checklistArray).toEqual([{ id: 'c1', name: 'Grid', isChecked: false, AssigneeUserId: [] }]);
    });

    it('has the tasks only when the template has them and they are asked for', async () => {
        seedTree(launch);
        const withTasks = await saved({ include: WITH_TASKS });
        expect(madeFrom(await use(withTasks._id, { include: STRUCTURE_ONLY })).tasks).toHaveLength(0);
        const without = await saved({ name: 'No tasks' });
        const res = await use(without._id, { name: 'Empty' });
        expect(madeFrom(res).tasks).toHaveLength(0);
        expect(res.body.data.counts.tasks).toBe(0);
    });

    it('gets its automations switched off, pointed at the new project, and says so', async () => {
        const source = seedRule(launch);
        const template = await saved({ include: { ...STRUCTURE_ONLY, automations: true } });
        const res = await use(template._id);
        const made = madeFrom(res);
        const copied = rowsOf(SCHEMA_TYPE.AUTOMATION_RULES).filter((row) => String(row._id) !== String(source._id));
        expect(copied).toHaveLength(1);
        expect(copied[0]).toMatchObject({ name: 'Close out', enabled: false, createdBy: OWNER, scope: { allProjects: false, projectIds: [made.id] }, stats: {} });
        expect(copied[0].conditions).toEqual({ all: [{ field: 'status', value: `${made.id}:3` }] });
        expect(copied[0].steps).toEqual([{ id: 's1', type: 'move', sprintId: String(byName(made.lists, 'Wireframes')._id) }]);
        expect(res.body.data.counts.automations).toBe(1);
        expect(made.notes).toContainEqual({ code: 'automations_disabled', count: 1 });
        expect(rowsOf(SCHEMA_TYPE.AUTOMATION_RULES).find((row) => String(row._id) === String(source._id))).toMatchObject({ enabled: true });
    });

    it('has no automations when they are not asked for', async () => {
        seedRule(launch);
        const template = await saved({ include: { ...STRUCTURE_ONLY, automations: true } });
        const res = await use(template._id, { include: STRUCTURE_ONLY });
        expect(rowsOf(SCHEMA_TYPE.AUTOMATION_RULES)).toHaveLength(1);
        expect(res.body.data.counts.automations).toBe(0);
    });

    it('takes the key sent, and refuses one that is taken before anything is written', async () => {
        const template = await saved();
        expect(madeFrom(await use(template._id, { code: 'aut' })).project.ProjectCode).toBe('AUT');
        const res = await use(template._id, { name: 'Again', code: 'LAU' });
        expect(refused(res, 400)).toMatch(/key/i);
        expect(rowsOf(SCHEMA_TYPE.PROJECTS).filter((row) => row.ProjectName === 'Again')).toHaveLength(0);
        expect(stepProjectCount).toHaveBeenCalledTimes(1);
    });

    it('is private when asked, with the person who made it on it', async () => {
        const template = await saved();
        const made = madeFrom(await use(template._id, { isPrivate: true }, { uid: ADMIN }));
        expect(made.project).toMatchObject({ isPrivateSpace: true, AssigneeUserId: [ADMIN] });
        expect(stepProjectCount).toHaveBeenCalledWith(C, true, 1);
    });

    it('can be made again and again from the same template', async () => {
        seedTree(launch);
        const template = await saved({ include: WITH_TASKS });
        const first = madeFrom(await use(template._id));
        const second = madeFrom(await use(template._id, { name: 'Winter launch' }));
        expect(second.project.ProjectCode).not.toBe(first.project.ProjectCode);
        expect(second.tasks).toHaveLength(4);
        expect(second.tasks.map((task) => task.TaskKey).sort()).toEqual([1, 2, 3, 4].map((n) => `${second.project.ProjectCode}-${n}`));
    });
});

describe('what a template names that is no longer there', () => {
    it('is a person: left off the tasks, and the answer says how many', async () => {
        seedTree(launch);
        const template = await saved({ include: { ...WITH_TASKS, assignees: true } });
        rowsOf(SCHEMA_TYPE.COMPANY_USERS).find((row) => row.userId === MEMBER).isDelete = true;
        const made = madeFrom(await use(template._id));
        const top = byName(made.tasks, 'Draw the set', 'TaskName');
        expect(top.AssigneeUserId).toEqual([]);
        expect(top.checklistArray[0].AssigneeUserId).toEqual([]);
        expect(made.project.AssigneeUserId).toEqual([OWNER]);
        expect(made.notes).toContainEqual({ code: 'people_skipped', count: 1 });
    });

    it('is nobody: the people come along when asked for', async () => {
        seedTree(launch);
        const template = await saved({ include: { ...WITH_TASKS, assignees: true } });
        const made = madeFrom(await use(template._id, {}, { uid: ADMIN }));
        expect(byName(made.tasks, 'Draw the set', 'TaskName').AssigneeUserId).toEqual([MEMBER]);
        expect([...made.project.AssigneeUserId].sort()).toEqual([OWNER, ADMIN, MEMBER].sort());
        expect(made.notes.map((note) => note.code)).not.toContain('people_skipped');
        const alone = madeFrom(await use(template._id, { name: 'Alone', include: { ...EVERYTHING, assignees: false } }, { uid: ADMIN }));
        expect(byName(alone.tasks, 'Draw the set', 'TaskName').AssigneeUserId).toEqual([]);
        expect(alone.project.AssigneeUserId).toEqual([ADMIN]);
    });

    it('is a status: left out of the project, and the answer says how many', async () => {
        const template = await saved();
        seed(SCHEMA_TYPE.SETTINGS, { name: settingsCollectionDocs.TASK_STATUS, settings: [{ key: 1, name: 'To Do' }, { key: 2, name: 'Review', isDeleted: true }] });
        const made = madeFrom(await use(template._id));
        expect(made.project.taskStatusData.map((status) => status.key)).toEqual([1]);
        expect(made.notes).toContainEqual({ code: 'statuses_skipped', count: 2 });
    });

    it('is a custom field: not linked, its values left off, and the answer says how many', async () => {
        seedTree(launch);
        const template = await saved({ include: WITH_TASKS });
        db().store[SCHEMA_TYPE.CUSTOM_FIELDS] = [];
        const res = await use(template._id);
        const made = madeFrom(res);
        expect(res.body.data.sharedFields).toEqual([]);
        expect(byName(made.tasks, 'Draw the set', 'TaskName').customField || {}).toEqual({});
        expect(made.notes).toContainEqual({ code: 'fields_skipped', count: 1 });
    });
});

/* The stand-in database keeps any field; the real collections are strict and drop what their schema does not declare. */
describe('what is written fits the schemas', () => {
    const { checkType } = jest.requireActual('../utils/mongo-handler/mongoQueries');
    const models = {};
    const modelOf = (type) => {
        models[type] = models[type] || mongoose.model(`template_fit_${type}`, checkType(type));
        return models[type];
    };
    const TYPES = [
        SCHEMA_TYPE.PROJECT_SNAPSHOTS, SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.FOLDERS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.TASKS,
        SCHEMA_TYPE.AUTOMATION_RULES, SCHEMA_TYPE.PROJECT_RULES, SCHEMA_TYPE.IMPORT_JOBS,
    ];

    it('with nothing dropped and nothing missing, in the template and in the project made from it', async () => {
        seedTree(launch);
        for (let i = 0; i <= INLINE_TASK_LIMIT; i += 1) seedTask(launch, launch.backlog, { TaskName: `Bulk ${i}` });
        Object.assign(rowsOf(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === launch.id), {
            isGlobalPermission: false, ProjectCurrency: { code: 'USD' }, ProjectType: 'fixed',
            projectStatusData: [{ key: 1, value: 'active' }], status: 'active', statusType: 'active', ProjectRequiredDefaultComponent: 'ListView',
        });
        seed(SCHEMA_TYPE.PROJECT_RULES, { key: 'task', name: 'Task', isParent: true, projectId: launch.id, roles: [{ key: MEMBER_ROLE, permission: true }] });
        seedRule(launch);
        const template = await saved({ description: 'How we launch', include: EVERYTHING });
        expect((await run(EDIT, { id: template._id, body: { name: 'Launch plan v2' } })).statusCode).toBe(200);
        expect((await use(template._id, { startDate: '2026-06-01' })).body.status).toBe(true);

        const written = db().calls
            .filter((call) => TYPES.includes(call.type) && ['save', 'insertMany'].includes(call.method))
            .flatMap((call) => (call.method === 'save' ? [call.data] : call.data[0]).map((doc) => [call.type, doc]));
        expect([...new Set(written.map(([type]) => type))].sort()).toEqual([...TYPES].sort());
        written.forEach(([type, doc]) => {
            const cast = new (modelOf(type))(doc);
            expect([type, cast.validateSync() || null]).toEqual([type, null]);
            const kept = cast.toObject({ minimize: false });
            expect([type, Object.keys(doc).filter((key) => doc[key] !== undefined && !(key in kept))]).toEqual([type, []]);
        });
        const edits = db().calls.filter((call) => call.type === SCHEMA_TYPE.PROJECT_SNAPSHOTS && call.method === 'updateOne').flatMap((call) => Object.keys(call.data[1].$set));
        const declared = Object.keys(checkType(SCHEMA_TYPE.PROJECT_SNAPSHOTS).paths);
        expect(edits.filter((key) => !declared.includes(key))).toEqual([]);
    });
});

describe('a large template', () => {
    const big = () => { for (let i = 0; i <= INLINE_TASK_LIMIT; i += 1) seedTask(launch, launch.backlog, { TaskName: `Bulk ${i}` }); };

    it('is stored in rows of bounded size', async () => {
        big();
        const template = await saved({ include: WITH_TASKS });
        const parts = stored().filter((row) => row.kind === 'tasks');
        expect(parts.length).toBeGreaterThanOrEqual(4);
        expect(Math.max(...parts.map((row) => row.tasks.length))).toBeLessThanOrEqual(TASKS_PER_ROW);
        expect(parts.map((row) => row.part)).toEqual(parts.map((unused, at) => at));
        expect(template.counts.tasks).toBe(INLINE_TASK_LIMIT + 1);
    });

    it('answers with the structure and a job, adds the tasks after, and reports progress as a duplicate does', async () => {
        big();
        const template = await saved({ include: WITH_TASKS });
        const res = await use(template._id, {}, { wait: false });
        expect(res.body).toMatchObject({ status: true, data: { counts: { folders: 2, lists: 3 }, job: { status: 'processing', total: INLINE_TASK_LIMIT + 1 } } });
        const id = String(res.body.data.project._id);
        expect(inProject(SCHEMA_TYPE.TASKS, id, 'ProjectID').length).toBeLessThan(INLINE_TASK_LIMIT + 1);

        await settle();
        expect(inProject(SCHEMA_TYPE.TASKS, id, 'ProjectID')).toHaveLength(INLINE_TASK_LIMIT + 1);
        const progress = await run(PROGRESS, { id });
        expect(progress.body).toMatchObject({ status: true, data: { status: 'done', total: INLINE_TASK_LIMIT + 1, processed: INLINE_TASK_LIMIT + 1, created: INLINE_TASK_LIMIT + 1 } });
        const inserts = db().calls.filter((call) => call.type === SCHEMA_TYPE.TASKS && call.method === 'insertMany').map((call) => call.data[0].length);
        expect(Math.max(...inserts)).toBeLessThanOrEqual(100);
    });
});

describe('a project that fails part way', () => {
    it('leaves nothing behind and gives the count back', async () => {
        seedTree(launch);
        const template = await saved({ include: WITH_TASKS });
        const real = db().crud.getMockImplementation();
        db().crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === SCHEMA_TYPE.TASKS && method === 'insertMany') throw new Error('disk full');
            return real(companyId, query, method);
        });
        const res = await use(template._id);
        refused(res, 500);
        expect(stepProjectCount.mock.calls).toEqual([[C, false, 1], [C, false, -1]]);
        expect(rowsOf(SCHEMA_TYPE.PROJECTS).filter((row) => row.ProjectName === 'Autumn launch')).toHaveLength(0);
        expect(rowsOf(SCHEMA_TYPE.FOLDERS)).toHaveLength(2);
        expect(rowsOf(SCHEMA_TYPE.SPRINTS)).toHaveLength(3);
        expect(rowsOf(SCHEMA_TYPE.CUSTOM_FIELDS).find((row) => String(row._id) === SHAPE).projectId).toEqual([launch.id]);
    });
});

describe('the request to use a template', () => {
    let template;
    beforeEach(async () => { template = await saved(); });
    const bad = async (body) => {
        const res = await run(USE, { id: template._id, body });
        expect(rowsOf(SCHEMA_TYPE.PROJECTS)).toHaveLength(1);
        return refused(res, 400);
    };

    it('needs a name and the four choices', async () => {
        expect(await bad({ include: EVERYTHING })).toMatch(/name/i);
        expect(await bad({ name: 'Autumn launch' })).toMatch(/include/i);
        expect(await bad({ name: 'Autumn launch', include: { ...EVERYTHING, dates: 1 } })).toMatch(/include\.dates/);
    });

    it('takes a start that is a date, a key of letters and digits, and privacy as a boolean', async () => {
        expect(await bad({ name: 'Autumn launch', include: EVERYTHING, startDate: 'soon' })).toMatch(/startDate/);
        expect(await bad({ name: 'Autumn launch', include: EVERYTHING, startDate: '+275760-09-13T00:00:00.000Z' })).toMatch(/startDate/);
        expect(await bad({ name: 'Autumn launch', include: EVERYTHING, code: 'A-1' })).toMatch(/code/);
        expect(await bad({ name: 'Autumn launch', include: EVERYTHING, code: 'ABCDEFGHIJK' })).toMatch(/code/);
        expect(await bad({ name: 'Autumn launch', include: EVERYTHING, isPrivate: 'yes' })).toMatch(/isPrivate/);
    });

    it('refuses a key it does not know', async () => {
        expect(await bad({ name: 'Autumn launch', include: EVERYTHING, projectCreatedBy: MEMBER })).toMatch(/projectCreatedBy/);
        expect(await bad({ name: 'Autumn launch', include: EVERYTHING, constructor: 1 })).toMatch(/constructor/);
        expect(await bad({ name: 'Autumn launch', include: { ...EVERYTHING, comments: true } })).toMatch(/include\.comments/);
    });

    it('answers 404 for a template that is not there, was deleted, or has a malformed id', async () => {
        refused(await use(oid()), 404);
        refused(await use('not-an-id'), 404);
        expect((await run(REMOVE, { id: template._id })).statusCode).toBe(200);
        refused(await use(template._id), 404);
    });
});

describe('the list of templates', () => {
    it('names each template with its description, counts, statuses and who made it, and never the snapshot', async () => {
        seedTree(launch);
        await saved({ description: 'How we launch', include: WITH_TASKS });
        await saved({ name: 'Another' }, { uid: ADMIN });
        const res = await list();
        expect(res.body.data.map((row) => row.name)).toEqual(['Another', 'Launch plan']);
        expect(res.body.data[1]).toMatchObject({
            name: 'Launch plan', description: 'How we launch', createdBy: OWNER, canManage: true,
            counts: { folders: 2, lists: 3, tasks: 4 }, include: WITH_TASKS,
        });
        expect(JSON.stringify(res.body.data)).not.toContain('snapshot');
        expect(JSON.stringify(res.body.data)).not.toContain('Draw the set');
    });

    it('leaves out the task rows and a deleted template', async () => {
        seedTree(launch);
        const template = await saved({ include: WITH_TASKS });
        expect((await list()).body.data).toHaveLength(1);
        const other = await saved({ name: 'Other', include: WITH_TASKS });
        const res = await run(REMOVE, { id: template._id });
        expect(res.body).toMatchObject({ status: true });
        expect((await list()).body.data.map((row) => row.name)).toEqual(['Other']);
        expect(headOf(template)).toMatchObject({ deletedStatusKey: 1, updatedBy: OWNER });
        const taskRowsOf = (owner) => stored().filter((row) => row.kind === 'tasks' && String(row.templateId) === String(owner._id));
        expect(taskRowsOf(template).length).toBeGreaterThan(0);
        taskRowsOf(template).forEach((row) => expect(row).toMatchObject({ deletedStatusKey: 1 }));
        taskRowsOf(other).forEach((row) => expect(row).toMatchObject({ deletedStatusKey: 0 }));
        expect(madeFrom(await use(other._id)).tasks).toHaveLength(4);
    });
});

describe('editing a template', () => {
    let template;
    beforeEach(async () => { template = await saved({ description: 'How we launch' }); });
    const edit = (body, options = {}) => run(EDIT, { ...options, id: template._id, body });

    it('renames it, rewrites the description and changes who it is offered to, one or all at once', async () => {
        expect((await edit({ name: '  Launch plan v2 ' })).body.data).toMatchObject({ name: 'Launch plan v2', description: 'How we launch' });
        expect((await edit({ description: '' })).body.data).toMatchObject({ name: 'Launch plan v2', description: '' });
        expect((await edit({ everyone: false, description: 'Ours' })).body.data).toMatchObject({ everyone: false, description: 'Ours' });
        expect(headOf(template)).toMatchObject({ name: 'Launch plan v2', description: 'Ours', everyone: false, updatedBy: OWNER });
    });

    it('refuses nothing to change, a bad value and a key it does not know, and leaves the snapshot alone', async () => {
        const before = JSON.stringify(headOf(template));
        expect(refused(await edit({}), 400)).toMatch(/name|description/i);
        expect(refused(await edit({ name: ' ' }), 400)).toMatch(/name/i);
        expect(refused(await edit({ everyone: 1 }), 400)).toMatch(/everyone/);
        expect(refused(await edit({ snapshot: {} }), 400)).toMatch(/snapshot/);
        expect(refused(await edit({ name: 'Fine', createdBy: MEMBER }), 400)).toMatch(/createdBy/);
        expect(JSON.stringify(headOf(template))).toBe(before);
    });
});

describe('telling the other clients', () => {
    const facts = (type) => socketEmitter.emit.mock.calls.filter(([event, payload]) => event === type && payload.module === 'projectSnapshots').map(([, payload]) => payload);

    it('emits the fact of a save, an edit and a delete, with the id and nothing of the content', async () => {
        const template = await saved({ description: 'How we launch' });
        await run(EDIT, { id: template._id, body: { name: 'Renamed' } });
        await run(REMOVE, { id: template._id });
        ['insert', 'update', 'delete'].forEach((type) => {
            expect(facts(type)).toEqual([{ type, companyId: C, module: 'projectSnapshots', data: { _id: String(template._id) } }]);
        });
    });

    it('emits nothing for a refused request or for a project made from a template', async () => {
        const template = await saved();
        socketEmitter.emit.mockClear();
        await run(EDIT, { id: template._id, body: {} });
        await use(template._id);
        expect(socketEmitter.emit.mock.calls.filter(([, payload]) => payload && payload.module === 'projectSnapshots')).toEqual([]);
    });

    it('relays only that the list changed, to the sockets of that company, for every kind of write', () => {
        jest.isolateModules(() => {
            const helper = require('../socket/helper');
            const emitter = require('../event/socketEventEmitter');
            const { relay, EVENT } = require('../socket/controller/projectTemplateSocket');
            const join = (companyId, socketId) => {
                const emit = jest.fn();
                const roomName = `selected_companies_${companyId}**${socketId}`;
                const socket = { id: socketId, rooms: new Set([roomName]), identity: { companyId, uid: OWNER } };
                helper.upsertRoom({ roomName, socketId, socket, namespace: { to: jest.fn(() => ({ emit })) } });
                return emit;
            };
            const mine = join(C, 's1');
            const theirs = join('c00000000000000000000002', 's2');
            relay({ type: 'insert', companyId: C, module: 'projectSnapshots', data: { _id: 'x', name: 'Launch plan' } });
            relay({ type: 'insert' });
            expect(mine.mock.calls).toEqual([[EVENT, { type: 'insert' }]]);
            expect(theirs).not.toHaveBeenCalled();
            expect(emitter.on.mock.calls.map(([event]) => event)).toEqual(['projectSnapshots:insert', 'projectSnapshots:update', 'projectSnapshots:delete']);
        });
    });
});

describe('who a template is for', () => {
    const seedRules = (grants) => {
        const parent = db().seed(SCHEMA_TYPE.RULES, { key: 'project', isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        Object.entries(grants).forEach(([path, permission]) => {
            db().seed(SCHEMA_TYPE.RULES, { key: path.split('.')[1], isParent: false, parentId: String(parent._id), roles: [{ key: MEMBER_ROLE, permission }] });
        });
    };
    const names = async (uid) => (await list({ uid })).body.data.map((row) => row.name);
    const secretProject = () => seedLaunch({ ProjectName: 'Secret', ProjectCode: 'SEC', isPrivateSpace: true, AssigneeUserId: [OWNER, MEMBER] });

    it('is not made from a personal list', async () => {
        const personal = seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'My list', ProjectCode: 'ME', isPersonal: true, personalOwner: OWNER, isPrivateSpace: true, AssigneeUserId: [OWNER], deletedStatusKey: 0 });
        expect(refused(await save(String(personal._id)), 400)).toMatch(/personal list/i);
        expect(stored()).toHaveLength(0);
    });

    it('needs the permission to create a project to save one, to list them and to use one', async () => {
        const template = await saved({ everyone: true });
        process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
        seedRules({ 'project.project_create': false });
        for (const res of [await save(launch.id, { name: 'Mine' }, { uid: MEMBER }), await list({ uid: MEMBER }), await use(template._id, {}, { uid: MEMBER })]) {
            expect(refused(res, 403)).toMatch(/permission/i);
            expect(res.body.permission).toBe('project.project_create');
        }
        expect(stored()).toHaveLength(1);
        expect(rowsOf(SCHEMA_TYPE.PROJECTS)).toHaveLength(1);
    });

    it('is saved and used by a member who holds that permission', async () => {
        process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
        seedRules({ 'project.project_create': true });
        const { template } = (await save(launch.id, {}, { uid: MEMBER })).body.data;
        expect(template).toMatchObject({ createdBy: MEMBER, canManage: true });
        expect(madeFrom(await use(template._id, {}, { uid: MEMBER })).project.projectCreatedBy).toBe(MEMBER);
    });

    it('is not made from a project the caller cannot open, a project in the trash or one that is not there', async () => {
        const secret = seedLaunch({ ProjectName: 'Secret', ProjectCode: 'SEC', isPrivateSpace: true, AssigneeUserId: [OWNER] });
        refused(await save(secret.id, {}, { uid: OUTSIDER }), 404);
        refused(await save(oid()), 404);
        refused(await save('not-an-id'), 404);
        rowsOf(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === launch.id).deletedStatusKey = 1;
        refused(await save(launch.id), 404);
        expect(stored()).toHaveLength(0);
    });

    it('from a private project is offered to the person who saved it, owners and admins', async () => {
        const secret = secretProject();
        const { template } = (await save(secret.id, { name: 'Secret plan' }, { uid: MEMBER })).body.data;
        expect(template).toMatchObject({ everyone: false, sourcePrivate: true });
        expect(await names(MEMBER)).toEqual(['Secret plan']);
        expect(await names(OWNER)).toEqual(['Secret plan']);
        expect(await names(ADMIN)).toEqual(['Secret plan']);
        expect(await names(OUTSIDER)).toEqual([]);
        refused(await use(template._id, {}, { uid: OUTSIDER }), 404);
        refused(await run(EDIT, { uid: OUTSIDER, id: template._id, body: { name: 'Mine' } }), 404);
        refused(await run(REMOVE, { uid: OUTSIDER, id: template._id }), 404);
        expect(rowsOf(SCHEMA_TYPE.PROJECTS).filter((row) => row.ProjectName === 'Autumn launch')).toHaveLength(0);
        expect(headOf(template)).toMatchObject({ name: 'Secret plan', deletedStatusKey: 0 });
    });

    it('from a private project is offered to everyone who can create projects once the person who saved it says so', async () => {
        const secret = secretProject();
        const { template } = (await save(secret.id, { name: 'Secret plan', everyone: true }, { uid: MEMBER })).body.data;
        expect(await names(OUTSIDER)).toEqual(['Secret plan']);
        const made = madeFrom(await use(template._id, {}, { uid: OUTSIDER }));
        expect(made.project).toMatchObject({ isPrivateSpace: true, AssigneeUserId: [OUTSIDER] });
        expect((await run(EDIT, { uid: MEMBER, id: template._id, body: { everyone: false } })).statusCode).toBe(200);
        expect(await names(OUTSIDER)).toEqual([]);
    });

    it('from a public project is offered to everyone unless the person who saved it says otherwise', async () => {
        expect(await saved({}, { uid: MEMBER })).toMatchObject({ everyone: true, sourcePrivate: false });
        expect(await saved({ name: 'Kept close', everyone: false }, { uid: MEMBER })).toMatchObject({ everyone: false });
        expect(await names(OUTSIDER)).toEqual(['Launch plan']);
        expect(await names(MEMBER)).toEqual(['Kept close', 'Launch plan']);
    });

    it('that holds a private list of a public project starts out not offered to everyone', async () => {
        expect(await saved()).toMatchObject({ everyone: false, sourcePrivate: true });
        expect(await names(OUTSIDER)).toEqual([]);
    });

    it('keeps a private list only when the person saving is on it, whatever their role, and says what was left', async () => {
        seedTree(launch);
        for (const uid of [MEMBER, ADMIN]) {
            const res = await save(launch.id, { name: `By ${uid}`, include: WITH_TASKS }, { uid });
            const { template, notes } = res.body.data;
            expect(headOf(template).snapshot.lists.map((row) => row.name).sort()).toEqual(['Backlog', 'Wireframes']);
            expect(storedTasks(template).map((task) => task.TaskName)).toEqual(['Kickoff']);
            expect(notes).toContainEqual({ code: 'private_lists_left', count: 1 });
            expect(template).toMatchObject({ sourcePrivate: false, counts: { lists: 2, tasks: 1 } });
        }
        const mine = await saved({ name: 'By the owner', include: WITH_TASKS });
        expect(headOf(mine).snapshot.lists.map((row) => row.name).sort()).toEqual(['Backlog', 'Glyphs', 'Wireframes']);
        expect(storedTasks(mine)).toHaveLength(4);
    });

    it('gives a list that was private to the person who makes the project, and to nobody the template names', async () => {
        const template = await saved({ include: { ...WITH_TASKS, assignees: true } });
        expect(byName(headOf(template).snapshot.lists, 'Glyphs')).toMatchObject({ private: true, AssigneeUserId: [] });
        const made = madeFrom(await use(template._id, {}, { uid: ADMIN }));
        expect(byName(made.lists, 'Glyphs')).toMatchObject({ private: true, AssigneeUserId: [ADMIN] });
        expect(byName(made.lists, 'Backlog').private).toBe(false);
    });

    it('leaves a private list and its tasks out when it is offered to everyone, whoever saves it, and says so', async () => {
        seedTree(launch);
        launch.sprint('Hidden', { private: true, AssigneeUserId: [ADMIN] });
        const { template, notes } = (await save(launch.id, { everyone: true, include: { ...EVERYTHING } })).body.data;
        expect(template).toMatchObject({ everyone: true, sourcePrivate: false, counts: { lists: 2, tasks: 1 } });
        expect(notes).toEqual([{ code: 'private_lists_left', count: 2 }]);
        expect(headOf(template).snapshot.lists.map((row) => row.name).sort()).toEqual(['Backlog', 'Wireframes']);
        expect(storedTasks(template).map((task) => task.TaskName)).toEqual(['Kickoff']);
        const kept = JSON.stringify(stored());
        ['Glyphs', 'Hidden', 'Draw the set', 'Arrows', 'Arrow left'].forEach((text) => expect(kept).not.toContain(text));

        const kind = await saved({ name: 'Kept close', everyone: false, include: WITH_TASKS });
        expect(headOf(kind).snapshot.lists.map((row) => row.name).sort()).toEqual(['Backlog', 'Glyphs', 'Wireframes']);
        expect(storedTasks(kind)).toHaveLength(4);
    });

    it('made from a public project never hands the person using it a private list or what was in it', async () => {
        seedTree(launch);
        const template = await saved({ everyone: true, include: EVERYTHING });
        const res = await use(template._id, {}, { uid: MEMBER });
        const made = madeFrom(res);
        expect(made.lists.map((row) => row.name).sort()).toEqual(['Backlog', 'Wireframes']);
        expect(made.tasks.map((task) => task.TaskName)).toEqual(['Kickoff']);
        const reached = JSON.stringify([res.body, (await list({ uid: MEMBER })).body, made.project, made.folders, made.lists, made.tasks]);
        ['Glyphs', 'Draw the set', 'Arrows', 'Arrow left'].forEach((text) => expect(reached).not.toContain(text));
    });

    it('that holds a private list cannot be offered to everyone afterwards, by anyone, and says why', async () => {
        const template = await saved();
        const before = JSON.stringify(headOf(template));
        for (const uid of [OWNER, ADMIN]) {
            const res = await run(EDIT, { uid, id: template._id, body: { everyone: true, name: 'Shared' } });
            expect(res.statusCode).not.toBe(200);
            expect(JSON.stringify(headOf(template))).toBe(before);
        }
        expect(refused(await run(EDIT, { id: template._id, body: { everyone: true } }), 400)).toMatch(/includes a private list; save a new template without it/);
        expect(await names(OUTSIDER)).toEqual([]);
    });

    it('from a private project is offered to everyone by the person who saved it alone; owners and admins can take that back', async () => {
        const secret = secretProject();
        const { template } = (await save(secret.id, { name: 'Secret plan' }, { uid: MEMBER })).body.data;
        for (const uid of [OWNER, ADMIN]) {
            expect(refused(await run(EDIT, { uid, id: template._id, body: { everyone: true } }), 403)).toMatch(/person who saved/);
            expect(refused(await run(EDIT, { uid, id: template._id, body: { everyone: true, name: 'Ours now' } }), 403)).toMatch(/person who saved/);
        }
        expect(headOf(template)).toMatchObject({ everyone: false, name: 'Secret plan' });
        expect(await names(OUTSIDER)).toEqual([]);

        expect((await run(EDIT, { uid: MEMBER, id: template._id, body: { everyone: true } })).statusCode).toBe(200);
        expect(await names(OUTSIDER)).toEqual(['Secret plan']);
        expect((await run(EDIT, { uid: ADMIN, id: template._id, body: { everyone: true, description: 'Reviewed' } })).statusCode).toBe(200);
        expect((await run(EDIT, { uid: ADMIN, id: template._id, body: { everyone: false, name: 'Secret plan v2' } })).statusCode).toBe(200);
        expect(headOf(template)).toMatchObject({ everyone: false, name: 'Secret plan v2', description: 'Reviewed' });
        refused(await run(EDIT, { uid: ADMIN, id: template._id, body: { everyone: true } }), 403);
        expect((await run(REMOVE, { uid: ADMIN, id: template._id })).statusCode).toBe(200);
    });

    it('from a public project with no private list in it is offered to everyone by an owner or an admin too', async () => {
        const template = await saved({ everyone: false }, { uid: MEMBER });
        expect(template).toMatchObject({ everyone: false, sourcePrivate: false });
        expect((await run(EDIT, { uid: ADMIN, id: template._id, body: { everyone: true } })).statusCode).toBe(200);
        expect(await names(OUTSIDER)).toEqual(['Launch plan']);
    });

    it('is changed and deleted by the person who saved it, owners and admins, and by no other member', async () => {
        const template = await saved({ everyone: true }, { uid: MEMBER });
        const before = JSON.stringify(headOf(template));
        expect((await list({ uid: OUTSIDER })).body.data[0]).toMatchObject({ canManage: false });
        expect(refused(await run(EDIT, { uid: OUTSIDER, id: template._id, body: { name: 'Mine now' } }), 403)).toMatch(/permission/i);
        expect(refused(await run(EDIT, { uid: OUTSIDER, id: template._id, body: { everyone: false } }), 403)).toMatch(/permission/i);
        expect(refused(await run(REMOVE, { uid: OUTSIDER, id: template._id }), 403)).toMatch(/permission/i);
        expect(JSON.stringify(headOf(template))).toBe(before);

        expect((await run(EDIT, { uid: MEMBER, id: template._id, body: { name: 'By its maker' } })).statusCode).toBe(200);
        expect((await run(EDIT, { uid: ADMIN, id: template._id, body: { description: 'By an admin' } })).statusCode).toBe(200);
        expect(headOf(template)).toMatchObject({ name: 'By its maker', description: 'By an admin', updatedBy: ADMIN });
        expect((await run(REMOVE, { uid: OWNER, id: template._id })).statusCode).toBe(200);
        expect(await names(MEMBER)).toEqual([]);
    });

    it('holds automations only when saved by someone who manages them, and gives them only to someone who does', async () => {
        seedRule(launch);
        const byMember = (await save(launch.id, { name: 'By a member', include: { ...STRUCTURE_ONLY, automations: true } }, { uid: MEMBER })).body.data;
        expect(byMember.notes).toContainEqual({ code: 'automations_skipped', count: 1 });
        expect(byMember.template).toMatchObject({ include: { automations: false }, counts: { automations: 0 } });
        expect(headOf(byMember.template).snapshot.rules).toEqual([]);

        const byOwner = await saved({ everyone: true, include: { ...STRUCTURE_ONLY, automations: true } });
        const res = await use(byOwner._id, {}, { uid: MEMBER });
        expect(rowsOf(SCHEMA_TYPE.AUTOMATION_RULES)).toHaveLength(1);
        expect(res.body.data.notes).toContainEqual({ code: 'automations_skipped', count: 1 });
    });

    it('stays in its own company', async () => {
        const ELSEWHERE = 'c00000000000000000000002';
        db(ELSEWHERE).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
        const template = await saved({ everyone: true });
        expect((await list({ company: ELSEWHERE })).body.data).toEqual([]);
        refused(await use(template._id, {}, { company: ELSEWHERE }), 404);
        refused(await run(REMOVE, { company: ELSEWHERE, id: template._id }), 404);
        expect(rowsOf(SCHEMA_TYPE.PROJECTS, ELSEWHERE)).toHaveLength(0);
    });
});
