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
jest.mock('../Modules/CustomField/helpers/customFieldHistory', () => ({
    recordFieldCreated: jest.fn(() => Promise.resolve()),
    recordFieldRenamed: jest.fn(() => Promise.resolve()),
}));
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
const { removeCache } = require('../utils/commonFunctions');
const socketEmitter = require('../event/socketEventEmitter');
const { stepProjectCount } = require('../Modules/Project/helpers/projectQuota');
const { recordProjectCreated } = require('../Modules/Project/helpers/projectHistory');
const matcher = require('../Modules/Automations/engine/matcher');
const { INLINE_TASK_LIMIT } = require('../Modules/ProjectDuplicate/rules');

const C = 'c00000000000000000000001';
const ELSEWHERE = 'c00000000000000000000002';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const OUTSIDER = 'a00000000000000000000004';
const MEMBER_ROLE = 3;
const oid = () => new mongoose.Types.ObjectId().toString();
const asId = (id) => new mongoose.Types.ObjectId(String(id));

const routesOf = (init) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers.flat(); };
    init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });
    return table;
};
const routes = () => routesOf(require('../Modules/ProjectDuplicate/routes').init);
const fieldRoutes = () => routesOf(require('../Modules/CustomField/routes').init);

const settle = async () => { for (let i = 0; i < 200; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const run = async (route, { uid = OWNER, company = C, id, body, wait = true, table = routes() }) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    const req = verified({ uid, params: { id }, body, query: {}, headers: { companyid: company } });
    for (const handler of table[route]) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    if (wait) await settle();
    return res;
};

const DUPLICATE = 'POST /api/v2/projects/:id/duplicate';
const PROGRESS = 'GET /api/v2/projects/:id/duplicate';
const STRUCTURE_ONLY = { tasks: false, assignees: false, dates: false };
const duplicate = (id, body = {}, options = {}) => run(DUPLICATE, { ...options, id, body: { name: 'Launch (copy)', include: STRUCTURE_ONLY, ...body } });

const db = (company = C) => mockDbOf(company);
const rowsOf = (type, company = C) => db(company).store[type] || [];
const seed = (type, doc, company = C) => db(company).seed(type, { _id: oid(), ...doc });
const inProject = (type, projectId, field = 'projectId') => rowsOf(type).filter((row) => String(row[field]) === String(projectId));
const byName = (rows, name, field = 'name') => rows.find((row) => row[field] === name);

const seedCompany = (company) => {
    db(company).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    [MEMBER, OUTSIDER].forEach((userId) => db(company).seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: MEMBER_ROLE, status: 2, isDelete: false }));
};

