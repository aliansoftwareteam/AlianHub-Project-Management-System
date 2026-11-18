const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({ hiddenSprintFilter: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { hiddenSprintFilter } = require('../Modules/Sprints/helpers/sprintVisibility');
const { recordVisit, listVisits } = require('../Modules/RecentVisits/controller');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const LOST_PROJECT = '6f0000000000000000000a02';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const FOLDER = '6f0000000000000000000f01';
const HIDDEN_SPRINT = '6f0000000000000000000d02';

const reply = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};

const call = async (handler, { body, query = {}, companyId = C } = {}) => {
    const res = reply();
    await handler({ headers: { companyid: companyId }, uid: ME, body, query }, res);
    return res;
};

const visit = (entityType, entityId, at, userId = ME) => mockDb.seed(SCHEMA_TYPE.RECENTVISITS, { userId, entityType, entityId, visitedAt: new Date(at) });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    visibleProjectIds.mockResolvedValue([PROJECT]);
    hiddenSprintFilter.mockResolvedValue({});
});

describe('recording visits to projects, sprints and docs', () => {
    it.each(['project', 'sprint', 'doc', 'task'])('records a %s visit', async (entityType) => {
        const res = await call(recordVisit, { body: { entityType, entityId: PROJECT } });
        expect(res.body.status).toBe(true);
        const written = mockDb.calls[mockDb.calls.length - 1];
        expect(written).toMatchObject({ companyId: C, type: SCHEMA_TYPE.RECENTVISITS, method: 'updateOne' });
        expect(written.data[0]).toMatchObject({ userId: ME, entityType });
    });

    it('refuses an unknown type or a malformed id', async () => {
        expect((await call(recordVisit, { body: { entityType: 'comment', entityId: PROJECT } })).body.status).toBe(false);
        expect((await call(recordVisit, { body: { entityType: 'project', entityId: 'nope' } })).body.status).toBe(false);
        expect(mockDb.crud).not.toHaveBeenCalled();
    });
});

