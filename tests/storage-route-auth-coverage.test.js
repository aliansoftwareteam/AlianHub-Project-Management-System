process.env.STORAGE_TYPE = 'wasabi';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(), getCompanyDataFun: jest.fn() }));
jest.mock('../Modules/LogTime/controllerV2', () => new Proxy({}, {
    get: (_target, key) => (typeof key === 'string' && key !== '__esModule' && key !== 'then' ? (_req, res) => res.json({ reached: true }) : undefined),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));
jest.mock('@aws-sdk/client-s3', () => {
    const command = () => class { constructor(input) { this.input = input; } };
    return {
        S3Client: class { async send() { return {}; } },
        GetObjectCommand: command(),
        CreateBucketCommand: command(),
        PutObjectCommand: command(),
        DeleteObjectCommand: command(),
        ListObjectsV2Command: command(),
        CopyObjectCommand: command(),
        DeleteBucketCommand: command(),
        HeadObjectCommand: command(),
    };
});
/* Every guard that needs req.uid is recorded, so each route carrying one can be checked against the real JWT lists. */
jest.mock('../Modules/storage/bucketAccess', () => {
    const actual = jest.requireActual('../Modules/storage/bucketAccess');
    const guards = new Set();
    const tracked = (factory) => (...args) => {
        const guard = factory(...args);
        guards.add(guard);
        return guard;
    };
    return {
        ...actual,
        guards,
        refuseUpload: tracked(actual.refuseUpload),
        requireBucketWrite: tracked(actual.requireBucketWrite),
        requireBucketRemoval: tracked(actual.requireBucketRemoval),
        requireOwnBucket: tracked(actual.requireOwnBucket),
    };
});

const express = require('express');
const { setMiddlewareWithCV2, setMiddlewareV2 } = require('../Config/setMiddleware');
const { guards } = require('../Modules/storage/bucketAccess');

const ROUTE_MODULES = ['../Modules/storage/server/routes', '../Modules/storage/wasabi/routes', '../Modules/LogTime/routes'];
const SAMPLE_ID = '6f0000000000000000000c01';

function guardedRoutes() {
    const routes = [];
    const app = { use() {} };
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
        app[method] = (routePath, ...handlers) => {
            if (handlers.flat(Infinity).some((handler) => guards.has(handler))) routes.push([method, routePath]);
        };
    }
    for (const file of ROUTE_MODULES) require(file).init(app);
    return routes;
}

const GUARDED = guardedRoutes();

let server;
let baseURL;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    setMiddlewareWithCV2(app);
    setMiddlewareV2(app);
    app.use((_req, res) => res.json({ reached: true }));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('storage routes with an access guard', () => {
    it('include every upload route', () => {
        expect(GUARDED).toEqual(expect.arrayContaining([
            ['post', '/api/v1/storage/uploadFile'],
            ['post', '/api/v1/wasabi/uploadFile'],
            ['post', '/api/v1/wasabi/uploadFile_64'],
            ['post', '/api/v2/timetracker/capture'],
            ['post', '/api/v3/timetracker/capture'],
            ['post', '/api/v4/timetracker/capture'],
        ]));
    });

    it.each(GUARDED)('%s %s is behind a JWT middleware, which is what sets req.uid', async (method, routePath) => {
        const res = await fetch(`${baseURL}${routePath.replace(/:\w+/g, SAMPLE_ID).replace(/\*/g, 'x')}`, {
            method: method === 'all' ? 'POST' : method.toUpperCase(),
            headers: { 'content-type': 'application/json' },
            body: method === 'get' ? undefined : '{}',
        });
        expect(res.status).toBe(401);
        expect((await res.json()).isJwtError).toBe(true);
    });
});
