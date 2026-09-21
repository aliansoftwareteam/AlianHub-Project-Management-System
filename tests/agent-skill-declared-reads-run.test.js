const crypto = require('crypto');

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
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({ contextFor: jest.fn(async () => ''), recordEpisode: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['6f0000000000000000000901']), visibleProjects: jest.fn(async () => []) }));

/* Every declared host is a name under example.com that lands on a loopback server, standing in for DNS so the
 * run-time rules are driven without a real outbound request. */
const mockResolveFixtureHost = (url) => {
    const u = new URL(url);
    if (!u.hostname.endsWith('.example.com')) return Promise.reject(new Error(`unexpected host ${u.hostname}`));
    return Promise.resolve({ url: u, address: '127.0.0.1', family: 4 });
};
jest.mock('../Modules/Agents/engine/safeFetch', () => {
    const actual = jest.requireActual('../Modules/Agents/engine/safeFetch');
    return { ...actual, safeFetch: (url, opts = {}) => actual.safeFetch(url, { resolve: mockResolveFixtureHost, ...opts }) };
});

const http = require('http');
const https = require('https');
const { testCert } = require('./fixtures/testCert');
const { myCache } = require('../Config/config');
const logger = require('../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const secrets = require('../Config/secrets');
const allowlist = require('../Modules/Agents/engine/egressAllowlist');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const { compile } = require('../Modules/Agents/skills/compile');
const skillRecord = require('../Modules/Agents/skillRecord');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const { dryRun } = require('../Modules/Agents/skillDryRun');
const taint = require('../Modules/Agents/taint');

const FLAG = 'SKILL_EXTERNAL_READS';
const C = '6f0000000000000000000c01';
const ACTOR = { id: '6f0000000000000000000a01', name: 'Olivia Owner' };
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Review', TaskKey: 'AR-7', ProjectID: '6f0000000000000000000901', description: 'Check the read.', deletedStatusKey: 0 };
const TOKEN = `rk_${crypto.randomBytes(20).toString('hex')}`;

const seen = [];
let tlsServer;
let plainServer;
let tlsPort;
let plainPort;
let READS;
let SECOND;
let OTHER;

const origin = (name) => `https://${name}.example.com:${tlsPort}`;

const ROUTES = {
    '/v1/items/AR-7': (req, res) => json(res, { ok: true, key: 'AR-7' }),
    '/text': (req, res) => text(res, 'hello from the declared host'),
    '/diff': (req, res) => text(res, 'diff --git a/x b/x\n+added a line'),
    '/big': (req, res) => text(res, 'x'.repeat(4096)),
    '/slow': (req, res) => setTimeout(() => text(res, 'late'), 3000),
    '/to-self': (req, res) => redirect(res, '/landed'),
    '/to-undeclared': (req, res) => redirect(res, `${origin('other')}/landed`),
    '/to-second': (req, res) => redirect(res, `${origin('second')}/landed`),
    '/to-http': (req, res) => redirect(res, `http://reads.example.com:${plainPort}/landed`),
    '/echo': (req, res) => text(res, `you sent ${req.headers.authorization || ''} ${req.headers['x-read-key'] || ''}`),
    '/nojson': (req, res) => text(res, 'not json'),
    '/missing': (req, res) => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('nope'); },
    '/landed': (req, res) => text(res, 'landed'),
};

function json(res, body) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
function text(res, body) { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(body); }
function redirect(res, location) { res.writeHead(302, { Location: location }); res.end(); }

const handler = (scheme) => (req, res) => {
    const path = req.url.split('?')[0];
    seen.push({ scheme, host: String(req.headers.host).split(':')[0], path, method: req.method, headers: req.headers });
    return (ROUTES[path] || ROUTES['/missing'])(req, res);
};

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

let originalCa;
beforeAll(async () => {
    const { key, cert } = testCert(['reads.example.com', 'second.example.com', 'other.example.com']);
    originalCa = https.globalAgent.options.ca;
    https.globalAgent.options.ca = cert;
    tlsServer = https.createServer({ key, cert }, handler('https'));
    plainServer = http.createServer(handler('http'));
    tlsPort = await listen(tlsServer);
    plainPort = await listen(plainServer);
    READS = `reads.example.com:${tlsPort}`;
    SECOND = `second.example.com:${tlsPort}`;
    OTHER = `other.example.com:${tlsPort}`;
}, 30000);

