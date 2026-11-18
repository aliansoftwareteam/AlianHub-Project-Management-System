const http = require('http');
const dns = require('dns');

const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { deliverToHook } = require('../Modules/Webhooks/dispatcher');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';

const listen = (handler) => new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

const readBody = (req) => new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
});

const envelope = { event: 'task.created', companyId: COMPANY, deliveredAt: 'now', changedFields: [], data: { _id: 't1', name: 'Task' } };

describe('REP-04 webhook delivery re-checks the destination', () => {
    let hits = 0;
    let sink;
    let lookup;
    beforeAll(async () => {
        sink = await listen((req, res) => { hits += 1; res.end('ok'); });
    });
    afterAll(() => new Promise((done) => sink.server.close(done)));
    beforeEach(() => {
        hits = 0;
        mockDb.store[SCHEMA_TYPE.WEBHOOK_LOGS] = [];
        lookup = jest.spyOn(dns.promises, 'lookup');
    });
    afterEach(() => lookup.mockRestore());

    it('never POSTs to a stored loopback url and logs the refusal', async () => {
        const hook = { _id: 'h1', url: `http://127.0.0.1:${sink.port}/hook`, secret: 's', format: 'json' };
        await deliverToHook(COMPANY, hook, envelope, 2);
        expect(hits).toBe(0);
        const [log] = mockDb.store[SCHEMA_TYPE.WEBHOOK_LOGS];
        expect(log).toMatchObject({ success: false, attempt: 2 });
        expect(log.error).toMatch(/private|local|internal/i);
    });

    it('never POSTs to a hostname that now resolves to a private address', async () => {
        lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
        const hook = { _id: 'h2', url: `http://rebind.example.com:${sink.port}/hook`, secret: 's', format: 'json' };
        await deliverToHook(COMPANY, hook, envelope, 2);
        expect(hits).toBe(0);
        expect(mockDb.store[SCHEMA_TYPE.WEBHOOK_LOGS][0].success).toBe(false);
    });
});

describe('safeFetch POST', () => {
    const publicResolve = (port) => async (url) => {
        const u = new URL(url);
        if (u.hostname !== 'public.example.com') throw new Error(`${u.hostname} is a private, local or internal host`);
        return { url: new URL(`http://public.example.com:${port}${u.pathname}`), address: '127.0.0.1', family: 4 };
    };

    it('sends the method, headers and body', async () => {
        let seen;
        const { server, port } = await listen(async (req, res) => {
            seen = { method: req.method, sig: req.headers['x-alianhub-signature'], body: await readBody(req) };
            res.statusCode = 202;
            res.end('accepted');
        });
        try {
            const out = await safeFetch(`http://public.example.com:${port}/hook`, {
                method: 'post', data: '{"a":1}', headers: { 'Content-Type': 'application/json', 'X-AlianHub-Signature': 'sha256=x' }, resolve: publicResolve(port),
            });
            expect(out.status).toBe(202);
            expect(seen).toEqual({ method: 'POST', sig: 'sha256=x', body: '{"a":1}' });
        } finally { server.close(); }
    });

    it('revalidates a redirect hop and refuses one that points at a private host', async () => {
        const { server, port } = await listen((req, res) => {
            res.statusCode = 307;
            res.setHeader('location', 'http://169.254.169.254/latest/meta-data');
            res.end();
        });
        try {
            await expect(safeFetch(`http://public.example.com:${port}/hook`, { method: 'post', data: '{}', resolve: publicResolve(port) }))
                .rejects.toThrow(/private|local|internal/i);
        } finally { server.close(); }
    });

    it('keeps POST across a 307 and switches to GET without a body on a 303', async () => {
        const seen = [];
        const { server, port } = await listen(async (req, res) => {
            seen.push({ path: req.url, method: req.method, body: await readBody(req) });
            if (req.url === '/start') { res.statusCode = 307; res.setHeader('location', '/kept'); return res.end(); }
            if (req.url === '/kept') { res.statusCode = 303; res.setHeader('location', '/done'); return res.end(); }
            return res.end('ok');
        });
        try {
            const out = await safeFetch(`http://public.example.com:${port}/start`, { method: 'post', data: 'payload', resolve: publicResolve(port) });
            expect(out.status).toBe(200);
            expect(seen).toEqual([
                { path: '/start', method: 'POST', body: 'payload' },
                { path: '/kept', method: 'POST', body: 'payload' },
                { path: '/done', method: 'GET', body: '' },
            ]);
        } finally { server.close(); }
    });
});
