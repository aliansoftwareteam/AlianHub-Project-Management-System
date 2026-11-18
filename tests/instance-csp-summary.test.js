const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/jwt', () => ({
    verifyJWTTokenV2: (req, res, next) => {
        const uid = req.headers['x-uid'];
        if (!uid) return res.status(401).send({ status: false, statusText: 'No session.' });
        req.uid = uid;
        if (req.headers['x-api-token']) req.apiToken = { id: req.headers['x-api-token'] };
        return next();
    },
}));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Instance/controller', () => new Proxy({}, { get: () => (req, res) => res.status(200).json({ status: true, reached: true }) }));
jest.mock('../Modules/Instance/enforcement', () => new Proxy({}, { get: () => (req, res) => res.status(200).json({ status: true, reached: true }) }));
jest.mock('../Modules/Agents/metricsController', () => ({ instanceMetrics: (req, res) => res.json({ status: true }) }));

const express = require('express');
const csp = require('../Config/contentSecurityPolicy');
const { init } = require('../Modules/Instance/routes');

const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const ROUTE = '/api/v2/instance/csp';
const DAY = 24 * 60 * 60 * 1000;
const ENV_KEYS = ['CSP_MODE', 'INSTANCE_ADMIN_KEY', 'CSP_EXTRA_IMG_SRC'];

const g = () => mockDbFor('global');
const utcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const report = (over = {}) => {
    const lastSeen = over.lastSeen || daysAgo(1);
    return { day: utcDay(lastSeen), directive: 'img-src', blockedHost: 'cdn.example.com', documentPath: '/:id/project', count: 1, lastSeen, ...over };
};

let server;
let baseURL;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    init(app);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    ENV_KEYS.forEach((key) => { delete process.env[key]; });
    jest.clearAllMocks();
    g().seed('users', { _id: OWNER, Employee_Name: 'Olivia Owner', isProductOwner: true });
    g().seed('users', { _id: MEMBER, Employee_Name: 'Max Member' });
});

afterAll(() => ENV_KEYS.forEach((key) => { delete process.env[key]; }));

const call = async (headers = {}) => {
    const res = await fetch(baseURL + ROUTE, { headers });
    return { status: res.status, body: await res.json() };
};
const asOwner = () => call({ 'x-uid': OWNER });

describe('GET /api/v2/instance/csp', () => {
    it('is for the instance owner only', async () => {
        expect((await call()).status).toBe(401);
        expect((await call({ 'x-uid': MEMBER })).status).toBe(403);
        expect((await call({ 'x-uid': OWNER, 'x-api-token': 't1' })).status).toBe(403);
        expect((await asOwner()).status).toBe(200);
    });

    it.each([[undefined, 'off', null], ['report', 'report', 'Content-Security-Policy-Report-Only'], ['ENFORCE', 'enforce', 'Content-Security-Policy']])('reports the mode the server runs in (%s)', async (value, mode, header) => {
        if (value) process.env.CSP_MODE = value;
        const { body } = await asOwner();
        expect(body.status).toBe(true);
        expect(body.data).toMatchObject({ mode, header, days: 7, reportPath: '/api/v2/csp-report' });
    });

    it('shows the policy the server sends, or would send once the mode is on', async () => {
        process.env.CSP_EXTRA_IMG_SRC = 'https://cdn.example.com';
        const { body } = await asOwner();
        expect(body.data.policy).toBe(csp.policyOf(process.env));
        expect(body.data.policy).toContain('https://cdn.example.com');
    });

    it('adds up the last seven days by blocked host and by directive, largest first', async () => {
        g().seed('csp_reports', report({ count: 4 }));
        g().seed('csp_reports', report({ count: 2, lastSeen: daysAgo(3), documentPath: '/:id/pages' }));
        g().seed('csp_reports', report({ count: 9, directive: 'script-src-elem', blockedHost: 'inline', lastSeen: daysAgo(2) }));
        g().seed('csp_reports', report({ count: 1, directive: 'connect-src', blockedHost: 'cdn.example.com' }));
        g().seed('csp_reports', report({ count: 500, blockedHost: 'old.example.com', lastSeen: daysAgo(9) }));

        const { data } = (await asOwner()).body;

        expect(data.total).toBe(16);
        expect(data.hosts.map((row) => [row.blockedHost, row.directive, row.count])).toEqual([['inline', 'script-src-elem', 9], ['cdn.example.com', 'img-src', 6], ['cdn.example.com', 'connect-src', 1]]);
        expect(new Date(data.hosts[1].lastSeen).getTime()).toBe(g().store.csp_reports[0].lastSeen.getTime());
        expect(data.directives).toEqual([{ directive: 'script-src-elem', count: 9 }, { directive: 'img-src', count: 6 }, { directive: 'connect-src', count: 1 }]);
        expect(JSON.stringify(data)).not.toContain('old.example.com');
    });

    it('lists ten rows at most', async () => {
        for (let i = 0; i < 14; i += 1) g().seed('csp_reports', report({ blockedHost: `h${i}.example.com`, directive: i % 2 ? 'img-src' : `${['font', 'media', 'frame', 'worker', 'connect', 'style', 'script'][i / 2]}-src`, count: i + 1 }));
        const { data } = (await asOwner()).body;
        expect(data.hosts).toHaveLength(10);
        expect(data.hosts[0]).toMatchObject({ blockedHost: 'h13.example.com', count: 14 });
        expect(data.total).toBe(105);
    });

    it('answers with empty lists before any report arrives', async () => {
        const { data } = (await asOwner()).body;
        expect(data).toMatchObject({ total: 0, hosts: [], directives: [] });
    });
});
