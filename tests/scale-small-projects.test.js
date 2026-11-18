/* Task 046, slice E4: the scale seed's optional second shape, hundreds of small projects beside the big one, so a
   read across projects names hundreds of them. It writes inside the scale seed company only, creates nothing twice,
   and is removed by the same --drop as everything else. */
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
const { seedSmallProjects, projectCountFrom, ownTasks } = require('../scripts/scale/lib/smallProjects');
const { generateTasks } = require('../scripts/scale/lib/generate');
const { MARK, PROJECT, SMALL_PROJECTS, smallProject } = require('../scripts/scale/lib/shape');

const GLOBAL = dbCollections.GLOBAL;
const save = (db, type, data) => mockCrud(db, { type, data }, 'save');
const rows = (db, type) => mockDb.store[`${db}/${type}`] || [];
const defaultOf = (templates) => templates.find((template) => template.default) || templates[0];
const snapshot = (list) => JSON.parse(JSON.stringify(list));

const fakeAdapter = ({ listWithProject = true } = {}) => ({
    createUser: jest.fn(async ({ person, companyId }) => {
        const user = await save(GLOBAL, SCHEMA_TYPE.USERS, { Employee_Email: person.email, AssignCompany: companyId ? [companyId] : [], scaleSeed: MARK });
        return user._id;
    }),
    createCompany: jest.fn(async ({ ownerId, name, mark }) => {
        const company = await save(GLOBAL, SCHEMA_TYPE.COMPANIES, { Cst_CompanyName: name, userId: ownerId, scaleSeed: mark });
        await mockCrud(GLOBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: ownerId }, { $push: { AssignCompany: company._id } }] }, 'updateOne');
        await save(company._id, SCHEMA_TYPE.SETTINGS, { name: 'roles', settings: [{ name: 'Owner', key: 1 }, { name: 'Member', key: 3 }] });
        await save(company._id, SCHEMA_TYPE.COMPANY_USERS, { userId: ownerId, roleType: 1, status: 2 });
        return company._id;
    }),
    addMember: jest.fn(async ({ companyId, userId, email, roleType }) => {
        await save(companyId, SCHEMA_TYPE.COMPANY_USERS, { userId, userEmail: email, roleType, status: 2 });
    }),
    createProject: jest.fn(async ({ companyId, project, tags, fields, memberIds, ownerId }) => {
        const saved = await save(companyId, SCHEMA_TYPE.PROJECTS, {
            ProjectName: project.name,
            ProjectCode: project.code,
            AssigneeUserId: [ownerId, ...memberIds],
            lastTaskId: 0,
            tagsArray: tags,
            taskStatusData: buildTaskStatusData(JSON.parse(JSON.stringify(defaultOf(taskStatusTemplates())))),
            taskTypeCounts: JSON.parse(JSON.stringify(defaultOf(taskTypeTemplates()).taskTypes)),
        });
        if (listWithProject) await save(companyId, SCHEMA_TYPE.SPRINTS, { name: 'List', projectId: saved._id, deletedStatusKey: 0, tasks: 0 });
        for (const field of fields) await save(companyId, SCHEMA_TYPE.CUSTOM_FIELDS, { ...field, projectId: [saved._id] });
        return saved._id;
    }),
    createList: jest.fn(async ({ companyId, projectId, name }) => (await save(companyId, SCHEMA_TYPE.SPRINTS, { name, projectId, deletedStatusKey: 0, tasks: 0 }))._id),
    dropCompany: jest.fn(async (companyId) => {
        Object.keys(mockDb.store).filter((key) => key.startsWith(`${companyId}/`)).forEach((key) => { delete mockDb.store[key]; });
    }),
});

const originalEnv = { ...process.env };
let adapter;
let bystander;
let companyId;

const seedBystander = async () => {
    const company = await save(GLOBAL, SCHEMA_TYPE.COMPANIES, { Cst_CompanyName: 'Real Company', bystander: true });
    const project = await save(company._id, SCHEMA_TYPE.PROJECTS, { ProjectName: 'Real', ProjectCode: smallProject(1).code });
    await save(company._id, SCHEMA_TYPE.TASKS, { TaskName: 'Real task', ProjectID: project._id, isParentTask: true, deletedStatusKey: 0 });
    return company._id;
};
const bystanderRows = () => snapshot(Object.fromEntries(Object.entries(mockDb.store).filter(([key]) => key.startsWith(`${bystander}/`))));
const projects = () => rows(companyId, SCHEMA_TYPE.PROJECTS);
const smallOnes = () => projects().filter((project) => /^SS\d{3}$/.test(project.ProjectCode));
const tasks = () => rows(companyId, SCHEMA_TYPE.TASKS);
const tasksOf = (project) => tasks().filter((task) => String(task.ProjectID) === String(project._id));
const small = (count, over = {}) => seedSmallProjects({ count, adapter, ...over });

