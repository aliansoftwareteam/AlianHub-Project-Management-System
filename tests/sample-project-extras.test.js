/* The welcome project shows what the product gained: a folder with a subfolder holding a list, subtasks
   three levels deep, two custom fields with values, a doc, a goal counted from the sample list, and a
   task in a second list. Every kind is made by the helper a person's create goes through, belongs to
   the company, is found again by DELETE /api/v2/sample-data, and leaves what a person made alone. */
const mockDb = require('./fixtures/fakeMongo').create();
const mockProjectHex = '6f0000000000000000000b01';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => ({})) }));
jest.mock('../Modules/Tasks/helpers/mongo_helper', () => ({ HandleHistory: jest.fn(async () => ({})) }));
jest.mock('../Modules/AI/publicSources', () => ({ sharedProjects: jest.fn(async () => [{ _id: mockProjectHex }]), READER_CAP: 50 }));
jest.mock('../Modules/Project/controller/updateProject', () => ({
    updateProjectInternal: jest.fn(async (company, id, patch) => {
        Object.assign(mockDb.store.projects.find((p) => String(p._id) === String(id)), patch);
    }),
}));
jest.mock('../Modules/Sprints/controller', () => {
    const actual = jest.requireActual('../Modules/Sprints/controller');
    actual.getPerProjectCount = async () => true;
    return actual;
});
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: jest.requireActual('../Modules/Tasks/helpers/taskMongo/extraLists') }));
jest.mock('../Modules/Pages/controller', () => jest.requireActual('../Modules/Pages/controller'));
jest.mock('../Modules/Trash/listAccess', () => ({ visibleTrash: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskWriteFields', () => ({
    ...jest.requireActual('../Modules/Tasks/helpers/taskWriteFields'),
    sessionActor: jest.fn(),
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { seedSampleTasks, demoTasksForFocus } = require('../utils/sampleTasks');
const trash = require('../Modules/Trash/controller');
const socketEmitter = require('../event/socketEventEmitter');
const { removeCache } = require('../utils/commonFunctions');
const goalsRules = require('../Modules/Goals/helpers/goalRules');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const PROJECT_ID = new mongoose.Types.ObjectId(mockProjectHex);
const OWN_PROJECT_ID = new mongoose.Types.ObjectId('6f0000000000000000000b02');
const MARK = String(PROJECT_ID);

const rows = (type) => mockDb.store[type] || [];
const inSample = (row, key) => String(row[key]) === MARK;

const project = () => ({
    _id: PROJECT_ID,
    CompanyId: COMPANY,
    ProjectName: 'Welcome to AlianHub',
    ProjectCode: 'WELCOME',
    statusType: 'active',
    lastTaskId: 0,
    AssigneeUserId: [OWNER],
    taskTypeCounts: [{ name: 'Task', key: 1, value: 'task' }],
    taskStatusData: [
        { name: 'To Do', key: 1, type: 'default_active' },
        { name: 'In Progress', key: 3, type: 'active' },
        { name: 'In Review', key: 4, type: 'active' },
        { name: 'Backlog', key: 5, type: 'active' },
        { name: 'Done', key: 6, type: 'active' },
        { name: 'Complete', key: 2, type: 'close' },
    ],
});

const seedPeopleAndPersonalRecords = () => {
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Priya Shah' });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT_ID, ProjectCode: 'WELCOME', ProjectName: 'Welcome to AlianHub', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OWN_PROJECT_ID, ProjectCode: 'MINE', ProjectName: 'Mine', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'My doc', ProjectID: OWN_PROJECT_ID, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.GOALS, { name: 'My goal', ownerUserId: OWNER, visibility: 'private', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { fieldTitle: 'Mine', projectId: [String(OWN_PROJECT_ID)], global: false, isDelete: true });
};

let firstSprint;
const seedSample = async () => {
    firstSprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: 'List', projectId: PROJECT_ID, tasks: 0, deletedStatusKey: 0 });
    return seedSampleTasks(project(), firstSprint, demoTasksForFocus(''), OWNER);
};

const response = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};
const removeSample = async (company = COMPANY) => {
    const res = response();
    await trash.removeSampleData({ headers: { companyid: company }, aud: company, uid: OWNER, query: {}, params: {}, body: {} }, res);
    return res;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.crud.mockClear();
    seedPeopleAndPersonalRecords();
});

