/* Task 046 A3: the whiteboard routes. A board is read and written through its project and list. */
const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
let mockShownNoTasks = [];
jest.mock('../Modules/Tasks/helpers/taskListProjects', () => {
    const held = require('./fixtures/taskListRules').taskListHeldEverywhere();
    return { ...held, keepTaskListProjectIds: async (companyId, uid, projectIds) => (mockShownNoTasks.includes(String(uid)) ? [] : held.keepTaskListProjectIds(companyId, uid, projectIds)) };
});
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const { holdNarrowedToken } = require('../Config/narrowedTokenRoutes');
const { MAX_ELEMENTS, MAX_NOTES, MAX_TEXT_LENGTH, MAX_PATCH_BYTES } = require('../Modules/Whiteboards/boardRules');

const C = 'c00000000000000000000001';
const OTHER_COMPANY = 'c00000000000000000000002';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MEMBER = 'a00000000000000000000003';
const TEAMMATE = 'a00000000000000000000004';
const NO_SEAT = 'a00000000000000000000009';
const MEMBER_ROLE = 3;
const WATCHER_ROLE = 7;
const WATCHER = 'a00000000000000000000005';

const OPEN = 'b00000000000000000000001';
const CLOSED = 'b00000000000000000000002';
const PERSONAL = 'b00000000000000000000003';
const LIST = 'd00000000000000000000001';
const PRIVATE_LIST = 'd00000000000000000000002';
const CLOSED_LIST = 'd00000000000000000000003';
const PERSONAL_LIST = 'd00000000000000000000004';
const DELETED_LIST = 'd00000000000000000000005';
const T1 = 'e00000000000000000000001';
const T2 = 'e00000000000000000000002';
const CHAT = 'e00000000000000000000003';
const P1 = 'e00000000000000000000004';
const K1 = 'e00000000000000000000005';
const S1 = 'e00000000000000000000006';
const S2 = 'e00000000000000000000007';
const MARKUP = '<img src=x onerror=alert(1)> & "launch" </script>';

const routes = (() => {
    const table = {};
    const register = (method) => (route, ...handlers) => { table[`${method} ${route}`] = handlers; };
    require('../Modules/Whiteboards/routes').init({ get: register('GET'), post: register('POST'), patch: register('PATCH'), delete: register('DELETE'), put: register('PUT') });
    return table;
})();

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    return res;
};

const call = async (route, uid, [projectId, sprintId], body, headers = { companyid: C }) => {
    const [handler] = routes[route];
    const res = response();
    await handler(verified({ uid, params: { projectId, sprintId }, body, headers }), res);
    return res;
};
const BOARD = 'GET /api/v2/whiteboards/:projectId/:sprintId';
const SAVE = 'PATCH /api/v2/whiteboards/:projectId/:sprintId';
const HISTORY = 'GET /api/v2/whiteboards/:projectId/:sprintId/history';
const RESTORE = 'POST /api/v2/whiteboards/:projectId/:sprintId/restore';

const read = (uid, where) => call(BOARD, uid, where);
const card = (id, taskId, x = 10, y = 20) => ({ id, type: 'task', taskId, x, y });
const save = (uid, where, body) => call(SAVE, uid, where, body);
const boards = () => mockDb.store[SCHEMA_TYPE.WHITEBOARDS] || [];
const seedTask = (_id, ProjectID, sprintId, doc = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, { _id, ProjectID, sprintId, TaskName: `Task ${_id.slice(-1)}`, TaskKey: `AP-${_id.slice(-1)}`, deletedStatusKey: 0, ...doc });

const seedRules = () => {
    const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project', isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }, { key: WATCHER_ROLE, permission: true }] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'private_projects', isParent: false, parentId: String(parent._id), roles: [{ key: WATCHER_ROLE, permission: 2 }] });
};

beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockShownNoTasks = [];
    mockDb = fakeMongo.create();
    [[OWNER, 1], [ADMIN, 2], [MEMBER, MEMBER_ROLE], [TEAMMATE, MEMBER_ROLE], [WATCHER, WATCHER_ROLE]].forEach(([userId, roleType]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
    seedRules();
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN, ProjectName: 'Open', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: CLOSED, ProjectName: 'Closed', isPrivateSpace: true, AssigneeUserId: [MEMBER], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PERSONAL, ProjectName: 'Mine', isPrivateSpace: true, isPersonal: true, personalOwner: MEMBER, AssigneeUserId: [MEMBER], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: LIST, projectId: OPEN, name: 'List', private: false, AssigneeUserId: [], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_LIST, projectId: OPEN, name: 'Private', private: true, AssigneeUserId: [MEMBER], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: DELETED_LIST, projectId: OPEN, name: 'Gone', private: false, AssigneeUserId: [], deletedStatusKey: 1 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: CLOSED_LIST, projectId: CLOSED, name: 'Closed list', private: false, AssigneeUserId: [], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PERSONAL_LIST, projectId: PERSONAL, name: 'My list', private: false, AssigneeUserId: [], deletedStatusKey: 0 });
    seedTask(T1, OPEN, LIST, { TaskName: MARKUP });
    seedTask(T2, OPEN, LIST);
    seedTask(CHAT, OPEN, LIST, { TaskName: 'Between two people', mainChat: true, AssigneeUserId: [MEMBER] });
    seedTask(P1, OPEN, PRIVATE_LIST, { TaskName: 'Private plan' });
    seedTask(K1, CLOSED, CLOSED_LIST, { TaskName: 'Closed plan' });
    seedTask(S1, PERSONAL, PERSONAL_LIST, { TaskName: 'My errand' });
    seedTask(S2, OPEN, LIST, { TaskName: 'Staffing plan' });
});

describe('a board is read through its list', () => {
    it('is empty at revision 0 before anyone saved it, and says whether the reader may change it', async () => {
        const res = await read(MEMBER, [OPEN, LIST]);
        expect(res.statusCode).toBe(200);
        expect(res.body.data).toEqual({ boardId: null, revision: 0, elements: [], savedBy: null, savedAt: null, canEdit: true, limits: { elements: MAX_ELEMENTS, notes: MAX_NOTES, text: MAX_TEXT_LENGTH } });
    });

    it('comes back with each card, the task it stands for and that task\'s name', async () => {
        const saved = await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [card('a', T1, 30, 40), card('b', T2)] });
        expect(saved.statusCode).toBe(200);
        const { data } = (await read(TEAMMATE, [OPEN, LIST])).body;
        expect(data).toMatchObject({ boardId: String(boards()[0]._id), revision: 1, savedBy: MEMBER, canEdit: true });
        expect(data.elements).toEqual([
            { id: 'a', type: 'task', taskId: T1, x: 30, y: 40, z: 0, title: MARKUP, taskKey: 'AP-1' },
            { id: 'b', type: 'task', taskId: T2, x: 10, y: 20, z: 0, title: 'Task 2', taskKey: 'AP-2' },
        ]);
    });

    it('sends a task name as the text it is, in a JSON answer, and keeps no name on the stored board', async () => {
        await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [card('a', T1)] });
        const res = await read(MEMBER, [OPEN, LIST]);
        expect(res.json).toHaveBeenCalledTimes(1);
        expect(res.send).not.toHaveBeenCalled();
        expect(res.body.data.elements[0].title).toBe(MARKUP);
        expect(JSON.stringify(boards()[0])).not.toContain('onerror');
        expect(Object.keys(boards()[0].elements[0]).sort()).toEqual(['id', 'taskId', 'type', 'x', 'y', 'z']);
    });

    it('leaves out the cards whose task was deleted or moved to another list', async () => {
        await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [card('a', T1), card('b', T2)] });
        mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === T2).sprintId = PRIVATE_LIST;
        expect((await read(MEMBER, [OPEN, LIST])).body.data.elements.map((element) => element.id)).toEqual(['a']);
    });
});