const seedRules = (grants) => {
    const parent = db().seed(SCHEMA_TYPE.RULES, { key: 'project', isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
    Object.entries(grants).forEach(([path, permission]) => {
        db().seed(SCHEMA_TYPE.RULES, { key: path.split('.')[1], isParent: false, parentId: String(parent._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
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
        AssigneeUserId: [OWNER, MEMBER], LeadUserId: [OWNER], projectCreatedBy: OWNER,
        taskStatusData: STATUSES, taskTypeCounts: [{ key: 1, value: 'task', name: 'Task', taskCount: 4 }, { key: 2, value: 'bug', name: 'Bug', taskCount: 0 }],
        apps: ['Priority', 'CustomFields'], workingDays: [1, 2, 3, 4], lastTaskId: 4,
        StartDate: new Date('2026-01-05'), DueDate: new Date('2026-03-01'), deletedStatusKey: 0,
        favouriteTasks: [{ userId: MEMBER }], watchers: { [MEMBER]: true }, lastProjectActivity: new Date('2026-02-01'),
        ...extra,
    });
    const id = String(project._id);
    const folder = (name, more = {}) => String(seed(SCHEMA_TYPE.FOLDERS, { name, projectId: asId(id), deletedStatusKey: 0, ...more })._id);
    const list = (name, more = {}) => String(seed(SCHEMA_TYPE.SPRINTS, { name, projectId: asId(id), private: false, deletedStatusKey: 0, tasks: 0, ...more })._id);
    const design = folder('Design');
    const icons = folder('Icons', { parentFolderId: asId(design) });
    const backlog = list('Backlog');
    const wireframes = list('Wireframes', { folderId: asId(design) });
    const glyphs = list('Glyphs', { folderId: asId(icons), private: true, AssigneeUserId: [OWNER] });
    db().store[SCHEMA_TYPE.PROJECTS].find((row) => String(row._id) === id).ProjectRequiredComponent = [
        { id: 'view-list', keyName: 'ListView', name: 'List', settings: { groupBy: 'status', filters: [{ field: 'sprintId', value: wireframes }] } },
        { id: 'view-board', keyName: 'ProjectKanban', name: 'Board', settings: { groupBy: 'priority' } },
    ];
    return { id, design, icons, backlog, wireframes, glyphs, folder, list };
};

const seedTask = (launch, sprintId, doc = {}) => {
    const sprint = rowsOf(SCHEMA_TYPE.SPRINTS).find((row) => String(row._id) === String(sprintId));
    const folderRow = sprint.folderId && rowsOf(SCHEMA_TYPE.FOLDERS).find((row) => String(row._id) === String(sprint.folderId));
    sprint.tasks += 1;
    return seed(SCHEMA_TYPE.TASKS, {
        TaskName: 'Task', TaskKey: `LAU-${rowsOf(SCHEMA_TYPE.TASKS).length + 1}`, TaskType: 'task', TaskTypeKey: 1,
        ProjectID: asId(launch.id), CompanyId: asId(C), sprintId: asId(sprintId),
        sprintArray: { id: asId(sprintId), name: sprint.name, ...(folderRow ? { folderId: asId(folderRow._id), folderName: folderRow.name } : {}) },
        ...(folderRow ? { folderObjId: asId(folderRow._id) } : {}),
        status: { key: 1, text: 'To Do', type: 'default_active' }, statusKey: 1, statusType: 'default_active',
        Task_Priority: 'MEDIUM', Task_Leader: OWNER, isParentTask: true, ParentTaskId: '', deletedStatusKey: 0,
        AssigneeUserId: [], watchers: [], groupByStatusIndex: 0,
        ...doc,
    });
};

/* A task, a subtask and a sub-subtask in the private list, plus one task at the top of the project. */
const seedTree = (launch) => {
    const top = seedTask(launch, launch.glyphs, {
        TaskName: 'Draw the set', AssigneeUserId: [MEMBER], watchers: [MEMBER], subTasks: 1,
        DueDate: new Date('2026-02-10'), startDate: new Date('2026-02-01'), dueDateDeadLine: [{ date: '2026-02-08' }],
        checklistArray: [{ id: 'c1', name: 'Grid', isChecked: true, AssigneeUserId: [MEMBER] }],
        customField: { f00000000000000000000001: { fieldValue: 'Round' } }, tagsArray: ['brand'],
        attachments: [{ url: 'wasabi://launch/icon.png' }], links: [{ url: 'https://example.test/pr/1' }],
        completion: { badge: 'HUMAN' }, favouriteTasks: [{ userId: MEMBER }], totalEstimatedTime: 120, points: 5,
    });
    const middle = seedTask(launch, launch.glyphs, {
        TaskName: 'Arrows', isParentTask: false, ParentTaskId: String(top._id), ancestors: [String(top._id)], subTasks: 1, TaskType: 'bug', TaskTypeKey: 2,
    });
    const leaf = seedTask(launch, launch.glyphs, {
        TaskName: 'Arrow left', isParentTask: false, ParentTaskId: String(middle._id), ancestors: [String(top._id), String(middle._id)],
    });
    const loose = seedTask(launch, launch.backlog, { TaskName: 'Kickoff' });
    seed(SCHEMA_TYPE.COMMENTS, { taskId: asId(top._id), projectId: asId(launch.id), sprintId: asId(launch.glyphs), message: 'Looks good' });
    return { top, middle, leaf, loose };
};

const copyOf = (res) => {
    const id = String(res.body.data.project._id);
    const folders = inProject(SCHEMA_TYPE.FOLDERS, id);
    const lists = inProject(SCHEMA_TYPE.SPRINTS, id);
    const tasks = inProject(SCHEMA_TYPE.TASKS, id, 'ProjectID');
    const project = rowsOf(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === id);
    return { id, project, folders, lists, tasks };
};

const refused = (res, code) => {
    expect(res.statusCode).toBe(code);
    expect(res.body).toMatchObject({ status: false, statusText: expect.any(String) });
    return res.body.statusText;
};

const nothingCopied = () => {
    expect(rowsOf(SCHEMA_TYPE.PROJECTS).filter((row) => row.ProjectName === 'Launch (copy)')).toHaveLength(0);
};

let launch;
beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDbs = {};
    mockCompany = { planFeature: { project: null, maxPublicProject: null, maxPrivateProject: null }, projectCount: { projectCount: 1, publicCount: 1, privateCount: 0 } };
    seedCompany(C);
    seedCompany(ELSEWHERE);
    launch = seedLaunch();
});

afterEach(() => { delete process.env.PERMISSION_ENFORCEMENT_MODE; });

describe('the structure', () => {
    it('copies the folder, the subfolder and the list in each', async () => {
        const res = await duplicate(launch.id);
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true, data: { counts: { folders: 2, lists: 3, tasks: 0 }, job: null } });
        const copy = copyOf(res);
        const design = byName(copy.folders, 'Design');
        const icons = byName(copy.folders, 'Icons');
        expect(copy.folders).toHaveLength(2);
        expect(design.parentFolderId == null).toBe(true);
        expect(String(icons.parentFolderId)).toBe(String(design._id));
        expect(copy.lists.map((list) => list.name).sort()).toEqual(['Backlog', 'Glyphs', 'Wireframes']);
        expect(byName(copy.lists, 'Backlog').folderId == null).toBe(true);
        expect(String(byName(copy.lists, 'Wireframes').folderId)).toBe(String(design._id));
        expect(String(byName(copy.lists, 'Glyphs').folderId)).toBe(String(icons._id));
        copy.lists.forEach((list) => expect(list).toMatchObject({ tasks: 0, deletedStatusKey: 0 }));
    });

    it('gives every row a new id and leaves nothing in the copy pointing at the source', async () => {
        const tree = seedTree(launch);
        const rule = seed(SCHEMA_TYPE.AUTOMATION_RULES, {
            name: 'Close out', enabled: true, version: 2, scope: { allProjects: false, projectIds: [launch.id] },
            trigger: { type: 'event', event: 'task.status_changed' },
            steps: [{ id: 's1', type: 'move', sprintId: launch.wireframes, statusRef: `${launch.id}:3` }],
        });
        const res = await duplicate(launch.id, { include: { tasks: true, assignees: true, dates: true } });
        const copy = copyOf(res);
        const copiedRule = rowsOf(SCHEMA_TYPE.AUTOMATION_RULES).find((row) => String(row._id) !== String(rule._id));
        const sourceIds = [
            launch.id, launch.design, launch.icons, launch.backlog, launch.wireframes, launch.glyphs,
            ...Object.values(tree).map((task) => String(task._id)),
        ];
        const written = JSON.stringify([copy.project, copy.folders, copy.lists, copy.tasks, copiedRule, res.body.data]);
        sourceIds.forEach((id) => expect(written).not.toContain(id));
        const copiedIds = [copy.project, ...copy.folders, ...copy.lists, ...copy.tasks].map((row) => String(row._id));
        expect(new Set(copiedIds).size).toBe(copiedIds.length);
        expect(copy.tasks).toHaveLength(4);
    });

    it('keeps a private list private, with its people', async () => {
        const copy = copyOf(await duplicate(launch.id));
        expect(byName(copy.lists, 'Glyphs')).toMatchObject({ private: true, AssigneeUserId: [OWNER] });
        expect(byName(copy.lists, 'Backlog').private).toBe(false);
    });

    it('leaves behind a private list the caller is not on, with its tasks, and says so', async () => {
        seedTree(launch);
        const res = await duplicate(launch.id, { include: { tasks: true, assignees: false, dates: false } }, { uid: MEMBER });
        const copy = copyOf(res);
        expect(copy.lists.map((list) => list.name).sort()).toEqual(['Backlog', 'Wireframes']);
        expect(copy.folders.map((folder) => folder.name).sort()).toEqual(['Design', 'Icons']);
        expect(copy.tasks.map((task) => task.TaskName)).toEqual(['Kickoff']);
        expect(res.body.data.notes).toContainEqual({ code: 'private_lists_left', count: 1 });
        expect(res.body.data.counts).toMatchObject({ lists: 2, tasks: 1 });
    });

    it('leaves out a deleted folder and what was in it, and an archived list', async () => {
        const gone = launch.folder('Old', { deletedStatusKey: 1 });
        launch.list('Old list', { folderId: asId(gone), deletedStatusKey: 1 });
        launch.list('Parked', { deletedStatusKey: 2 });
        const copy = copyOf(await duplicate(launch.id));
        expect(copy.folders.map((folder) => folder.name).sort()).toEqual(['Design', 'Icons']);
        expect(copy.lists.map((list) => list.name).sort()).toEqual(['Backlog', 'Glyphs', 'Wireframes']);
    });

    it('puts a subfolder whose parent is not copied at the top, and says so', async () => {
        const gone = launch.folder('Old', { deletedStatusKey: 1 });
        launch.folder('Stray', { parentFolderId: asId(gone) });
        const res = await duplicate(launch.id);
        const stray = byName(copyOf(res).folders, 'Stray');
        expect(stray.parentFolderId == null).toBe(true);
        expect(res.body.data.notes).toContainEqual({ code: 'subfolder_moved_to_top', name: 'Stray' });
    });

    it('leaves the source as it was', async () => {
        seedTree(launch);
        const before = JSON.stringify([SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.FOLDERS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.TASKS].map((type) => rowsOf(type).filter((row) => [row._id, row.projectId, row.ProjectID].map(String).includes(launch.id))));
        const res = await duplicate(launch.id, { include: { tasks: true, assignees: true, dates: true } });
        expect(res.body.status).toBe(true);
        const after = JSON.stringify([SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.FOLDERS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.TASKS].map((type) => rowsOf(type).filter((row) => [row._id, row.projectId, row.ProjectID].map(String).includes(launch.id))));
        expect(after).toBe(before);
    });
});

describe('the project itself', () => {
    it('takes the name sent, a code of its own, and the caller as its owner', async () => {
        const res = await duplicate(launch.id, {}, { uid: MEMBER });
        const { project } = copyOf(res);
        expect(project).toMatchObject({ ProjectName: 'Launch (copy)', projectCreatedBy: MEMBER, LeadUserId: [MEMBER], deletedStatusKey: 0, lastTaskId: 0 });
        expect(project.ProjectCode).not.toBe('LAU');
        expect(project.ProjectCode).toMatch(/^[A-Z0-9]{2,6}$/);
        expect(String(project.CompanyId)).toBe(C);
    });

    it('carries the statuses, task types, apps, working days and shared views', async () => {
        const { project, lists } = copyOf(await duplicate(launch.id));
        expect(project.taskStatusData).toEqual(STATUSES);
        expect(project.taskTypeCounts.map((type) => [type.key, type.taskCount])).toEqual([[1, 0], [2, 0]]);
        expect(project.apps).toEqual(['Priority', 'CustomFields']);
        expect(project.workingDays).toEqual([1, 2, 3, 4]);
        expect(project.ProjectRequiredComponent.map((view) => view.keyName)).toEqual(['ListView', 'ProjectKanban']);
        expect(project.ProjectRequiredComponent[0].settings).toEqual({ groupBy: 'status', filters: [{ field: 'sprintId', value: String(byName(lists, 'Wireframes')._id) }] });
    });

    it('starts without the favourites, watchers and activity of the source', async () => {
        const { project } = copyOf(await duplicate(launch.id));
        expect(project.favouriteTasks || []).toEqual([]);
        expect(project.watchers || {}).toEqual({});
        expect(project.lastProjectActivity).toBeUndefined();
    });

    it('keeps the dates only when asked', async () => {
        expect(copyOf(await duplicate(launch.id)).project.DueDate).toBeFalsy();
        const dated = copyOf(await duplicate(launch.id, { name: 'Dated', include: { tasks: false, assignees: false, dates: true } })).project;
        expect(new Date(dated.DueDate).toISOString()).toBe(new Date('2026-03-01').toISOString());
        expect(new Date(dated.StartDate).toISOString()).toBe(new Date('2026-01-05').toISOString());
    });

    it('keeps a private project private with its people, and the caller among them', async () => {
        const secret = seedLaunch({ ProjectName: 'Secret', ProjectCode: 'SEC', isPrivateSpace: true, AssigneeUserId: [OWNER, MEMBER] });
        const { project } = copyOf(await duplicate(secret.id, {}, { uid: MEMBER }));
        expect(project.isPrivateSpace).toBe(true);
        expect([...project.AssigneeUserId].sort()).toEqual([OWNER, MEMBER].sort());
        expect(stepProjectCount).toHaveBeenCalledWith(C, true, 1);
    });

    it('links the project-level custom fields to the copy', async () => {
        const own = seed(SCHEMA_TYPE.CUSTOM_FIELDS, { fieldTitle: 'Shape', global: false, projectId: [launch.id] });
        const other = seed(SCHEMA_TYPE.CUSTOM_FIELDS, { fieldTitle: 'Elsewhere', global: false, projectId: [oid()] });
        const res = await duplicate(launch.id);
        const { id } = copyOf(res);
        expect(res.body.data.sharedFields).toEqual([String(own._id)]);
        expect(rowsOf(SCHEMA_TYPE.CUSTOM_FIELDS).find((row) => row._id === own._id).projectId).toEqual([launch.id, id]);
        expect(rowsOf(SCHEMA_TYPE.CUSTOM_FIELDS).find((row) => row._id === other._id).projectId).toHaveLength(1);
        expect(removeCache).toHaveBeenCalledWith(`customField:${C}`);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', { type: 'update', companyId: C, module: 'customFields' });
    });

    it('links a field that holds its one project as text', async () => {
        const own = seed(SCHEMA_TYPE.CUSTOM_FIELDS, { fieldTitle: 'Shape', global: false, projectId: launch.id });
        const { id } = copyOf(await duplicate(launch.id));
        const writes = db().calls.filter((call) => call.type === SCHEMA_TYPE.CUSTOM_FIELDS && ['updateOne', 'updateMany'].includes(call.method));
        expect(writes.map((call) => [call.method, Object.keys(call.data[1])[0]])).toEqual([['updateOne', '$set'], ['updateMany', '$addToSet']]);
        expect(writes[0].data[0]).toEqual({ _id: own._id, projectId: launch.id });
        expect(rowsOf(SCHEMA_TYPE.CUSTOM_FIELDS).find((row) => row._id === own._id).projectId).toEqual([launch.id, id]);
    });

    it('copies the permissions of a project that has its own', async () => {
        const own = seedLaunch({ ProjectName: 'Own rules', ProjectCode: 'OWN', isGlobalPermission: false });
        const parent = seed(SCHEMA_TYPE.PROJECT_RULES, { key: 'task', name: 'Task', isParent: true, projectId: own.id, roles: [{ key: MEMBER_ROLE, permission: true }] });
        seed(SCHEMA_TYPE.PROJECT_RULES, { key: 'task_create', name: 'Create', isParent: false, parentId: String(parent._id), projectId: own.id, roles: [{ key: MEMBER_ROLE, permission: false }] });
        const { id, project } = copyOf(await duplicate(own.id));
        const copied = rowsOf(SCHEMA_TYPE.PROJECT_RULES).filter((row) => String(row.projectId) === id);
        expect(project.isGlobalPermission).toBe(false);
        expect(copied.map((row) => row.key).sort()).toEqual(['task', 'task_create']);
        expect(byName(copied, 'task_create', 'key').parentId).toBe(String(byName(copied, 'task', 'key')._id));
        expect(byName(copied, 'task_create', 'key').roles).toEqual([{ key: MEMBER_ROLE, permission: false }]);
    });

    it('clears the project listing cache and records the creation, as creating a project does', async () => {
        const res = await duplicate(launch.id);
        expect(removeCache).toHaveBeenCalledWith('UserProjectData:', true);
        expect(recordProjectCreated).toHaveBeenCalledWith(expect.objectContaining({ companyId: C, actorId: OWNER, project: expect.objectContaining({ ProjectName: 'Launch (copy)' }) }));
        expect(stepProjectCount).toHaveBeenCalledWith(C, false, 1);
        expect(res.body.data.project.ProjectName).toBe('Launch (copy)');
    });
});

describe('automations', () => {
    const ruleFor = (projectIds, more = {}) => seed(SCHEMA_TYPE.AUTOMATION_RULES, {
        name: 'Close out', enabled: true, version: 2, deletedStatusKey: 0, scope: { allProjects: false, projectIds },
        trigger: { type: 'event', event: 'task.status_changed' }, conditions: { all: [{ field: 'status', value: `${launch.id}:3` }] },
        steps: [{ id: 's1', type: 'move', sprintId: launch.wireframes }], stats: { fired: 9 }, lastRunCount: 3, createdBy: MEMBER,
        ...more,
    });

    it('arrive switched off, pointed at the copy, and the answer says so', async () => {
        const source = ruleFor([launch.id]);
        const res = await duplicate(launch.id);
        const copy = copyOf(res);
        const copied = rowsOf(SCHEMA_TYPE.AUTOMATION_RULES).filter((row) => String(row._id) !== String(source._id));
        expect(copied).toHaveLength(1);
        expect(copied[0]).toMatchObject({ name: 'Close out', enabled: false, createdBy: OWNER, scope: { allProjects: false, projectIds: [copy.id] } });
        expect(copied[0].conditions).toEqual({ all: [{ field: 'status', value: `${copy.id}:3` }] });
        expect(copied[0].steps).toEqual([{ id: 's1', type: 'move', sprintId: String(byName(copy.lists, 'Wireframes')._id) }]);
        expect(copied[0].stats).toEqual({});
        expect(copied[0].lastRunCount || 0).toBe(0);
        expect(res.body.data.counts.automations).toBe(1);
        expect(res.body.data.notes).toContainEqual({ code: 'automations_disabled', count: 1 });
        expect(rowsOf(SCHEMA_TYPE.AUTOMATION_RULES).find((row) => String(row._id) === String(source._id))).toMatchObject({ enabled: true, scope: { projectIds: [launch.id] } });
        expect(matcher.invalidate).toHaveBeenCalledWith(C);
    });

    it('leaves alone a rule for every project, a rule for another project and a deleted rule', async () => {
        ruleFor([], { scope: { allProjects: true, projectIds: [] } });
        ruleFor([oid()]);
        ruleFor([launch.id], { deletedStatusKey: 1 });
        const res = await duplicate(launch.id);
        expect(rowsOf(SCHEMA_TYPE.AUTOMATION_RULES)).toHaveLength(3);
        expect(res.body.data.counts.automations).toBe(0);
        expect(res.body.data.notes.map((note) => note.code)).not.toContain('automations_disabled');
    });

    it('are not copied by someone who cannot manage automations, and the answer says so', async () => {
        ruleFor([launch.id]);
        const res = await duplicate(launch.id, {}, { uid: MEMBER });
        expect(res.body.status).toBe(true);
        expect(rowsOf(SCHEMA_TYPE.AUTOMATION_RULES)).toHaveLength(1);
        expect(res.body.data.notes).toContainEqual({ code: 'automations_skipped', count: 1 });
    });
});

describe('tasks', () => {
    it('are left behind unless asked for', async () => {
        seedTree(launch);
        const res = await duplicate(launch.id);
        expect(copyOf(res).tasks).toHaveLength(0);
        expect(res.body.data.counts.tasks).toBe(0);
    });

    it('keep their three levels, with the chains rebuilt on the new ids', async () => {
        seedTree(launch);
        const res = await duplicate(launch.id, { include: { tasks: true, assignees: false, dates: false } });
        const copy = copyOf(res);
        const top = byName(copy.tasks, 'Draw the set', 'TaskName');
        const middle = byName(copy.tasks, 'Arrows', 'TaskName');
        const leaf = byName(copy.tasks, 'Arrow left', 'TaskName');
        expect(res.body.data.counts.tasks).toBe(4);
        expect(top).toMatchObject({ isParentTask: true, subTasks: 1 });
        expect(top.ParentTaskId || '').toBe('');
        expect(top.ancestors || []).toEqual([]);
        expect(middle).toMatchObject({ isParentTask: false, ParentTaskId: String(top._id), ancestors: [String(top._id)], subTasks: 1 });
        expect(leaf).toMatchObject({ isParentTask: false, ParentTaskId: String(middle._id), ancestors: [String(top._id), String(middle._id)] });
        expect(leaf.subTasks || 0).toBe(0);
    });

    it('land in the copy of their list and folder', async () => {
        seedTree(launch);
        const copy = copyOf(await duplicate(launch.id, { include: { tasks: true, assignees: false, dates: false } }));
        const glyphs = byName(copy.lists, 'Glyphs');
        const icons = byName(copy.folders, 'Icons');
        const top = byName(copy.tasks, 'Draw the set', 'TaskName');
        const loose = byName(copy.tasks, 'Kickoff', 'TaskName');
        expect(String(top.sprintId)).toBe(String(glyphs._id));
        expect(String(top.folderObjId)).toBe(String(icons._id));
        expect(top.sprintArray).toMatchObject({ name: 'Glyphs', folderName: 'Icons' });
        expect(String(top.sprintArray.id)).toBe(String(glyphs._id));
        expect(String(top.sprintArray.folderId)).toBe(String(icons._id));
        expect(String(loose.sprintId)).toBe(String(byName(copy.lists, 'Backlog')._id));
        expect(loose.folderObjId == null).toBe(true);
        expect(glyphs.tasks).toBe(3);
        expect(byName(copy.lists, 'Backlog').tasks).toBe(1);
        expect(byName(copy.lists, 'Wireframes').tasks).toBe(0);
    });

    it('get keys of their own, counted on the copy', async () => {
        seedTree(launch);
        const copy = copyOf(await duplicate(launch.id, { include: { tasks: true, assignees: false, dates: false } }));
        const keys = copy.tasks.map((task) => task.TaskKey).sort();
        expect(keys).toEqual([1, 2, 3, 4].map((n) => `${copy.project.ProjectCode}-${n}`));
        expect(copy.project.lastTaskId).toBe(4);
        expect(copy.project.taskTypeCounts.map((type) => [type.key, type.taskCount])).toEqual([[1, 3], [2, 1]]);
    });

    it('keep the checklist, the field values, the tags and the estimate; not the files, links, comments or history', async () => {
        seedTree(launch);
        const copy = copyOf(await duplicate(launch.id, { include: { tasks: true, assignees: false, dates: false } }));
        const top = byName(copy.tasks, 'Draw the set', 'TaskName');
        expect(top).toMatchObject({
            customField: { f00000000000000000000001: { fieldValue: 'Round' } }, tagsArray: ['brand'], totalEstimatedTime: 120, points: 5,
            Task_Priority: 'MEDIUM', statusKey: 1, TaskType: 'task', TaskTypeKey: 1, Task_Leader: OWNER, deletedStatusKey: 0,
        });
        expect(top.checklistArray).toEqual([{ id: 'c1', name: 'Grid', isChecked: true, AssigneeUserId: [] }]);
        expect(top.attachments || []).toEqual([]);
        expect(top.links || []).toEqual([]);
        expect(top.completion).toBeUndefined();
        expect(top.favouriteTasks || []).toEqual([]);
        expect(rowsOf(SCHEMA_TYPE.COMMENTS)).toHaveLength(1);
        expect(rowsOf(SCHEMA_TYPE.HISTORY).filter((row) => copy.tasks.some((task) => String(task._id) === String(row.TaskId || row.taskId)))).toHaveLength(0);
    });

    it('carry a field value only where it still fits its field', async () => {
        const rating = String(seed(SCHEMA_TYPE.CUSTOM_FIELDS, { fieldTitle: 'Score', fieldType: 'rating', fieldRatingMax: 5, global: false, projectId: [launch.id] })._id);
        const people = String(seed(SCHEMA_TYPE.CUSTOM_FIELDS, { fieldTitle: 'Reviewers', fieldType: 'people', global: false, projectId: [launch.id] })._id);
        seedTask(launch, launch.backlog, { TaskName: 'Scored', customField: { [rating]: { fieldValue: 4, _id: rating }, [people]: { fieldValue: [MEMBER, oid()], _id: people } } });
        seedTask(launch, launch.backlog, { TaskName: 'Overscored', customField: { [rating]: { fieldValue: 9, _id: rating } } });
        const copy = copyOf(await duplicate(launch.id, { include: { tasks: true, assignees: false, dates: false } }));
        expect(byName(copy.tasks, 'Scored', 'TaskName').customField).toEqual({ [rating]: { fieldValue: 4, _id: rating }, [people]: { fieldValue: [MEMBER], _id: people } });
        expect(byName(copy.tasks, 'Overscored', 'TaskName').customField).toEqual({});
    });

    it('lose their people and dates unless asked for', async () => {
        seedTree(launch);
        const bare = byName(copyOf(await duplicate(launch.id, { include: { tasks: true, assignees: false, dates: false } })).tasks, 'Draw the set', 'TaskName');
        expect(bare.AssigneeUserId).toEqual([]);
        expect(bare.watchers).toEqual([]);
        expect(bare.DueDate).toBeUndefined();
        expect(bare.startDate).toBeUndefined();
        expect(bare.dueDateDeadLine || []).toEqual([]);

        const full = byName(copyOf(await duplicate(launch.id, { name: 'Full', include: { tasks: true, assignees: true, dates: true } })).tasks, 'Draw the set', 'TaskName');
        expect(full.AssigneeUserId).toEqual([MEMBER]);
        expect(full.watchers).toEqual([]);
        expect(new Date(full.DueDate).toISOString()).toBe(new Date('2026-02-10').toISOString());
        expect(new Date(full.startDate).toISOString()).toBe(new Date('2026-02-01').toISOString());
        expect(full.checklistArray[0].AssigneeUserId).toEqual([MEMBER]);
    });

    it('leave out a deleted task and the subtasks under it', async () => {
        const { top } = seedTree(launch);
        rowsOf(SCHEMA_TYPE.TASKS).find((row) => row._id === top._id).deletedStatusKey = 1;
        const res = await duplicate(launch.id, { include: { tasks: true, assignees: false, dates: false } });
        expect(copyOf(res).tasks.map((task) => task.TaskName)).toEqual(['Kickoff']);
        expect(res.body.data.notes).toContainEqual({ code: 'tasks_left_out', count: 2 });
    });

    it('stop at the third level when old rows go deeper', async () => {
        const { top, middle, leaf } = seedTree(launch);
        seedTask(launch, launch.glyphs, { TaskName: 'Too deep', isParentTask: false, ParentTaskId: String(leaf._id), ancestors: [top, middle, leaf].map((task) => String(task._id)) });
        const res = await duplicate(launch.id, { include: { tasks: true, assignees: false, dates: false } });
        const copy = copyOf(res);
        expect(copy.tasks.map((task) => task.TaskName).sort()).toEqual(['Arrow left', 'Arrows', 'Draw the set', 'Kickoff']);
        expect(byName(copy.tasks, 'Arrow left', 'TaskName').subTasks).toBe(0);
        expect(res.body.data.notes).toContainEqual({ code: 'tasks_left_out', count: 1 });
    });

    it('never fire the task-created event, a notification or a history line for a copied task', async () => {
        seedTree(launch);
        await duplicate(launch.id, { include: { tasks: true, assignees: true, dates: true } });
        expect(socketEmitter.emit).not.toHaveBeenCalled();
        expect(rowsOf(SCHEMA_TYPE.NOTIFICATIONS || 'notifications')).toHaveLength(0);
    });

    it('are written in bounded batches', async () => {
        for (let i = 0; i < 230; i += 1) seedTask(launch, launch.backlog, { TaskName: `Bulk ${i}` });
        const res = await duplicate(launch.id, { include: { tasks: true, assignees: false, dates: false } });
        expect(res.body.data).toMatchObject({ job: null, counts: { tasks: 230 } });
        const inserts = db().calls.filter((call) => call.type === SCHEMA_TYPE.TASKS && call.method === 'insertMany').map((call) => call.data[0].length);
        expect(inserts.length).toBeGreaterThanOrEqual(3);
        expect(Math.max(...inserts)).toBeLessThanOrEqual(100);
        expect(byName(copyOf(res).lists, 'Backlog').tasks).toBe(230);
    });
});

/* The stand-in database keeps any field; the real collections are strict and drop what their schema does not declare. */
describe('what is written fits the schemas', () => {
    const { checkType } = jest.requireActual('../utils/mongo-handler/mongoQueries');
    const models = {};
    const modelOf = (type) => {
        models[type] = models[type] || mongoose.model(`duplicate_fit_${type}`, checkType(type));
        return models[type];
    };
    const TYPES = [SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.FOLDERS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.TASKS, SCHEMA_TYPE.AUTOMATION_RULES, SCHEMA_TYPE.PROJECT_RULES, SCHEMA_TYPE.IMPORT_JOBS];

    it('with nothing dropped and nothing missing', async () => {
        seedTree(launch);
        for (let i = 0; i <= INLINE_TASK_LIMIT; i += 1) seedTask(launch, launch.backlog, { TaskName: `Bulk ${i}` });
        const own = rowsOf(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === launch.id);
        Object.assign(own, {
            isGlobalPermission: false, ProjectCurrency: { code: 'USD' }, ProjectType: 'fixed', projectIcon: { type: 'color', data: 'blue' },
            projectStatusData: [{ key: 1, value: 'active' }], status: 'active', statusType: 'active', ProjectRequiredDefaultComponent: 'ListView',
        });
        seed(SCHEMA_TYPE.PROJECT_RULES, { key: 'task', name: 'Task', isParent: true, projectId: launch.id, roles: [{ key: MEMBER_ROLE, permission: true }] });
        seed(SCHEMA_TYPE.AUTOMATION_RULES, { name: 'Close out', enabled: true, version: 2, scope: { allProjects: false, projectIds: [launch.id] }, trigger: { type: 'event', event: 'task.created' }, steps: [] });
        const res = await duplicate(launch.id, { include: { tasks: true, assignees: true, dates: true } });
        expect(res.body.status).toBe(true);

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
    });
});

describe('a large project', () => {
    const big = () => { for (let i = 0; i <= INLINE_TASK_LIMIT; i += 1) seedTask(launch, launch.backlog, { TaskName: `Bulk ${i}` }); };

    it('answers with the structure and a job, and copies the tasks after', async () => {
        big();
        const res = await duplicate(launch.id, { include: { tasks: true, assignees: false, dates: false } }, { wait: false });
        expect(res.body).toMatchObject({ status: true, data: { counts: { folders: 2, lists: 3 }, job: { status: 'processing', total: INLINE_TASK_LIMIT + 1 } } });
        const { id } = copyOf(res);
        expect(inProject(SCHEMA_TYPE.TASKS, id, 'ProjectID').length).toBeLessThan(INLINE_TASK_LIMIT + 1);

        await settle();
        expect(inProject(SCHEMA_TYPE.TASKS, id, 'ProjectID')).toHaveLength(INLINE_TASK_LIMIT + 1);
        const progress = await run(PROGRESS, { id });
        expect(progress.body).toMatchObject({ status: true, data: { status: 'done', total: INLINE_TASK_LIMIT + 1, processed: INLINE_TASK_LIMIT + 1, created: INLINE_TASK_LIMIT + 1 } });
    });

    it('answers the progress of a copy to the person who started it only', async () => {
        big();
        const { id } = copyOf(await duplicate(launch.id, { include: { tasks: true, assignees: false, dates: false } }));
        expect((await run(PROGRESS, { id, uid: MEMBER })).body).toMatchObject({ status: true, data: null });
        expect((await run(PROGRESS, { id: launch.id })).body).toMatchObject({ status: true, data: null });
    });

    it('marks the job failed when the copy breaks part way', async () => {
        big();
        const real = db().crud.getMockImplementation();
        let inserts = 0;
        db().crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === SCHEMA_TYPE.TASKS && method === 'insertMany') { inserts += 1; if (inserts === 2) throw new Error('disk full'); }
            return real(companyId, query, method);
        });
        const res = await duplicate(launch.id, { include: { tasks: true, assignees: false, dates: false } });
        const progress = await run(PROGRESS, { id: copyOf(res).id });
        expect(progress.body.data).toMatchObject({ status: 'failed', created: 100 });
    });
});