describe('the welcome project after seeding', () => {
    beforeEach(seedSample);

    test('a folder holds a subfolder, and the subfolder holds a list', () => {
        const folders = rows(SCHEMA_TYPE.FOLDERS).filter((f) => inSample(f, 'projectId'));
        const top = folders.find((f) => !f.parentFolderId);
        const sub = folders.find((f) => f.parentFolderId);
        expect(folders).toHaveLength(2);
        expect(String(sub.parentFolderId)).toBe(String(top._id));
        const list = rows(SCHEMA_TYPE.SPRINTS).find((l) => String(l.folderId) === String(sub._id));
        expect(list).toBeDefined();
        expect(inSample(list, 'projectId')).toBe(true);
    });

    test('one task has subtasks three levels deep, in its own list', () => {
        const tasks = rows(SCHEMA_TYPE.TASKS);
        const deepest = tasks.filter((t) => t.ancestors.length === 2);
        expect(deepest).toHaveLength(1);
        expect(tasks.every((t) => t.ancestors.length <= 2)).toBe(true);
        const [root, middle] = deepest[0].ancestors;
        expect(tasks.find((t) => String(t._id) === root).ancestors).toEqual([]);
        expect(tasks.find((t) => String(t._id) === middle).ParentTaskId).toBe(root);
    });

    test('two fields belong to the project, and a few tasks hold their values', () => {
        const fields = rows(SCHEMA_TYPE.CUSTOM_FIELDS).filter((f) => (f.projectId || []).includes(MARK));
        expect(fields.map((f) => f.fieldType).sort()).toEqual(['dropdown', 'number']);
        fields.forEach((f) => {
            expect(f.global).toBe(false);
            expect(f.type).toBe('task');
            expect(f.isDelete).toBe(true);
        });
        const dropdown = fields.find((f) => f.fieldType === 'dropdown');
        expect(dropdown.fieldOptions.length).toBeGreaterThanOrEqual(2);
        const valued = rows(SCHEMA_TYPE.TASKS).filter((t) => t.customField && Object.keys(t.customField).length);
        expect(valued.length).toBeGreaterThanOrEqual(3);
        const number = fields.find((f) => f.fieldType === 'number');
        const total = valued.reduce((sum, t) => sum + Number(t.customField[String(number._id)].fieldValue), 0);
        expect(total).toBeGreaterThan(0);
        expect(new Set(valued.map((t) => t.customField[String(dropdown._id)].fieldValue[0])).size).toBeGreaterThanOrEqual(2);
    });

    test('a doc in the project holds a heading, a paragraph and a checklist', () => {
        const docs = rows(SCHEMA_TYPE.PAGES).filter((p) => inSample(p, 'ProjectID'));
        expect(docs).toHaveLength(1);
        expect(docs[0].createdBy).toBe(OWNER);
        expect(docs[0].content.blocks.blocks.map((b) => b.type)).toEqual(['header', 'paragraph', 'checklist']);
        expect(docs[0].rawText.length).toBeGreaterThan(20);
        expect(docs[0].content.html).toContain('Working agreement');
        expect(docs[0].createdByAgent).toBeUndefined();
        expect(docs[0].agentStatus).toBeUndefined();
    });

    test('a goal counts the done tasks of the first sample list, and is private to the owner', () => {
        const goals = rows(SCHEMA_TYPE.GOALS).filter((g) => g.sample === true);
        expect(goals).toHaveLength(1);
        expect(goals[0].ownerUserId).toBe(OWNER);
        expect(goals[0].visibility).toBe('private');
        const [target] = goals[0].targets;
        expect(target.kind).toBe(goalsRules.TASKS);
        expect(target.sources.sprintIds).toEqual([String(firstSprint._id)]);
        expect(target.counted.total).toBeGreaterThan(0);
        expect(target.counted.done).toBeGreaterThan(0);
    });

    test('one task is also in the list inside the subfolder', () => {
        const sub = rows(SCHEMA_TYPE.FOLDERS).find((f) => f.parentFolderId);
        const list = rows(SCHEMA_TYPE.SPRINTS).find((l) => String(l.folderId) === String(sub._id));
        const extra = rows(SCHEMA_TYPE.TASKS).filter((t) => (t.extraLists || []).length);
        expect(extra).toHaveLength(1);
        expect(String(extra[0].extraLists[0].sprintId)).toBe(String(list._id));
        expect(String(extra[0].sprintId)).not.toBe(String(list._id));
        expect(extra[0].ancestors).toEqual([]);
    });

    test('every task event the seeding sent names the company', () => {
        const sent = socketEmitter.emit.mock.calls.map(([, payload]) => payload).filter((payload) => payload && payload.module === 'task');
        expect(sent.length).toBeGreaterThan(0);
        sent.forEach((payload) => expect(payload.companyId).toBe(COMPANY));
    });

    test('every call ran in the one company', () => {
        expect(mockDb.crud.mock.calls.length).toBeGreaterThan(20);
        expect(new Set(mockDb.crud.mock.calls.map(([company]) => company))).toEqual(new Set([COMPANY, SCHEMA_TYPE.GOLBAL]));
        rows(SCHEMA_TYPE.TASKS).forEach((t) => expect(t.CompanyId).toBe(COMPANY));
    });

    test('seeding is quiet: no notification, no email, no automation row', () => {
        [SCHEMA_TYPE.NOTIFICATIONS, SCHEMA_TYPE.AUTOMATIONS, SCHEMA_TYPE.AUTOMATION_RUNS].filter(Boolean)
            .forEach((type) => expect(rows(type)).toHaveLength(0));
        const touched = new Set(mockDb.crud.mock.calls.map(([, query]) => query.type));
        [...touched].forEach((type) => expect(String(type)).not.toMatch(/notification|email|mail|automation/i));
    });
});

