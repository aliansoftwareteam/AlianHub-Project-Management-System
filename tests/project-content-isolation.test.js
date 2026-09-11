const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const mockReached = (name) => jest.fn((req, res) => res.status(200).json({ status: true, reached: name }));
const mockModule = () => new Proxy({}, { get: (target, name) => { target[name] = target[name] || mockReached(String(name)); return target[name]; } });

jest.mock('../Modules/Project/controller/getProjectById', () => mockModule());
jest.mock('../Modules/Project/controller/getProjectList', () => mockModule());
jest.mock('../Modules/Project/controller/updateProject', () => mockModule());
jest.mock('../Modules/Project/controller/getSprintFolder', () => mockModule());
jest.mock('../Modules/Project/controller/updateSprint', () => mockModule());
jest.mock('../Modules/Project/controller/getProjectFilterData', () => mockModule());
jest.mock('../Modules/Project/controller/checklist', () => mockModule());
jest.mock('../Modules/Project/controller/tags', () => mockModule());
jest.mock('../Modules/Project/controller/getQueryFun', () => mockModule());
jest.mock('../Modules/Sprints/controller', () => mockModule());
jest.mock('../Modules/Sprints/burndown', () => mockModule());
jest.mock('../Modules/Sprints/hours', () => mockModule());
jest.mock('../Modules/Sprints/scrum', () => mockModule());
jest.mock('../Modules/Epics/controller', () => mockModule());
jest.mock('../Modules/Milestone/controller', () => mockModule());
jest.mock('../Modules/ProjectDashboard/controller', () => mockModule());
jest.mock('../Modules/Calendar/controller', () => mockModule());
jest.mock('../Modules/RecurringTasks/controller', () => mockModule());
jest.mock('../Modules/projectSetting/controller', () => mockModule());
jest.mock('../Modules/projectSetting/autoArchive', () => mockModule());
jest.mock('../Modules/projectSetting/estimationScale', () => mockModule());
jest.mock('../Modules/projectSetting/wipLimit', () => mockModule());
jest.mock('../Modules/projectRules/controller', () => mockModule());

const mockProvider = { configured: false, chat: jest.fn() };
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => mockProvider.configured,
    getProvider: () => ({ chat: mockProvider.chat }),
}));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MEMBER = 'a00000000000000000000003';
const MEMBER_ROLE = 3;

const oid = () => new mongoose.Types.ObjectId().toString();

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    res.set = jest.fn(() => res);
    return res;
};

const run = async (handlers, req) => {
    const res = response();
    for (const handler of handlers) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await new Promise((resolve) => setImmediate(resolve));
    return res;
};

const request = ({ uid = MEMBER, params = {}, body = {}, query = {} } = {}) => ({ uid, params, body, query, headers: { companyid: C } });

const seedRules = (grants = {}) => {
    const parents = {};
    const parentOf = (section) => {
        if (!parents[section]) parents[section] = mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        return parents[section];
    };
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parentOf(section)._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

const seedProject = (doc = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', isPrivateSpace: true, AssigneeUserId: [OWNER], isGlobalPermission: true, ...doc,
});

const seedIn = (type, field, pid, doc = {}) => String(mockDb.seed(type, { _id: oid(), [field]: pid, ...doc })._id);
const sprintIn = (pid, doc) => seedIn(SCHEMA_TYPE.SPRINTS, 'projectId', pid, doc);
const folderIn = (pid) => seedIn(SCHEMA_TYPE.FOLDERS, 'projectId', pid);
const epicIn = (pid) => seedIn(SCHEMA_TYPE.EPICS, 'ProjectID', pid);
const milestoneIn = (pid) => seedIn(SCHEMA_TYPE.MILESTONE, 'projectId', pid);
const definitionIn = (pid) => seedIn(SCHEMA_TYPE.RECURRING_TASKS, 'ProjectID', pid);
const taskIn = (pid) => seedIn(SCHEMA_TYPE.TASKS, 'ProjectID', pid);

