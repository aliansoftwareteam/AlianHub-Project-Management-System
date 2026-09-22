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

const mockResolveFixtureHost = (url) => {
    const u = new URL(url);
    if (!u.hostname.endsWith('.example.com')) return Promise.reject(new Error(`unexpected host ${u.hostname}`));
    return Promise.resolve({ url: u, address: '127.0.0.1', family: 4 });
};
jest.mock('../Modules/Agents/engine/safeFetch', () => {
    const actual = jest.requireActual('../Modules/Agents/engine/safeFetch');
    return { ...actual, safeFetch: (url, opts = {}) => actual.safeFetch(url, { resolve: mockResolveFixtureHost, ...opts }) };
});

const https = require('https');
const mongoose = require('mongoose');
const { testCert } = require('./fixtures/testCert');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const secrets = require('../Config/secrets');
const allowlist = require('../Modules/Agents/engine/egressAllowlist');
const skillRecord = require('../Modules/Agents/skillRecord');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const { dryRun } = require('../Modules/Agents/skillDryRun');
const replay = require('../Modules/AICore/replay');
const { aiReplaysSchema } = require('../utils/mongo-handler/createSchema');

const C = '6f0000000000000000000c01';
const RUN_ID = '6f0000000000000000000e01';
const ACTOR = { id: '6f0000000000000000000a01', name: 'Olivia Owner' };
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Review', TaskKey: 'AR-7', ProjectID: '6f0000000000000000000901', description: 'Check the read.', deletedStatusKey: 0 };
/* Plain words so the generic redactor would pass it through: only the credential scrub can keep it out. */
const TOKEN = 'rk_opensesame_quartz_zebra_harbour';
const PLANTED = `sk-${'Q7'.repeat(12)}`;
const KB = 1024;
const HUGE = `{"note":"${PLANTED}","pad":"${'y'.repeat(40 * KB)}","tail":"end"}`;

const seen = [];
let tlsServer;
let READS;
let originalCa;

const ROUTES = {
    '/v1/items/AR-7': (req, res) => json(res, { ok: true, key: 'AR-7' }),
    '/huge': (req, res) => text(res, HUGE),
    '/echo': (req, res) => text(res, `you sent ${String(req.headers.authorization || '').replace(/^Bearer /, '')}`),
    '/to-self': (req, res) => { res.writeHead(302, { Location: '/landed?page=2' }); res.end(); },
    '/landed': (req, res) => text(res, 'landed'),
};

function json(res, body) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
function text(res, body) { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(body); }

beforeAll(async () => {
    const { key, cert } = testCert(['reads.example.com']);
    originalCa = https.globalAgent.options.ca;
    https.globalAgent.options.ca = cert;
    tlsServer = https.createServer({ key, cert }, (req, res) => {
        const path = req.url.split('?')[0];
        seen.push({ path, headers: req.headers });
        return (ROUTES[path] || ((q, s) => { s.writeHead(404); s.end('nope'); }))(req, res);
    });
    await new Promise((resolve) => tlsServer.listen(0, '127.0.0.1', resolve));
    READS = `reads.example.com:${tlsServer.address().port}`;
}, 30000);

afterAll(async () => {
    https.globalAgent.options.ca = originalCa;
    https.globalAgent.destroy();
    await new Promise((done) => { tlsServer.closeAllConnections(); tlsServer.close(done); });
    ['SKILL_EXTERNAL_READS', 'SECRETS_STORE', 'SECRETS_KEY', 'AI_REPLAY'].forEach((name) => delete process.env[name]);
});

beforeEach(() => {
    Object.values(mockDbs).forEach((db) => { Object.keys(db.store).forEach((k) => { db.store[k].length = 0; }); db.calls.length = 0; });
    myCache.flushAll();
    seen.length = 0;
    jest.clearAllMocks();
    process.env.SKILL_EXTERNAL_READS = 'on';
    process.env.SECRETS_STORE = 'true';
    process.env.SECRETS_KEY = crypto.randomBytes(24).toString('hex');
    delete process.env.AI_REPLAY;
});

const step = (params = {}) => ({ reader: 'api', as: 'r', params: { host: READS, path: '/v1/items/{{TaskKey}}', format: 'json', timeoutMs: 3000, ...params } });
const save = async (gather) => {
    await allowlist.replaceHosts(C, [READS], ACTOR.id);
    return skillRecord.createSkill(C, {
        key: 'reads.replay',
        name: 'Declared read replay',
        inputs: [],
        gather,
        prompt: { template: 'READ: {{gather.r.text}}', output: '{"summary":"..."}' },
        fallback: 'Read {{gather.r.bytes}} bytes',
        emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
    });
};
const gatherRun = (over = {}) => orchestrator.gather({ skillSlug: 'reads.replay', task: TASK, companyId: C, startedBy: ACTOR.id, runId: RUN_ID, ...over });
const fetchRows = () => (mockDbFor(C).store[SCHEMA_TYPE.AI_REPLAYS] || []).filter((row) => row.kind === 'fetch');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