describe('removing the sample', () => {
    beforeEach(seedSample);

    test('takes every kind it made', async () => {
        const res = await removeSample();
        expect(res.body.data).toMatchObject({ projects: 1, folders: 2, docs: 1, fields: 2, goals: 1 });
        expect(res.body.data.lists).toBe(4);
        expect(rows(SCHEMA_TYPE.PROJECTS).find((p) => inSample(p, '_id')).deletedStatusKey).toBe(1);
        const gone = (type, key) => rows(type).filter((r) => inSample(r, key)).every((r) => r.deletedStatusKey === 1);
        expect(gone(SCHEMA_TYPE.TASKS, 'ProjectID')).toBe(true);
        expect(gone(SCHEMA_TYPE.FOLDERS, 'projectId')).toBe(true);
        expect(gone(SCHEMA_TYPE.SPRINTS, 'projectId')).toBe(true);
        expect(gone(SCHEMA_TYPE.PAGES, 'ProjectID')).toBe(true);
        expect(rows(SCHEMA_TYPE.GOALS).find((g) => g.sample).deletedStatusKey).toBe(1);
        rows(SCHEMA_TYPE.CUSTOM_FIELDS).filter((f) => (f.projectId || []).includes(MARK)).forEach((f) => expect(f.isDelete).toBe(false));
    });

    test("leaves a person's own project, doc, goal and field", async () => {
        await removeSample();
        expect(rows(SCHEMA_TYPE.PROJECTS).find((p) => p.ProjectCode === 'MINE').deletedStatusKey).toBe(0);
        expect(rows(SCHEMA_TYPE.PAGES).find((p) => p.title === 'My doc').deletedStatusKey).toBe(0);
        expect(rows(SCHEMA_TYPE.GOALS).find((g) => g.name === 'My goal').deletedStatusKey).toBe(0);
        expect(rows(SCHEMA_TYPE.CUSTOM_FIELDS).find((f) => f.fieldTitle === 'Mine').isDelete).toBe(true);
    });

    test('every read and write of the removal is scoped to the company', async () => {
        mockDb.crud.mockClear();
        await removeSample();
        expect(mockDb.crud.mock.calls.length).toBeGreaterThan(5);
        expect(new Set(mockDb.crud.mock.calls.map(([company]) => company))).toEqual(new Set([COMPANY]));
    });
});

