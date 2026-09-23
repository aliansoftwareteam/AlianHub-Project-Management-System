const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/ApiTokens/controller', () => ({ resolveToken: jest.fn(), logTokenActivity: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { resolveToken } = require('../Modules/ApiTokens/controller');
const jwt = require('../Config/jwt');
const getTaskCtrl = require('../Modules/Tasks/helpers/getTasksData');
const { requireStoredFileRead } = require('../Modules/storage/downloadScope');

/* A token narrowed to some projects is held to them by the shared checks every REST route reads
 * (the visible-project set, the project guard, the task visibility stage, the stored-file check),
 * and a route that cannot hold it is refused before its handler runs. */

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const MEMBER_ROLE = 3;

const oid = () => new mongoose.Types.ObjectId().toString();
const rawToken = (n) => `ahp_${String(n).repeat(48).slice(0, 48)}`;
const TOKENS = {};
const token = (n, userId, projectIds) => {
    const raw = rawToken(n);
    TOKENS[raw] = { _id: `tok${n}`, userId, scopes: ['read', 'write'], active: true, kind: 'agent', projectIds };
    return raw;
};

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};

const REACHED = Symbol('reached');

/* Runs the chain the way Express does, each handler inside the previous one's next(), and settles
 * on the first response or on falling off the end. */
const run = (handlers, req) => new Promise((resolve, reject) => {
    const res = { statusCode: 200, body: undefined };
    const done = () => resolve(res);
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; done(); return res; };
    res.send = res.json;
    res.set = () => res;
    res.on = () => res;
    res.clearCookie = () => res;
    const step = (i) => {
        if (i >= handlers.length) { res.body = REACHED; return done(); }
        return Promise.resolve(handlers[i](req, res, () => step(i + 1))).catch(reject);
    };
    step(0);
});

const request = (raw, method, url, { params = {}, query = {}, body = {} } = {}) => ({
    method, originalUrl: url, path: url.split('?')[0], params, query, body, ip: '127.0.0.1',
    headers: { companyid: C, authorization: `Bearer ${raw}` },
});

const viaJwt = (raw, method, url, handlers, options) => run([jwt.verifyJWTTokenWithCV2, ...handlers], request(raw, method, url, options));

const publicApi = (raw, path, options = {}) => {
    const url = path.replace(':key', (options.params || {}).key || '');
    return run(routesOf('../Modules/ApiTokens/publicApi')[`GET ${path}`], request(raw, 'GET', url, options));
};

const seedRules = (grants = {}) => {
    const parents = {};
    const parentOf = (section) => {
        if (!parents[section]) parents[section] = mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        return parents[section];
    };
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parentOf(section)._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

let A;
let B;
let taskA;
let taskB;
const OWNER_NARROWED = token(1, OWNER, []);
const OWNER_FULL = token(2, OWNER, []);
const MEMBER_NARROWED = token(3, MEMBER, []);
const MEMBER_FULL = token(4, MEMBER, []);

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    seedRules({ 'project.private_projects': 1, 'task.task_attachments': true });
    A = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'A', isPrivateSpace: false, AssigneeUserId: [OWNER, MEMBER], deletedStatusKey: 0 });
    B = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'B', isPrivateSpace: false, AssigneeUserId: [OWNER, MEMBER], deletedStatusKey: 0 });
    taskA = mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), TaskKey: 'A-1', TaskName: 'in A', ProjectID: String(A._id), deletedStatusKey: 0 });
    taskB = mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), TaskKey: 'B-1', TaskName: 'in B', ProjectID: String(B._id), deletedStatusKey: 0 });
    [OWNER, MEMBER].forEach((uid) => myCache.set(`membership:${uid}:${C}`, true, 600));
    TOKENS[OWNER_NARROWED].projectIds = [String(A._id)];
    TOKENS[MEMBER_NARROWED].projectIds = [String(A._id)];
    resolveToken.mockImplementation(async (companyId, raw) => ({ token: companyId === C ? TOKENS[raw] || null : null }));
});

afterEach(() => {
    delete process.env.STORAGE_DOWNLOAD_SCOPE;
});

