const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, firstSprint, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* PATCH /api/v1/sprint/:id and /api/v1/folder/:id build their write from the fields the sprint list edits. */

const state = readState();
let client;
let owner;
let project;
let other;

const db = () => client.db(state.companyId);
const oid = (id) => new ObjectId(String(id));
const userData = () => ({ id: owner.uid, Employee_Name: 'Olivia Owner', companyOwnerId: owner.uid });
const projectData = (p) => ({ id: String(p._id), ProjectName: p.ProjectName });

const patchSprint = (id, updateObject, extra = {}) => owner.api.patch(`/api/v1/sprint/${id}`, {
    companyId: state.companyId, projectId: project._id, folderId: null, type: 'updateSprint', updateObject, userData: userData(),
    sprintName: 'List', projectData: projectData(project), folderName: '', ...extra,
});

const patchFolder = (id, updateObject, extra = {}) => owner.api.patch(`/api/v1/folder/${id}`, {
    companyId: state.companyId, projectId: project._id, type: 'updateFolder', updateObject, userData: userData(),
    folderName: 'Q3', projectData: projectData(project), sprints: [], ...extra,
});

const newSprint = async (p, doc = {}) => {
    const { insertedId } = await db().collection('sprints').insertOne({ name: `SPF ${uniqueSuffix()}`, projectId: oid(p._id), private: false, deletedStatusKey: 0, tasks: 0, ...doc });
    return String(insertedId);
};
const newFolder = async (p) => String((await db().collection('folders').insertOne({ name: `SPF folder ${uniqueSuffix()}`, projectId: oid(p._id), deletedStatusKey: 0 })).insertedId);
const newTask = async (p, sprintId, doc = {}) => String((await db().collection('tasks').insertOne({ TaskName: 'SPF', ProjectID: oid(p._id), sprintId: oid(sprintId), deletedStatusKey: 0, ...doc })).insertedId);
const stored = (collection, id) => db().collection(collection).findOne({ _id: oid(id) });
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
    project = await createProject(owner.api, { name: `SPF ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    other = await createProject(owner.api, { name: `SPF other ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
});

afterAll(async () => {
    if (client) await client.close();
});

describe('a sprint update', () => {
    it.each([
        ['a rename onto the trash key', { $rename: { watchers: 'deletedStatusKey' } }],
        ['a move to another project', { $set: { projectId: '000000000000000000000001' } }],
        ['a name through the update path', { $set: { name: 'renamed' } }],
    ])('refuses %s with 400 and writes nothing', async (_label, updateObject) => {
        const id = await newSprint(project, { watchers: [owner.uid] });
        const before = await stored('sprints', id);
        const res = await patchSprint(id, updateObject);
        expect([res.status, res.body.status]).toEqual([400, false]);
        expect(await stored('sprints', id)).toEqual(before);
    });

    it('creates nothing for a sprint id that does not exist', async () => {
        const missing = new ObjectId();
        const res = await patchSprint(String(missing), { $set: { deletedStatusKey: 2 } }, { updatedValueDeleteStatusKey: 2 });
        expect(res.body.status).toBe(false);
        expect(await stored('sprints', missing)).toBeNull();
    });

    it('cascades the trash key it wrote, not the separate status field', async () => {
        const id = await newSprint(project);
        const task = await newTask(project, id);
        const res = await patchSprint(id, { $set: { deletedStatusKey: 2 } }, { updatedValueDeleteStatusKey: 1 });
        expect(res.body.status).toBe(true);
        await settle();
        expect((await stored('tasks', task)).deletedStatusKey).toBe(4);
    });

    it('moves a sprint only into a folder of its own project', async () => {
        const id = await newSprint(project);
        const elsewhere = await newFolder(other);
        const refused = await patchSprint(id, { $set: { folderId: elsewhere, folderName: 'x' } });
        expect(refused.status).toBe(400);
        expect((await stored('sprints', id)).folderId).toBeUndefined();

        const here = await newFolder(project);
        const moved = await patchSprint(id, { $set: { folderId: here, folderName: 'x' } }, { historyData: { type: 'moved' } });
        expect(moved.body.status).toBe(true);
        expect(String((await stored('sprints', id)).folderId)).toBe(here);
    });
});

describe('a folder update', () => {
    it('refuses anything but the trash key with 400', async () => {
        const id = await newFolder(project);
        const res = await patchFolder(id, { $set: { deletedStatusKey: 2, projectId: String(other._id) } }, { updatedValueDeleteStatusKey: 2 });
        expect(res.status).toBe(400);
        expect(String((await stored('folders', id)).projectId)).toBe(String(project._id));
    });

    it('cascades onto the folder\'s own sprints, not the ones the request lists', async () => {
        const folder = await newFolder(project);
        const inside = await newSprint(project, { folderId: oid(folder) });
        const outside = await newSprint(project);
        const insideTask = await newTask(project, inside);
        const outsideTask = await newTask(project, outside);
        const res = await patchFolder(folder, { $set: { deletedStatusKey: 2 } }, { updatedValueDeleteStatusKey: 2, sprints: [outside] });
        expect(res.body.status).toBe(true);
        await settle();
        expect((await stored('tasks', insideTask)).deletedStatusKey).toBe(6);
        expect((await stored('tasks', outsideTask)).deletedStatusKey).toBe(0);
    });
});

it('keeps the first sprint of a new project usable for the list screens', async () => {
    const sprint = await firstSprint(owner.api, project._id);
    const res = await patchSprint(String(sprint._id || sprint.id), { $addToSet: { watchers: owner.uid } });
    expect(res.body.status).toBe(true);
});
