process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

const mockFailing = { sprintWrites: false };
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => (mockFailing.sprintWrites && q.type === 'sprints' && method === 'findOneAndUpdate'
        ? Promise.reject(new Error('the database is away'))
        : mockDb.crud(companyId, q, method)),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { EventEmitter } = require('events');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { updateSprintFun } = require('../Modules/Sprints/controller');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_SECRET, L_PERSONAL, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, settle } = world;
const { seed, rows, task } = world.create(mockDb);

const TAG = 'tag-open-1';
const TAG_ELSEWHERE = 'tag-private-1';
const PATCH_TASK = 'PATCH /api/v2/tasks';
const PATCH_LIST = 'PATCH /api/v1/sprint/:id';
const EVERYONE = [['an owner', OWNER], ['an admin', ADMIN], ['a member on the private work', INSIDER], ['a member outside it', OUTSIDER], ['a guest', GUEST]];

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers.flat(); };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
['Tasks', 'Sprints'].forEach((name) => require(`../Modules/${name}/routes`).init(app));

const TIMED_OUT = 'never answered';
const send = (route, uid, body, params = {}) => new Promise((resolve) => {
    const [method, url] = route.split(' ');
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { res.headersSent = true; res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { uid, method, originalUrl: url, url, baseUrl: '', route: { path: url }, query: {}, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    const handlers = routes[route];
    const step = (at) => Promise.resolve(handlers[at](req, res, () => step(at + 1)));
    step(0);
    setTimeout(() => resolve(TIMED_OUT), 1500);
}).then(async (result) => { await settle(); return result; });

const tag = (uid, taskId, tagId, operation = 'add') => send(PATCH_TASK, uid, { action: 'updateTags', companyId: CID, taskId, tagId, operation });
const rename = (uid, listId, sprintName, projectId = P_OPEN) => send(PATCH_LIST, uid, { type: 'editSprintName', companyId: CID, projectId, sprintName }, { id: listId });
const list = (id) => rows(SCHEMA_TYPE.SPRINTS).find((row) => String(row._id) === id);
const project = (id) => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === id);

beforeEach(() => {
    mockFailing.sprintWrites = false;
    seed();
    project(P_OPEN).tagsArray = [{ uid: TAG, tagName: 'Urgent' }];
    project(P_PRIVATE).tagsArray = [{ uid: TAG_ELSEWHERE, tagName: 'Internal' }];
    const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project', name: 'Project', isParent: true, roles: [] });
    ['project_sprint_name_edit', 'project_sprint_create', 'sprint_archive', 'sprint_type_change'].forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, {
        key, name: key, isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: true }],
    }));
});

describe('a tag put on a task', () => {
    it.each(EVERYONE)('is stored for %s when it is one of the project\'s tags', async (label, uid) => {
        const answer = await tag(uid, T_OPEN, TAG);

        expect(answer.code).toBe(200);
        expect(task(T_OPEN).tagsArray).toEqual([TAG]);
    });

    it.each([
        ['a tag no project has', 'tag-of-nothing'],
        ['a tag of another project', TAG_ELSEWHERE],
        ['a number', 7],
        ['a truth value', true],
        ['an empty text', ''],
        ['an object', { $ne: null }],
        ['a list', [TAG]],
    ])('is refused when it is %s, and nothing is stored', async (label, tagId) => {
        for (const uid of [OWNER, ADMIN, INSIDER, GUEST]) {
            const answer = await tag(uid, T_OPEN, tagId);

            expect([label, answer.code]).toEqual([label, 400]);
            expect(answer.body.status).toBe(false);
            expect(task(T_OPEN).tagsArray).toBeUndefined();
        }
    });

    it('can still be taken off after the project dropped it', async () => {
        task(T_OPEN).tagsArray = ['dropped-tag', TAG];

        expect((await tag(INSIDER, T_OPEN, 'dropped-tag', 'remove')).code).toBe(200);
        expect(task(T_OPEN).tagsArray).toEqual([TAG]);
    });

    it.each([
        ['a task in a project the caller cannot open', OUTSIDER, T_PRIVATE, TAG_ELSEWHERE],
        ['a task on a list a guest is not on', GUEST, T_SECRET, TAG],
        ['a task on another person\'s personal list', OWNER, T_PERSONAL, TAG],
    ])('answers not found for %s, whichever tag it names', async (label, uid, taskId, known) => {
        expect(await tag(uid, taskId, known)).toEqual(await tag(uid, taskId, 'tag-of-nothing'));
        expect((await tag(uid, taskId, known)).code).toBe(404);
        expect(task(taskId).tagsArray).toBeUndefined();
    });
});