describe('who may duplicate', () => {
    it('refuses a personal list', async () => {
        const personal = seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'My list', ProjectCode: 'ME', isPersonal: true, personalOwner: OWNER, isPrivateSpace: true, AssigneeUserId: [OWNER], deletedStatusKey: 0 });
        const res = await duplicate(String(personal._id), { name: 'Launch (copy)' });
        expect(refused(res, 400)).toMatch(/personal list/i);
        nothingCopied();
        expect(stepProjectCount).not.toHaveBeenCalled();
    });

    it('refuses a member without the permission to create a project', async () => {
        process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
        seedRules({ 'project.project_create': false });
        const res = await duplicate(launch.id, {}, { uid: MEMBER });
        expect(refused(res, 403)).toMatch(/permission/i);
        expect(res.body.permission).toBe('project.project_create');
        nothingCopied();
    });

    it('lets a member with that permission duplicate a project they can open', async () => {
        process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
        seedRules({ 'project.project_create': true });
        const res = await duplicate(launch.id, {}, { uid: MEMBER });
        expect(res.body.status).toBe(true);
        expect(copyOf(res).project.projectCreatedBy).toBe(MEMBER);
    });

    it('answers 404 for a private project the caller is not on', async () => {
        const secret = seedLaunch({ ProjectName: 'Secret', ProjectCode: 'SEC', isPrivateSpace: true, AssigneeUserId: [OWNER] });
        const res = await duplicate(secret.id, {}, { uid: OUTSIDER });
        refused(res, 404);
        nothingCopied();
    });

    it('answers 404 for a project of another company, a project that is not there and a malformed id', async () => {
        const foreign = String(db(ELSEWHERE).seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Theirs', ProjectCode: 'THR', isPrivateSpace: false, deletedStatusKey: 0 })._id);
        refused(await duplicate(foreign), 404);
        refused(await duplicate(oid()), 404);
        refused(await duplicate('not-an-id'), 404);
        expect(rowsOf(SCHEMA_TYPE.PROJECTS, ELSEWHERE)).toHaveLength(1);
        nothingCopied();
    });

    it('answers 404 for a project in the trash', async () => {
        db().store[SCHEMA_TYPE.PROJECTS].find((row) => String(row._id) === launch.id).deletedStatusKey = 1;
        refused(await duplicate(launch.id), 404);
    });

    it('counts the copy as creating a project counts one, and like a create is held to no plan limit', async () => {
        Object.assign(mockCompany.planFeature, { project: 1, maxPublicProject: 1, maxPrivateProject: 0 });
        const res = await duplicate(launch.id);
        expect(res.body.status).toBe(true);
        expect(copyOf(res).project.ProjectName).toBe('Launch (copy)');
        expect(stepProjectCount.mock.calls).toEqual([[C, false, 1]]);
        expect(mockCompany.projectCount).toEqual({ projectCount: 2, publicCount: 2, privateCount: 0 });
    });

    it('gives the count back when the copy fails', async () => {
        const real = db().crud.getMockImplementation();
        db().crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === SCHEMA_TYPE.SPRINTS && method === 'insertMany') throw new Error('disk full');
            return real(companyId, query, method);
        });
        const res = await duplicate(launch.id);
        expect(res.body.status).toBe(false);
        expect(stepProjectCount.mock.calls).toEqual([[C, false, 1], [C, false, -1]]);
        nothingCopied();
        expect(inProject(SCHEMA_TYPE.FOLDERS, launch.id)).toHaveLength(2);
        expect(rowsOf(SCHEMA_TYPE.FOLDERS)).toHaveLength(2);
    });
});