const GRANTS = {
    'project.private_projects': 1,
    'project.project_sprint_create': true,
    'project.project_sprint_name_edit': true,
    'project.sprint_delete': true,
    'project.project_folder_create': true,
    'project.project_folder_name_edit': true,
    'project.project_milestone': true,
    'project.project_milestone_status_change': true,
    'task.task_create': true,
};

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ADMIN, roleType: 2 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE });
    mockProvider.configured = false;
    mockProvider.chat.mockReset();
});

const PROJECT = '../Modules/Project/routes';
const SPRINTS = '../Modules/Sprints/routes';
const EPICS = '../Modules/Epics/routes';
const MILESTONE = '../Modules/Milestone/routes';
const DASHBOARD = '../Modules/ProjectDashboard/routes';
const CALENDAR = '../Modules/Calendar/routes';
const RECURRING = '../Modules/RecurringTasks/routes';
const SETTINGS = '../Modules/projectSetting/routes';
const RULES = '../Modules/projectRules/routes';

const READS = [
    [PROJECT, 'GET /api/v1/project/:id', (pid) => ({ params: { id: pid } })],
    [PROJECT, 'GET /api/v1/project/sprintFolder/:id', (pid) => ({ params: { id: pid }, query: { collection: 'sprints' } })],
    [PROJECT, 'GET /api/v1/projectdata/taskData', (pid) => ({ query: { taskId: taskIn(pid), projectId: pid, subTaskLimit: 1 } })],
    [SPRINTS, 'POST /api/v2/sprints/burndown', (pid) => ({ body: { sprintId: sprintIn(pid) } })],
    [SPRINTS, 'POST /api/v2/sprints/hours', (pid) => ({ body: { sprintId: sprintIn(pid) } })],
    [SPRINTS, 'GET /api/v2/sprints/complete-preview', (pid) => ({ query: { sprintId: sprintIn(pid) } })],
    [SPRINTS, 'GET /api/v2/sprints/report', (pid) => ({ query: { sprintId: sprintIn(pid) } })],
    [SPRINTS, 'POST /api/v2/sprints/backlog', (pid) => ({ body: { projectId: pid } })],
    [EPICS, 'GET /api/v2/epics', (pid) => ({ query: { projectId: pid } })],
    [MILESTONE, 'GET /api/v1/milestone/project/:pid', (pid) => ({ params: { pid } })],
    [MILESTONE, 'GET /api/v1/milestone/:id', (pid) => ({ params: { id: milestoneIn(pid) } })],
    [MILESTONE, 'GET /api/v2/billing/contract', (pid) => ({ query: { projectId: pid } })],
    [MILESTONE, 'GET /api/v2/billing/hourly', (pid) => ({ query: { projectId: pid } })],
    [MILESTONE, 'GET /api/v2/billing/client-view', (pid) => ({ query: { projectId: pid } })],
    [DASHBOARD, 'GET /api/v1/project-dashboard/:projectId', (pid) => ({ params: { projectId: pid } })],
    [RECURRING, 'GET /api/v1/recurring-tasks/project/:pid', (pid) => ({ params: { pid } })],
    [SETTINGS, 'GET /api/v1/projectSetting/autoArchive/:pid', (pid) => ({ params: { pid } })],
    [RULES, 'GET /api/v1/projectRules/:pid', (pid) => ({ params: { pid } })],
];

