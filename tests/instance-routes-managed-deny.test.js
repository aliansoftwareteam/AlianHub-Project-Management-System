const express = require('express');

const answered = (name) => (req, res) => res.send({ status: true, statusText: name });
const mockHandlers = new Proxy({}, { get: (target, name) => answered(String(name)) });

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Instance/controller', () => mockHandlers);
jest.mock('../Modules/Instance/enforcement', () => mockHandlers);
jest.mock('../Modules/Instance/csp', () => mockHandlers);
jest.mock('../Modules/Instance/egress', () => mockHandlers);
jest.mock('../Modules/Instance/instructionPatterns', () => mockHandlers);
jest.mock('../Modules/Instance/knowledge', () => mockHandlers);
jest.mock('../Modules/Instance/auditRedaction', () => mockHandlers);
jest.mock('../Modules/Agents/metricsController', () => mockHandlers);
jest.mock('../Modules/Instance/restart', () => ({ restart: (req, res) => res.status(202).send({ status: true, statusText: 'restart' }) }));
jest.mock('../Modules/Instance/guard', () => {
    const actual = jest.requireActual('../Modules/Instance/guard');
    return { ...actual, requireInstanceAdmin: (req, res, next) => { req.instanceAdmin = req.headers['x-as']; next(); } };
});

const hostingMode = require('../Config/hostingMode');

const CLOSED = [
    ['POST', '/maintenance'],
    ['GET', '/upgrade'],
    ['POST', '/migrations/run'],
    ['GET', '/logs'],
    ['GET', '/logs/files'],
    ['GET', '/logs/download'],
    ['GET', '/backups'],
    ['POST', '/backups'],
    ['GET', '/backups/b1/manifest'],
    ['GET', '/backups/b1/download'],
    ['POST', '/backups/b1/restore'],
    ['DELETE', '/backups/b1'],
    ['GET', '/orphan-databases'],
    ['POST', '/orphan-databases/db1/drop'],
];
const OPEN = [['GET', '/settings'], ['GET', '/health'], ['GET', '/stats'], ['GET', '/companies'], ['POST', '/restart']];

let server;
let base;
const savedMode = process.env.HOSTING_MODE;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    require('../Modules/Instance/routes').init(app);
    server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}/api/v2/instance`;
});

afterAll(() => {
    server.close();
    if (savedMode === undefined) delete process.env.HOSTING_MODE; else process.env.HOSTING_MODE = savedMode;
    hostingMode._resetForTests();
});

const call = async (method, path, as) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'x-as': as, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    return { status: res.status, body: await res.json() };
};

const inMode = (mode) => {
    hostingMode._resetForTests();
    if (mode) process.env.HOSTING_MODE = mode; else delete process.env.HOSTING_MODE;
};

describe('a hosted instance', () => {
    beforeAll(() => inMode('managed'));

    it.each(CLOSED)('refuses %s %s to the owner with 403', async (method, path) => {
        expect(await call(method, path, 'owner')).toEqual({ status: 403, body: { status: false, statusText: 'AlianHub Cloud manages this for you.' } });
    });

    it.each(CLOSED)('lets the platform key through to %s %s', async (method, path) => {
        expect((await call(method, path, 'platform')).status).toBe(200);
    });

    it.each(OPEN)('keeps %s %s open to the owner', async (method, path) => {
        expect((await call(method, path, 'owner')).status).toBeLessThan(300);
    });
});

describe('a self-hosted instance', () => {
    beforeAll(() => inMode(''));

    it.each(CLOSED)('keeps %s %s open to the owner, as before', async (method, path) => {
        expect((await call(method, path, 'owner')).status).toBe(200);
    });
});