describe('who may open a board', () => {
    const notFound = (res) => expect({ statusCode: res.statusCode, body: res.body }).toEqual({
        statusCode: 404,
        body: { status: false, statusText: 'Whiteboard not found.', message: 'Whiteboard not found.' },
    });
    const everyRoute = async (uid, where) => [
        await read(uid, where),
        await save(uid, where, { baseRevision: 0, upsert: [card('a', T1)] }),
        await call(HISTORY, uid, where),
        await call(RESTORE, uid, where, { revision: 1 }),
    ];

    it.each([
        ['a list in a project the caller is not in', TEAMMATE, [CLOSED, CLOSED_LIST]],
        ['a private list the caller is not on', TEAMMATE, [OPEN, PRIVATE_LIST]],
        ['a list in someone else\'s personal project, for an owner', OWNER, [PERSONAL, PERSONAL_LIST]],
        ['a list in someone else\'s personal project, for an admin', ADMIN, [PERSONAL, PERSONAL_LIST]],
        ['a list in someone else\'s personal project, for a member', TEAMMATE, [PERSONAL, PERSONAL_LIST]],
        ['a list named with another project', MEMBER, [OPEN, CLOSED_LIST]],
        ['a deleted list', MEMBER, [OPEN, DELETED_LIST]],
        ['a list that does not exist', MEMBER, [OPEN, 'd000000000000000000000ff']],
        ['a project that does not exist', MEMBER, ['b000000000000000000000ff', LIST]],
        ['ids that are not ids', MEMBER, ['{"$ne":null}', 'x']],
        ['someone with no seat', NO_SEAT, [OPEN, LIST]],
    ])('answers every route the same for %s', async (_what, uid, where) => {
        mockDb.seed(SCHEMA_TYPE.WHITEBOARDS, { projectId: where[0], sprintId: where[1], revision: 1, elements: [card('a', T1)], history: [{ revision: 1, elements: [] }], deletedStatusKey: 0 });
        const before = JSON.stringify(boards());
        (await everyRoute(uid, where)).forEach(notFound);
        expect(JSON.stringify(boards())).toBe(before);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('opens a private list for the people on it, and for owners and admins', async () => {
        for (const uid of [MEMBER, OWNER, ADMIN]) expect((await read(uid, [OPEN, PRIVATE_LIST])).statusCode).toBe(200);
        expect((await save(MEMBER, [OPEN, PRIVATE_LIST], { baseRevision: 0, upsert: [card('p', P1)] })).statusCode).toBe(200);
    });

    it('opens a personal project\'s board for its owner alone', async () => {
        expect((await save(MEMBER, [PERSONAL, PERSONAL_LIST], { baseRevision: 0, upsert: [card('s', S1)] })).statusCode).toBe(200);
        expect((await read(MEMBER, [PERSONAL, PERSONAL_LIST])).body.data.elements[0].title).toBe('My errand');
    });

    it('lets a role that lists every private project read a board there and change nothing', async () => {
        await save(MEMBER, [CLOSED, CLOSED_LIST], { baseRevision: 0, upsert: [card('k', K1)] });
        const seen = await read(WATCHER, [CLOSED, CLOSED_LIST]);
        expect(seen.body.data).toMatchObject({ revision: 1, canEdit: false });
        const moved = await save(WATCHER, [CLOSED, CLOSED_LIST], { baseRevision: 1, upsert: [card('k', K1, 500, 500)] });
        const restored = await call(RESTORE, WATCHER, [CLOSED, CLOSED_LIST], { revision: 1 });
        [moved, restored].forEach((res) => expect(res.statusCode).toBe(403));
        expect(boards()[0]).toMatchObject({ revision: 1, elements: [{ id: 'k', x: 10, y: 20 }] });
        expect((await call(HISTORY, WATCHER, [CLOSED, CLOSED_LIST])).statusCode).toBe(200);
    });

    it('refuses a company outside the caller\'s session, and nobody at all', async () => {
        const res = response();
        await routes[BOARD][0]({ uid: MEMBER, aud: C, params: { projectId: OPEN, sprintId: LIST }, headers: { companyid: OTHER_COMPANY } }, res);
        expect(res.statusCode).toBe(403);
        expect((await read(undefined, [OPEN, LIST])).statusCode).toBe(401);
        expect(mockDb.calls.filter((entry) => entry.type === SCHEMA_TYPE.WHITEBOARDS)).toEqual([]);
    });

    it('is not a route a token narrowed to some projects may call', async () => {
        for (const [method, url] of [['GET', `/api/v2/whiteboards/${OPEN}/${LIST}`], ['PATCH', `/api/v2/whiteboards/${OPEN}/${LIST}`], ['GET', `/api/v2/whiteboards/${OPEN}/${LIST}/history`], ['POST', `/api/v2/whiteboards/${OPEN}/${LIST}/restore`]]) {
            const res = response();
            const next = jest.fn();
            await holdNarrowedToken({ method, originalUrl: url, headers: { companyid: C }, apiToken: { userId: MEMBER, projectIds: [OPEN] } }, res, next);
            expect({ url, reached: next.mock.calls.length, statusCode: res.statusCode }).toEqual({ url, reached: 0, statusCode: 403 });
        }
    });

    it('sits behind the signed-in guard', () => {
        const guard = fs.readFileSync(path.join(__dirname, '..', 'Config', 'setMiddleware.js'), 'utf8');
        expect(guard).toContain('"/api/v2/whiteboards"');
        expect(fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')).toContain("require('./Modules/Whiteboards/init').init(app)");
    });
});

describe('a card and the task behind it', () => {
    it('gives a viewer who may not open the task the card\'s place and nothing of the task', async () => {
        await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [card('a', T2), card('c', S2, 70, 80)] });
        const mine = (await read(MEMBER, [OPEN, LIST])).body.data.elements;
        expect(mine[1]).toEqual({ id: 'c', type: 'task', taskId: S2, x: 70, y: 80, z: 0, title: 'Staffing plan', taskKey: 'AP-7' });
        mockShownNoTasks = [TEAMMATE];
        const res = await read(TEAMMATE, [OPEN, LIST]);
        expect(res.body.data.elements[1]).toEqual({ id: 'c', type: 'task', x: 70, y: 80, z: 0, withheld: true });
        expect(JSON.stringify(res.body)).not.toContain('Staffing plan');
        expect(JSON.stringify(res.body)).not.toContain(S2);
    });

    it('gives the same to that viewer in the answer to their own save, and in a conflict', async () => {
        await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [card('a', T2), card('c', S2)] });
        mockShownNoTasks = [TEAMMATE];
        const moved = await save(TEAMMATE, [OPEN, LIST], { baseRevision: 1, upsert: [card('a', T2, 300, 300)] });
        const stale = await save(TEAMMATE, [OPEN, LIST], { baseRevision: 1, upsert: [card('a', T2, 400, 400)] });
        expect([moved.statusCode, stale.statusCode]).toEqual([200, 409]);
        [moved, stale].forEach((res) => {
            expect(res.body.data.elements[1]).toEqual({ id: 'c', type: 'task', x: 10, y: 20, z: 0, withheld: true });
            expect(JSON.stringify(res.body)).not.toContain('Staffing plan');
        });
    });

    it('holds no card for a conversation, for the people in it or anyone else', async () => {
        for (const uid of [MEMBER, TEAMMATE, OWNER, ADMIN]) {
            const res = await save(uid, [OPEN, LIST], { baseRevision: 0, upsert: [card('c', CHAT)] });
            expect(res.body.data.elements).toEqual([]);
            expect(JSON.stringify(res.body)).not.toContain('Between two people');
        }
        expect(boards()).toEqual([]);
    });

    it('leaves out a new card for a task the writer may not open, or one outside the list, with one answer', async () => {
        const answers = [];
        for (const taskId of [CHAT, P1, K1, 'e000000000000000000000ff']) {
            const res = await save(TEAMMATE, [OPEN, LIST], { baseRevision: 0, upsert: [card('x', taskId)] });
            answers.push({ statusCode: res.statusCode, body: res.body });
        }
        expect(answers[0]).toMatchObject({ statusCode: 200, body: { status: true, data: { boardId: null, revision: 0, elements: [] } } });
        answers.forEach((answer) => expect(answer).toEqual(answers[0]));
        expect(boards()).toEqual([]);

        const mixed = await save(TEAMMATE, [OPEN, LIST], { baseRevision: 0, upsert: [card('a', T2), card('x', CHAT), card('y', P1)] });
        expect(mixed.body.data.elements.map((element) => element.id)).toEqual(['a']);
        expect(boards()[0].elements.map((element) => element.taskId)).toEqual([T2]);
    });
});

