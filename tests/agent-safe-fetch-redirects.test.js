const http = require('http');
const { Readable } = require('stream');
const axios = require('axios');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));

/* Every test host is a name under .test that lands on a loopback server, standing in for DNS so the redirect
 * rules can be driven without a real outbound request. */
const mockResolveTestHost = (url) => {
    const u = new URL(url);
    if (!u.hostname.endsWith('.test')) return Promise.reject(new Error(`unexpected host ${u.hostname}`));
    return Promise.resolve({ url: u, address: '127.0.0.1', family: 4 });
};
jest.mock('../Modules/Agents/engine/safeFetch', () => {
    const actual = jest.requireActual('../Modules/Agents/engine/safeFetch');
    return { ...actual, safeFetch: (url, opts = {}) => actual.safeFetch(url, { resolve: mockResolveTestHost, ...opts }) };
});

const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const pageAudit = require('../Modules/Agents/engine/pageAudit');
const taint = require('../Modules/Agents/taint');

const seen = [];
const servers = {};
const origin = (name, server = name) => `http://${name}.test:${servers[server].port}`;

const ROUTES = {
    '/to-other': (res) => redirect(res, 302, `${origin('b')}/landed`),
    '/to-self': (res) => redirect(res, 302, '/landed'),
    '/to-other-port': (res) => redirect(res, 302, `${origin('a', 'b')}/landed`),
    '/307-self': (res) => redirect(res, 307, '/landed'),
    '/308-self': (res) => redirect(res, 308, '/landed'),
    '/307-other': (res) => redirect(res, 307, `${origin('b')}/landed`),
    '/308-other': (res) => redirect(res, 308, `${origin('b')}/landed`),
    '/301': (res) => redirect(res, 301, '/landed'),
    '/302': (res) => redirect(res, 302, '/landed'),
    '/303': (res) => redirect(res, 303, '/landed'),
    '/two-hop': (res) => redirect(res, 302, `${origin('b')}/bounce?token=abc`),
    '/bounce': (res) => redirect(res, 302, `${origin('c', 'a')}/landed?q=secret`),
    '/other-then-back': (res) => redirect(res, 302, `${origin('b')}/back`),
    '/back': (res) => redirect(res, 302, `${origin('a')}/landed`),
};

function redirect(res, status, location) {
    res.writeHead(status, { Location: location });
    res.end();
}

const serve = (name) => new Promise((resolve) => {
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const path = req.url.split('?')[0];
            seen.push({ server: name, host: req.headers.host.split(':')[0], path, method: req.method, headers: req.headers, body });
            if (ROUTES[path]) return ROUTES[path](res);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end('<html><body>landed</body></html>');
        });
    });
    server.listen(0, '127.0.0.1', () => { servers[name] = { server, port: server.address().port }; resolve(); });
});

beforeAll(async () => { await serve('a'); await serve('b'); });
afterAll(() => Promise.all(Object.values(servers).map(({ server }) => new Promise((done) => { server.closeAllConnections?.(); server.close(done); }))));
beforeEach(() => { seen.length = 0; });

const CREDENTIALS = { Authorization: 'Bearer top-secret', 'Proxy-Authorization': 'Basic cHJveHk=', Cookie: 'session=abc', 'X-Api-Key': 'key-123' };
const SENSITIVE = ['authorization', 'proxy-authorization', 'cookie', 'x-api-key'];
const sensitiveOf = (hit) => SENSITIVE.filter((name) => name in hit.headers);
const withCredentials = (extra = {}) => ({ timeoutMs: 3000, headers: { ...CREDENTIALS, 'User-Agent': 'probe/1' }, sensitiveHeaders: ['X-Api-Key'], ...extra });

