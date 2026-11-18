const mockDb = require('./fixtures/fakeMongo').create();
// fakeMongo keeps one list per type; a company has a database of its own, so each type is kept per database here.
const mockCrud = (database, query, method) => mockDb.crud(database, { ...query, type: `${database}/${query.type}` }, method);
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { buildTaskStatusData } = require('../Modules/Setup/demoProject');
const { TemplateData: taskStatusTemplates } = require('../utils/Tempates/task_status');
const { TemplateData: taskTypeTemplates } = require('../utils/Tempates/task_type');
const { seedScale } = require('../scripts/scale/lib/seed');
const { dropScale } = require('../scripts/scale/lib/drop');
const { issueScaleSession } = require('../scripts/scale/lib/session');
const { openScaleCompany } = require('../scripts/scale/lib/guard');
const { MARK, COMPANY_NAME, PROJECT, PEOPLE, FIELDS, LIST_COUNT, MEMBER_COUNT } = require('../scripts/scale/lib/shape');

const GLOBAL = dbCollections.GLOBAL;
const READS = ['find', 'findOne', 'aggregate', 'countDocuments', 'distinct'];

const save = (db, type, data) => mockCrud(db, { type, data }, 'save');
const rows = (db, type) => mockDb.store[`${db}/${type}`] || [];
const globalRows = (type) => rows(GLOBAL, type);
const defaultOf = (templates) => templates.find((template) => template.default) || templates[0];
const snapshot = (list) => JSON.parse(JSON.stringify(list));

const fakeAdapter = () => ({
    createUser: jest.fn(async ({ person, companyId }) => {
        const user = await save(GLOBAL, SCHEMA_TYPE.USERS, { Employee_Email: person.email, AssignCompany: companyId ? [companyId] : [], scaleSeed: MARK });
        await save(GLOBAL, dbCollections.USER_AUTH, { _id: user._id, email: person.email });
        return user._id;
    }),
    createCompany: jest.fn(async ({ ownerId, name, mark }) => {
        const company = await save(GLOBAL, SCHEMA_TYPE.COMPANIES, { Cst_CompanyName: name, userId: ownerId, scaleSeed: mark });
        await save(GLOBAL, dbCollections.BUCKETS, { id: company._id });
        await mockCrud(GLOBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: ownerId }, { $push: { AssignCompany: company._id } }] }, 'updateOne');
        await save(company._id, SCHEMA_TYPE.SETTINGS, { name: 'roles', settings: [{ name: 'Owner', key: 1 }, { name: 'Member', key: 3 }] });
        await save(company._id, SCHEMA_TYPE.COMPANY_USERS, { userId: ownerId, roleType: 1, status: 2 });
        return company._id;
    }),
    addMember: jest.fn(async ({ companyId, userId, email, roleType }) => {
        await save(companyId, SCHEMA_TYPE.COMPANY_USERS, { userId, userEmail: email, roleType, status: 2 });
    }),
    createProject: jest.fn(async ({ companyId, project, tags, fields }) => {
        const saved = await save(companyId, SCHEMA_TYPE.PROJECTS, {
            ProjectName: project.name,
            ProjectCode: project.code,
            lastTaskId: 0,
            tagsArray: tags,
            taskStatusData: buildTaskStatusData(JSON.parse(JSON.stringify(defaultOf(taskStatusTemplates())))),
            taskTypeCounts: JSON.parse(JSON.stringify(defaultOf(taskTypeTemplates()).taskTypes)),
        });
        await save(companyId, SCHEMA_TYPE.SPRINTS, { name: 'List', projectId: saved._id, deletedStatusKey: 0, tasks: 0 });
        for (const field of fields) await save(companyId, SCHEMA_TYPE.CUSTOM_FIELDS, { ...field, projectId: [saved._id] });
        return saved._id;
    }),
    createList: jest.fn(async ({ companyId, projectId, name }) => (await save(companyId, SCHEMA_TYPE.SPRINTS, { name, projectId, deletedStatusKey: 0, tasks: 0 }))._id),
    dropCompany: jest.fn(async (companyId) => {
        Object.keys(mockDb.store).filter((key) => key.startsWith(`${companyId}/`)).forEach((key) => { delete mockDb.store[key]; });
    }),
    issueSession: jest.fn(async (userId) => {
        const session = await save(GLOBAL, dbCollections.SESSIONS, { userId });
        return { accessToken: 'header.payload.signature', sessionId: session._id };
    }),
});