const WRITES = [
    [PROJECT, 'PUT /api/v1/project/sprint/:id', (pid) => ({ params: { id: sprintIn(pid) }, body: { updateObject: { name: 'Renamed' } } })],
    [SPRINTS, 'POST /api/v2/sprints/scrum', (pid) => ({ body: { sprintId: sprintIn(pid), isScrum: true } })],
    [SPRINTS, 'POST /api/v2/sprints/start', (pid) => ({ body: { sprintId: sprintIn(pid) } })],
    [SPRINTS, 'POST /api/v2/sprints/complete', (pid) => ({ body: { sprintId: sprintIn(pid), incompleteDestination: 'next' } })],
    [SPRINTS, 'POST /api/v1/sprint', (pid) => ({ body: { projectId: pid, sprintName: 'Sprint 9' } })],
    [SPRINTS, 'PATCH /api/v1/sprint/:id', (pid) => { const id = sprintIn(pid); return { params: { id }, body: { type: 'editSprintName', prevData: { id }, sprintName: 'Renamed' } }; }],
    [SPRINTS, 'PATCH /api/v1/sprint/:id', (pid) => ({ params: { id: sprintIn(pid) }, body: { type: 'deleteChannel' } })],
    [SPRINTS, 'POST /api/v1/folder', (pid) => ({ body: { projectId: pid, folderName: 'Q3' } })],
    [SPRINTS, 'PATCH /api/v1/folder/:id', (pid) => ({ params: { id: folderIn(pid) }, body: { type: 'editFolderName', folderName: 'Q4' } })],
    [EPICS, 'POST /api/v2/epics', (pid) => ({ body: { projectId: pid, name: 'Billing' } })],
    [EPICS, 'PUT /api/v2/epics/:id', (pid) => ({ params: { id: epicIn(pid) }, body: { name: 'Renamed' } })],
    [EPICS, 'DELETE /api/v2/epics/:id', (pid) => ({ params: { id: epicIn(pid) } })],
    [EPICS, 'POST /api/v2/epics/:id/recount', (pid) => ({ params: { id: epicIn(pid) } })],
    [EPICS, 'POST /api/v2/epics/assign', (pid) => ({ body: { taskId: taskIn(pid), epicId: epicIn(pid) } })],
    [MILESTONE, 'POST /api/v1/addmilestone', (pid) => ({ body: { projectId: pid, milestoneObject: { milestoneName: 'M1' } } })],
    [MILESTONE, 'POST /api/v1/updatemilestone', (pid) => ({ body: { milestoneObject: { _id: milestoneIn(pid) } } })],
    [MILESTONE, 'POST /api/v1/deletemilestone', (pid) => ({ body: { milestoneObjForDelete: { _id: milestoneIn(pid) } } })],
    [MILESTONE, 'POST /api/v1/clearmilestonestatus', (pid) => ({ body: { milestoneObject: { _id: milestoneIn(pid) } } })],
    [MILESTONE, 'POST /api/v1/cancelmilestonestatus', (pid) => ({ body: { milestoneObject: { _id: milestoneIn(pid) } } })],
    [MILESTONE, 'POST /api/v1/refundamount', (pid) => ({ body: { milestoneObject: { _id: milestoneIn(pid) } } })],
    [MILESTONE, 'POST /api/v1/draggablemilestone', (pid) => ({ body: { milestoneObject: { _id: milestoneIn(pid) } } })],
    [MILESTONE, 'PUT /api/v2/billing/contract', (pid) => ({ body: { projectId: pid, blendedCostRate: 10 } })],
    [MILESTONE, 'POST /api/v2/billing/milestone', (pid) => ({ body: { projectId: pid, milestoneName: 'M2', amount: 5 } })],
    [MILESTONE, 'PATCH /api/v2/billing/milestone/:id', (pid) => ({ params: { id: milestoneIn(pid) }, body: { amount: 7 } })],
    [MILESTONE, 'POST /api/v2/billing/client-view/message', (pid) => ({ body: { projectId: pid, message: 'Hello' } })],
    [CALENDAR, 'POST /api/v1/calendar/feeds', (pid) => ({ body: { scope: 'project', projectId: pid } })],
    [RECURRING, 'POST /api/v1/recurring-tasks', (pid) => ({ body: { name: 'Weekly', taskName: 'Report', freq: 'weekly', projectData: { _id: pid }, sprintId: sprintIn(pid) } })],
    [RECURRING, 'PATCH /api/v1/recurring-tasks/:id', (pid) => ({ params: { id: definitionIn(pid) }, body: { enabled: false } })],
    [RECURRING, 'DELETE /api/v1/recurring-tasks/:id', (pid) => ({ params: { id: definitionIn(pid) } })],
    [RECURRING, 'POST /api/v1/recurring-tasks/:id/run-now', (pid) => ({ params: { id: definitionIn(pid) } })],
];