describe('credentials on redirects', () => {
    it('drops Authorization, Proxy-Authorization, Cookie and a caller-marked header on a hop to another host', async () => {
        const out = await safeFetch(`${origin('a')}/to-other`, withCredentials());
        expect(out.status).toBe(200);
        expect(seen.map((h) => [h.host, h.path])).toEqual([['a.test', '/to-other'], ['b.test', '/landed']]);
        expect(sensitiveOf(seen[0])).toEqual(SENSITIVE);
        expect(sensitiveOf(seen[1])).toEqual([]);
        expect(seen[1].headers['user-agent']).toBe('probe/1');
    });

    it('treats another port on the same host as another origin', async () => {
        await safeFetch(`${origin('a')}/to-other-port`, withCredentials());
        expect(seen.map((h) => [h.server, h.path])).toEqual([['a', '/to-other-port'], ['b', '/landed']]);
        expect(sensitiveOf(seen[1])).toEqual([]);
    });

    it('matches a caller-marked header whatever its case', async () => {
        await safeFetch(`${origin('a')}/to-other`, { timeoutMs: 3000, headers: { 'x-API-key': 'k' }, sensitiveHeaders: ['X-Api-Key'] });
        expect(seen[1].headers).not.toHaveProperty('x-api-key');
    });

    it('keeps every header on a same-origin redirect', async () => {
        await safeFetch(`${origin('a')}/to-self`, withCredentials());
        expect(seen.map((h) => h.path)).toEqual(['/to-self', '/landed']);
        expect(sensitiveOf(seen[1])).toEqual(SENSITIVE);
        expect(seen[1].headers.authorization).toBe('Bearer top-secret');
    });

    it('does not restore dropped credentials when a later hop returns to the first origin', async () => {
        await safeFetch(`${origin('a')}/other-then-back`, withCredentials());
        expect(seen.map((h) => [h.host, h.path])).toEqual([['a.test', '/other-then-back'], ['b.test', '/back'], ['a.test', '/landed']]);
        expect(sensitiveOf(seen[2])).toEqual([]);
    });

    describe('from https to http', () => {
        let request;
        beforeEach(() => {
            const real = axios.request.bind(axios);
            request = jest.spyOn(axios, 'request').mockImplementation((config) => {
                if (!config.url.startsWith('https:')) return real(config);
                return Promise.resolve({ status: 302, headers: { location: `${origin('b')}/landed` }, data: Readable.from([]) });
            });
        });
        afterEach(() => request.mockRestore());

        it('refuses the downgrade when the caller sent credentials, and sends the http host nothing', async () => {
            await expect(safeFetch(`https://a.test:${servers.a.port}/secure`, withCredentials())).rejects.toThrow(/https to http/i);
            expect(seen).toEqual([]);
        });

        it('refuses it for a caller-marked header alone', async () => {
            await expect(safeFetch(`https://a.test:${servers.a.port}/secure`, { timeoutMs: 3000, headers: { 'X-Api-Key': 'k' }, sensitiveHeaders: ['x-api-key'] }))
                .rejects.toThrow(/https to http/i);
            expect(seen).toEqual([]);
        });

        it('follows it without credentials, with nothing sensitive to drop', async () => {
            const out = await safeFetch(`https://a.test:${servers.a.port}/secure`, { timeoutMs: 3000, headers: { 'User-Agent': 'probe/1' } });
            expect(out.status).toBe(200);
            expect(seen.map((h) => [h.host, h.path])).toEqual([['b.test', '/landed']]);
            expect(sensitiveOf(seen[0])).toEqual([]);
            expect(seen[0].headers['user-agent']).toBe('probe/1');
        });
    });
});

describe('method and body on redirects', () => {
    const post = (path, extra = {}) => safeFetch(`${origin('a')}${path}`, withCredentials({ method: 'post', data: 'payload', ...extra, headers: { ...CREDENTIALS, 'Content-Type': 'text/plain' } }));

    it.each(['/307-self', '/308-self'])('%s on the same origin keeps the method, the body and the credentials', async (path) => {
        await post(path);
        expect(seen[1]).toMatchObject({ path: '/landed', method: 'POST', body: 'payload' });
        expect(sensitiveOf(seen[1])).toEqual(SENSITIVE);
    });

    it.each(['/307-other', '/308-other'])('%s to another origin sends neither the body nor the credentials', async (path) => {
        await post(path);
        expect(seen[1]).toMatchObject({ host: 'b.test', path: '/landed', body: '' });
        expect(seen[1].method).not.toBe('POST');
        expect(sensitiveOf(seen[1])).toEqual([]);
        expect(seen[1].headers).not.toHaveProperty('content-type');
    });

    it.each(['/301', '/302', '/303'])('%s turns a POST into a GET without a body or its body headers', async (path) => {
        await post(path);
        expect(seen[1]).toMatchObject({ path: '/landed', method: 'GET', body: '' });
        expect(seen[1].headers).not.toHaveProperty('content-type');
    });

    it('a 307 to another origin still replays an uncredentialed body, as webhook deliveries rely on', async () => {
        await safeFetch(`${origin('a')}/307-other`, { timeoutMs: 3000, method: 'post', data: 'payload', headers: { 'Content-Type': 'text/plain' } });
        expect(seen[1]).toMatchObject({ host: 'b.test', method: 'POST', body: 'payload' });
    });
});

describe('what a redirected fetch reports', () => {
    it('returns the final URL and every hop as host and path, never a query string', async () => {
        const out = await safeFetch(`${origin('a')}/two-hop?first=1`, { timeoutMs: 3000 });
        expect(out.finalUrl).toBe(`${origin('c', 'a')}/landed`);
        expect(out.hops).toEqual([
            { host: `a.test:${servers.a.port}`, path: '/two-hop', status: 302 },
            { host: `b.test:${servers.b.port}`, path: '/bounce', status: 302 },
            { host: `c.test:${servers.a.port}`, path: '/landed', status: 200 },
        ]);
        expect(JSON.stringify(out.hops)).not.toMatch(/token|secret|first/);
    });

    it('a single fetch reports one hop', async () => {
        const out = await safeFetch(`${origin('a')}/plain`, { timeoutMs: 3000 });
        expect(out.hops).toEqual([{ host: `a.test:${servers.a.port}`, path: '/plain', status: 200 }]);
        expect(out.finalUrl).toBe(`${origin('a')}/plain`);
    });

    it('a page read through redirects across hosts records every host as a taint source, once each', async () => {
        const { out, found } = await taint.collect(() => pageAudit.fetchPage(`${origin('a')}/two-hop`));
        expect(out.status).toBe(200);
        expect(found.map((s) => [s.kind, s.ref])).toEqual([['fetch', 'a.test'], ['fetch', 'b.test'], ['fetch', 'c.test']]);
    });

    it('a same-host redirect is noted once', async () => {
        const { found } = await taint.collect(() => pageAudit.fetchPage(`${origin('a')}/to-self`));
        expect(found.map((s) => s.ref)).toEqual(['a.test']);
    });
});