describe('what removing the sample tells everyone else', () => {
    beforeEach(seedSample);

    const sentBy = async (act) => {
        socketEmitter.emit.mockClear();
        await act();
        return socketEmitter.emit.mock.calls.map(([type, payload]) => ({ type, ...payload }));
    };

    test('the docs are announced as their own trash path announces them, and the folders go with the project, each event with the company', async () => {
        const docIds = rows(SCHEMA_TYPE.PAGES).filter((p) => inSample(p, 'ProjectID')).map((p) => String(p._id));
        const sent = await sentBy(removeSample);
        expect(sent.filter((event) => event.module === 'folders')).toEqual([]);
        expect(sent.filter((event) => event.module === 'project')).toHaveLength(1);
        const docs = sent.filter((event) => event.module === 'pages');
        expect(docs).toHaveLength(1);
        expect(docs[0]).toMatchObject({ type: 'update', companyId: COMPANY, data: { deletedStatusKey: 1, deleted: docIds.length, ids: docIds } });
        expect(sent.length).toBeGreaterThanOrEqual(3);
        sent.forEach((event) => expect(event.companyId).toBe(COMPANY));
    });

    test('the cached project lists are dropped after the last list and folder is written', async () => {
        removeCache.mockClear();
        mockDb.crud.mockClear();
        await removeSample();
        const cleared = removeCache.mock.calls
            .map((args, index) => ({ args, order: removeCache.mock.invocationCallOrder[index] }))
            .filter(({ args }) => args[0] === 'UserProjectData:' && args[1] === true);
        expect(cleared.length).toBeGreaterThan(0);
        const writes = mockDb.crud.mock.calls
            .map(([, query, method], index) => ({ type: query.type, method, order: mockDb.crud.mock.invocationCallOrder[index] }))
            .filter(({ type, method }) => method === 'updateMany' && [SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.FOLDERS].includes(type));
        expect(writes.length).toBeGreaterThanOrEqual(2);
        expect(cleared[cleared.length - 1].order).toBeGreaterThan(Math.max(...writes.map((write) => write.order)));
    });

    test('nothing is announced when there was no sample to remove', async () => {
        await removeSample();
        const sent = await sentBy(removeSample);
        expect(sent).toEqual([]);
    });
});

describe("a person's own task that was added to a sample list", () => {
    beforeEach(seedSample);

    const oid = (value) => new mongoose.Types.ObjectId(String(value));
    const sampleSubfolderList = () => {
        const sub = rows(SCHEMA_TYPE.FOLDERS).find((f) => f.parentFolderId);
        return rows(SCHEMA_TYPE.SPRINTS).find((l) => String(l.folderId) === String(sub._id));
    };
    const seedOwnTask = () => {
        const home = mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: 'Mine', projectId: OWN_PROJECT_ID, deletedStatusKey: 0 });
        const second = mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: 'Also mine', projectId: OWN_PROJECT_ID, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.TASKS, {
            TaskName: 'My task', ProjectID: OWN_PROJECT_ID, sprintId: oid(home._id), deletedStatusKey: 0, CompanyId: COMPANY,
            extraLists: [
                { projectId: PROJECT_ID, sprintId: oid(sampleSubfolderList()._id), addedBy: OWNER, addedAt: new Date() },
                { projectId: OWN_PROJECT_ID, sprintId: oid(second._id), addedBy: OWNER, addedAt: new Date() },
            ],
        });
        return { second };
    };
    const ownTask = () => rows(SCHEMA_TYPE.TASKS).find((t) => t.TaskName === 'My task');

    test('leaves the sample list and stays where it lives, with its other lists', async () => {
        const { second } = seedOwnTask();
        await removeSample();
        expect(ownTask().deletedStatusKey).toBe(0);
        expect(ownTask().extraLists.map((entry) => String(entry.sprintId))).toEqual([String(second._id)]);
    });

    test('the list it left is named in the task event, so the row goes from that list on every open client', async () => {
        seedOwnTask();
        const sampleList = String(sampleSubfolderList()._id);
        socketEmitter.emit.mockClear();
        await removeSample();
        const told = socketEmitter.emit.mock.calls.map(([, payload]) => payload)
            .filter((payload) => payload.module === 'task' && String(payload.data._id) === String(ownTask()._id));
        expect(told).toHaveLength(1);
        expect(told[0]).toMatchObject({ type: 'update', companyId: COMPANY, leftLists: [{ projectId: MARK, sprintId: sampleList }] });
        expect(told[0].updatedFields.extraLists).toHaveLength(1);
    });

    test("the sample's own task keeps its entry, so restoring the project from the trash brings it back whole", async () => {
        seedOwnTask();
        const sampleList = String(sampleSubfolderList()._id);
        await removeSample();
        const kept = rows(SCHEMA_TYPE.TASKS).filter((t) => inSample(t, 'ProjectID') && (t.extraLists || []).length);
        expect(kept).toHaveLength(1);
        expect(String(kept[0].extraLists[0].sprintId)).toBe(sampleList);
    });
});

