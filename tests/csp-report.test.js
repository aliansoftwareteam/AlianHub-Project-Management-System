const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const bodyParser = require('body-parser');
const express = require('express');
const logger = require('../Config/loggerConfig');
const { init } = require('../Modules/CspReport/init');
const rules = require('../Modules/CspReport/reportRules');
const { MAX_BODY_BYTES, MAX_ROWS_PER_DAY, MAX_NEW_KEYS_PER_ADDRESS, REPORTS_PER_MINUTE } = require('../Modules/CspReport/routes');

const ROUTE = '/api/v2/csp-report';
const LEGACY = 'application/csp-report';
const REPORTING_API = 'application/reports+json';
const SECRET = 'SECRETtoken0123456789abcdef';

const legacyReport = (over = {}) => ({
    'csp-report': {
        'document-uri': `https://hub.example.com/6f00000000000000000000a1/project/6f00000000000000000000b2/board?invite=${SECRET}#${SECRET}`,
        referrer: `https://mail.example.com/?q=${SECRET}`,
        'violated-directive': 'img-src',
        'effective-directive': 'img-src',
        'original-policy': "default-src 'self'; report-uri /api/v2/csp-report",
        disposition: 'report',
        'blocked-uri': `https://cdn.evil.example/pixel.gif?token=${SECRET}&email=owner@example.com`,
        'source-file': `https://hub.example.com/js/app.js?${SECRET}`,
        'script-sample': `fetch("/x?${SECRET}")`,
        'status-code': 200,
        ...over,
    },
});

const apiReport = (over = {}) => ({
    type: 'csp-violation',
    age: 12,
    url: `https://hub.example.com/pages/${SECRET}?share=${SECRET}`,
    user_agent: 'Mozilla/5.0',
    body: {
        documentURL: `https://hub.example.com/pages/${SECRET}?share=${SECRET}`,
        referrer: '',
        blockedURL: `wss://push.evil.example:8443/socket?auth=${SECRET}`,
        effectiveDirective: 'connect-src',
        originalPolicy: "default-src 'self'",
        sourceFile: `https://hub.example.com/js/app.js?${SECRET}`,
        sample: SECRET,
        disposition: 'enforce',
        statusCode: 200,
        ...over,
    },
});

let server;
let baseURL;
let consoleSpies;

const startApp = async (env = { CSP_MODE: 'report' }) => {
    const app = express();
    app.set('trust proxy', true);
    app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));
    app.use(bodyParser.json({ limit: '2mb' }));
    app.use(bodyParser.raw({ limit: '2mb' }));
    init(app, env);
    app.use((err, req, res, next) => { logger.error(`unhandled: ${err && err.stack}`); res.status(500).end(); next; });
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
};
const stopApp = () => new Promise((resolve) => server.close(resolve));

