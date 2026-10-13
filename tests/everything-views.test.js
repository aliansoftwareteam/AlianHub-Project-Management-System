/* Task 046 M2: a person's saved views of the Everything page. A view has a name and the page's
   settings, no project, and one owner: the person who made it. The handlers run over fakeMongo. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const views = require('../Modules/Tasks/controller/everythingViews');
const { MAX_VIEWS, MAX_NAME, parseViewSettings, parseViewBody } = require('../Modules/Tasks/helpers/everythingViews');
const { EverythingRefused } = require('../Modules/Tasks/helpers/everythingQuery');
const { holdNarrowedToken } = require('../Config/narrowedTokenRoutes');
const createSchema = require('../utils/mongo-handler/createSchema');
const { schema } = require('../utils/mongo-handler/schema');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const COLLEAGUE = '6f0000000000000000000004';
const DEACTIVATED = '6f0000000000000000000005';
const ROLES = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [COLLEAGUE]: 3 };
const PROJECT = '6f0000000000000000000a01';

const SETTINGS = {
    mode: 'board', search: '', status: ['Doing'], assignee: [MEMBER, 'unassigned'], priority: ['HIGH'], taskType: ['bug'], projectIds: [PROJECT],
    due: 'week', group: 'status', sortBy: 'DueDate', sortDir: 'asc', showSubtasks: true, hideDone: false, includeClosed: true,
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const call = async (handler, uid, { body, id, headers } = {}) => {
    const res = response();
    await handler({ headers: headers || { companyid: C }, aud: C, uid, body, params: id ? { id } : {} }, res);
    return res;
};
const create = (uid, body = { name: 'My week', settings: SETTINGS }) => call(views.createView, uid, { body });
const list = async (uid) => (await call(views.listViews, uid)).body.data;
const stored = () => mockDb.store[SCHEMA_TYPE.EVERYTHING_VIEWS] || [];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    Object.entries(ROLES).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: DEACTIVATED, roleType: 3, status: 2, isDelete: true });
});

describe('a saved view', () => {
    it('keeps a name and the page\'s settings, with no project', async () => {
        const res = await create(MEMBER);
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true, statusText: 'View saved.' });
        expect(res.body.data).toEqual({ _id: expect.stringMatching(/^[a-f0-9]{24}$/i), name: 'My week', settings: SETTINGS, isDefault: false, updatedAt: null });
        expect(stored()).toHaveLength(1);
        expect(stored()[0]).toMatchObject({ userId: MEMBER, name: 'My week', settings: SETTINGS, isDefault: false, deletedStatusKey: 0 });
        expect(stored()[0]).not.toHaveProperty('projectId');
    });

    it('is listed for its owner, by name', async () => {
        await create(MEMBER, { name: 'Zeta', settings: {} });
        await create(MEMBER, { name: 'alpha', settings: { mode: 'table' } });
        expect((await list(MEMBER)).map((view) => view.name)).toEqual(['alpha', 'Zeta']);
        expect((await list(MEMBER))[0].settings).toEqual({ mode: 'table' });
    });

    it('can be renamed, have its settings replaced, and both at once', async () => {
        const id = (await create(MEMBER)).body.data._id;
        const renamed = await call(views.updateView, MEMBER, { id, body: { name: '  This   week ' } });
        expect(renamed.body.data).toMatchObject({ _id: id, name: 'This week', settings: SETTINGS });

        const replaced = await call(views.updateView, MEMBER, { id, body: { settings: { mode: 'list', hideDone: true } } });
        expect(replaced.body.data.settings).toEqual({ mode: 'list', hideDone: true });
        expect((await list(MEMBER))[0]).toMatchObject({ name: 'This week', settings: { mode: 'list', hideDone: true } });
    });

    it('can be the default, one at a time', async () => {
        const first = (await create(MEMBER, { name: 'First', settings: {} })).body.data._id;
        const second = (await create(MEMBER, { name: 'Second', settings: {} })).body.data._id;
        await create(COLLEAGUE, { name: 'Theirs', settings: {}, isDefault: true });

        await call(views.updateView, MEMBER, { id: first, body: { isDefault: true } });
        expect((await list(MEMBER)).map((view) => [view.name, view.isDefault])).toEqual([['First', true], ['Second', false]]);

        await call(views.updateView, MEMBER, { id: second, body: { isDefault: true } });
        expect((await list(MEMBER)).map((view) => [view.name, view.isDefault])).toEqual([['First', false], ['Second', true]]);
        expect((await list(COLLEAGUE))[0].isDefault).toBe(true);

        await call(views.updateView, MEMBER, { id: second, body: { isDefault: false } });
        expect((await list(MEMBER)).some((view) => view.isDefault)).toBe(false);
    });

    it('can be deleted, and is then gone from the list and from every later request', async () => {
        const id = (await create(MEMBER)).body.data._id;
        const gone = await call(views.deleteView, MEMBER, { id });
        expect(gone.body).toEqual({ status: true, statusText: 'View deleted.' });
        expect(await list(MEMBER)).toEqual([]);
        expect((await call(views.updateView, MEMBER, { id, body: { name: 'Back' } })).statusCode).toBe(404);
        expect((await call(views.deleteView, MEMBER, { id })).statusCode).toBe(404);
    });

    it('is capped per person, not per company', async () => {
        for (let n = 0; n < MAX_VIEWS; n += 1) mockDb.seed(SCHEMA_TYPE.EVERYTHING_VIEWS, { userId: MEMBER, name: `View ${n}`, settings: {}, deletedStatusKey: 0 });
        const full = await create(MEMBER);
        expect(full.statusCode).toBe(400);
        expect(stored()).toHaveLength(MAX_VIEWS);
        expect((await create(COLLEAGUE)).statusCode).toBe(200);
    });
});

describe('a view belongs to the person who made it', () => {
    let id;
    beforeEach(async () => {
        id = (await create(MEMBER)).body.data._id;
        mockDb.calls.length = 0;
    });
    const unchanged = () => expect(stored()[0]).toMatchObject({ userId: MEMBER, name: 'My week', settings: SETTINGS, isDefault: false, deletedStatusKey: 0 });

    it.each([['a colleague', COLLEAGUE], ['an admin', ADMIN], ['an owner', OWNER]])('is not listed for %s', async (_who, uid) => {
        expect(await list(uid)).toEqual([]);
    });

    it.each([['a colleague', COLLEAGUE], ['an admin', ADMIN], ['an owner', OWNER]])('cannot be renamed, changed, made default or deleted by %s, who is told it does not exist', async (_who, uid) => {
        for (const body of [{ name: 'Taken' }, { settings: { mode: 'table' } }, { isDefault: true }]) {
            const res = await call(views.updateView, uid, { id, body });
            expect({ statusCode: res.statusCode, statusText: res.body.statusText }).toEqual({ statusCode: 404, statusText: 'View not found.' });
        }
        const removed = await call(views.deleteView, uid, { id });
        expect(removed.statusCode).toBe(404);
        expect(removed.body).toEqual((await call(views.deleteView, uid, { id: '6f00000000000000000000ff' })).body);
        unchanged();
    });

    it('names the caller in every read and write of the collection', async () => {
        await list(OWNER);
        await call(views.updateView, OWNER, { id, body: { name: 'Taken' } });
        await call(views.deleteView, OWNER, { id });
        await create(OWNER);
        await call(views.updateView, OWNER, { id: stored()[1]._id, body: { isDefault: true } });
        const touching = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.EVERYTHING_VIEWS);
        expect(touching.length).toBeGreaterThan(5);
        touching.forEach((c) => {
            const named = c.method === 'save' ? c.data.userId : c.data[0].userId;
            expect({ method: c.method, userId: named }).toEqual({ method: c.method, userId: OWNER });
        });
    });

    it('lets making someone\'s own view the default leave everyone else\'s default alone', async () => {
        await call(views.updateView, MEMBER, { id, body: { isDefault: true } });
        const theirs = (await create(COLLEAGUE, { name: 'Theirs', settings: {} })).body.data._id;
        await call(views.updateView, COLLEAGUE, { id: theirs, body: { isDefault: true } });
        expect((await list(MEMBER))[0].isDefault).toBe(true);
    });

    it('tells no one else: nothing goes out on the company\'s socket room', async () => {
        await call(views.updateView, MEMBER, { id, body: { name: 'Renamed' } });
        await call(views.deleteView, MEMBER, { id });
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it.each([['a deactivated seat', DEACTIVATED, 403], ['someone with no seat', '6f0000000000000000000009', 403], ['nobody', undefined, 401]])(
        'refuses %s before the collection is read',
        async (_who, uid, statusCode) => {
            for (const [handler, options] of [[views.listViews, {}], [views.createView, { body: { name: 'N', settings: {} } }], [views.updateView, { id, body: { name: 'N' } }], [views.deleteView, { id }]]) {
                expect((await call(handler, uid, options)).statusCode).toBe(statusCode);
            }
            expect(mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.EVERYTHING_VIEWS)).toEqual([]);
            unchanged();
        },
    );

    it('refuses a company outside the token audience', async () => {
        const res = await call(views.listViews, MEMBER, { headers: { companyid: OTHER_COMPANY } });
        expect(res.statusCode).toBe(403);
        expect(mockDb.calls).toEqual([]);
    });

    it('is not a route a token narrowed to some projects may call', async () => {
        for (const [method, path] of [['GET', '/api/v2/tasks/everything/views'], ['POST', '/api/v2/tasks/everything/views'], ['PATCH', `/api/v2/tasks/everything/views/${id}`], ['DELETE', `/api/v2/tasks/everything/views/${id}`]]) {
            const res = response();
            const next = jest.fn();
            await holdNarrowedToken({ method, originalUrl: path, headers: { companyid: C }, apiToken: { userId: MEMBER, projectIds: [PROJECT] } }, res, next);
            expect({ path, reached: next.mock.calls.length, statusCode: res.statusCode }).toEqual({ path, reached: 0, statusCode: 403 });
        }
    });
});

describe('what a view may hold', () => {
    const refusal = (fn) => {
        try { fn(); } catch (error) { if (error instanceof EverythingRefused) return error.field; throw error; }
        return null;
    };

    it('takes every setting the page has', () => {
        expect(parseViewSettings(SETTINGS)).toEqual(SETTINGS);
        expect(parseViewSettings({})).toEqual({});
        expect(parseViewSettings({ status: ['Doing', 'Doing'] })).toEqual({ status: ['Doing'] });
    });

    it.each([
        ['settings.findQuery', { findQuery: [{ $match: {} }] }],
        ['settings.columns', { columns: [] }],
        ['settings.$where', { $where: 'sleep(1000)' }],
        ['settings.userId', { userId: OWNER }],
        ['settings.mode', { mode: 'gantt' }],
        ['settings.group', { group: 'customField' }],
        ['settings.sortBy', { sortBy: 'TaskName' }],
        ['settings.sortDir', { sortDir: -1 }],
        ['settings.due', { due: 'someday' }],
        ['settings.hideDone', { hideDone: 'yes' }],
        ['settings.status', { status: 'Doing' }],
        ['settings.status', { status: [{ $ne: null }] }],
        ['settings.status', { status: Array.from({ length: 101 }, (_, n) => `s${n}`) }],
        ['settings.assignee', { assignee: ['$where'] }],
        ['settings.projectIds', { projectIds: ['not-an-id'] }],
        ['settings.search', { search: 'x'.repeat(201) }],
    ])('refuses %s', (field, settings) => {
        expect(refusal(() => parseViewSettings(settings))).toBe(field);
    });

    it.each([
        ['settings', { name: 'N', settings: [] }],
        ['name', { name: '   ', settings: {} }],
        ['name', { name: 'x'.repeat(MAX_NAME + 1), settings: {} }],
        ['name', { name: 7, settings: {} }],
        ['name', { settings: {} }],
        ['settings', { name: 'N' }],
        ['userId', { name: 'N', settings: {}, userId: OWNER }],
        ['projectId', { name: 'N', settings: {}, projectId: PROJECT }],
        ['deletedStatusKey', { name: 'N', settings: {}, deletedStatusKey: 0 }],
        ['isDefault', { name: 'N', settings: {}, isDefault: 'yes' }],
        ['body', []],
    ])('refuses a new view with a bad %s', (field, body) => {
        expect(refusal(() => parseViewBody(body, ['name', 'settings']))).toBe(field);
    });

    it('refuses a change that names nothing', () => {
        expect(refusal(() => parseViewBody({}))).toBe('body');
    });

    it('answers a refused request with 400 and the field, and stores nothing', async () => {
        const res = await create(MEMBER, { name: 'N', settings: { findQuery: [] }, userId: OWNER });
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false, field: 'userId' });
        const settings = await create(MEMBER, { name: 'N', settings: { findQuery: [] } });
        expect(settings.body.field).toBe('settings.findQuery');
        expect(stored()).toEqual([]);

        const id = (await create(MEMBER)).body.data._id;
        const changed = await call(views.updateView, MEMBER, { id, body: { settings: { ...SETTINGS, userId: OWNER } } });
        expect(changed.statusCode).toBe(400);
        expect(stored()[0].settings).toEqual(SETTINGS);
        expect((await call(views.updateView, MEMBER, { id: 'not-an-id', body: { name: 'N' } })).statusCode).toBe(404);
    });
});

describe('the stored row', () => {
    it('declares every field it keeps, in a strict schema with an index on its owner', () => {
        expect(Object.keys(schema.everything_views).sort()).toEqual(['deletedStatusKey', 'isDefault', 'name', 'settings', 'userId']);
        expect(createSchema.everythingViewsSchema.options.strict).toBe(true);
        expect(createSchema.everythingViewsSchema.indexes().map(([key]) => key)).toContainEqual({ userId: 1, deletedStatusKey: 1 });
    });
});