describe('the visible-project set and the task visibility stage', () => {
    it('lists only the listed projects to a narrowed token', async () => {
        for (const raw of [OWNER_NARROWED, MEMBER_NARROWED]) {
            const res = await publicApi(raw, '/api/public-v1/projects');
            expect(res.body.data.map((p) => String(p._id))).toEqual([String(A._id)]);
        }
    });

    it('keeps every project the person may open for a token with an empty list', async () => {
        for (const raw of [OWNER_FULL, MEMBER_FULL]) {
            const res = await publicApi(raw, '/api/public-v1/projects');
            expect(res.body.data.map((p) => String(p._id)).sort()).toEqual([String(A._id), String(B._id)].sort());
        }
    });

    it('leaves what the same request computes for someone else alone', async () => {
        const { runNarrowed } = require('../Config/tokenNarrowing');
        const { visibleProjectIds } = require('../Modules/Agents/scope');
        const seen = await runNarrowed(TOKENS[OWNER_NARROWED], async () => ({
            owner: await visibleProjectIds(C, OWNER),
            member: await visibleProjectIds(C, MEMBER),
        }));
        expect(seen.owner).toEqual([String(A._id)]);
        expect(seen.member.sort()).toEqual([String(A._id), String(B._id)].sort());
    });

    it('reads a token with an empty list as not narrowed', async () => {
        TOKENS[OWNER_NARROWED].projectIds = [];
        const res = await publicApi(OWNER_NARROWED, '/api/public-v1/projects');
        expect(res.body.data).toHaveLength(2);
    });

    it('finds no task outside the list, for an owner as for a member', async () => {
        for (const raw of [OWNER_NARROWED, MEMBER_NARROWED]) {
            expect((await publicApi(raw, '/api/public-v1/tasks/:key', { params: { key: 'B-1' } })).statusCode).toBe(404);
            expect((await publicApi(raw, '/api/public-v1/tasks/:key', { params: { key: 'A-1' } })).statusCode).toBe(200);
        }
        expect((await publicApi(OWNER_FULL, '/api/public-v1/tasks/:key', { params: { key: 'B-1' } })).statusCode).toBe(200);
    });

    it('narrows a task search to the list', async () => {
        const find = (raw) => viaJwt(raw, 'POST', '/api/v1/task/find', [getTaskCtrl.getTaskByQyery], { body: { findQuery: [{ $match: {} }] } });
        for (const raw of [OWNER_NARROWED, MEMBER_NARROWED]) {
            const res = await find(raw);
            expect(res.body.map((t) => String(t._id))).toEqual([String(taskA._id)]);
        }
        expect((await find(OWNER_FULL)).body.map((t) => String(t._id)).sort()).toEqual([String(taskA._id), String(taskB._id)].sort());
    });
});

describe('the project guard', () => {
    const read = (raw, task) => viaJwt(raw, 'GET', `/api/v1/task/${task._id}`, [getTaskCtrl.getTask], { params: { id: String(task._id) } });

    it('answers a task outside the list as not found', async () => {
        for (const raw of [OWNER_NARROWED, MEMBER_NARROWED]) {
            expect((await read(raw, taskB)).statusCode).toBe(404);
            expect((await read(raw, taskA)).statusCode).toBe(200);
        }
    });

    it('is unchanged for a token with an empty list', async () => {
        for (const raw of [OWNER_FULL, MEMBER_FULL]) expect((await read(raw, taskB)).statusCode).toBe(200);
    });
});

describe('routes that cannot hold a narrowed token', () => {
    it('refuses them before the handler runs', async () => {
        for (const raw of [OWNER_NARROWED, MEMBER_NARROWED]) {
            const res = await viaJwt(raw, 'GET', '/api/v1/project', []);
            expect(res.statusCode).toBe(403);
            expect(res.body).not.toBe(REACHED);
        }
        expect((await viaJwt(OWNER_FULL, 'GET', '/api/v1/project', [])).body).toBe(REACHED);
    });

    it('holds a route that names its project to the list', async () => {
        const page = (raw, project) => viaJwt(raw, 'GET', `/api/v1/comments/get-paginated-messages?projectId=${project._id}`, [], { query: { projectId: String(project._id) } });
        for (const raw of [OWNER_NARROWED, MEMBER_NARROWED]) {
            expect((await page(raw, B)).body).not.toBe(REACHED);
            expect((await page(raw, A)).body).toBe(REACHED);
        }
        expect((await page(OWNER_FULL, B)).body).toBe(REACHED);
    });
});

describe('stored files', () => {
    const signed = (raw, key) => viaJwt(raw, 'GET', `/api/v1/generateSignedUrl/${C}?filepath=${encodeURIComponent(key)}`, [
        requireStoredFileRead((req) => C, (req) => req.query.filepath, { storage: 'server' }),
    ], { params: { bucketId: C }, query: { filepath: key } });
    const keyOf = (project, task) => `Project/${project._id}/Sprint/${task._id}/Attachment/notes.txt`;

    it('holds a narrowed token to the list even while downloads are only reported', async () => {
        process.env.STORAGE_DOWNLOAD_SCOPE = 'report';
        expect((await signed(OWNER_NARROWED, keyOf(A, taskB))).body).not.toBe(REACHED);
        expect((await signed(OWNER_NARROWED, keyOf(B, taskB))).body).not.toBe(REACHED);
        expect((await signed(OWNER_NARROWED, keyOf(A, taskA))).body).toBe(REACHED);
        expect((await signed(OWNER_FULL, keyOf(A, taskB))).body).toBe(REACHED);
    });

    it('holds an object store link to the key\'s project', async () => {
        const link = (raw, key) => viaJwt(raw, 'POST', '/api/v1/wasabi/retriveObject', [], { body: { companyId: C, path: key } });
        expect((await link(OWNER_NARROWED, keyOf(B, taskB))).statusCode).toBe(404);
        expect((await link(OWNER_NARROWED, 'companyIcon/logo.png')).statusCode).toBe(404);
        expect((await link(OWNER_NARROWED, keyOf(A, taskA))).body).toBe(REACHED);
        expect((await link(OWNER_FULL, keyOf(B, taskB))).body).toBe(REACHED);
    });
});