afterAll(async () => {
    https.globalAgent.options.ca = originalCa;
    https.globalAgent.destroy();
    await Promise.all([tlsServer, plainServer].map((server) => new Promise((done) => { server.closeAllConnections(); server.close(done); })));
    delete process.env[FLAG];
    delete process.env.SECRETS_STORE;
    delete process.env.SECRETS_KEY;
});

beforeEach(() => {
    Object.values(mockDbs).forEach((db) => { Object.keys(db.store).forEach((k) => { db.store[k].length = 0; }); db.calls.length = 0; });
    myCache.flushAll();
    seen.length = 0;
    jest.clearAllMocks();
    process.env[FLAG] = 'on';
    process.env.SECRETS_STORE = 'true';
    process.env.SECRETS_KEY = crypto.randomBytes(24).toString('hex');
});

const step = (params = {}, over = {}) => ({ reader: 'api', as: 'r', params: { host: READS, path: '/v1/items/{{TaskKey}}', format: 'json', timeoutMs: 3000, ...params }, ...over });

const skillBody = (gather = [step()], over = {}) => ({
    key: 'reads.run',
    name: 'Declared reads',
    inputs: [],
    gather,
    prompt: { template: 'READ: {{gather.r.text}}', output: '{"summary":"..."}' },
    fallback: 'Read {{gather.r.bytes}} bytes',
    emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
    ...over,
});

const allow = (hosts) => allowlist.replaceHosts(C, hosts, ACTOR.id);
const readCredential = (hosts = [READS], extra = {}) => secrets.create({ companyId: C, name: 'Read token', kind: 'skill_read', value: TOKEN, hosts, actor: ACTOR, ...extra });
const save = async (gather, { hosts = [READS, SECOND] } = {}) => {
    await allow(hosts);
    return skillRecord.createSkill(C, skillBody(gather));
};
/* A row as it would stand after its save-time checks passed, for a run whose world changed since. */
const seedSkill = (gather, over = {}) => mockDbFor(C).seed(SCHEMA_TYPE.AGENT_SKILLS, { ...validateSkill(skillBody(gather)).value, ...over });
const gatherRun = () => orchestrator.gather({ skillSlug: 'reads.run', task: TASK, companyId: C, startedBy: ACTOR.id });
const refusalOf = async (promise) => {
    try { await promise; } catch (e) { return e; }
    throw new Error('expected the read to be refused');
};
const everywhereElse = () => JSON.stringify([logger.info.mock.calls, logger.error.mock.calls, logger.warn.mock.calls, require('../Modules/Audit/recorder').recordAudit.mock.calls]);

describe('flag off: beta exactly', () => {
    it('a skill with a declared read still refuses with external_reads_not_available and fetches nothing', async () => {
        seedSkill([step()]);
        await allow([READS]);
        delete process.env[FLAG];
        await expect(gatherRun()).rejects.toMatchObject({ code: 'external_reads_not_available' });
        expect(seen).toEqual([]);
    });
});