describe('the request', () => {
    const bad = async (body) => {
        const res = await run(DUPLICATE, { id: launch.id, body });
        nothingCopied();
        return refused(res, 400);
    };

    it('needs a name', async () => {
        expect(await bad({ include: STRUCTURE_ONLY })).toMatch(/name/i);
        expect(await bad({ name: '   ', include: STRUCTURE_ONLY })).toMatch(/name/i);
        expect(await bad({ name: 42, include: STRUCTURE_ONLY })).toMatch(/name/i);
        expect(await bad({ name: 'x'.repeat(256), include: STRUCTURE_ONLY })).toMatch(/name/i);
    });

    it('needs the three choices as booleans', async () => {
        expect(await bad({ name: 'Launch (copy)' })).toMatch(/include/i);
        expect(await bad({ name: 'Launch (copy)', include: { tasks: 'yes', assignees: false, dates: false } })).toMatch(/include\.tasks/);
        expect(await bad({ name: 'Launch (copy)', include: { tasks: false, assignees: false } })).toMatch(/include\.dates/);
    });

    it('refuses a key it does not know', async () => {
        expect(await bad({ name: 'Launch (copy)', include: STRUCTURE_ONLY, owner: MEMBER })).toMatch(/owner/);
        expect(await bad({ name: 'Launch (copy)', include: { ...STRUCTURE_ONLY, comments: true } })).toMatch(/include\.comments/);
    });

    it('trims the name', async () => {
        const res = await run(DUPLICATE, { id: launch.id, body: { name: '  Launch two  ', include: STRUCTURE_ONLY } });
        expect(res.body.data.project.ProjectName).toBe('Launch two');
    });
});