beforeEach(async () => {
    Object.keys(mockDb.store).forEach((type) => { delete mockDb.store[type]; });
    process.env.MONGODB_URL = 'mongodb://localhost:27017';
    process.env.NODE_ENV = 'test';
    adapter = fakeAdapter();
    bystander = await seedBystander();
    ({ companyId } = await seedScale({ tasks: 40, adapter }));
    mockDb.calls.length = 0;
});

afterAll(() => {
    process.env = originalEnv;
});

describe('the count asked for', () => {
    it.each([0, -1, 2.5, 'many', true, SMALL_PROJECTS.max + 1])('refuses %p', (value) => {
        expect(() => projectCountFrom(value)).toThrow(/--small-projects/);
    });

    it('takes a whole number up to the cap, as a number or as the text a command line gives', () => {
        expect(projectCountFrom('300')).toBe(300);
        expect(projectCountFrom(SMALL_PROJECTS.max)).toBe(SMALL_PROJECTS.max);
    });
});

describe('small projects beside the big one', () => {
    it('adds the projects, each with one list and ten tasks, to the scale seed company', async () => {
        const report = await small(6);

        expect(report).toMatchObject({ companyId, created: { projects: 6, lists: 0 }, stored: { smallProjects: 6 } });
        expect(smallOnes().map((project) => project.ProjectCode)).toEqual(['SS001', 'SS002', 'SS003', 'SS004', 'SS005', 'SS006']);
        expect(smallOnes().map((project) => project.ProjectName)[0]).toBe('Scale Small 001');
        smallOnes().forEach((project) => {
            const stored = tasksOf(project);
            expect(stored.filter((task) => task.isParentTask)).toHaveLength(SMALL_PROJECTS.tasks);
            expect(stored.every((task) => String(task.CompanyId) === companyId)).toBe(true);
            expect(stored.filter((task) => task.isParentTask).map((task) => task.TaskKey)).toContain(`${project.ProjectCode}-1`);
            expect(rows(companyId, SCHEMA_TYPE.SPRINTS).filter((list) => String(list.projectId) === String(project._id))).toHaveLength(1);
        });
        expect(report.inserted.tasks).toBe(60);
    });

    it('writes nowhere else: every call goes to the scale company or reads the global database', async () => {
        const before = bystanderRows();
        await small(4);
        expect([...new Set(mockDb.calls.map((call) => call.companyId))].sort()).toEqual([companyId, GLOBAL].sort());
        expect(mockDb.calls.filter((call) => call.companyId === GLOBAL && !['find', 'findOne'].includes(call.method))).toEqual([]);
        expect(bystanderRows()).toEqual(before);
    });

    it('leaves the big project and its tasks as they were', async () => {
        const big = projects().find((project) => project.ProjectCode === PROJECT.code);
        const before = snapshot({ project: big, tasks: tasksOf(big) });
        await small(5);
        expect(snapshot({ project: projects().find((project) => project.ProjectCode === PROJECT.code), tasks: tasksOf(big) })).toEqual(before);
    });

    it('gives every task an id of its own, across the small projects and the big one', async () => {
        await small(8);
        const ids = tasks().map((task) => String(task._id));
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBeGreaterThan(40 + 80);
    });

    it('puts only the owner on a small project, and assigns its tasks to the company\'s people', async () => {
        await small(2);
        adapter.createProject.mock.calls.filter(([call]) => /^SS/.test(call.project.code)).forEach(([call]) => {
            expect(call.memberIds).toEqual([]);
            expect(call.fields).toEqual([]);
        });
        const members = new Set(rows(companyId, SCHEMA_TYPE.COMPANY_USERS).map((member) => String(member.userId)));
        const assigned = smallOnes().flatMap((project) => tasksOf(project)).flatMap((task) => task.AssigneeUserId);
        expect(assigned.length).toBeGreaterThan(0);
        expect(assigned.every((id) => members.has(String(id)))).toBe(true);
    });

    it('keeps each project\'s counters equal to what is stored', async () => {
        await small(3);
        smallOnes().forEach((project) => {
            const stored = tasksOf(project);
            expect(project.lastTaskId).toBe(stored.length);
            const [list] = rows(companyId, SCHEMA_TYPE.SPRINTS).filter((entry) => String(entry.projectId) === String(project._id));
            expect(list.tasks).toBe(stored.length);
        });
    });

    it('creates nothing new when it runs twice, and only the missing ones when asked for more', async () => {
        await small(4);
        const before = snapshot({ projects: projects(), tasks: tasks() });
        const again = await small(4);
        expect(again).toMatchObject({ created: { projects: 0, lists: 0 }, inserted: { tasks: 0, subtasks: 0 }, stored: { smallProjects: 4 } });
        expect(snapshot({ projects: projects(), tasks: tasks() })).toEqual(before);

        const more = await small(6);
        expect(more).toMatchObject({ created: { projects: 2 }, inserted: { tasks: 20 }, stored: { smallProjects: 6 } });
    });

    it('makes the list itself when creating a project did not', async () => {
        adapter = fakeAdapter({ listWithProject: false });
        const report = await small(2);
        expect(report.created).toEqual({ projects: 2, lists: 2 });
        expect(adapter.createList).toHaveBeenCalledWith(expect.objectContaining({ companyId, name: 'List' }));
    });

    it('is removed with the rest of the company by --drop', async () => {
        await small(3);
        await dropScale({ adapter });
        expect(Object.keys(mockDb.store).filter((key) => key.startsWith(`${companyId}/`))).toEqual([]);
        expect(adapter.dropCompany).toHaveBeenCalledWith(companyId);
    });
});

