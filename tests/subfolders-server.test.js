const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDbs;
const mockDbOf = (companyId) => {
    mockDbs[companyId] = mockDbs[companyId] || fakeMongo.create();
    return mockDbs[companyId];
};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => mockDbOf(companyId).crud(companyId, ...rest),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ unsetAllCounts: jest.fn(async () => ({})), updateUnReadCommentsCount: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => ({ status: true })) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { unsetAllCounts } = require('../Modules/notification-count/controller');
const socketEmitter = require('../event/socketEventEmitter');

const C = 'c00000000000000000000001';
const ELSEWHERE = 'c00000000000000000000002';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const MEMBER_ROLE = 3;
const ARCHIVED_WITH_FOLDER = 6;
const oid = () => new mongoose.Types.ObjectId().toString();

const routes = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers.flat(); };
    require('../Modules/Sprints/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });
    return table;
};

const settle = async () => { for (let i = 0; i < 60; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const run = async (route, { uid = OWNER, company = C, id, body }) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    const req = verified({ uid, params: { id }, body: { companyId: company, ...body }, query: {}, headers: { companyid: company } });
    for (const handler of routes()[route]) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await settle();
    return res;
};

const db = (company = C) => mockDbOf(company);
const rowsOf = (type, company = C) => db(company).store[type] || [];
const stored = (type, id, company = C) => rowsOf(type, company).find((row) => String(row._id) === String(id));
const statusOf = (type, id) => stored(type, id).deletedStatusKey;
const snapshot = (type) => JSON.stringify(rowsOf(type));

const seedCompany = (company) => {
    db(company).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    db(company).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
};
const projectIn = (company = C, name = 'Launch') => String(db(company).seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: name, isPrivateSpace: false, AssigneeUserId: [] })._id);
const folderIn = (doc = {}, company = C) => String(db(company).seed(SCHEMA_TYPE.FOLDERS, { _id: oid(), projectId: project, name: 'Q3', deletedStatusKey: 0, ...doc })._id);
const sprintIn = (doc = {}) => String(db().seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: project, name: 'Sprint 1', private: false, deletedStatusKey: 0, ...doc })._id);
const taskIn = (sprintId, deletedStatusKey = 0) => String(db().seed(SCHEMA_TYPE.TASKS, { _id: oid(), ProjectID: project, sprintId, TaskName: 'Task', deletedStatusKey })._id);

