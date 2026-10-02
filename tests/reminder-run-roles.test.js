const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...a) => mockDb.crud(...a),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/GeneralReminders/controller', () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn((req, res) => res.send({ status: true, ran: name }));
        return target[name];
    },
}));
jest.mock('../Modules/TimeSheet/controller/timeReminders', () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn((req, res) => res.send({ status: true, ran: name }));
        return target[name];
    },
}));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const generalReminders = require('../Modules/GeneralReminders/controller');
const timeReminders = require('../Modules/TimeSheet/controller/timeReminders');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const GUEST = '6f0000000000000000000a04';
const STRANGER = '6f0000000000000000000a09';

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    require(modulePath).init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE') });
    return table;
};

const RUNS = [
    ['POST /api/v1/general-reminders/run-due', routesOf('../Modules/GeneralReminders/routes'), generalReminders.runDueForCompany],
    ['POST /api/v1/timesheet/send-reminders', routesOf('../Modules/TimeSheet/routes'), timeReminders.triggerReminders],
];

const through = async (handlers, uid) => {
    const res = { code: 200, body: null };
    res.status = (code) => { res.code = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = res.json;
    const req = { headers: { companyid: C }, body: {}, query: {}, params: {}, uid };
    for (const handler of handlers) {
        let passed = false;
        // eslint-disable-next-line no-await-in-loop
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    return res;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    jest.clearAllMocks();
    [[OWNER, 1], [ADMIN, 2], [MEMBER, 3], [GUEST, 0]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
});

describe.each(RUNS)('%s runs for the whole company', (route, table, handler) => {
    it.each([['an owner', OWNER], ['an admin', ADMIN]])('for %s', async (_who, uid) => {
        const res = await through(table[route], uid);
        expect(res.code).toBe(200);
        expect(res.body.status).toBe(true);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it.each([['a member', MEMBER], ['a guest', GUEST], ['someone with no seat', STRANGER]])('and not for %s', async (_who, uid) => {
        const res = await through(table[route], uid);
        expect(res.code).toBe(403);
        expect(res.body.status).toBe(false);
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('the reminder routes a person uses for themselves', () => {
    const table = routesOf('../Modules/GeneralReminders/routes');

    it.each([
        ['POST /api/v1/general-reminders', 'createReminder'],
        ['GET /api/v1/general-reminders', 'listMine'],
        ['POST /api/v1/general-reminders/:id/run-now', 'runNow'],
        ['PATCH /api/v1/general-reminders/:id', 'updateReminder'],
        ['DELETE /api/v1/general-reminders/:id', 'deleteReminder'],
    ])('%s stays open to a member', async (route, name) => {
        const res = await through(table[route], MEMBER);
        expect(res.body).toEqual({ status: true, ran: name });
    });
});