describe('saving through the route', () => {
    it('answers a save made on an older revision with 409 and the board as it is now', async () => {
        await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [card('a', T1), card('b', T2)] });
        await save(TEAMMATE, [OPEN, LIST], { baseRevision: 1, upsert: [card('b', T2, 500, 500)] });
        const stale = await save(MEMBER, [OPEN, LIST], { baseRevision: 1, upsert: [card('a', T1, 900, 900)] });
        expect(stale.statusCode).toBe(409);
        expect(stale.body).toMatchObject({ status: false, code: 'revision_conflict', data: { revision: 2, savedBy: TEAMMATE } });
        expect(stale.body.data.elements.map((element) => [element.id, element.x])).toEqual([['a', 10], ['b', 500]]);

        const again = await save(MEMBER, [OPEN, LIST], { baseRevision: stale.body.data.revision, upsert: [card('a', T1, 900, 900)] });
        expect(again.statusCode).toBe(200);
        expect(again.body.data.elements.map((element) => [element.id, element.x])).toEqual([['a', 900], ['b', 500]]);
    });

    it('never lets a board kept on a device replace one the workspace already has', async () => {
        await save(TEAMMATE, [OPEN, LIST], { baseRevision: 0, upsert: [card('b', T2, 500, 500)] });
        const upload = await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [card('a', T1), card('b2', T2, 1, 1)] });
        expect(upload.statusCode).toBe(409);
        expect(boards()[0].elements).toEqual([{ id: 'b', type: 'task', taskId: T2, x: 500, y: 500, z: 0 }]);
    });

    it('enforces the size limits and stores nothing from a refused save', async () => {
        const tooMany = await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: Array.from({ length: MAX_ELEMENTS + 1 }, (_, n) => card(`c${n}`, T1)) });
        expect({ statusCode: tooMany.statusCode, field: tooMany.body.field }).toEqual({ statusCode: 400, field: 'upsert' });
        const tooBig = await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [card('a', T1)], remove: ['x'.repeat(MAX_PATCH_BYTES)] });
        expect({ statusCode: tooBig.statusCode, field: tooBig.body.field }).toEqual({ statusCode: 413, field: 'body' });
        const dataUrl = await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [{ ...card('a', T1), src: 'data:image/png;base64,AAAA' }] });
        expect({ statusCode: dataUrl.statusCode, field: dataUrl.body.field }).toEqual({ statusCode: 400, field: 'upsert.src' });
        const markup = await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [{ ...card('a', T1), text: '<b>hi</b>' }] });
        expect({ statusCode: markup.statusCode, field: markup.body.field }).toEqual({ statusCode: 400, field: 'upsert.text' });
        expect(boards()).toEqual([]);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('lists the earlier states and restores one for someone who may change the board', async () => {
        await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [card('a', T1, 1, 1), card('b', T2, 2, 2)] });
        await save(TEAMMATE, [OPEN, LIST], { baseRevision: 1, upsert: [card('a', T1, 800, 800)], remove: ['b'] });
        const history = await call(HISTORY, MEMBER, [OPEN, LIST]);
        expect(history.body.data).toEqual([{ revision: 1, savedBy: MEMBER, savedAt: expect.any(Date), cards: 2, reason: 'author' }]);

        const restored = await call(RESTORE, MEMBER, [OPEN, LIST], { revision: 1 });
        expect(restored.statusCode).toBe(200);
        expect(restored.body.data).toMatchObject({ revision: 3, savedBy: MEMBER });
        expect(restored.body.data.elements.map((element) => [element.id, element.x, element.title])).toEqual([['a', 1, MARKUP], ['b', 2, 'Task 2']]);

        expect((await call(RESTORE, MEMBER, [OPEN, LIST], { revision: 99 })).statusCode).toBe(404);
        expect((await call(RESTORE, MEMBER, [OPEN, LIST], { revision: '1' })).body).toMatchObject({ status: false, field: 'revision' });
        expect((await call(RESTORE, MEMBER, [OPEN, LIST], undefined)).statusCode).toBe(400);
    });
});