/* The copy shares the definition of a project-level field with its source, so what one project does to the field must not reach the other. */
describe('a field shared with the copy', () => {
    const WITH_TASKS = { include: { tasks: true, assignees: false, dates: false } };
    const updateField = (id, updateObject, uid = OWNER) => run('PUT /api/v1/customField', {
        uid, table: fieldRoutes(), body: { type: 'updateOne', key: '$set', id: String(id), updateObject },
    });
    const takeOff = (id, projectId, uid = OWNER) => run('PUT /api/v1/customField', {
        uid, table: fieldRoutes(), body: { type: 'updateOne', key: '$set', id: String(id), removeProjects: [projectId] },
    });
    const definition = (id) => rowsOf(SCHEMA_TYPE.CUSTOM_FIELDS).find((row) => String(row._id) === String(id));
    const valuesIn = (projectId) => inProject(SCHEMA_TYPE.TASKS, projectId, 'ProjectID').map((task) => task.customField);

    let field;
    let copy;
    const shared = async (projectExtra = {}) => {
        launch = seedLaunch({ ProjectName: 'Fields', ProjectCode: 'FLD', ...projectExtra });
        field = String(seed(SCHEMA_TYPE.CUSTOM_FIELDS, { fieldTitle: 'Score', fieldType: 'rating', fieldRatingMax: 5, type: 'task', isDelete: true, global: false, projectId: [launch.id] })._id);
        seedTask(launch, launch.backlog, { TaskName: 'Scored', customField: { [field]: { fieldValue: 4, _id: field } } });
        copy = copyOf(await duplicate(launch.id, WITH_TASKS));
        expect(definition(field).projectId).toEqual([launch.id, copy.id]);
        expect(valuesIn(copy.id)).toEqual([{ [field]: { fieldValue: 4, _id: field } }]);
    };

    it('stays on the copy, with its values, when it is taken off the source', async () => {
        await shared();
        const res = await takeOff(field, launch.id);
        expect(res.statusCode).toBe(200);
        expect(definition(field)).toMatchObject({ fieldTitle: 'Score', fieldType: 'rating', isDelete: true, global: false, projectId: [copy.id] });
        expect(valuesIn(copy.id)).toEqual([{ [field]: { fieldValue: 4, _id: field } }]);
        expect(valuesIn(launch.id)).toEqual([{ [field]: { fieldValue: 4, _id: field } }]);
    });

    it('stays on the source, with its values, when it is taken off the copy', async () => {
        await shared();
        const res = await takeOff(field, copy.id);
        expect(res.statusCode).toBe(200);
        expect(definition(field)).toMatchObject({ fieldTitle: 'Score', isDelete: true, global: false, projectId: [launch.id] });
        expect(valuesIn(launch.id)).toEqual([{ [field]: { fieldValue: 4, _id: field } }]);
        expect(valuesIn(copy.id)).toEqual([{ [field]: { fieldValue: 4, _id: field } }]);
    });

    it('cannot be taken off, switched off or renamed for a project by someone who cannot open that project', async () => {
        await shared({ isPrivateSpace: true, AssigneeUserId: [OWNER, MEMBER] });
        rowsOf(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === copy.id).AssigneeUserId = [OWNER];
        const before = JSON.stringify(definition(field));
        for (const change of [{ projectId: [launch.id] }, { isDelete: false }, { fieldTitle: 'Mine now' }]) {
            const res = await updateField(field, change, MEMBER);
            expect([403, 404]).toContain(res.statusCode);
            expect(JSON.stringify(definition(field))).toBe(before);
        }
        expect([403, 404]).toContain((await takeOff(field, copy.id, MEMBER)).statusCode);
        expect(JSON.stringify(definition(field))).toBe(before);
        expect(valuesIn(copy.id)).toEqual([{ [field]: { fieldValue: 4, _id: field } }]);
    });

    it('is one definition: switching it off is for both projects, and no value is removed', async () => {
        await shared();
        const res = await updateField(field, { isDelete: false });
        expect(res.statusCode).toBe(200);
        expect(definition(field)).toMatchObject({ isDelete: false, projectId: [launch.id, copy.id] });
        expect(valuesIn(launch.id)).toEqual([{ [field]: { fieldValue: 4, _id: field } }]);
        expect(valuesIn(copy.id)).toEqual([{ [field]: { fieldValue: 4, _id: field } }]);
    });
});
