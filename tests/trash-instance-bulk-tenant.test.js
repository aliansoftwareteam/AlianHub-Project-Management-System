const mongoose = require('mongoose');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: jest.fn(async () => null),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProjectInternal: jest.fn(async () => ({})) }));
jest.mock('../Modules/Sprints/controller', () => ({ updateSprintFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Pages/controller', () => ({ restorePage: jest.fn((req, res) => res.send({ status: true })) }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({
    taskMongo: {
        bulkRestore: jest.fn(async () => ({ totals: { updated: 1 } })),
        bulkTrash: jest.fn(async () => ({ totals: { updated: 1 } })),
    },
}));
jest.mock('../Modules/Tasks/helpers/task_class', () => ({ task: {} }));
jest.mock('../Modules/Tasks/helpers/taskWritePlacement', () => ({
    ...jest.requireActual('../Modules/Tasks/helpers/taskWritePlacement'),
    readableTaskIds: jest.fn(async (companyId, uid, taskIds) => taskIds),
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const trash = require('../Modules/Trash/controller');
const instance = require('../Modules/Instance/controller');

const COMPANY = '6f00000000000000000000a1';
const OTHER_COMPANY = '6f00000000000000000000a2';
const USER = '6f00000000000000000000b1';
const TASK = String(new mongoose.Types.ObjectId());

const REFUSED = { status: false, statusText: 'You do not have access to this company' };

const response = () => {
    const res = { code: 200, body: undefined, headers: {} };
    res.status = (code) => { res.code = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = res.send;
    res.setHeader = (key, value) => { res.headers[key] = value; };
    return res;
};

const signedIn = (over = {}) => ({ headers: { companyid: COMPANY }, aud: COMPANY, uid: USER, params: {}, query: {}, body: {}, ...over });
const companiesRead = () => [...new Set(MongoDbCrudOpration.mock.calls.map(([companyId]) => String(companyId)))];

beforeEach(() => jest.clearAllMocks());

describe('trash takes the company from the verified request', () => {
    test('lists the header company when the token holds it', async () => {
        const res = response();
        await trash.list(signedIn({ query: { kind: 'tasks' } }), res);
        expect(res.body).toMatchObject({ status: true });
        expect(companiesRead()).toEqual([COMPANY]);
    });

    test('refuses a list for a header company outside the token and reads nothing', async () => {
        const res = response();
        await trash.list(signedIn({ aud: OTHER_COMPANY, query: { kind: 'tasks' } }), res);
        expect({ code: res.code, body: res.body }).toEqual({ code: 403, body: REFUSED });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    test('restores a task in the header company when the token holds it', async () => {
        const res = response();
        await trash.restore(signedIn({ params: { kind: 'tasks', id: TASK } }), res);
        expect(res.body).toMatchObject({ status: true });
        expect(taskMongo.bulkRestore).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY, taskIds: [TASK] }));
    });

    test('refuses a restore for a header company outside the token and restores nothing', async () => {
        const res = response();
        await trash.restore(signedIn({ aud: OTHER_COMPANY, params: { kind: 'tasks', id: TASK } }), res);
        expect({ code: res.code, body: res.body }).toEqual({ code: 403, body: REFUSED });
        expect(taskMongo.bulkRestore).not.toHaveBeenCalled();
    });

    test('refuses sample-data removal for a header company outside the token', async () => {
        const res = response();
        await trash.removeSampleData(signedIn({ aud: OTHER_COMPANY }), res);
        expect({ code: res.code, body: res.body }).toEqual({ code: 403, body: REFUSED });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });
});

describe('the bulk task route takes the company from the verified request', () => {
    const routes = {};
    require('../Modules/Tasks/routes').init({
        get: () => {}, put: () => {}, delete: () => {}, use: () => {}, patch: () => {},
        post: (path, ...handlers) => { routes[path] = handlers[handlers.length - 1]; },
    });
    const bulk = async (request) => {
        const res = response();
        await routes['/api/v2/tasks/bulk'](request, res);
        for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
        return res;
    };
    const body = { action: 'bulkTrash', companyId: COMPANY, taskIds: [TASK] };

    test('runs the action in the header company when the token holds it', async () => {
        const res = await bulk(signedIn({ body: { ...body } }));
        expect(res.body).toMatchObject({ status: true });
        expect(taskMongo.bulkTrash).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY, taskIds: [TASK] }));
    });

    test('refuses a header company outside the token the way other adopted modules do', async () => {
        const res = await bulk(signedIn({ aud: OTHER_COMPANY, body: { ...body } }));
        expect({ code: res.code, body: res.body }).toEqual({ code: 403, body: REFUSED });
        expect(taskMongo.bulkTrash).not.toHaveBeenCalled();
    });
});

describe('the instance audit export', () => {
    test('exports any workspace the instance owner names, whatever the token holds', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce([{ Type: 'task', Key: 'k', Message: 'm', createdAt: new Date(0) }]);
        const res = response();
        await instance.auditExport(signedIn({ instanceAdmin: 'owner', query: { companyId: OTHER_COMPANY } }), res);
        expect(res.code).toBe(200);
        expect(res.headers['Content-Disposition']).toBe(`attachment; filename="audit-${OTHER_COMPANY}.csv"`);
        expect(companiesRead()).toEqual([OTHER_COMPANY]);
    });

    test('exports the header company for the admin key, which carries no token', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce([]);
        const res = response();
        await instance.auditExport({ instanceAdmin: 'key', headers: { companyid: COMPANY }, query: {}, body: {} }, res);
        expect(res.code).toBe(200);
        expect(companiesRead()).toEqual([COMPANY]);
    });

    test('refuses a header company outside the owner token when no workspace is named', async () => {
        const res = response();
        await instance.auditExport(signedIn({ instanceAdmin: 'owner', aud: OTHER_COMPANY }), res);
        expect({ code: res.code, body: res.body }).toEqual({ code: 403, body: REFUSED });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });
});