const seedRules = (grants) => {
    const parent = db().seed(SCHEMA_TYPE.RULES, { key: 'project', isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
    Object.entries(grants).forEach(([path, permission]) => {
        db().seed(SCHEMA_TYPE.RULES, { key: path.split('.')[1], isParent: false, parentId: String(parent._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

const ADD = 'POST /api/v1/folder';
const PATCH = 'PATCH /api/v1/folder/:id';
const add = (body, options = {}) => run(ADD, { ...options, body: { projectId: project, folderName: 'Sub', ...body } });
const move = (id, parentFolderId, options = {}) => run(PATCH, { ...options, id, body: { type: 'moveFolder', projectId: project, parentFolderId } });
const setStatus = (id, deletedStatusKey) => run(PATCH, { id, body: { type: 'updateFolder', projectId: project, folderName: 'Q3', projectData: { id: project, ProjectName: 'Launch' }, updateObject: { $set: { deletedStatusKey } } } });

const refused = (res) => {
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ status: false, statusText: expect.any(String), message: expect.any(String) });
    expect(res.body.statusText).toBe(res.body.message);
    return res.body.statusText;
};

let project;
beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDbs = {};
    seedCompany(C);
    seedCompany(ELSEWHERE);
    project = projectIn();
});

describe('adding a folder', () => {
    it('stores no parent on a root folder', async () => {
        const res = await add({});
        expect(res.body).toMatchObject({ status: true });
        expect(rowsOf(SCHEMA_TYPE.FOLDERS)).toHaveLength(1);
        expect(rowsOf(SCHEMA_TYPE.FOLDERS)[0]).not.toHaveProperty('parentFolderId');
    });

    it('stores the parent of a subfolder and answers it', async () => {
        const parent = folderIn();
        const res = await add({ parentFolderId: parent });
        expect(res.body).toMatchObject({ status: true });
        expect(String(res.body.data.parentFolderId)).toBe(parent);
        const saved = rowsOf(SCHEMA_TYPE.FOLDERS).find((row) => row.name === 'Sub');
        expect(String(saved.parentFolderId)).toBe(parent);
        expect(String(saved.projectId)).toBe(project);
    });

    it('names the parent in the history line', async () => {
        const parent = folderIn({ name: 'Design <b>' });
        await add({ parentFolderId: parent });
        const [line] = rowsOf(SCHEMA_TYPE.HISTORY);
        expect(line.Message).toContain('in <b>Design &lt;b&gt;</b> folder');
    });

    it('refuses a parent in another project', async () => {
        const other = projectIn(C, 'Other');
        const parent = folderIn({ projectId: other });
        expect(refused(await add({ parentFolderId: parent }))).toMatch(/not in this project/);
        expect(rowsOf(SCHEMA_TYPE.FOLDERS)).toHaveLength(1);
    });

    it('refuses a deleted parent', async () => {
        const parent = folderIn({ deletedStatusKey: 1 });
        expect(refused(await add({ parentFolderId: parent }))).toMatch(/deleted/);
        expect(rowsOf(SCHEMA_TYPE.FOLDERS)).toHaveLength(1);
    });

    it('refuses a parent that is itself a subfolder', async () => {
        const root = folderIn();
        const sub = folderIn({ parentFolderId: root });
        expect(refused(await add({ parentFolderId: sub }))).toMatch(/one level/);
        expect(rowsOf(SCHEMA_TYPE.FOLDERS)).toHaveLength(2);
    });

    it.each([['text', 'not-an-id'], ['an object', { $ne: null }], ['a number', 7]])('refuses a parent id that is %s', async (_label, parentFolderId) => {
        refused(await add({ parentFolderId }));
        expect(rowsOf(SCHEMA_TYPE.FOLDERS)).toHaveLength(0);
    });

    it('refuses a parent that lives in another company', async () => {
        const theirs = folderIn({ projectId: project }, ELSEWHERE);
        const before = db(ELSEWHERE).crud.mock.calls.length;
        expect(refused(await add({ parentFolderId: theirs }))).toMatch(/not in this project/);
        expect(db(ELSEWHERE).crud.mock.calls).toHaveLength(before);
        expect(db().crud.mock.calls.every(([companyId]) => companyId === C)).toBe(true);
    });
});

describe('moving a folder', () => {
    it('moves a folder under a parent and writes nothing else', async () => {
        const parent = folderIn({ name: 'Design' });
        const folder = folderIn({ name: 'Icons' });
        const sprint = sprintIn({ folderId: folder });
        taskIn(sprint);
        const sprints = snapshot(SCHEMA_TYPE.SPRINTS);
        const tasks = snapshot(SCHEMA_TYPE.TASKS);

        const res = await move(folder, parent);

        expect(res.body).toMatchObject({ status: true, data: { name: 'Icons', deletedStatusKey: 0 } });
        expect(String(res.body.data._id)).toBe(folder);
        expect(String(res.body.data.parentFolderId)).toBe(parent);
        expect(stored(SCHEMA_TYPE.FOLDERS, folder)).toMatchObject({ name: 'Icons', deletedStatusKey: 0, projectId: project });
        expect(String(stored(SCHEMA_TYPE.FOLDERS, folder).parentFolderId)).toBe(parent);
        expect(stored(SCHEMA_TYPE.FOLDERS, parent)).not.toHaveProperty('parentFolderId');
        expect(snapshot(SCHEMA_TYPE.SPRINTS)).toBe(sprints);
        expect(snapshot(SCHEMA_TYPE.TASKS)).toBe(tasks);
    });

    it('moves a subfolder back to the top level', async () => {
        const parent = folderIn();
        const folder = folderIn({ parentFolderId: parent });
        const res = await move(folder, null);
        expect(res.body).toMatchObject({ status: true });
        expect(res.body.data.parentFolderId == null).toBe(true);
        expect(stored(SCHEMA_TYPE.FOLDERS, folder)).not.toHaveProperty('parentFolderId');
    });

    it('records the move with the stored names', async () => {
        const parent = folderIn({ name: 'Design' });
        const folder = folderIn({ name: 'Icons <i>' });
        await move(folder, parent);
        await move(folder, null);
        const lines = rowsOf(SCHEMA_TYPE.HISTORY).map((row) => row.Message);
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('<b>Icons &lt;i&gt;</b> folder into <b>Design</b> folder in <b>Launch</b> project');
        expect(lines[1]).toContain('<b>Icons &lt;i&gt;</b> folder out of <b>Design</b> folder in <b>Launch</b> project');
    });

    it('refuses a move that names no parent', async () => {
        const folder = folderIn();
        refused(await run(PATCH, { id: folder, body: { type: 'moveFolder', projectId: project } }));
    });

    it('refuses a folder as its own parent', async () => {
        const folder = folderIn();
        expect(refused(await move(folder, folder))).toMatch(/itself/);
        expect(stored(SCHEMA_TYPE.FOLDERS, folder)).not.toHaveProperty('parentFolderId');
    });

    it('refuses a cycle between two folders', async () => {
        const parent = folderIn();
        const child = folderIn({ parentFolderId: parent });
        refused(await move(parent, child));
        expect(stored(SCHEMA_TYPE.FOLDERS, parent)).not.toHaveProperty('parentFolderId');
    });

    it('refuses to put a folder under a subfolder', async () => {
        const root = folderIn();
        const sub = folderIn({ parentFolderId: root });
        const folder = folderIn();
        expect(refused(await move(folder, sub))).toMatch(/one level/);
        expect(stored(SCHEMA_TYPE.FOLDERS, folder)).not.toHaveProperty('parentFolderId');
    });

    it('refuses to make a subfolder of a folder that holds subfolders', async () => {
        const folder = folderIn();
        folderIn({ parentFolderId: folder });
        const target = folderIn();
        expect(refused(await move(folder, target))).toMatch(/one level/);
        expect(stored(SCHEMA_TYPE.FOLDERS, folder)).not.toHaveProperty('parentFolderId');
    });

    it('lets a folder whose only subfolder is deleted move', async () => {
        const folder = folderIn();
        folderIn({ parentFolderId: folder, deletedStatusKey: 1 });
        const target = folderIn();
        expect((await move(folder, target)).body).toMatchObject({ status: true });
    });

    it('refuses a parent in another project, a deleted parent and a parent in another company', async () => {
        const folder = folderIn();
        const other = projectIn(C, 'Other');
        expect(refused(await move(folder, folderIn({ projectId: other })))).toMatch(/not in this project/);
        expect(refused(await move(folder, folderIn({ deletedStatusKey: 1 })))).toMatch(/deleted/);
        expect(refused(await move(folder, folderIn({}, ELSEWHERE)))).toMatch(/not in this project/);
        expect(stored(SCHEMA_TYPE.FOLDERS, folder)).not.toHaveProperty('parentFolderId');
    });

    it('answers folder not found for an id that is not stored, or stored in another company', async () => {
        const parent = folderIn();
        expect((await move(oid(), parent)).body).toMatchObject({ status: false, statusText: 'Folder not found' });
        const theirs = folderIn({}, ELSEWHERE);
        expect((await move(theirs, parent)).body).toMatchObject({ status: false });
        expect(stored(SCHEMA_TYPE.FOLDERS, theirs, ELSEWHERE)).not.toHaveProperty('parentFolderId');
    });

    it('needs a folder permission the member holds', async () => {
        const parent = folderIn();
        const folder = folderIn();
        seedRules({ 'project.project_folder_name_edit': false, 'project.project_folder_create': false, 'project.folder_archive': true });
        const denied = await move(folder, parent, { uid: MEMBER });
        expect(denied.statusCode).toBe(403);
        expect(stored(SCHEMA_TYPE.FOLDERS, folder)).not.toHaveProperty('parentFolderId');
    });

    it('lets a member who may create folders move one', async () => {
        const parent = folderIn();
        const folder = folderIn();
        seedRules({ 'project.project_folder_name_edit': false, 'project.project_folder_create': true });
        expect((await move(folder, parent, { uid: MEMBER })).body).toMatchObject({ status: true });
    });
});

describe('chat categories never nest', () => {
    let space;
    const categoryIn = (doc = {}) => folderIn({ projectId: space, name: 'Category', ...doc });
    beforeEach(() => {
        space = String(db().seed(SCHEMA_TYPE.MAIN_CHATS, { _id: oid(), default: false })._id);
    });

    it('refuses a category under a category, on add and on move', async () => {
        const parent = categoryIn();
        const child = categoryIn();
        expect(refused(await add({ projectId: space, mainChat: true, parentFolderId: parent }))).toMatch(/[Cc]hat categor/);
        expect(refused(await run(PATCH, { id: child, body: { type: 'moveFolder', projectId: space, parentFolderId: parent } }))).toMatch(/[Cc]hat categor/);
        expect(rowsOf(SCHEMA_TYPE.FOLDERS).some((row) => row.parentFolderId)).toBe(false);
    });

    it('refuses a category as the parent of a project folder, and a project folder as the parent of a category', async () => {
        const category = categoryIn();
        const folder = folderIn();
        refused(await add({ parentFolderId: category }));
        refused(await move(folder, category));
        refused(await run(PATCH, { id: category, body: { type: 'moveFolder', projectId: space, parentFolderId: folder } }));
        expect(rowsOf(SCHEMA_TYPE.FOLDERS).some((row) => row.parentFolderId)).toBe(false);
    });
});

describe('archive, delete and restore cascade through subfolders', () => {
    let tree;
    beforeEach(() => {
        const parent = folderIn({ name: 'Parent' });
        const sub = folderIn({ name: 'Sub', parentFolderId: parent });
        const archivedSub = folderIn({ name: 'Archived alone', parentFolderId: parent, deletedStatusKey: 2 });
        const neighbour = folderIn({ name: 'Neighbour' });
        const sprints = {
            parent: sprintIn({ folderId: parent }),
            sub: sprintIn({ folderId: sub }),
            subArchivedAlone: sprintIn({ folderId: sub, deletedStatusKey: 2 }),
            archivedSub: sprintIn({ folderId: archivedSub }),
            neighbour: sprintIn({ folderId: neighbour }),
            root: sprintIn(),
        };
        tree = {
            parent,
            sub,
            archivedSub,
            neighbour,
            sprints,
            tasks: {
                parent: taskIn(sprints.parent),
                sub: taskIn(sprints.sub),
                subArchivedAlone: taskIn(sprints.sub, 2),
                subDeletedAlone: taskIn(sprints.sub, 1),
                inArchivedSprint: taskIn(sprints.subArchivedAlone, 4),
                archivedSub: taskIn(sprints.archivedSub, ARCHIVED_WITH_FOLDER),
                neighbour: taskIn(sprints.neighbour),
                root: taskIn(sprints.root),
            },
        };
    });

    const taskStatuses = () => Object.fromEntries(Object.entries(tree.tasks).map(([name, id]) => [name, statusOf(SCHEMA_TYPE.TASKS, id)]));
    const untouched = { subArchivedAlone: 2, subDeletedAlone: 1, inArchivedSprint: 4, archivedSub: ARCHIVED_WITH_FOLDER, neighbour: 0, root: 0 };

    it('archives the subfolder, its sprints\' tasks and nothing that was already archived or deleted', async () => {
        const res = await setStatus(tree.parent, 2);

        expect(res.body).toMatchObject({ status: true, subfolders: [{ _id: tree.sub, deletedStatusKey: ARCHIVED_WITH_FOLDER }] });
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.parent)).toBe(2);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.sub)).toBe(ARCHIVED_WITH_FOLDER);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.archivedSub)).toBe(2);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.neighbour)).toBe(0);
        expect(taskStatuses()).toEqual({ parent: ARCHIVED_WITH_FOLDER, sub: ARCHIVED_WITH_FOLDER, ...untouched });
        expect(rowsOf(SCHEMA_TYPE.SPRINTS).map((sprint) => sprint.deletedStatusKey).sort()).toEqual([0, 0, 0, 0, 0, 2]);
        const cleared = unsetAllCounts.mock.calls.map(([companyId, projectId, sprintId]) => [companyId, String(projectId), String(sprintId)]);
        expect(cleared.sort()).toEqual([[C, project, tree.sprints.parent], [C, project, tree.sprints.sub]].sort());
    });

    it('restores only what the archive changed', async () => {
        await setStatus(tree.parent, 2);
        const res = await setStatus(tree.parent, 0);

        expect(res.body).toMatchObject({ status: true, subfolders: [{ _id: tree.sub, deletedStatusKey: 0 }] });
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.parent)).toBe(0);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.sub)).toBe(0);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.archivedSub)).toBe(2);
        expect(taskStatuses()).toEqual({ parent: 0, sub: 0, ...untouched });
    });

    it('deletes the subfolder and its sprints\' tasks', async () => {
        const res = await setStatus(tree.parent, 1);

        expect(res.body).toMatchObject({ status: true, subfolders: [{ _id: tree.sub, deletedStatusKey: 1 }] });
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.sub)).toBe(1);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.archivedSub)).toBe(2);
        expect(taskStatuses()).toEqual({ parent: 1, sub: 1, ...untouched });
    });

    it('brings back after a delete only the rows still marked as archived with the folder, as one level does', async () => {
        await setStatus(tree.parent, 2);
        await setStatus(tree.parent, 1);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.sub)).toBe(ARCHIVED_WITH_FOLDER);
        expect(taskStatuses()).toEqual({ parent: ARCHIVED_WITH_FOLDER, sub: ARCHIVED_WITH_FOLDER, ...untouched });

        await setStatus(tree.parent, 0);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.sub)).toBe(0);
        expect(taskStatuses()).toEqual({ parent: 0, sub: 0, ...untouched });
    });

    it('leaves rows a plain delete removed where they are on restore, as one level does', async () => {
        await setStatus(tree.parent, 1);
        await setStatus(tree.parent, 0);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.sub)).toBe(1);
        expect(taskStatuses()).toEqual({ parent: 1, sub: 1, ...untouched });
    });

    it('archives and restores a subfolder alone without touching its parent or siblings', async () => {
        await setStatus(tree.sub, 2);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.sub)).toBe(2);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.parent)).toBe(0);
        expect(taskStatuses()).toEqual({ parent: 0, sub: ARCHIVED_WITH_FOLDER, ...untouched });

        await setStatus(tree.archivedSub, 0);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.archivedSub)).toBe(0);
        expect(taskStatuses()).toEqual({ parent: 0, sub: ARCHIVED_WITH_FOLDER, ...untouched, archivedSub: 0 });
    });

    it('keeps a subfolder that was archived alone archived when its parent comes back', async () => {
        await setStatus(tree.sub, 2);
        await setStatus(tree.parent, 2);
        await setStatus(tree.parent, 0);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.sub)).toBe(2);
        expect(taskStatuses()).toEqual({ parent: 0, sub: ARCHIVED_WITH_FOLDER, ...untouched });
    });

    it('refuses to restore a subfolder while its parent is archived or deleted', async () => {
        await setStatus(tree.parent, 2);
        expect(refused(await setStatus(tree.archivedSub, 0))).toMatch(/parent/);
        expect(refused(await setStatus(tree.sub, 0))).toMatch(/parent/);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.archivedSub)).toBe(2);
        expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.sub)).toBe(ARCHIVED_WITH_FOLDER);
        expect(taskStatuses()).toEqual({ parent: ARCHIVED_WITH_FOLDER, sub: ARCHIVED_WITH_FOLDER, ...untouched });
    });

    it('refuses to move a subfolder that is archived with its parent', async () => {
        await setStatus(tree.parent, 2);
        expect(refused(await move(tree.sub, null))).toMatch(/parent/);
        expect(String(stored(SCHEMA_TYPE.FOLDERS, tree.sub).parentFolderId)).toBe(tree.parent);
    });

    describe('and the trash restores a deleted folder', () => {
        const fromTrash = async (id) => {
            const { updateFolderFun } = require('../Modules/Sprints/controller');
            const { answer, cascade } = await updateFolderFun({
                companyId: C,
                id,
                updateObject: { $set: { deletedStatusKey: 0 } },
                folderName: 'Parent',
                projectData: { id: project, ProjectName: 'Launch' },
                userData: { id: OWNER, Employee_Name: 'Olivia Owner' },
                fromTrash: true,
            });
            await cascade;
            await settle();
            return answer;
        };

        it('with the subfolders and tasks that went with it; like a list\'s restore, every trashed task in those lists comes back', async () => {
            await setStatus(tree.parent, 1);
            const answer = await fromTrash(tree.parent);

            expect(answer).toMatchObject({ status: true, subfolders: [{ _id: tree.sub, deletedStatusKey: 0 }] });
            expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.parent)).toBe(0);
            expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.sub)).toBe(0);
            expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.archivedSub)).toBe(2);
            expect(taskStatuses()).toEqual({ parent: 0, sub: 0, ...untouched, subDeletedAlone: 0 });
        });

        it('with what was archived with it before it was deleted', async () => {
            await setStatus(tree.parent, 2);
            await setStatus(tree.parent, 1);
            await fromTrash(tree.parent);
            expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.sub)).toBe(0);
            expect(taskStatuses()).toMatchObject({ parent: 0, sub: 0, archivedSub: ARCHIVED_WITH_FOLDER, inArchivedSprint: 4, neighbour: 0 });
        });

        it('refuses a subfolder while its parent is still in the trash', async () => {
            await setStatus(tree.parent, 1);
            await expect(fromTrash(tree.sub)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/parent/) });
            expect(statusOf(SCHEMA_TYPE.FOLDERS, tree.sub)).toBe(1);
        });

        it('writes history that names the signed-in user', async () => {
            await setStatus(tree.parent, 1);
            await fromTrash(tree.parent);
            const lines = rowsOf(SCHEMA_TYPE.HISTORY).map((row) => row.Message);
            expect(lines[lines.length - 1]).toBe('<b>Olivia Owner</b> has restored <b>Parent</b> folder in <b>Launch</b> project.');
        });
    });
});