const call = (modulePath, route, uid, build, project) => run(routesOf(modulePath)[route], request({ uid, ...build(String(project._id)) }));

describe.each(READS)('read %s %s', (modulePath, route, build) => {
    it('answers 404 to a member who is not in the private project', async () => {
        seedRules(GRANTS);
        const res = await call(modulePath, route, MEMBER, build, seedProject());
        expect(res.statusCode).toBe(404);
        expect(res.body).toMatchObject({ status: false, error: 'Not Found' });
    });

    it('lets an assignee, the owner and an admin read', async () => {
        seedRules(GRANTS);
        const project = seedProject({ AssigneeUserId: [MEMBER] });
        for (const uid of [MEMBER, OWNER, ADMIN]) {
            expect((await call(modulePath, route, uid, build, project)).body).toMatchObject({ status: true });
        }
        expect((await call(modulePath, route, OWNER, build, seedProject({ AssigneeUserId: [] }))).body).toMatchObject({ status: true });
    });

    it('lets any member read a public project', async () => {
        seedRules({});
        const res = await call(modulePath, route, MEMBER, build, seedProject({ isPrivateSpace: false, AssigneeUserId: [] }));
        expect(res.body).toMatchObject({ status: true });
    });
});

describe.each(WRITES)('write %s %s', (modulePath, route, build) => {
    it('refuses a member who is not in the private project', async () => {
        seedRules(GRANTS);
        const res = await call(modulePath, route, MEMBER, build, seedProject());
        expect(res.statusCode).toBe(404);
        expect(res.body).toMatchObject({ status: false });
    });

    it('lets an assignee holding the permission, the owner and an admin write', async () => {
        seedRules(GRANTS);
        const project = seedProject({ AssigneeUserId: [MEMBER] });
        for (const uid of [MEMBER, OWNER, ADMIN]) {
            expect((await call(modulePath, route, uid, build, project)).body).toMatchObject({ status: true });
        }
    });
});

describe('where the project comes from', () => {
    it('reads the project off the stored sprint, not the project id in the body', async () => {
        seedRules(GRANTS);
        const privateProject = seedProject();
        const publicProject = seedProject({ isPrivateSpace: false });
        const res = await run(routesOf(SPRINTS)['POST /api/v2/sprints/start'], request({ body: { sprintId: sprintIn(String(privateProject._id)), projectId: String(publicProject._id) } }));
        expect(res.statusCode).toBe(404);
    });

    it('still checks a project id the handler takes from the body', async () => {
        seedRules(GRANTS);
        const privateProject = seedProject();
        const publicProject = seedProject({ isPrivateSpace: false });
        const id = sprintIn(String(publicProject._id));
        const res = await run(routesOf(SPRINTS)['PATCH /api/v1/sprint/:id'], request({ params: { id }, body: { type: 'editSprintName', prevData: { id }, projectId: String(privateProject._id) } }));
        expect(res.statusCode).toBe(404);
    });

    it('refuses completing a sprint into a sprint of a private project', async () => {
        seedRules(GRANTS);
        const publicProject = seedProject({ isPrivateSpace: false });
        const privateProject = seedProject();
        const res = await run(routesOf(SPRINTS)['POST /api/v2/sprints/complete'], request({ body: { sprintId: sprintIn(String(publicProject._id)), incompleteDestination: sprintIn(String(privateProject._id)) } }));
        expect(res.statusCode).toBe(404);
    });

    it('refuses reading a private task through a public project id', async () => {
        seedRules(GRANTS);
        const publicProject = seedProject({ isPrivateSpace: false });
        const privateProject = seedProject();
        const res = await run(routesOf(PROJECT)['GET /api/v1/projectdata/taskData'], request({ query: { taskId: taskIn(String(privateProject._id)), projectId: String(publicProject._id), subTaskLimit: 1 } }));
        expect(res.statusCode).toBe(404);
    });

    it('refuses a recurring rule that points at a sprint in a private project', async () => {
        seedRules(GRANTS);
        const publicProject = seedProject({ isPrivateSpace: false });
        const privateProject = seedProject();
        const res = await run(routesOf(RECURRING)['POST /api/v1/recurring-tasks'], request({ body: { projectData: { _id: String(publicProject._id) }, sprintId: sprintIn(String(privateProject._id)) } }));
        expect(res.statusCode).toBe(404);
    });

    it('leaves a chat channel, whose container is not a project, to its handler', async () => {
        seedRules({});
        const id = sprintIn(oid(), { mainChat: true });
        const res = await run(routesOf(SPRINTS)['PATCH /api/v1/sprint/:id'], request({ params: { id }, body: { type: 'deleteChannel', mainChat: true, projectId: oid() } }));
        expect(res.body).toMatchObject({ status: true, reached: 'deleteChannel' });
    });

    it('leaves a personal calendar feed to its handler', async () => {
        seedRules({});
        const res = await run(routesOf(CALENDAR)['POST /api/v1/calendar/feeds'], request({ body: { scope: 'my', projectId: String(seedProject()._id) } }));
        expect(res.body).toMatchObject({ status: true, reached: 'createFeed' });
    });
});