const originalEnv = { ...process.env };
let adapter;
let bystander;

/* Another company on the same server: nothing of it may change, whatever the seed or the drop does. */
const seedBystander = async () => {
    const owner = await save(GLOBAL, SCHEMA_TYPE.USERS, { Employee_Email: 'owner@real.example', AssignCompany: [], bystander: true });
    await save(GLOBAL, dbCollections.USER_AUTH, { _id: owner._id, email: 'owner@real.example', bystander: true });
    const company = await save(GLOBAL, SCHEMA_TYPE.COMPANIES, { Cst_CompanyName: 'Real Company', userId: owner._id, bystander: true });
    await mockCrud(GLOBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: owner._id }, { $push: { AssignCompany: company._id } }] }, 'updateOne');
    await save(GLOBAL, dbCollections.BUCKETS, { id: company._id, bystander: true });
    await save(GLOBAL, dbCollections.SESSIONS, { userId: owner._id, bystander: true });
    const project = await save(company._id, SCHEMA_TYPE.PROJECTS, { ProjectName: PROJECT.name, ProjectCode: PROJECT.code, lastTaskId: 3 });
    const list = await save(company._id, SCHEMA_TYPE.SPRINTS, { name: 'List', projectId: project._id, deletedStatusKey: 0, tasks: 3 });
    for (let n = 1; n <= 3; n += 1) {
        const task = await save(company._id, SCHEMA_TYPE.TASKS, { TaskName: `Real task ${n}`, ProjectID: project._id, sprintId: list._id, isParentTask: true, deletedStatusKey: 0 });
        await save(company._id, SCHEMA_TYPE.COMMENTS, { message: 'Real comment', taskId: task._id, projectId: project._id });
    }
    return { companyId: company._id, ownerId: owner._id };
};

const bystanderRows = () => snapshot(Object.fromEntries(Object.entries(mockDb.store)
    .map(([key, list]) => [key, key.startsWith(`${GLOBAL}/`) ? list.filter((row) => row.bystander === true) : list])
    .filter(([key]) => key.startsWith(`${GLOBAL}/`) || key.startsWith(`${bystander.companyId}/`))));
const scaleCompany = () => globalRows(SCHEMA_TYPE.COMPANIES).find((company) => company.scaleSeed && company.scaleSeed.by === MARK);
const scaleTasks = () => rows(scaleCompany()._id, SCHEMA_TYPE.TASKS);

beforeEach(async () => {
    Object.keys(mockDb.store).forEach((type) => { delete mockDb.store[type]; });
    process.env.MONGODB_URL = 'mongodb://localhost:27017';
    process.env.NODE_ENV = 'test';
    adapter = fakeAdapter();
    bystander = await seedBystander();
    mockDb.calls.length = 0;
});

afterAll(() => {
    process.env = originalEnv;
});