describe('renaming a folder', () => {
    const rename = (id, folderName) => run(PATCH, { id, body: { type: 'editFolderName', projectId: project, folderName } });
    const taskUnder = (folderId, extra = {}) => String(db().seed(SCHEMA_TYPE.TASKS, {
        _id: oid(), ProjectID: project, sprintId: oid(), TaskName: 'Task', deletedStatusKey: 0, folderObjId: folderId, sprintArray: { name: 'Sprint 1', folderId, folderName: 'Q3' }, ...extra,
    })._id);
    const taskWrites = (company = C) => db(company).calls.filter((call) => call.type === SCHEMA_TYPE.TASKS && call.method === 'updateMany');

    it('renames the copy of its name on every task in it, and on no other task', async () => {
        const folder = folderIn();
        const other = folderIn({ name: 'Other' });
        const mine = taskUnder(folder);
        const archived = taskUnder(folder, { deletedStatusKey: 2 });
        const theirs = taskUnder(other);
        const loose = taskIn(sprintIn());

        const res = await rename(folder, 'Q4');

        expect(res.body).toMatchObject({ status: true, data: { name: 'Q4' } });
        expect(stored(SCHEMA_TYPE.TASKS, mine).sprintArray).toEqual({ name: 'Sprint 1', folderId: folder, folderName: 'Q4' });
        expect(stored(SCHEMA_TYPE.TASKS, archived).sprintArray.folderName).toBe('Q4');
        expect(stored(SCHEMA_TYPE.TASKS, theirs).sprintArray.folderName).toBe('Q3');
        expect(stored(SCHEMA_TYPE.TASKS, loose)).not.toHaveProperty('sprintArray');
    });

    it('scopes that write to the company and the folder\'s stored project, and leaves the tasks\' updatedAt alone', async () => {
        const folder = folderIn();
        taskUnder(folder);
        folderIn({}, ELSEWHERE);

        await rename(folder, 'Q4');

        const [write] = taskWrites();
        expect(taskWrites()).toHaveLength(1);
        expect(write.companyId).toBe(C);
        expect(String(write.data[0].ProjectID)).toBe(project);
        expect(String(write.data[0].folderObjId)).toBe(folder);
        expect(write.data[1]).toEqual({ $set: { 'sprintArray.folderName': 'Q4' } });
        expect(write.data[2]).toEqual({ timestamps: false });
        expect(taskWrites(ELSEWHERE)).toEqual([]);
    });

    it('writes to no task when the folder is not found', async () => {
        expect((await rename(oid(), 'Q4')).body).toMatchObject({ status: false, statusText: 'Folder not found' });
        expect(taskWrites()).toEqual([]);
    });
});