describe('a new name for a list', () => {
    it.each(EVERYONE)('is stored trimmed for %s', async (label, uid) => {
        const answer = await rename(uid, L_OPEN, '  Renamed list  ');

        expect(answer.body.status).toBe(true);
        expect(list(L_OPEN).name).toBe('Renamed list');
    });

    it('may be as long as the web lets it be', async () => {
        expect((await rename(OWNER, L_OPEN, 'n'.repeat(50))).body.status).toBe(true);
        expect(list(L_OPEN).name).toBe('n'.repeat(50));
    });

    it.each([
        ['missing', undefined],
        ['empty', ''],
        ['blank', '   '],
        ['longer than the web allows', 'n'.repeat(51)],
        ['a number', 5],
        ['an object', { $gt: '' }],
        ['a list', ['Renamed']],
        ['nothing at all', null],
    ])('is refused when it is %s, and the list keeps its name', async (label, sprintName) => {
        for (const uid of [OWNER, ADMIN, INSIDER, GUEST]) {
            const answer = await rename(uid, L_OPEN, sprintName);

            expect([label, answer.code]).toEqual([label, 400]);
            expect(answer.body.status).toBe(false);
            expect(list(L_OPEN).name).toBe('Open list');
        }
    });

    it.each([
        ['a private list, for a member who is not on it', OUTSIDER, L_SECRET, 'Private list'],
        ['a private list, for a guest', GUEST, L_SECRET, 'Private list'],
        ['another person\'s personal list, for an owner', OWNER, L_PERSONAL, 'Personal list'],
    ])('does not reach %s', async (label, uid, listId, name) => {
        const answer = await rename(uid, listId, 'Taken over', String(list(listId).projectId));

        expect(answer.code).toBe(404);
        expect(list(listId).name).toBe(name);
    });
});

describe('a list update the database refuses', () => {
    const archive = { $set: { deletedStatusKey: 2 } };

    it('settles for whoever called it', async () => {
        mockFailing.sprintWrites = true;
        const call = updateSprintFun({ params: { id: L_OPEN }, body: { companyId: CID, projectId: P_OPEN, updateObject: { $inc: { tasks: 1 } } } });
        const waited = new Promise((resolve) => { setTimeout(() => resolve(TIMED_OUT), 1500); });

        const outcome = await Promise.race([call.then((value) => ({ value }), (error) => ({ error })), waited]);

        expect(outcome).toEqual({ error: { status: false, statusText: expect.any(String) } });
    });

    it.each([['an owner', OWNER], ['an admin', ADMIN], ['a member', INSIDER]])('is answered for %s with a failure of the usual shape', async (label, uid) => {
        mockFailing.sprintWrites = true;

        const answer = await send(PATCH_LIST, uid, { type: 'updateSprint', companyId: CID, projectId: P_OPEN, updateObject: archive }, { id: L_OPEN });

        expect(answer).not.toBe(TIMED_OUT);
        expect(answer.code).toBe(500);
        expect(answer.body).toEqual({ status: false, statusText: expect.any(String) });
        expect(answer.body.statusText).not.toMatch(/database/);
        expect(list(L_OPEN).deletedStatusKey).toBe(0);
    });

    it('still goes through when the database takes it', async () => {
        const answer = await send(PATCH_LIST, OWNER, { type: 'updateSprint', companyId: CID, projectId: P_OPEN, updateObject: archive }, { id: L_OPEN });

        expect(answer.code).toBe(200);
        expect(answer.body.status).toBe(true);
        expect(list(L_OPEN).deletedStatusKey).toBe(2);
    });
});