describe('a board follows its list', () => {
    const FOLDER = 'f00000000000000000000001';
    const SUBFOLDER = 'f00000000000000000000002';
    const FOLDER_LIST = 'd00000000000000000000011';
    const SUBFOLDER_LIST = 'd00000000000000000000012';
    const F1 = 'e00000000000000000000011';
    const F2 = 'e00000000000000000000012';
    const row = (type, id) => mockDb.store[type].find((doc) => String(doc._id) === id);
    const setStatus = (type, id, deletedStatusKey) => { row(type, id).deletedStatusKey = deletedStatusKey; myCache.flushAll(); };
    const boardOf = (where) => boards().find((board) => String(board.sprintId) === where[1]);
    const move = (uid, where, taskId) => save(uid, where, { baseRevision: boardOf(where).revision, upsert: [card('c', taskId, 77, 88)] });

    beforeEach(async () => {
        mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: FOLDER, projectId: OPEN, name: 'Folder', deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: SUBFOLDER, projectId: OPEN, name: 'Subfolder', parentFolderId: FOLDER, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: FOLDER_LIST, projectId: OPEN, folderId: FOLDER, name: 'In folder', private: false, AssigneeUserId: [], deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SUBFOLDER_LIST, projectId: OPEN, folderId: SUBFOLDER, name: 'In subfolder', private: false, AssigneeUserId: [], deletedStatusKey: 0 });
        seedTask(F1, OPEN, FOLDER_LIST);
        seedTask(F2, OPEN, SUBFOLDER_LIST);
        await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [card('c', T1), { id: 'n', type: 'note', text: 'Keep me', tone: 'green', x: 1, y: 2, w: 180, h: 120 }] });
        await save(MEMBER, [OPEN, FOLDER_LIST], { baseRevision: 0, upsert: [card('c', F1)] });
        await save(MEMBER, [OPEN, SUBFOLDER_LIST], { baseRevision: 0, upsert: [card('c', F2)] });
    });

    const gone = async (where, taskId) => {
        for (const uid of [MEMBER, OWNER]) {
            expect((await read(uid, where)).statusCode).toBe(404);
            expect((await move(uid, where, taskId)).statusCode).toBe(404);
            expect((await call(HISTORY, uid, where)).statusCode).toBe(404);
            expect((await call(RESTORE, uid, where, { revision: 1 })).statusCode).toBe(404);
        }
    };
    const frozen = async (where, taskId) => {
        for (const uid of [MEMBER, OWNER]) {
            const seen = await read(uid, where);
            expect({ statusCode: seen.statusCode, canEdit: seen.body.data.canEdit, cards: seen.body.data.elements.length > 0 }).toEqual({ statusCode: 200, canEdit: false, cards: true });
            expect((await move(uid, where, taskId)).statusCode).toBe(403);
            expect((await call(RESTORE, uid, where, { revision: 1 })).statusCode).toBe(403);
        }
    };
    const live = async (where, taskId) => {
        expect((await read(MEMBER, where)).body.data.canEdit).toBe(true);
        expect((await move(MEMBER, where, taskId)).statusCode).toBe(200);
    };

    it.each([
        ['the list', SCHEMA_TYPE.SPRINTS, LIST, [OPEN, LIST], T1],
        ['the folder it is in', SCHEMA_TYPE.FOLDERS, FOLDER, [OPEN, FOLDER_LIST], F1],
        ['the folder above its folder', SCHEMA_TYPE.FOLDERS, FOLDER, [OPEN, SUBFOLDER_LIST], F2],
        ['the project', SCHEMA_TYPE.PROJECTS, OPEN, [OPEN, LIST], T1],
    ])('is gone while %s is in the trash and back as it was once that is restored', async (_what, type, id, where, taskId) => {
        const before = JSON.stringify(boards());
        setStatus(type, id, 1);
        await gone(where, taskId);
        expect(JSON.stringify(boards())).toBe(before);

        setStatus(type, id, 0);
        expect((await read(MEMBER, where)).body.data.revision).toBe(1);
        await live(where, taskId);
    });

    it.each([
        ['the list is archived', SCHEMA_TYPE.SPRINTS, LIST, 2, [OPEN, LIST], T1],
        ['the list is closed', SCHEMA_TYPE.SPRINTS, LIST, 5, [OPEN, LIST], T1],
        ['its folder is archived', SCHEMA_TYPE.FOLDERS, FOLDER, 2, [OPEN, FOLDER_LIST], F1],
        ['its folder is archived with the folder above', SCHEMA_TYPE.FOLDERS, SUBFOLDER, 6, [OPEN, SUBFOLDER_LIST], F2],
        ['the folder above its folder is archived', SCHEMA_TYPE.FOLDERS, FOLDER, 2, [OPEN, SUBFOLDER_LIST], F2],
        ['the project is archived', SCHEMA_TYPE.PROJECTS, OPEN, 2, [OPEN, LIST], T1],
    ])('can be read and not changed while %s, whoever asks', async (_what, type, id, status, where, taskId) => {
        const before = JSON.stringify(boards());
        setStatus(type, id, status);
        await frozen(where, taskId);
        expect(JSON.stringify(boards())).toBe(before);

        setStatus(type, id, 0);
        await live(where, taskId);
    });

    it('leaves the boards of the other lists as they are', async () => {
        setStatus(SCHEMA_TYPE.FOLDERS, FOLDER, 1);
        setStatus(SCHEMA_TYPE.SPRINTS, PRIVATE_LIST, 1);
        await live([OPEN, LIST], T1);
        expect((await read(MEMBER, [OPEN, LIST])).body.data.elements.map((element) => element.id)).toEqual(['c', 'n']);
    });

    it('drops the card of a task that went to the trash or to another list, on the next read, and keeps the notes', async () => {
        await save(MEMBER, [OPEN, LIST], { baseRevision: 1, upsert: [card('d', T2)] });
        row(SCHEMA_TYPE.TASKS, T1).deletedStatusKey = 1;
        expect((await read(MEMBER, [OPEN, LIST])).body.data.elements.map((element) => element.id)).toEqual(['n', 'd']);
        row(SCHEMA_TYPE.TASKS, T2).sprintId = FOLDER_LIST;
        expect((await read(MEMBER, [OPEN, LIST])).body.data.elements.map((element) => element.id)).toEqual(['n']);

        row(SCHEMA_TYPE.TASKS, T1).deletedStatusKey = 0;
        expect((await read(MEMBER, [OPEN, LIST])).body.data.elements.map((element) => element.id)).toEqual(['c', 'n']);
    });
});