describe('visible but not allowed', () => {
    it('lets a member who may list every private project read it, and answers 403 to a write', async () => {
        seedRules({ ...GRANTS, 'project.private_projects': 2 });
        const project = seedProject();
        const read = await call(EPICS, 'GET /api/v2/epics', MEMBER, (pid) => ({ query: { projectId: pid } }), project);
        expect(read.body).toMatchObject({ status: true });
        const write = await call(EPICS, 'POST /api/v2/epics', MEMBER, (pid) => ({ body: { projectId: pid, name: 'x' } }), project);
        expect(write.statusCode).toBe(403);
    });

    it('answers 403 naming the key when an assignee lacks the permission for the action', async () => {
        seedRules({ ...GRANTS, 'project.project_sprint_create': false });
        const project = seedProject({ AssigneeUserId: [MEMBER] });
        const res = await call(SPRINTS, 'POST /api/v1/sprint', MEMBER, (pid) => ({ body: { projectId: pid } }), project);
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ status: false, permission: 'project.project_sprint_create' });
    });

    it('lets a member keep sprint favourites without a sprint edit permission', async () => {
        seedRules({ 'project.private_projects': 1 });
        const project = seedProject({ AssigneeUserId: [MEMBER] });
        const res = await call(PROJECT, 'PUT /api/v1/project/sprint/:id', MEMBER, (pid) => ({ params: { id: sprintIn(pid) }, body: { updateObject: { favouriteTasks: { userId: MEMBER } }, key: '$push' } }), project);
        expect(res.body).toMatchObject({ status: true });
    });
});

describe('list-shaped reads keep only visible projects', () => {
    it.each([
        ['POST /api/v1/get-remaining-projects', PROJECT, (ids) => ({ dataIds: ids }), (req) => req.body.dataIds],
        ['POST /api/v1/milestoneReport', MILESTONE, (ids) => ({ element: ids, startDate: 1, endDate: 2 }), (req) => req.body.element],
    ])('%s', async (route, modulePath, bodyFor, idsOf) => {
        seedRules(GRANTS);
        const hidden = String(seedProject()._id);
        const assigned = String(seedProject({ AssigneeUserId: [MEMBER] })._id);
        const open = String(seedProject({ isPrivateSpace: false })._id);
        const req = request({ body: bodyFor([hidden, assigned, open]) });
        const res = await run(routesOf(modulePath)[route], req);
        expect(res.body).toMatchObject({ status: true });
        expect(idsOf(req)).toEqual([assigned, open]);

        const ownerReq = request({ uid: OWNER, body: bodyFor([hidden, assigned, open]) });
        await run(routesOf(modulePath)[route], ownerReq);
        expect(idsOf(ownerReq)).toEqual([hidden, assigned, open]);
    });
});

