const fs = require('fs');
const path = require('path');

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs, dbCollections } = require('../Config/collections');

const CID = '6f00000000000000000000c1';
const OTHER_CID = '6f00000000000000000000c2';
const USERS = {
    owner: ['6f0000000000000000000001', 1],
    admin: ['6f0000000000000000000002', 2],
    member: ['6f0000000000000000000003', 3],
    guest: ['6f0000000000000000000004', 0],
};

const SETTINGS_DIR = path.join(__dirname, '..', 'Modules', 'settings');
const routes = [];
const app = ['get', 'put', 'post', 'delete', 'patch'].reduce((acc, method) => {
    acc[method] = (routePath, ...handlers) => routes.push({ method, path: routePath, handlers });
    return acc;
}, {});
fs.readdirSync(SETTINGS_DIR)
    .filter((dir) => fs.existsSync(path.join(SETTINGS_DIR, dir, 'routes.js')))
    .forEach((dir) => require(path.join(SETTINGS_DIR, dir, 'routes.js')).init(app));

const GATED = [
    'PUT /api/v1/setting/roles/update',
    'PUT /api/v1/setting/designation/update',
    'PUT /api/v1/commonDateFormate',
    'PUT /api/v1/taskPriority',
    'PUT /api/v1/fileExtensions',
    'PUT /api/v1/milestoneStatus',
    'PUT /api/v1/securityPermissions',
    'PUT /api/v1/setting/skills',
    'POST /api/v1/project-status-template',
    'PUT /api/v1/project-status-template',
    'DELETE /api/v1/project-status-template/:id',
    'PUT /api/v1/templates/taskType',
    'POST /api/v1/templates/taskType',
    'DELETE /api/v1/templates/taskType/:id',
    'PUT /api/v1/templates/taskStatus',
    'POST /api/v1/templates/taskStatus',
    'DELETE /api/v1/templates/taskStatus/:id',
    'PUT /api/v1/setting/taskType',
    'PUT /api/v1/setting/taskStatus',
    'PUT /api/v1/setting/projectStatus',
];
/* Judged inside the controller: a member may change their own row, views and notification settings. */
const JUDGED_IN_CONTROLLER = [
    'PUT /api/v1/members',
    'PUT /api/v1/root-members',
    'POST /api/v1/members/private-view',
    'POST /api/v1/members/count',
    'PUT /api/v1/notifications',
    'PUT /api/v1/notifications/preferences',
    'PUT /api/v1/currency/:cid/:id',
];

const label = (r) => `${r.method.toUpperCase()} ${r.path}`;
const routeFor = (name) => routes.find((r) => label(r) === name);

const makeRes = () => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    return res;
};

/* Runs every handler before the controller; true when the request would reach it. */
const reachesController = async (route, req) => {
    const res = makeRes();
    for (const handler of route.handlers.slice(0, -1)) {
        let passed = false;
        await handler(req, res, () => { passed = true; });
        if (!passed) return { reached: false, res };
    }
    return { reached: true, res };
};

const requestAs = (role, extra = {}) => ({ uid: USERS[role][0], headers: { companyid: CID }, body: {}, params: {}, query: {}, ...extra });
const call = async (handler, req) => { const res = makeRes(); await handler(req, res); return res; };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    Object.values(USERS).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
});