describe('a declared read at run time', () => {
    it('fetches the declared, listed host with GET and parses JSON into the gathered context', async () => {
        await save([step()]);
        const out = await gatherRun();
        expect(out.status).toBe(orchestrator.GATHERED);
        expect(out.context.gather.r).toMatchObject({ status: 200, json: { ok: true, key: 'AR-7' }, bytes: expect.any(Number) });
        expect(seen.map((h) => [h.scheme, h.host, h.path, h.method])).toEqual([['https', 'reads.example.com', '/v1/items/AR-7', 'GET']]);
    });

    it.each([
        ['url', 'text', '/text', 'hello from the declared host'],
        ['url', 'diff', '/diff', 'diff --git a/x b/x\n+added a line'],
        ['api', 'text', '/text', 'hello from the declared host'],
    ])('the %s reader keeps a %s body as text', async (reader, format, path, body) => {
        await save([step({ path, format }, { reader })]);
        const out = await gatherRun();
        expect(out.context.gather.r).toMatchObject({ status: 200, text: body });
        expect(out.context.gather.r).not.toHaveProperty('json');
    });

    it('skips a body that is not the JSON the read declared', async () => {
        await save([step({ path: '/nojson' })]);
        expect((await gatherRun()).status).toBe('skipped');
    });

    it('skips an error status instead of handing its body to the model', async () => {
        await save([step({ path: '/missing', format: 'text' })]);
        const out = await gatherRun();
        expect(out.status).toBe('skipped');
        expect(out.reason).toContain('404');
    });

    it('refuses a host removed from the workspace allowlist after the save, before any request', async () => {
        await save([step()]);
        await allow([SECOND]);
        expect(await refusalOf(gatherRun())).toMatchObject({ code: 'host_not_allowed' });
        await allow([]);
        expect(await refusalOf(gatherRun())).toMatchObject({ code: 'host_not_allowed' });
        expect(seen).toEqual([]);
    });

    it('refuses a host the skill row does not declare', async () => {
        seedSkill([step()], { declaredHosts: [SECOND] });
        await allow([READS, SECOND]);
        expect(await refusalOf(gatherRun())).toMatchObject({ code: 'host_not_declared' });
        expect(seen).toEqual([]);
    });

    it('refuses the read when the allowlist cannot be read', async () => {
        await save([step()]);
        const spy = jest.spyOn(allowlist, 'hostsFor').mockRejectedValueOnce(new Error('down'));
        expect(await refusalOf(gatherRun())).toMatchObject({ code: 'allowlist_unreadable' });
        spy.mockRestore();
        expect(seen).toEqual([]);
    });

    it('follows a redirect on the same origin', async () => {
        await save([step({ path: '/to-self', format: 'text', maxRedirects: 1 })]);
        const out = await gatherRun();
        expect(out.context.gather.r.text).toBe('landed');
        expect(seen.map((h) => h.path)).toEqual(['/to-self', '/landed']);
    });

    it('refuses a redirect to a host the skill does not declare, even one on the list', async () => {
        await save([step({ path: '/to-undeclared', format: 'text', maxRedirects: 1 })], { hosts: [READS, SECOND, OTHER] });
        expect(await refusalOf(gatherRun())).toMatchObject({ code: 'host_not_declared' });
        expect(seen.map((h) => h.host)).toEqual(['reads.example.com']);
    });

    it('refuses a redirect to a declared host that is not on the list', async () => {
        await save([step({ path: '/to-second', format: 'text', maxRedirects: 1 }), step({ host: SECOND, path: '/text', format: 'text' }, { as: 's' })]);
        await allow([READS]);
        expect(await refusalOf(gatherRun())).toMatchObject({ code: 'host_not_allowed' });
        expect(seen.map((h) => h.host)).toEqual(['reads.example.com']);
    });

    it('follows a redirect to a declared, listed host', async () => {
        await save([step({ path: '/to-second', format: 'text', maxRedirects: 1 }), step({ host: SECOND, path: '/text', format: 'text' }, { as: 's' })]);
        const out = await gatherRun();
        expect(out.context.gather.r.text).toBe('landed');
        expect(seen.map((h) => [h.host, h.path])).toEqual([['reads.example.com', '/to-second'], ['second.example.com', '/landed'], ['second.example.com', '/text']]);
    });

    it('holds the redirect cap of the read', async () => {
        await save([step({ path: '/to-self', format: 'text', maxRedirects: 0 })]);
        expect((await refusalOf(gatherRun())).message).toMatch(/too many redirects/);
        expect(seen.map((h) => h.path)).toEqual(['/to-self']);
    });

    it('caps an oversize body at the size the read declares', async () => {
        await save([step({ path: '/big', format: 'text', maxBytes: 1024 })]);
        expect((await refusalOf(gatherRun())).message).toMatch(/1024 byte size cap/);
    });

    it('caps a slow response at the time the read declares', async () => {
        await save([step({ path: '/slow', format: 'text', timeoutMs: 500 })]);
        const started = Date.now();
        expect((await refusalOf(gatherRun())).message).toMatch(/time budget/);
        expect(Date.now() - started).toBeLessThan(2500);
    });
});