describe('portfolio rollups', () => {
    const { getRollup, getPortfolioSummary } = jest.requireActual('../Modules/Portfolio/controller');

    const seedPortfolio = () => {
        const hidden = seedProject({ ProjectName: 'Hidden' });
        const open = seedProject({ ProjectName: 'Open', isPrivateSpace: false });
        const portfolio = mockDb.seed(SCHEMA_TYPE.PORTFOLIOS, { _id: oid(), name: 'Q3', projectIds: [String(hidden._id), String(open._id)], deletedStatusKey: 0 });
        return String(portfolio._id);
    };

    it('includes only the projects visible to the caller', async () => {
        seedRules(GRANTS);
        const portfolioId = seedPortfolio();
        const asMember = response();
        await getRollup(request({ params: { id: portfolioId } }), asMember);
        expect(asMember.body.data.projects.map((p) => p.name)).toEqual(['Open']);

        const asOwner = response();
        await getRollup(request({ uid: OWNER, params: { id: portfolioId } }), asOwner);
        expect(asOwner.body.data.projects.map((p) => p.name).sort()).toEqual(['Hidden', 'Open']);
    });

    it('never serves one caller\'s cached summary to a caller who sees fewer projects', async () => {
        seedRules(GRANTS);
        mockProvider.configured = true;
        mockProvider.chat.mockResolvedValue({ content: 'Paragraph', model: 'm' });
        const portfolioId = seedPortfolio();

        await getPortfolioSummary(request({ uid: OWNER, body: { portfolioId } }), response());
        await getPortfolioSummary(request({ body: { portfolioId } }), response());

        expect(mockProvider.chat).toHaveBeenCalledTimes(2);
        const memberFacts = JSON.parse(mockProvider.chat.mock.calls[1][0].messages[0].content);
        expect(memberFacts.projects.map((p) => p.name)).toEqual(['Open']);
    });
});

describe('PRJ-04: PUT /api/v1/project/allTask/:id', () => {
    const { projectAlltaskUpdate } = jest.requireActual('../Modules/Project/controller/projectAlltaskUpdate');

    it('refuses a findObject.ProjectID that is not the project in the URL', async () => {
        const res = response();
        await projectAlltaskUpdate(request({ uid: OWNER, params: { id: oid() }, body: { findObject: { ProjectID: oid(), _id: oid() }, updateObject: { TaskName: 'x' } } }), res);
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false });
        expect(mockDb.calls.filter((c) => c.method === 'updateMany')).toEqual([]);
    });

    it('scopes the update to the URL project whatever else findObject says', async () => {
        const projectId = oid();
        const res = response();
        await projectAlltaskUpdate(request({ uid: OWNER, params: { id: projectId }, body: { findObject: { ProjectID: projectId, _id: oid() }, updateObject: { TaskName: 'x' } } }), res);
        const [update] = mockDb.calls.filter((c) => c.method === 'updateMany');
        expect(String(update.data[0].ProjectID)).toBe(projectId);
    });
});

describe('PRJ-05: DELETE /api/v1/project/filter/delete/:cid/:id', () => {
    const { deleteFilter } = jest.requireActual('../Modules/Project/controller/manageGlobalFilter');

    it('refuses a company id that is not the session company', async () => {
        const res = response();
        await deleteFilter(request({ params: { cid: 'c00000000000000000000009', id: oid() } }), res);
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ status: false });
        expect(mockDb.calls).toEqual([]);
    });

    it('deletes within the session company', async () => {
        const res = response();
        await deleteFilter(request({ params: { cid: C, id: oid() } }), res);
        expect(mockDb.calls[0]).toMatchObject({ companyId: C, method: 'deleteOne' });
    });
});