describe('a declared read in a run leaves a fetch row in the replay', () => {
    it('with host, path, status, bytes, hops, the body hash, the body and its taint, and nothing else of the request', async () => {
        await save([step()]);
        await gatherRun();
        const body = JSON.stringify({ ok: true, key: 'AR-7' });
        expect(fetchRows()).toEqual([expect.objectContaining({
            feature: 'agent_run',
            kind: 'fetch',
            runId: RUN_ID,
            promptHash: sha256(body),
            fetch: {
                host: READS,
                path: '/v1/items/AR-7',
                status: 200,
                bytes: Buffer.byteLength(body),
                hops: [{ host: READS, path: '/v1/items/AR-7', status: 200 }],
                sha256: sha256(body),
                body,
                bodyTruncated: false,
            },
            tainted: true,
            taintSources: [{ kind: 'fetch', ref: 'reads.example.com', at: expect.any(Date) }],
            status: 'ok',
            expiresAt: expect.any(Date),
        })]);
        const [row] = fetchRows();
        expect(JSON.stringify(row).toLowerCase()).not.toMatch(/user-agent|authorization|headers|credential/);
    });

    it('keeps no query string on the path or any hop', async () => {
        await save([step({ path: '/to-self', format: 'text', maxRedirects: 1 })]);
        await gatherRun();
        const [row] = fetchRows();
        expect(row.fetch.path).toBe('/to-self');
        expect(row.fetch.hops).toEqual([{ host: READS, path: '/to-self', status: 302 }, { host: READS, path: '/landed', status: 200 }]);
        expect(JSON.stringify(row)).not.toContain('page=2');
    });

    it('drops a query string handed to it directly', async () => {
        await replay.recordFetch({ companyId: C, runId: RUN_ID, host: READS, path: '/a?key=v1', status: 200, bytes: 2, hops: [{ host: READS, path: '/a?key=v1#top', status: 200 }], sha256: 'h', body: '{}', taintSources: [] });
        const [row] = fetchRows();
        expect(row.fetch.path).toBe('/a');
        expect(row.fetch.hops).toEqual([{ host: READS, path: '/a', status: 200 }]);
    });

    it('keeps the first 32 KB of the body with a truncation marker and hashes the whole body', async () => {
        await save([step({ path: '/huge', format: 'text' })]);
        const out = await gatherRun();
        const [row] = fetchRows();
        expect(out.context.gather.r.text).toBe(HUGE);
        expect(row.fetch.sha256).toBe(sha256(HUGE));
        expect(row.fetch.bytes).toBe(Buffer.byteLength(HUGE));
        expect(row.fetch.bodyTruncated).toBe(true);
        expect(row.truncated).toBe(true);
        expect(row.fetch.body.endsWith(replay.FETCH_TRUNCATION_MARKER)).toBe(true);
        const kept = row.fetch.body.slice(0, -replay.FETCH_TRUNCATION_MARKER.length);
        expect(Buffer.byteLength(kept)).toBeLessThanOrEqual(replay.FETCH_BODY_BYTES);
        expect(Buffer.byteLength(kept)).toBeGreaterThan(replay.FETCH_BODY_BYTES - 64);
        expect(row.fetch.body).not.toContain('"tail":"end"');
    });

    it('masks a secret-like string in the body with the replay redactor', async () => {
        await save([step({ path: '/huge', format: 'text' })]);
        await gatherRun();
        const [row] = fetchRows();
        expect(row.fetch.body).not.toContain(PLANTED);
        expect(row.fetch.body).toContain('"note":"[redacted]"');
    });

    it('never stores the credential, even when the host echoes it in the body', async () => {
        const { handle } = await secrets.create({ companyId: C, name: 'Read token', kind: 'skill_read', value: TOKEN, hosts: [READS], actor: ACTOR });
        await save([step({ path: '/echo', format: 'text', credential: handle })]);
        await gatherRun();
        expect(seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
        const rows = mockDbFor(C).store[SCHEMA_TYPE.AI_REPLAYS] || [];
        expect(fetchRows()).toHaveLength(1);
        const stored = JSON.stringify(rows);
        expect(stored).not.toContain(TOKEN);
        expect(stored).not.toContain('opensesame');
        expect(stored).not.toContain('quartz_zebra');
        expect(stored).not.toContain(sha256(`you sent ${TOKEN}`));
    });

    it('survives the strict replay schema', () => {
        const Replay = mongoose.models.s11s3Replay || mongoose.model('s11s3Replay', aiReplaysSchema);
        const fetch = { host: READS, path: '/p', status: 200, bytes: 2, hops: [{ host: READS, path: '/p', status: 200 }], sha256: 'a', body: '{}', bodyTruncated: false };
        expect(new Replay({ feature: 'agent_run', kind: 'fetch', promptHash: 'a', status: 'ok', createdAt: new Date(), expiresAt: new Date(), fetch }).toObject().fetch).toEqual(fetch);
    });
});

describe('no fetch row', () => {
    it('on a dry run, which still fetches', async () => {
        await save([step()]);
        mockDbFor(C).seed(SCHEMA_TYPE.TASKS, TASK);
        const preview = await dryRun(C, 'reads.replay', { taskId: TASK._id, uid: ACTOR.id });
        expect(preview.ran).toBe(true);
        expect(seen).toHaveLength(1);
        expect(mockDbFor(C).calls.filter((c) => c.type === SCHEMA_TYPE.AI_REPLAYS)).toEqual([]);
    });

    it('with AI_REPLAY off', async () => {
        await save([step()]);
        process.env.AI_REPLAY = 'off';
        await gatherRun();
        expect(seen).toHaveLength(1);
        expect(mockDbFor(C).calls.filter((c) => c.type === SCHEMA_TYPE.AI_REPLAYS)).toEqual([]);
    });
});