describe('listing recent visits of every type', () => {
    const seedWorld = () => {
        const project = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Budget ops', deletedStatusKey: 0 });
        const lostProject = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: LOST_PROJECT, ProjectName: 'Gone away', deletedStatusKey: 0 });
        const firstSprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: 'Sprint 1', projectId: PROJECT, folderId: FOLDER, deletedStatusKey: 0 });
        const sprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: 'Sprint 2', projectId: PROJECT, deletedStatusKey: 0 });
        const hiddenSprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: HIDDEN_SPRINT, name: 'Private', projectId: PROJECT, private: true, deletedStatusKey: 0 });
        const deletedSprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: 'Deleted', projectId: PROJECT, deletedStatusKey: 1 });
        const lostSprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: 'Elsewhere', projectId: LOST_PROJECT, deletedStatusKey: 0 });
        const doc = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Budget wiki', ProjectID: PROJECT, deletedStatusKey: 0 });
        const companyDoc = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Handbook', ProjectID: null, deletedStatusKey: 0 });
        const theirPrivateDoc = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Their notes', ProjectID: PROJECT, visibility: 'private', createdBy: OTHER, deletedStatusKey: 0 });
        const deletedDoc = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Binned', ProjectID: PROJECT, deletedStatusKey: 1 });
        const lostDoc = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Other project doc', ProjectID: LOST_PROJECT, deletedStatusKey: 0 });
        const task = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Still mine', TaskKey: 'AH-1', ProjectID: PROJECT, sprintId: sprint._id, deletedStatusKey: 0 });
        return { project, lostProject, firstSprint, sprint, hiddenSprint, deletedSprint, lostSprint, doc, companyDoc, theirPrivateDoc, deletedDoc, lostDoc, task };
    };

    it('keeps the old task-only answer when no types are asked for', async () => {
        const w = seedWorld();
        visit('project', w.project._id, 3);
        visit('task', w.task._id, 2);
        const res = await call(listVisits);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].task.TaskName).toBe('Still mine');
        expect(res.body.data[0]).toMatchObject({ type: 'task', id: String(w.task._id), title: 'Still mine' });
    });

    it('returns projects, sprints, docs and tasks newest first, with a title, project and route', async () => {
        const w = seedWorld();
        visit('project', w.project._id, 5);
        visit('sprint', w.sprint._id, 4);
        visit('doc', w.doc._id, 3);
        visit('task', w.task._id, 2);
        visit('doc', w.companyDoc._id, 1);

        const res = await call(listVisits, { query: { types: 'task,project,sprint,doc' } });
        expect(res.body.status).toBe(true);
        expect(res.body.data.map((row) => [row.type, row.title])).toEqual([
            ['project', 'Budget ops'],
            ['sprint', 'Sprint 2'],
            ['doc', 'Budget wiki'],
            ['task', 'Still mine'],
            ['doc', 'Handbook'],
        ]);
        const [project, sprint, doc, task, companyDoc] = res.body.data;
        expect(project).toMatchObject({ id: PROJECT, projectId: PROJECT, projectName: 'Budget ops', route: { projectId: PROJECT, sprintId: String(w.firstSprint._id), folderId: FOLDER } });
        expect(sprint).toMatchObject({ id: String(w.sprint._id), projectName: 'Budget ops', route: { projectId: PROJECT, sprintId: String(w.sprint._id), folderId: '' } });
        expect(doc).toMatchObject({ id: String(w.doc._id), projectName: 'Budget ops', route: { pageId: String(w.doc._id), projectId: PROJECT } });
        expect(task).toMatchObject({ projectName: 'Budget ops', route: { projectId: PROJECT, sprintId: String(w.sprint._id), taskId: String(w.task._id) } });
        expect(task.task.TaskKey).toBe('AH-1');
        expect(companyDoc).toMatchObject({ projectId: '', projectName: '', route: { pageId: String(w.companyDoc._id), projectId: '' } });
        expect(res.body.data.every((row) => row.visitedAt)).toBe(true);
    });

    it('accepts types=all', async () => {
        const w = seedWorld();
        visit('sprint', w.sprint._id, 2);
        visit('task', w.task._id, 1);
        const res = await call(listVisits, { query: { types: 'all' } });
        expect(res.body.data.map((row) => row.type)).toEqual(['sprint', 'task']);
    });

    it('drops what the caller can no longer open: lost projects, private or deleted sprints and docs', async () => {
        const w = seedWorld();
        hiddenSprintFilter.mockResolvedValue({ sprintId: { $nin: [HIDDEN_SPRINT] } });
        visit('project', w.lostProject._id, 12);
        visit('sprint', w.hiddenSprint._id, 11);
        visit('sprint', w.deletedSprint._id, 10);
        visit('sprint', w.lostSprint._id, 9);
        visit('doc', w.theirPrivateDoc._id, 8);
        visit('doc', w.deletedDoc._id, 7);
        visit('doc', w.lostDoc._id, 6);
        visit('project', '6f0000000000000000000a99', 5);
        visit('sprint', w.sprint._id, 1);

        const res = await call(listVisits, { query: { types: 'all' } });
        expect(res.body.data.map((row) => row.title)).toEqual(['Sprint 2']);
    });

    it('never lands a recent project on a sprint the caller cannot see', async () => {
        const w = seedWorld();
        mockDb.store[SCHEMA_TYPE.SPRINTS].length = 0;
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: HIDDEN_SPRINT, name: 'Private', projectId: PROJECT, private: true, deletedStatusKey: 0 });
        hiddenSprintFilter.mockResolvedValue({ sprintId: { $nin: [HIDDEN_SPRINT] } });
        visit('project', w.project._id, 1);
        const res = await call(listVisits, { query: { types: 'project' } });
        expect(res.body.data[0].route).toEqual({ projectId: PROJECT, sprintId: '', folderId: '' });
    });

    it('reads only the caller\'s own visits in this company', async () => {
        const w = seedWorld();
        visit('project', w.project._id, 2, OTHER);
        visit('sprint', w.sprint._id, 1);
        const res = await call(listVisits, { query: { types: 'all' } });
        expect(res.body.data.map((row) => row.type)).toEqual(['sprint']);
        expect(mockDb.calls.every((c) => c.companyId === C)).toBe(true);
    });

    it('caps the list, and honours a smaller limit', async () => {
        const w = seedWorld();
        for (let i = 0; i < 20; i += 1) {
            const doc = mockDb.seed(SCHEMA_TYPE.PAGES, { title: `Doc ${i}`, ProjectID: PROJECT, deletedStatusKey: 0 });
            visit('doc', doc._id, 100 - i);
        }
        visit('sprint', w.sprint._id, 1);
        expect((await call(listVisits, { query: { types: 'all' } })).body.data).toHaveLength(15);
        expect((await call(listVisits, { query: { types: 'all', limit: '4' } })).body.data.map((row) => row.title)).toEqual(['Doc 0', 'Doc 1', 'Doc 2', 'Doc 3']);
        expect((await call(listVisits, { query: { types: 'all', limit: '500' } })).body.data).toHaveLength(15);
    });

    it('ignores types it does not know', async () => {
        const w = seedWorld();
        visit('sprint', w.sprint._id, 2);
        visit('task', w.task._id, 1);
        const res = await call(listVisits, { query: { types: 'sprint,comment' } });
        expect(res.body.data.map((row) => row.type)).toEqual(['sprint']);
    });
});