describe('what counts as sample', () => {
    beforeEach(seedSample);

    const goals = require('../Modules/Goals/controller');
    const ask = async (handler, { body, id } = {}) => {
        const res = response();
        res.json = res.send;
        await handler({ headers: { companyid: COMPANY }, aud: COMPANY, uid: OWNER, body, query: {}, params: { id } }, res);
        return res;
    };
    const marked = () => rows(SCHEMA_TYPE.GOALS).filter((g) => g.sample !== undefined || g.sampleProjectId !== undefined);

    test('the seeded goal names the welcome project it came with', () => {
        expect(marked()).toHaveLength(1);
        expect(marked()[0]).toMatchObject({ sample: true, sampleProjectId: MARK, name: 'Finish the getting-started tasks' });
    });

    test('the goal schema stores both marks, and no doc, folder or list has one', () => {
        const { checkType } = jest.requireActual('../utils/mongo-handler/mongoQueries');
        expect(checkType(SCHEMA_TYPE.GOALS).path('sample')).toBeDefined();
        expect(checkType(SCHEMA_TYPE.GOALS).path('sampleProjectId')).toBeDefined();
        [SCHEMA_TYPE.PAGES, SCHEMA_TYPE.FOLDERS, SCHEMA_TYPE.SPRINTS].forEach((type) => {
            expect(Object.keys(checkType(type).paths).filter((path) => /sample/i.test(path))).toEqual([]);
        });
    });

    test('a goal request that names either mark is refused, and stores nothing', async () => {
        const mine = rows(SCHEMA_TYPE.GOALS).find((g) => g.name === 'My goal');
        const asked = [
            await ask(goals.createGoal, { body: { name: 'Mine too', sample: true } }),
            await ask(goals.createGoal, { body: { name: 'Mine too', sampleProjectId: MARK } }),
            await ask(goals.updateGoal, { id: String(mine._id), body: { sample: true } }),
            await ask(goals.updateGoal, { id: String(mine._id), body: { name: 'My goal', sampleProjectId: MARK } }),
        ];
        expect(asked.map((res) => res.statusCode)).toEqual([400, 400, 400, 400]);
        expect(rows(SCHEMA_TYPE.GOALS).filter((g) => g.name === 'Mine too')).toHaveLength(0);
        expect(marked()).toHaveLength(1);
    });

    test('a goal, doc, folder or list outside the welcome project stays, whatever it carries', async () => {
        mockDb.seed(SCHEMA_TYPE.GOALS, { name: 'Flag alone', ownerUserId: OWNER, sample: true, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.GOALS, { name: 'Another project', ownerUserId: OWNER, sample: true, sampleProjectId: String(OWN_PROJECT_ID), deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.GOALS, { name: 'Id alone', ownerUserId: OWNER, sampleProjectId: MARK, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Marked doc', ProjectID: OWN_PROJECT_ID, sample: true, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.FOLDERS, { name: 'Marked folder', projectId: OWN_PROJECT_ID, sample: true, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: 'Marked list', projectId: OWN_PROJECT_ID, sample: true, deletedStatusKey: 0 });
        const res = await removeSample();
        expect(res.body.data).toMatchObject({ goals: 1, docs: 1, folders: 2, lists: 4 });
        ['Flag alone', 'Another project', 'Id alone'].forEach((name) => expect(rows(SCHEMA_TYPE.GOALS).find((g) => g.name === name).deletedStatusKey).toBe(0));
        expect(rows(SCHEMA_TYPE.PAGES).find((p) => p.title === 'Marked doc').deletedStatusKey).toBe(0);
        expect(rows(SCHEMA_TYPE.FOLDERS).find((f) => f.name === 'Marked folder').deletedStatusKey).toBe(0);
        expect(rows(SCHEMA_TYPE.SPRINTS).find((l) => l.name === 'Marked list').deletedStatusKey).toBe(0);
    });

    test('the goal of a welcome project that is already in the trash still goes', async () => {
        rows(SCHEMA_TYPE.PROJECTS).find((p) => inSample(p, '_id')).deletedStatusKey = 1;
        const res = await removeSample();
        expect(res.body.data).toMatchObject({ projects: 0, goals: 1 });
    });
});

describe('a kind that cannot be made does not lose the others', () => {
    test('without the owner seat the goal is skipped and the tasks, doc and folders still exist', async () => {
        mockDb.store[SCHEMA_TYPE.COMPANY_USERS].length = 0;
        const { sharedProjects } = require('../Modules/AI/publicSources');
        sharedProjects.mockResolvedValueOnce([]);
        await seedSample();
        expect(rows(SCHEMA_TYPE.TASKS).length).toBeGreaterThan(10);
        expect(rows(SCHEMA_TYPE.GOALS).filter((g) => g.sample)).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.PAGES).filter((p) => inSample(p, 'ProjectID'))).toHaveLength(1);
        expect(rows(SCHEMA_TYPE.FOLDERS).filter((f) => inSample(f, 'projectId'))).toHaveLength(2);
    });
});