describe('folder writes say that the company\'s folders changed', () => {
    const announced = () => socketEmitter.emit.mock.calls.filter(([, payload]) => payload && payload.module === 'folders');

    it('once per write, naming neither the project nor the folder', async () => {
        const parent = folderIn();
        const folder = folderIn({ name: 'Icons' });

        await add({});
        expect(announced()).toEqual([['insert', { type: 'insert', companyId: C, module: 'folders' }]]);

        socketEmitter.emit.mockClear();
        await run(PATCH, { id: folder, body: { type: 'editFolderName', projectId: project, folderName: 'Glyphs' } });
        await move(folder, parent);
        await setStatus(folder, 2);
        expect(announced()).toEqual([1, 2, 3].map(() => ['update', { type: 'update', companyId: C, module: 'folders' }]));
    });

    it('nothing for a write that is refused or finds no folder', async () => {
        const folder = folderIn();
        await move(folder, folder);
        await move(oid(), null);
        await add({ parentFolderId: 'not-an-id' });
        await setStatus(oid(), 2);
        await run(PATCH, { id: oid(), body: { type: 'editFolderName', projectId: project, folderName: 'Q4' } });
        expect(announced()).toEqual([]);
    });
});

describe('reading folders', () => {
    const read = async (projectId, company = C) => {
        const { getSprintFolder } = require('../Modules/Project/controller/getSprintFolder');
        const res = { statusCode: 200, body: undefined };
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (payload) => { res.body = payload; return res; };
        await getSprintFolder(verified({ uid: OWNER, params: { id: projectId }, query: { collection: 'folders' }, headers: { companyid: company } }), res);
        await settle();
        return res;
    };

    it('answers the parent of every folder, null at the top level', async () => {
        const parent = folderIn({ name: 'Parent' });
        const sub = folderIn({ name: 'Sub', parentFolderId: new mongoose.Types.ObjectId(parent) });
        folderIn({ name: 'Gone', deletedStatusKey: 1 });
        folderIn({ name: 'Theirs' }, ELSEWHERE);

        const res = await read(project);

        expect(res.statusCode).toBe(200);
        const byId = Object.fromEntries(res.body.map((folder) => [String(folder._id), folder]));
        expect(Object.keys(byId).sort()).toEqual([parent, sub].sort());
        expect(byId[parent]).toMatchObject({ name: 'Parent', projectId: project, deletedStatusKey: 0, parentFolderId: null });
        expect(byId[sub]).toMatchObject({ name: 'Sub', deletedStatusKey: 0 });
        expect(String(byId[sub].parentFolderId)).toBe(parent);
    });
});

describe('the strict folders schema', () => {
    it('keeps parentFolderId and still drops a field it does not declare', () => {
        const { folders } = jest.requireActual('../utils/mongo-handler/createSchema');
        const Folder = mongoose.models.SubfolderProbe || mongoose.model('SubfolderProbe', folders);
        const parent = oid();
        const doc = new Folder({ name: 'Sub', projectId: oid(), deletedStatusKey: 0, parentFolderId: parent, depth: 2 }).toObject();
        expect(String(doc.parentFolderId)).toBe(parent);
        expect(doc).not.toHaveProperty('depth');
        expect(new Folder({ name: 'Root', projectId: oid(), deletedStatusKey: 0 }).toObject()).not.toHaveProperty('parentFolderId');
    });
});
