const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method),
}));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));

const { myCache } = require('../Config/config');
const { getRoleType } = require('../Config/permissionGuard');
const allowlist = require('../Modules/Agents/engine/egressAllowlist');
const skillsCtrl = require('../Modules/Agents/skillsController');

const FLAG = 'SKILL_EXTERNAL_READS';
const C = '6f0000000000000000000c01';
const C2 = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000a01';
const LISTED = ['api.github.com', 'status.example.org:8443', '*.acme.io'];

const seedList = (hosts, companyId = C) => mockDbFor(companyId).seed(allowlist.COLLECTION, { _id: allowlist.DOC_ID, hosts });

const req = (host, over = {}) => ({ headers: { companyid: C }, params: {}, query: { host }, body: {}, uid: OWNER, ...over });
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const check = async (host, over) => { const r = res(); await skillsCtrl.egressCheck(req(host, over), r); return r; };

beforeEach(() => {
    Object.values(mockDbs).forEach((db) => { Object.keys(db.store).forEach((k) => { db.store[k].length = 0; }); db.calls.length = 0; });
    myCache.flushAll();
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(1);
    process.env[FLAG] = 'on';
    seedList(LISTED);
});

afterAll(() => { delete process.env[FLAG]; });

describe('GET /api/v2/agents/skills/egress-check', () => {
    it('answers allowed for a host on this workspace list, the port included', async () => {
        const r = await check('api.github.com');
        expect(r.code).toBe(200);
        expect(r.body).toMatchObject({ status: true, data: { host: 'api.github.com', state: 'allowed' } });
        expect((await check('status.example.org:8443')).body.data.state).toBe('allowed');
        expect((await check('API.GitHub.com')).body.data).toEqual({ host: 'api.github.com', state: 'allowed' });
    });

    it('answers not_listed for a declarable host the list does not hold, or holds on another port only', async () => {
        expect((await check('api.gitlab.com')).body.data).toEqual({ host: 'api.gitlab.com', state: 'not_listed' });
        expect((await check('status.example.org')).body.data.state).toBe('not_listed');
        expect((await check('status.example.org:9443')).body.data.state).toBe('not_listed');
        expect((await check('api.github.com:8443')).body.data.state).toBe('allowed');
    });

    it('answers not_listed for every host when the list is empty', async () => {
        seedList([], C2);
        const r = await check('api.github.com', { headers: { companyid: C2 } });
        expect(r.body.data.state).toBe('not_listed');
    });

    it('answers not_declarable, with the reason, for a host no skill may declare even when the list matches it', async () => {
        const cases = [
            ['*.acme.io', 'wildcard'],
            ['127.0.0.1.nip.io', 'wildcard_dns'],
            ['build.corp', 'private'],
            ['localhost', 'private'],
            ['10.0.0.1', 'address'],
            ['https://api.github.com', 'scheme'],
            ['api.github.com/repos', 'path'],
            ['', 'invalid'],
        ];
        for (const [host, reason] of cases) {
            // eslint-disable-next-line no-await-in-loop
            const r = await check(host);
            expect(r.code).toBe(200);
            expect(r.body.data).toMatchObject({ state: 'not_declarable', reason });
        }
        const list = await check(['api.github.com', 'api.gitlab.com']);
        expect(list.body.data).toMatchObject({ state: 'not_declarable', reason: 'invalid' });
    });

    it('never returns the list itself', async () => {
        for (const host of ['api.github.com', 'api.gitlab.com', 'localhost']) {
            // eslint-disable-next-line no-await-in-loop
            const r = await check(host);
            const text = JSON.stringify(r.body);
            LISTED.filter((entry) => entry !== host).forEach((entry) => expect(text).not.toContain(entry));
            expect(Object.keys(r.body.data).sort()).toEqual(expect.arrayContaining(['host', 'state']));
            expect(Object.keys(r.body.data).every((k) => ['host', 'state', 'reason'].includes(k))).toBe(true);
        }
    });

    it('reads only the calling workspace list', async () => {
        seedList(['api.gitlab.com'], C2);
        expect((await check('api.gitlab.com')).body.data.state).toBe('not_listed');
        expect((await check('api.gitlab.com', { headers: { companyid: C2 } })).body.data.state).toBe('allowed');
        expect((await check('api.github.com', { headers: { companyid: C2 } })).body.data.state).toBe('not_listed');
        expect(mockDbFor(C).calls.every((c) => String(c.companyId) === C)).toBe(true);
        expect(getRoleType).toHaveBeenCalledWith(C2, OWNER);
    });

    it('refuses a company the session is not scoped to', async () => {
        const r = await check('api.github.com', { headers: { companyid: C2 }, aud: C });
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(r.body.data).toBeUndefined();
    });

    it('refuses a member without the skill permission', async () => {
        getRoleType.mockResolvedValue(3);
        const r = await check('api.github.com');
        expect(r.code).toBe(403);
        expect(r.body.data).toBeUndefined();
    });

    it('refuses an API token, even one an owner holds', async () => {
        const r = await check('api.github.com', { apiToken: { _id: '6f0000000000000000000t01', name: 'script', userId: OWNER } });
        expect(r.code).toBe(403);
        expect(r.body.data).toBeUndefined();
    });

    it('refuses an OAuth token, even one an owner granted', async () => {
        const r = await check('api.github.com', { mcp: true });
        expect(r.code).toBe(403);
        expect(r.body.data).toBeUndefined();
    });

    it('refuses an agent', async () => {
        const r = await check('api.github.com', { agentActor: { kind: 'agent', userId: OWNER, agentId: '6f0000000000000000000b01' } });
        expect(r.code).toBe(403);
    });

    it('is not there while declared reads are off', async () => {
        delete process.env[FLAG];
        const r = await check('api.github.com');
        expect(r.code).toBe(404);
        expect(r.body.data).toBeUndefined();
    });

    it('is routed ahead of the skill key route, which would otherwise take it as a key', () => {
        const gets = [];
        const app = { get: (path) => gets.push(path), post: () => {}, put: () => {}, delete: () => {}, patch: () => {}, use: () => {} };
        require('../Modules/Agents/routes').init(app);
        const at = gets.indexOf('/api/v2/agents/skills/egress-check');
        expect(at).toBeGreaterThan(-1);
        expect(at).toBeLessThan(gets.indexOf('/api/v2/agents/skills/:key'));
    });

    it('says the list could not be read rather than guessing', async () => {
        const spy = jest.spyOn(allowlist, 'hostsFor').mockRejectedValue(new Error('down'));
        const r = await check('api.github.com');
        spy.mockRestore();
        expect(r.code).toBe(503);
        expect(r.body).toMatchObject({ status: false, code: 'allowlist_unreadable' });
    });
});