describe('the credential', () => {
    it('is sent as a bearer token to the declared host only', async () => {
        const { handle } = await readCredential();
        await save([step({ credential: handle })]);
        await gatherRun();
        expect(seen).toHaveLength(1);
        expect(seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('goes in the header the secret names, marked sensitive', async () => {
        const { handle } = await readCredential([READS], { header: 'X-Read-Key' });
        await save([step({ path: '/to-second', format: 'text', maxRedirects: 1, credential: handle }), step({ host: SECOND, path: '/text', format: 'text' }, { as: 's' })]);
        await gatherRun();
        expect(seen[0].headers['x-read-key']).toBe(TOKEN);
        expect(seen[0].headers).not.toHaveProperty('authorization');
        expect(seen.slice(1).map((h) => h.headers['x-read-key'])).toEqual([undefined, undefined]);
    });

    it('never reaches another hop, even a declared, listed one', async () => {
        const { handle } = await readCredential([READS, SECOND]);
        await save([step({ path: '/to-second', format: 'text', maxRedirects: 1, credential: handle }), step({ host: SECOND, path: '/text', format: 'text' }, { as: 's' })]);
        await gatherRun();
        expect(seen.map((h) => [h.host, h.path, Boolean(h.headers.authorization)])).toEqual([
            ['reads.example.com', '/to-second', true],
            ['second.example.com', '/landed', false],
            ['second.example.com', '/text', false],
        ]);
    });

    it('keeps the credential on a same-origin redirect', async () => {
        const { handle } = await readCredential();
        await save([step({ path: '/to-self', format: 'text', maxRedirects: 1, credential: handle })]);
        await gatherRun();
        expect(seen.map((h) => h.headers.authorization)).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
    });

    it('refuses a redirect from https to http while it carries the credential', async () => {
        const { handle } = await readCredential();
        await save([step({ path: '/to-http', format: 'text', maxRedirects: 1, credential: handle })]);
        const error = await refusalOf(gatherRun());
        expect(error.message).toMatch(/https to http/);
        expect(seen.map((h) => h.scheme)).toEqual(['https']);
    });

    it('appears nowhere in the gathered context, the prompt, the logs, the audit or an error', async () => {
        const { handle } = await readCredential([READS], { header: 'X-Read-Key' });
        await save([step({ path: '/echo', format: 'text', credential: handle })]);
        const out = await gatherRun();
        expect(seen[0].headers['x-read-key']).toBe(TOKEN);
        expect(JSON.stringify(out)).not.toContain(TOKEN);
        expect(out.context.gather.r.text).toContain('[redacted]');
        const skill = compile(await skillRecord.getSkill(C, 'reads.run'));
        expect(skill.buildUserPrompt({ task: TASK, context: out.context })).not.toContain(TOKEN);

        await skillRecord.updateSkill(C, 'reads.run', { gather: [step({ path: '/to-http', format: 'text', maxRedirects: 1, credential: handle })] });
        const error = await refusalOf(gatherRun());
        expect(`${error.message} ${error.stack} ${JSON.stringify(error)}`).not.toContain(TOKEN);
        expect(error.config).toBeUndefined();
        expect(everywhereElse()).not.toContain(TOKEN);
    });

    it('leaves no trace in an error from a failed connection', async () => {
        const { handle } = await readCredential();
        await save([step({ credential: handle })]);
        const spy = jest.spyOn(require('axios'), 'request').mockImplementationOnce(async (config) => {
            throw Object.assign(new Error(`connect ECONNREFUSED with ${config.headers.Authorization || config.headers.authorization}`), { code: 'ECONNREFUSED', config });
        });
        const error = await refusalOf(gatherRun());
        spy.mockRestore();
        expect(`${error.message} ${error.stack} ${JSON.stringify(error)}`).not.toContain(TOKEN);
        expect(error.config).toBeUndefined();
        expect(error.code).toBe('read_failed');
    });

    it('is refused at save when the secret does not name the declared host', async () => {
        const { handle } = await readCredential([SECOND]);
        await allow([READS, SECOND]);
        await expect(skillRecord.createSkill(C, skillBody([step({ credential: handle })]))).rejects.toMatchObject({
            errors: [expect.objectContaining({ field: 'gather[0].params.credential', code: 'credential_host_not_bound' })],
        });
    });

    it('is refused at run when the secret no longer names the declared host, before any request', async () => {
        const { handle } = await readCredential();
        await save([step({ credential: handle })]);
        await secrets.rotate({ companyId: C, handle, value: TOKEN, hosts: [SECOND], actor: ACTOR });
        expect(await refusalOf(gatherRun())).toMatchObject({ code: 'credential_host_not_bound' });
        expect(seen).toEqual([]);
    });

    it('is refused at run once revoked', async () => {
        const { handle } = await readCredential();
        await save([step({ credential: handle })]);
        await secrets.revoke({ companyId: C, handle, actor: ACTOR });
        expect(await refusalOf(gatherRun())).toMatchObject({ code: 'credential_revoked' });
        expect(seen).toEqual([]);
    });

    it('is refused at run when it is of another kind', async () => {
        const made = await secrets.create({ companyId: C, name: 'Integration', kind: 'integration', value: TOKEN, actor: ACTOR });
        seedSkill([step({ credential: made.handle })]);
        await allow([READS]);
        expect(await refusalOf(gatherRun())).toMatchObject({ code: 'credential_wrong_kind' });
        expect(seen).toEqual([]);
    });

    it('is refused at run while the secrets store is off', async () => {
        const { handle } = await readCredential();
        await save([step({ credential: handle })]);
        delete process.env.SECRETS_STORE;
        expect(await refusalOf(gatherRun())).toMatchObject({ code: 'credential_store_off' });
        expect(seen).toEqual([]);
    });
});

describe('taint', () => {
    it('lists url and api among the external reads', () => {
        expect(taint.EXTERNAL_READS).toEqual(expect.arrayContaining(['url', 'api']));
        expect(taint.readsExternal(compile(validateSkill(skillBody()).value))).toBe(true);
    });

    it('marks every hop host on the gathered result and notes them for the run', async () => {
        await save([step({ path: '/to-second', format: 'text', maxRedirects: 1 }), step({ host: SECOND, path: '/text', format: 'text' }, { as: 's' })]);
        const { out, found } = await taint.collect(() => gatherRun());
        expect(out.context.gather.r.taint.map((s) => [s.kind, s.ref])).toEqual([['fetch', 'reads.example.com'], ['fetch', 'second.example.com']]);
        expect(out.context.gather.s.taint.map((s) => [s.kind, s.ref])).toEqual([['fetch', 'second.example.com']]);
        const sources = taint.merge([], [...found, ...taint.fromContext(out.context, { skill: compile(await skillRecord.getSkill(C, 'reads.run')) })]);
        expect(sources.map((s) => s.ref)).toEqual(['reads.example.com', 'second.example.com']);
    });
});

describe('a dry run', () => {
    it('fetches through the same checks and writes no replay', async () => {
        const { handle } = await readCredential();
        await save([step({ credential: handle })]);
        mockDbFor(C).seed(SCHEMA_TYPE.TASKS, TASK);
        const preview = await dryRun(C, 'reads.run', { taskId: TASK._id, uid: ACTOR.id });
        expect(preview.ran).toBe(true);
        expect(preview.gathered.gather.r.json).toEqual({ ok: true, key: 'AR-7' });
        expect(seen).toHaveLength(1);
        expect(JSON.stringify(preview)).not.toContain(TOKEN);
        expect(mockDbFor(C).store[SCHEMA_TYPE.AI_REPLAYS] || []).toEqual([]);
        expect(mockDbFor(C).calls.filter((c) => c.type === SCHEMA_TYPE.AI_REPLAYS)).toEqual([]);
    });

    it('is refused the same way when the host left the list', async () => {
        await save([step()]);
        await allow([]);
        mockDbFor(C).seed(SCHEMA_TYPE.TASKS, TASK);
        await expect(dryRun(C, 'reads.run', { taskId: TASK._id, uid: ACTOR.id })).rejects.toMatchObject({ code: 'host_not_allowed' });
        expect(seen).toEqual([]);
    });
});