const send = (body, type = LEGACY, headers = {}) => fetch(baseURL + ROUTE, {
    method: 'POST',
    headers: { 'content-type': type, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
});

const rows = () => mockDb.store.csp_reports || [];
const written = () => JSON.stringify([mockDb.store, mockDb.calls]);
const logged = () => JSON.stringify([...Object.values(logger).flatMap((fn) => fn.mock.calls), ...consoleSpies.flatMap((spy) => spy.mock.calls)]);

beforeEach(async () => {
    const { resetAddressCounts } = require('../Modules/CspReport/controller');
    if (resetAddressCounts) resetAddressCounts();
    Object.keys(mockDb.store).forEach((key) => delete mockDb.store[key]);
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((level) => jest.spyOn(console, level).mockImplementation(() => {}));
    await startApp();
});

afterEach(async () => {
    await stopApp();
    consoleSpies.forEach((spy) => spy.mockRestore());
});

describe('POST /api/v2/csp-report', () => {
    it('accepts a report-uri report without a session and answers with no content', async () => {
        const res = await send(legacyReport());
        expect(res.status).toBe(204);
        expect(await res.text()).toBe('');
        expect(rows()).toHaveLength(1);
    });

    it.each([['enforce', 204, 1], ['off', 404, 0], ['', 404, 0]])('exists only while the policy is on (CSP_MODE %j)', async (mode, status, stored) => {
        await stopApp();
        await startApp({ CSP_MODE: mode });
        expect((await send(legacyReport())).status).toBe(status);
        expect(rows()).toHaveLength(stored);
    });

    it('stores the directive, the blocked host and the document path shape, and nothing else', async () => {
        await send(legacyReport());
        const [row] = rows();
        expect(Object.keys(row).sort()).toEqual(['_id', 'blockedHost', 'count', 'day', 'directive', 'documentPath', 'lastSeen']);
        expect(row).toMatchObject({ directive: 'img-src', blockedHost: 'cdn.evil.example', documentPath: '/:id/project/:id/board', count: 1 });
        expect(row.day.toISOString()).toMatch(/T00:00:00\.000Z$/);
        expect(row.lastSeen).toBeInstanceOf(Date);
        expect(mockDb.calls.every((call) => call.companyId === 'global' && call.type === 'csp_reports')).toBe(true);
    });

    it('accepts a Reporting API batch', async () => {
        const res = await send([apiReport(), apiReport({ blockedURL: 'inline', effectiveDirective: 'script-src-elem' }), { type: 'deprecation', body: { id: 'x' } }], REPORTING_API);
        expect(res.status).toBe(204);
        expect(rows().map((row) => [row.directive, row.blockedHost, row.documentPath]).sort()).toEqual([
            ['connect-src', 'push.evil.example:8443', '/pages/:id'],
            ['script-src-elem', 'inline', '/pages/:id'],
        ]);
    });

    it('counts a repeated violation on one row per day', async () => {
        await send(legacyReport());
        await send(legacyReport({ 'blocked-uri': 'https://cdn.evil.example/other.png?x=1' }));
        await send([apiReport({ blockedURL: 'https://CDN.evil.example/', effectiveDirective: 'img-src', documentURL: 'https://hub.example.com/6f00000000000000000000c3/project/77/board' })], REPORTING_API);
        expect(rows()).toHaveLength(1);
        expect(rows()[0].count).toBe(3);
    });

    it('never lets a URL, a query string, a token or a sample reach the database or the logs', async () => {
        await send(legacyReport());
        await send([apiReport()], REPORTING_API);
        await send(`{"csp-report": {"blocked-uri": "https://x.example/?t=${SECRET}"`);
        expect(rows().length).toBeGreaterThan(0);
        for (const leaked of [SECRET, 'owner@example.com', 'pixel.gif', 'mail.example.com', '?', 'fetch(']) {
            expect(written()).not.toContain(leaked);
            expect(logged()).not.toContain(leaked);
        }
    });

    it.each([
        ['inline', 'inline'], ['eval', 'eval'], ['wasm-eval', 'wasm-eval'], ['data', 'data:'], ['data:image/png;base64,AAAA', 'data:'], ['blob:https://hub.example.com/6c1f', 'blob:'],
        ['blob', 'blob:'], ['about:blank', 'about:'], ['self', 'self'], ['', 'unknown'], ['chrome-extension://abcdef/content.js', 'chrome-extension:'],
        ['xn--bcher-kva.example', null], ['https://xn--bcher-kva.example/a', 'xn--bcher-kva.example'], ['https://bücher.example/a', 'xn--bcher-kva.example'],
    ])('names a blocked source that is not a host by its kind (%j)', async (blocked, stored) => {
        await send(legacyReport({ 'blocked-uri': blocked }));
        expect(rows().map((row) => row.blockedHost)).toEqual(stored === null ? [] : [stored]);
    });

    it.each([
        ['a bare word', 'secretvalue123'],
        ['a bare word with digits and dashes', 'invite-9f8e7d6c'],
        ['a scheme the browser never reports', 'myapp://open?taskId=1'],
        ['a made-up scheme carrying a value', 'secretvalue123:x'],
        ['a host longer than 253 characters', `https://${Array.from({ length: 5 }, () => 'a'.repeat(60)).join('.')}/x`],
        ['a label longer than 63 characters', `https://${'a'.repeat(64)}.example/x`],
    ])('stores nothing for %s', async (label, blocked) => {
        expect(blocked.length).toBeGreaterThan(0);
        await send(legacyReport({ 'blocked-uri': blocked }));
        expect(rows()).toHaveLength(0);
        expect(written()).not.toContain('secretvalue123');
    });

    it('keeps a host of exactly 253 characters', () => {
        const host = [...Array.from({ length: 3 }, () => 'a'.repeat(63)), 'a'.repeat(61)].join('.');
        expect(host).toHaveLength(253);
        expect(rules.blockedHostOf(`https://${host}/x`)).toBe(host);
        expect(rules.blockedHostOf(`https://${host}a/x`)).toBeNull();
    });

    it('reads the directive from violated-directive when the browser sends no effective one', async () => {
        await send(legacyReport({ 'effective-directive': undefined, 'violated-directive': 'frame-src https:' }));
        expect(rows()[0].directive).toBe('frame-src');
    });

    it.each([
        ['a directive that does not exist', legacyReport({ 'effective-directive': 'made-up-src', 'violated-directive': 'made-up-src' })],
        ['a body that is not a report', { hello: 'world' }],
        ['a report whose fields are not strings', legacyReport({ 'blocked-uri': { $gt: '' }, 'document-uri': ['x'] })],
        ['null', null],
    ])('stores nothing for %s', async (label, body) => {
        const res = await send(body);
        expect(res.status).toBe(204);
        expect(rows()).toHaveLength(0);
    });

    it('keeps only route words in the document path', () => {
        expect(rules.documentPathOf('https://hub.example.com/')).toBe('/');
        expect(rules.documentPathOf(`https://hub.example.com/reset-password/${SECRET}`)).toBe('/reset-password/:id');
        expect(rules.documentPathOf('https://hub.example.com/share/aB3-xyz_9')).toBe('/share/:id');
        expect(rules.documentPathOf('https://hub.example.com/a/b/c/d/e/f/g/h/i/j')).toBe('/a/b/c/d/e/f/g/h');
        expect(rules.documentPathOf('https://hub.example.com/AbCdEfGh/instance-console/')).toBe('/:id/instance-console');
        expect(rules.documentPathOf(`https://hub.example.com/${'a'.repeat(40)}`)).toBe('/:id');
        expect(rules.documentPathOf('not a url')).toBe('unknown');
    });

    it('refuses any other content type, so the 2 MB JSON parser never sees a report', async () => {
        for (const type of ['application/json', 'text/plain', 'application/x-www-form-urlencoded']) {
            const res = await send(legacyReport(), type);
            expect(res.status).toBe(415);
        }
        expect(rows()).toHaveLength(0);
    });

    it('refuses a body over the cap', async () => {
        expect(MAX_BODY_BYTES).toBeLessThanOrEqual(16 * 1024);
        const res = await send(legacyReport({ 'script-sample': 'x'.repeat(MAX_BODY_BYTES) }));
        expect(res.status).toBe(413);
        expect(rows()).toHaveLength(0);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('answers a body that is not JSON without logging it', async () => {
        const res = await send('{"csp-report": ', LEGACY);
        expect(res.status).toBe(400);
        expect(rows()).toHaveLength(0);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('reads at most twenty reports from one batch', async () => {
        const batch = Array.from({ length: 30 }, (unused, i) => ({ type: 'csp-violation', body: { documentURL: 'https://h.example/', blockedURL: `https://h${i}.example/`, effectiveDirective: 'img-src' } }));
        await send(batch, REPORTING_API);
        expect(rows()).toHaveLength(20);
    });

    it('stops adding rows for a day once that day is full, and keeps counting the rows it has', async () => {
        const today = rules.utcDay(new Date());
        for (let i = 0; i < MAX_ROWS_PER_DAY; i += 1) mockDb.seed('csp_reports', { day: today, directive: 'img-src', blockedHost: `h${i}.example`, documentPath: '/', count: 1, lastSeen: today });
        await send(legacyReport());
        expect(rows()).toHaveLength(MAX_ROWS_PER_DAY);
        await send(legacyReport({ 'blocked-uri': 'https://h0.example/x', 'document-uri': 'https://hub.example.com/' }));
        expect(rows().find((row) => row.blockedHost === 'h0.example').count).toBe(2);
    });

    it('lets one address add a fixed number of new rows a day, and still counts the rows it has', async () => {
        expect(MAX_NEW_KEYS_PER_ADDRESS).toBeLessThanOrEqual(100);
        const from = (ip) => ({ 'x-forwarded-for': ip });
        const batch = (offset, n) => Array.from({ length: n }, (unused, i) => ({ type: 'csp-violation', body: { documentURL: 'https://h.example/', blockedURL: `https://k${offset + i}.example/`, effectiveDirective: 'img-src' } }));
        for (let sent = 0; sent < MAX_NEW_KEYS_PER_ADDRESS + 20; sent += 20) await send(batch(sent, 20), REPORTING_API, from('198.51.100.7'));
        expect(rows()).toHaveLength(MAX_NEW_KEYS_PER_ADDRESS);

        await send(batch(0, 1), REPORTING_API, from('198.51.100.7'));
        expect(rows().find((row) => row.blockedHost === 'k0.example').count).toBe(2);

        await send(batch(1000, 1), REPORTING_API, from('203.0.113.9'));
        expect(rows()).toHaveLength(MAX_NEW_KEYS_PER_ADDRESS + 1);
    });

    it('counts a report whose row exists even once the day is full, from any address', async () => {
        const today = rules.utcDay(new Date());
        for (let i = 0; i < MAX_ROWS_PER_DAY; i += 1) mockDb.seed('csp_reports', { day: today, directive: 'img-src', blockedHost: `h${i}.example`, documentPath: '/', count: 1, lastSeen: today });
        await send(legacyReport({ 'blocked-uri': 'https://h7.example/x', 'document-uri': 'https://hub.example.com/' }), LEGACY, { 'x-forwarded-for': '192.0.2.44' });
        expect(rows()).toHaveLength(MAX_ROWS_PER_DAY);
        expect(rows().find((row) => row.blockedHost === 'h7.example').count).toBe(2);
    });

    it('answers 204 and logs one short line when the database is down', async () => {
        mockDb.crud.mockRejectedValueOnce(new Error('pool closed'));
        const res = await send(legacyReport());
        expect(res.status).toBe(204);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toBe('csp report not recorded: pool closed');
    });

    it('limits one address to a fixed number of reports a minute', async () => {
        expect(REPORTS_PER_MINUTE).toBeLessThanOrEqual(120);
        const statuses = [];
        for (let i = 0; i < REPORTS_PER_MINUTE + 1; i += 1) statuses.push((await send(legacyReport())).status);
        expect(statuses.slice(0, REPORTS_PER_MINUTE).every((status) => status === 204)).toBe(true);
        expect(statuses[REPORTS_PER_MINUTE]).toBe(429);
        expect(rows()[0].count).toBe(REPORTS_PER_MINUTE);
    });
});