describe('the seed writes only inside a company it created and marked', () => {
    it('creates one marked company with its own users and puts every task there', async () => {
        const before = bystanderRows();
        const report = await seedScale({ tasks: 120, adapter });

        const company = scaleCompany();
        expect(company).toMatchObject({ Cst_CompanyName: COMPANY_NAME, scaleSeed: { by: MARK } });
        expect(report.companyId).toBe(company._id);
        expect(report.companyId).not.toBe(bystander.companyId);
        expect(globalRows(SCHEMA_TYPE.USERS).filter((user) => user.scaleSeed === MARK)).toHaveLength(PEOPLE.length);
        expect(report.created).toEqual({ company: 1, users: MEMBER_COUNT + 1, members: MEMBER_COUNT, project: 1, lists: LIST_COUNT - 1 });

        expect(scaleTasks().filter((task) => task.isParentTask)).toHaveLength(120);
        scaleTasks().forEach((task) => expect(String(task.CompanyId)).toBe(company._id));
        expect(bystanderRows()).toEqual(before);
    });

    it('never names another company in a call: every one goes to its own company or to the global database', async () => {
        const report = await seedScale({ tasks: 60, adapter });
        expect([...new Set(mockDb.calls.map((call) => call.companyId))].sort()).toEqual([report.companyId, GLOBAL].sort());
        const globalWrites = mockDb.calls.filter((call) => call.companyId === GLOBAL && !READS.includes(call.method) && !['save', 'updateOne'].includes(call.method));
        expect(globalWrites).toEqual([]);
    });

    it('keeps the stored counters equal to what is stored', async () => {
        const report = await seedScale({ tasks: 200, adapter });
        const stored = scaleTasks();
        const project = rows(report.companyId, SCHEMA_TYPE.PROJECTS).find((row) => row._id === report.projectId);
        const lists = rows(report.companyId, SCHEMA_TYPE.SPRINTS);

        expect(report.inserted.tasks + report.inserted.subtasks).toBe(stored.length);
        expect(project.lastTaskId).toBe(stored.length);
        expect(project.taskTypeCounts.reduce((total, type) => total + type.taskCount, 0)).toBe(stored.length);
        expect(lists).toHaveLength(LIST_COUNT);
        expect(lists.reduce((total, list) => total + list.tasks, 0)).toBe(stored.length);
        lists.forEach((list) => expect(list.tasks).toBe(stored.filter((task) => String(task.sprintId) === list._id).length));
        expect(rows(report.companyId, SCHEMA_TYPE.COMMENTS)).toHaveLength(report.inserted.comments);
        expect(rows(report.companyId, SCHEMA_TYPE.CUSTOM_FIELDS)).toHaveLength(FIELDS.length);
    });

    it('creates nothing new when it runs twice', async () => {
        await seedScale({ tasks: 150, adapter });
        const after = snapshot(mockDb.store);
        const again = await seedScale({ tasks: 150, adapter });

        expect(again.created).toEqual({ company: 0, users: 0, members: 0, project: 0, lists: 0 });
        expect(again.inserted).toEqual({ tasks: 0, subtasks: 0, comments: 0 });
        expect(snapshot(mockDb.store)).toEqual(after);
        expect(adapter.createCompany).toHaveBeenCalledTimes(1);
    });

    it('tops a smaller data set up to a larger one with the same documents a fresh seed would hold', async () => {
        await seedScale({ tasks: 80, adapter });
        const topped = await seedScale({ tasks: 140, adapter });
        expect(topped.inserted.tasks).toBe(60);
        const keys = scaleTasks().map((task) => task.TaskKey);
        expect(new Set(keys).size).toBe(keys.length);
        expect(scaleTasks().filter((task) => task.isParentTask)).toHaveLength(140);
        expect(topped.counters.total).toBe(topped.generated.lastTaskId);
    });

    it('refuses to shrink: a smaller count than what is stored asks for a drop first', async () => {
        await seedScale({ tasks: 80, adapter });
        await expect(seedScale({ tasks: 40, adapter })).rejects.toThrow(/--drop/);
    });

    it.each([[0], [-5], ['ten'], [true], [50001], [10.5]])('refuses --tasks %p before writing anything', async (tasks) => {
        await expect(seedScale({ tasks, adapter })).rejects.toThrow(/--tasks/);
        expect(mockDb.calls).toHaveLength(0);
    });
});

describe('the seed leaves a company or account it did not create alone', () => {
    it('refuses when a company with the seed name exists without the mark', async () => {
        await save(GLOBAL, SCHEMA_TYPE.COMPANIES, { Cst_CompanyName: COMPANY_NAME, userId: bystander.ownerId, bystander: true });
        const before = bystanderRows();
        await expect(seedScale({ tasks: 10, adapter })).rejects.toThrow(/did not create/);
        expect(adapter.createCompany).not.toHaveBeenCalled();
        expect(adapter.createUser).not.toHaveBeenCalled();
        expect(bystanderRows()).toEqual(before);
    });

    it('refuses when a seed email already belongs to an unmarked account', async () => {
        await save(GLOBAL, SCHEMA_TYPE.USERS, { Employee_Email: PEOPLE[0].email, AssignCompany: [bystander.companyId], bystander: true });
        await expect(seedScale({ tasks: 10, adapter })).rejects.toThrow(/did not create/);
        expect(adapter.createCompany).not.toHaveBeenCalled();
    });

    it('refuses a marked company whose owner is not a seeded account', async () => {
        const company = await save(GLOBAL, SCHEMA_TYPE.COMPANIES, { Cst_CompanyName: COMPANY_NAME, userId: bystander.ownerId, scaleSeed: { by: MARK } });
        await expect(openScaleCompany(company._id)).rejects.toThrow(/Refusing to write/);
        await expect(dropScale({ adapter })).rejects.toThrow(/Refusing to write/);
        expect(adapter.dropCompany).not.toHaveBeenCalled();
    });

    it('opens no company by id unless that company carries the mark', async () => {
        await expect(openScaleCompany(bystander.companyId)).rejects.toThrow(/Refusing to write/);
        await expect(openScaleCompany('not-an-id')).rejects.toThrow(/needs the id/);
    });

    it.each([
        ['a remote database', { MONGODB_URL: 'mongodb://db.example.com:27017' }],
        ['production', { NODE_ENV: 'production' }],
    ])('seed, drop and token refuse %s before reading anything', async (_, env) => {
        Object.assign(process.env, env);
        await expect(seedScale({ tasks: 10, adapter })).rejects.toThrow(/Refusing to run/);
        await expect(dropScale({ adapter })).rejects.toThrow(/Refusing to run/);
        await expect(issueScaleSession({ adapter })).rejects.toThrow(/Refusing to run/);
        expect(mockDb.calls).toHaveLength(0);
    });
});