describe('notes and text through the routes', () => {
    const note = (id, text, extra = {}) => ({ id, type: 'note', text, tone: 'amber', x: 30, y: 40, w: 180, h: 120, ...extra });

    it('come back as stored, text as typed, to everyone who can read the board', async () => {
        const saved = await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [note('n1', MARKUP), { id: 'x1', type: 'text', text: 'Q4', x: 1, y: 2, w: 220, h: 40 }] });
        expect(saved.statusCode).toBe(200);
        for (const uid of [MEMBER, TEAMMATE, OWNER, ADMIN]) {
            expect((await read(uid, [OPEN, LIST])).body.data.elements).toEqual([
                { id: 'n1', type: 'note', text: MARKUP, tone: 'amber', x: 30, y: 40, w: 180, h: 120, z: 0 },
                { id: 'x1', type: 'text', text: 'Q4', x: 1, y: 2, w: 220, h: 40, z: 0 },
            ]);
        }
    });

    it('are read by exactly the people who can read the board', async () => {
        await save(MEMBER, [OPEN, PRIVATE_LIST], { baseRevision: 0, upsert: [note('n1', 'Only for this list')] });
        await save(MEMBER, [CLOSED, CLOSED_LIST], { baseRevision: 0, upsert: [note('n1', 'Only for this project')] });
        await save(MEMBER, [PERSONAL, PERSONAL_LIST], { baseRevision: 0, upsert: [note('n1', 'Only for me')] });

        const seenBy = async (uid, where) => { const res = await read(uid, where); return res.statusCode === 200 ? res.body.data.elements.map((element) => element.text) : res.statusCode; };
        expect(await seenBy(MEMBER, [OPEN, PRIVATE_LIST])).toEqual(['Only for this list']);
        expect(await seenBy(OWNER, [OPEN, PRIVATE_LIST])).toEqual(['Only for this list']);
        expect(await seenBy(TEAMMATE, [OPEN, PRIVATE_LIST])).toBe(404);
        expect(await seenBy(WATCHER, [CLOSED, CLOSED_LIST])).toEqual(['Only for this project']);
        expect(await seenBy(TEAMMATE, [CLOSED, CLOSED_LIST])).toBe(404);
        expect(await seenBy(MEMBER, [PERSONAL, PERSONAL_LIST])).toEqual(['Only for me']);
        for (const uid of [OWNER, ADMIN, TEAMMATE]) expect(await seenBy(uid, [PERSONAL, PERSONAL_LIST])).toBe(404);

        for (const [uid, where] of [[TEAMMATE, [OPEN, PRIVATE_LIST]], [TEAMMATE, [CLOSED, CLOSED_LIST]], [OWNER, [PERSONAL, PERSONAL_LIST]]]) {
            for (const res of [await read(uid, where), await call(HISTORY, uid, where), await save(uid, where, { baseRevision: 1, upsert: [note('n2', 'x')] })]) {
                expect(JSON.stringify(res.body)).not.toContain('Only for');
            }
        }
    });

    it('are not changed by someone who can only read the board', async () => {
        await save(MEMBER, [CLOSED, CLOSED_LIST], { baseRevision: 0, upsert: [note('n1', 'Plan')] });
        const edited = await save(WATCHER, [CLOSED, CLOSED_LIST], { baseRevision: 1, upsert: [note('n1', 'Changed')], remove: ['n1'] });
        expect(edited.statusCode).toBe(403);
        expect(boards()[0].elements[0].text).toBe('Plan');
    });

    it('answers 400 for an unknown field, an unknown tone and text that is too long, and stores nothing', async () => {
        const answers = [];
        for (const element of [note('n1', 'a', { color: '#ff0000' }), note('n1', 'a', { tone: 'teal' }), note('n1', 'x'.repeat(MAX_TEXT_LENGTH + 1)), note('n1', 'a', { html: '<b>a</b>' })]) {
            const res = await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: [element] });
            answers.push([res.statusCode, res.body.field]);
        }
        expect(answers).toEqual([[400, 'upsert.color'], [400, 'upsert.tone'], [400, 'upsert.text'], [400, 'upsert.html']]);
        expect(boards()).toEqual([]);
    });

    it('holds notes to their own cap', async () => {
        const many = Array.from({ length: MAX_NOTES + 1 }, (_, n) => note(`n${n}`, ''));
        const res = await save(MEMBER, [OPEN, LIST], { baseRevision: 0, upsert: many });
        expect({ statusCode: res.statusCode, field: res.body.field }).toEqual({ statusCode: 400, field: 'upsert' });
    });
});