describe('INS-06 company settings writes', () => {
    it('gates every write route in Modules/settings or judges it in the controller', () => {
        const writes = routes.filter((r) => r.method !== 'get').map(label);
        expect(writes.filter((name) => !GATED.includes(name) && !JUDGED_IN_CONTROLLER.includes(name))).toEqual([]);
        GATED.forEach((name) => expect(routeFor(name)).toBeDefined());
    });

    const refusals = GATED.flatMap((name) => ['guest', 'member'].map((role) => [role, name]));
    it.each(refusals)('refuses a %s on %s', async (role, name) => {
        const { reached, res } = await reachesController(routeFor(name), requestAs(role));
        expect(reached).toBe(false);
        expect(res.code).toBe(403);
        expect(res.body).toMatchObject({ status: false, statusText: expect.any(String) });
    });

    const passes = GATED.flatMap((name) => ['owner', 'admin'].map((role) => [role, name]));
    it.each(passes)('lets the %s through on %s', async (role, name) => {
        const { reached } = await reachesController(routeFor(name), requestAs(role));
        expect(reached).toBe(true);
    });

    it('refuses a caller with no seat in the company', async () => {
        const { reached, res } = await reachesController(routeFor('PUT /api/v1/securityPermissions'), { ...requestAs('owner'), uid: '6f0000000000000000000099' });
        expect(reached).toBe(false);
        expect(res.code).toBe(403);
    });

    it('keeps the settings reads open to a guest', async () => {
        for (const route of routes.filter((r) => r.method === 'get')) {
            const { reached } = await reachesController(route, requestAs('guest'));
            expect({ route: label(route), reached }).toEqual({ route: label(route), reached: true });
        }
    });

    it.each([
        ['Roles', 'updateRole', settingsCollectionDocs.ROLES],
        ['Designation', 'updateDesignation', settingsCollectionDocs.DESIGNATIONS],
    ])('%s update only touches its own settings document', async (dir, handler, docName) => {
        const ctrl = require(`../Modules/settings/${dir}/controller`);
        mockDb.seed(SCHEMA_TYPE.SETTINGS, { name: docName, settings: [] });
        mockDb.seed(SCHEMA_TYPE.SETTINGS, { name: 'rules', settings: [] });
        const foreign = await call(ctrl[handler], requestAs('owner', { body: { queryFilter: { name: 'rules' }, queryObj: { $set: { qaMarker: true } } } }));
        expect(foreign.code).toBe(400);
        const operator = await call(ctrl[handler], requestAs('owner', { body: { queryFilter: { name: docName }, queryObj: { $rename: { settings: 'gone' } } } }));
        expect(operator.code).toBe(400);
        const own = await call(ctrl[handler], requestAs('owner', { body: { queryFilter: { name: docName }, queryObj: { $push: { settings: { key: 1, name: 'Lead' } } } } }));
        expect(own.code).toBe(200);
        expect(mockDb.store[SCHEMA_TYPE.SETTINGS].find((d) => d.name === 'rules').qaMarker).toBeUndefined();
    });
});

describe('INS-05 PUT /api/v1/currency/:cid/:id', () => {
    const ctrl = require('../Modules/settings/settingCurrency/controller');
    const seedCurrency = () => mockDb.seed(dbCollections.CURRENCY_LIST, { code: 'USD', count: 1, isDelete: false });

    it('refuses a currency write aimed at another company', async () => {
        const currency = seedCurrency();
        const res = await call(ctrl.updateCurrency, requestAs('admin', { params: { cid: OTHER_CID, id: currency._id }, body: { key: '$set', updateObject: { qaMarker: true } } }));
        expect(res.code).toBe(403);
        expect(res.body.status).toBe(false);
        expect(mockDb.calls.filter((c) => c.method === 'updateOne')).toEqual([]);
    });

    it('writes to the session company', async () => {
        const currency = seedCurrency();
        const res = await call(ctrl.updateCurrency, requestAs('admin', { params: { cid: CID, id: currency._id }, body: { key: '$set', updateObject: { isDelete: true } } }));
        expect(res.code).toBe(200);
        expect(mockDb.calls.find((c) => c.method === 'updateOne').companyId).toBe(CID);
    });

    it('lets a member move the project usage count and nothing else', async () => {
        const currency = seedCurrency();
        const count = await call(ctrl.updateCurrency, requestAs('member', { params: { cid: CID, id: currency._id }, body: { key: '$inc', updateObject: { count: 1 } } }));
        expect(count.code).toBe(200);
        const hide = await call(ctrl.updateCurrency, requestAs('member', { params: { cid: CID, id: currency._id }, body: { key: '$set', updateObject: { isDelete: true } } }));
        expect(hide.code).toBe(403);
        const operator = await call(ctrl.updateCurrency, requestAs('admin', { params: { cid: CID, id: currency._id }, body: { key: '$unset', updateObject: { code: 1 } } }));
        expect(operator.code).toBe(400);
    });
});

describe('PUT /api/v1/notifications', () => {
    const ctrl = require('../Modules/settings/settingNotifications/controller');

    it('refuses changing another member notification settings', async () => {
        const doc = mockDb.seed(dbCollections.NOTIFICATIONS_SETTINGS, { userId: USERS.admin[0], chat: { items: [{ key: 'k', email: false }] } });
        const res = await call(ctrl.updateNotifications, requestAs('member', {
            body: { id: doc._id, key: 'chat', elementKey: 'k', fieldToUpdate: 'email', valueToUpdate: true, userId: USERS.admin[0] },
        }));
        expect(res.code).toBe(403);
        expect(mockDb.calls.filter((c) => c.method === 'updateOne')).toEqual([]);
    });
});