describe('--drop removes the marked company and nothing else', () => {
    it('removes the company, its bucket, its users with their sign-in rows and sessions, and drops only its database', async () => {
        const before = bystanderRows();
        const { companyId } = await seedScale({ tasks: 60, adapter });
        await issueScaleSession({ adapter });

        const { removed } = await dropScale({ adapter });

        expect(adapter.dropCompany.mock.calls).toEqual([[companyId]]);
        expect(removed).toEqual({ company: 1, bucket: 1, users: PEOPLE.length, userAuth: PEOPLE.length, sessions: 1, keptUsers: 0 });
        expect(scaleCompany()).toBeUndefined();
        expect(globalRows(SCHEMA_TYPE.USERS).filter((user) => user.scaleSeed === MARK)).toEqual([]);
        expect(bystanderRows()).toEqual(before);
        expect(Object.keys(mockDb.store).filter((key) => key.startsWith(`${companyId}/`))).toEqual([]);
        Object.keys(mockDb.store).filter((key) => key.startsWith(`${GLOBAL}/`)).forEach((key) => mockDb.store[key].forEach((row) => expect(row.bystander).toBe(true)));
    });

    it('does nothing when there is no marked company', async () => {
        const before = snapshot(mockDb.store);
        expect(await dropScale({ adapter })).toEqual({ companyId: null, removed: { company: 0, bucket: 0, users: 0, userAuth: 0, sessions: 0, keptUsers: 0 } });
        expect(adapter.dropCompany).not.toHaveBeenCalled();
        expect(snapshot(mockDb.store)).toEqual(before);
    });

    it('keeps a seeded user who has since joined another company', async () => {
        await seedScale({ tasks: 20, adapter });
        const joined = globalRows(SCHEMA_TYPE.USERS).find((user) => user.Employee_Email === PEOPLE[3].email);
        joined.AssignCompany.push(bystander.companyId);

        const { removed } = await dropScale({ adapter });

        expect(removed).toMatchObject({ users: PEOPLE.length - 1, keptUsers: 1 });
        expect(globalRows(SCHEMA_TYPE.USERS).map((user) => user.Employee_Email)).toContain(PEOPLE[3].email);
        expect(globalRows(dbCollections.USER_AUTH).map((auth) => auth.email)).toContain(PEOPLE[3].email);
    });

    it('can be seeded again after a drop', async () => {
        await seedScale({ tasks: 30, adapter });
        await dropScale({ adapter });
        const again = await seedScale({ tasks: 30, adapter });
        expect(again.created.company).toBe(1);
        expect(again.inserted.tasks).toBe(30);
    });
});

describe('the session token is for the seed company owner only', () => {
    it('issues a session for the marked owner and says which company and project it opens', async () => {
        const report = await seedScale({ tasks: 20, adapter });
        const session = await issueScaleSession({ adapter });
        expect(adapter.issueSession).toHaveBeenCalledWith(report.ownerId);
        expect(session).toMatchObject({ accessToken: 'header.payload.signature', companyId: report.companyId, userId: report.ownerId });
        expect(session.project._id).toBe(report.projectId);
        expect(session.lists).toHaveLength(LIST_COUNT);
    });

    it('refuses when the seed has not run', async () => {
        await expect(issueScaleSession({ adapter })).rejects.toThrow(/Run the seed first/);
        expect(adapter.issueSession).not.toHaveBeenCalled();
    });
});