describe('it needs the scale seed company', () => {
    it('refuses, and writes nothing, when there is none', async () => {
        await dropScale({ adapter });
        mockDb.calls.length = 0;
        await expect(small(2)).rejects.toThrow(/no scale seed company/);
        expect(mockDb.calls.filter((call) => !['find', 'findOne'].includes(call.method))).toEqual([]);
    });

    it('refuses a database that is not local', async () => {
        process.env.MONGODB_URL = 'mongodb://db.example.com:27017';
        await expect(small(2)).rejects.toThrow(/Refusing to run/);
    });
});

describe('a small project\'s own tasks', () => {
    const context = (code) => ({
        companyId: '0'.repeat(23) + '1',
        project: {
            _id: '0'.repeat(23) + '2', ProjectCode: code,
            taskStatusData: buildTaskStatusData(JSON.parse(JSON.stringify(defaultOf(taskStatusTemplates())))),
            taskTypeCounts: defaultOf(taskTypeTemplates()).taskTypes, tagsArray: [],
        },
        lists: [{ _id: '0'.repeat(23) + '3', name: 'List' }],
        memberIds: ['0'.repeat(23) + '4'],
        ownerId: '0'.repeat(23) + '5',
        fields: [],
        anchor: new Date('2026-10-01T00:00:00.000Z'),
    });
    const generated = (code) => [...generateTasks(context(code), SMALL_PROJECTS.tasks)];

    it('are the same on every run, and different from the next project\'s', () => {
        const first = ownTasks(generated('SS001'), 1).map((doc) => String(doc._id));
        expect(ownTasks(generated('SS001'), 1).map((doc) => String(doc._id))).toEqual(first);
        const second = ownTasks(generated('SS002'), 2).map((doc) => String(doc._id));
        expect(first.filter((id) => second.includes(id))).toEqual([]);
        expect(first.filter((id) => generated('SS001').map((row) => String(row.task._id)).includes(id))).toEqual([]);
    });

    it('keep each subtask under its own parent, and carry no comment a small project does not have', () => {
        const docs = ownTasks(generated('SS001'), 1);
        const parents = new Set(docs.filter((doc) => doc.isParentTask).map((doc) => String(doc._id)));
        docs.filter((doc) => !doc.isParentTask).forEach((doc) => expect(parents.has(doc.ParentTaskId)).toBe(true));
        docs.forEach((doc) => { expect(doc).not.toHaveProperty('message'); expect(doc).not.toHaveProperty('lastMessage'); });
    });

    it('sit in a slice of time of their own, so tasks of different projects do not tie on the time they were updated', () => {
        const stamps = (number) => ownTasks(generated(smallProject(number).code), number).filter((doc) => doc.isParentTask).map((doc) => doc.updatedAt.getTime());
        expect(stamps(1).filter((at) => stamps(2).includes(at))).toEqual([]);
        expect(stamps(2)[0] - stamps(1)[0]).toBe(7 * 60 * 1000);
    });
});
