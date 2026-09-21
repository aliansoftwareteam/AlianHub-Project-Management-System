const fs = require('node:fs');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { emailFor, login, readState } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');
const csp = require('../../Config/contentSecurityPolicy');
const { MAX_BODY_BYTES, REPORTS_PER_MINUTE } = require('../../Modules/CspReport/routes');

/* Sprint 8 slice 12: the policy header by mode, the public report route and the instance card's read, through the real app. */

const state = readState();
const BOOT_TIMEOUT_MS = 180000;
const ROUTE = '/api/v2/csp-report';
const SUMMARY = '/api/v2/instance/csp';
const ENFORCED = 'content-security-policy';
const REPORT_ONLY = 'content-security-policy-report-only';
const SECRET = 'S8S12secretTOKEN0123456789';
const BLOCKED_HOST = 'cdn.s8s12.example';
const THIRTY_DAYS = 30 * 24 * 60 * 60;
const BETA_HELMET_HEADERS = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'cross-origin',
    'origin-agent-cluster': '?1',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-dns-prefetch-control': 'off',
    'x-download-options': 'noopen',
    'x-frame-options': 'SAMEORIGIN',
    'x-permitted-cross-domain-policies': 'none',
    'x-xss-protection': '0',
};
const SECURITY_HEADER = /^(x-(?!request-id$)|cross-origin-|content-security-|strict-transport-|referrer-policy$|origin-agent-cluster$|reporting-endpoints$|report-to$)/;

const securityHeaders = (headers) => Object.fromEntries([...headers].filter(([name]) => SECURITY_HEADER.test(name)));
const headersOf = async (baseURL, route) => securityHeaders((await fetch(baseURL + route)).headers);

const legacyReport = (over = {}) => ({
    'csp-report': {
        'document-uri': `${state.baseURL}/${state.companyId}/project/${SECRET}/board?invite=${SECRET}`,
        referrer: `https://mail.example.com/?q=${SECRET}`,
        'effective-directive': 'img-src',
        'violated-directive': 'img-src',
        'blocked-uri': `https://${BLOCKED_HOST}/pixel.gif?token=${SECRET}`,
        'script-sample': SECRET,
        'original-policy': "default-src 'self'",
        ...over,
    },
});

const send = (baseURL, body, type) => fetch(baseURL + ROUTE, { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify(body) });

const startWith = (label, env) => startServer({ mongoUrl: resolveMongoUrl(), logFile: path.join(STATE_DIR, `csp-${label}-server.log`), env });

const filesUnder = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)])) : []);

let mongo;
let reports;

beforeAll(async () => {
    mongo = await MongoClient.connect(resolveMongoUrl());
    reports = mongo.db('global').collection('csp_reports');
});

afterAll(async () => {
    if (reports) await reports.deleteMany({ blockedHost: { $in: [BLOCKED_HOST, 'inline'] } });
    if (mongo) await mongo.close();
});

describe('uploads on server storage, with CSP_MODE unset', () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const FILES = [
        ['s8s12-photo.png', PNG, 'image/png', false],
        ['s8s12-notes.txt', Buffer.from('plain notes'), 'text/plain; charset=utf-8', false],
        ['s8s12-report.pdf', Buffer.from('%PDF-1.4\n%%EOF'), 'application/pdf', false],
        ['s8s12-payload.js', Buffer.from('alert(document.domain)'), 'application/octet-stream', true],
        ['s8s12-page.html', Buffer.from('<script>alert(document.domain)</script>'), 'application/octet-stream', true],
        ['s8s12-drawing.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'application/octet-stream', true],
    ];
    let owner;

    beforeAll(async () => {
        const session = await login(state.baseURL, emailFor('owner'));
        owner = createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId: state.companyId });
    });

    it.each(FILES)('serves %s as %s', async (name, bytes, type, download) => {
        const filepath = `project/${state.projects.shared._id}/${name}`;
        const up = await owner.post('/api/v1/storage/uploadFileBase64', { companyId: state.companyId, path: filepath, base64String: bytes.toString('base64') });
        expect(up.status).toBe(200);
        const signed = await owner.get(`/api/v1/generateSignedUrl/${state.companyId}`, { query: { filepath, domainUrl: state.baseURL } });
        const res = await fetch(signed.body.url);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe(type);
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
        expect(res.headers.get('content-disposition')).toBe(download ? `attachment; filename="${name}"` : null);
        expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    });
});

describe('CSP_MODE unset, the harness server', () => {
    it.each(['/', '/login', '/api/v2/changelog', '/api/v2/instance/public-config'])('sends the security headers beta sends, and no policy, on %s', async (route) => {
        expect(await headersOf(state.baseURL, route)).toEqual(BETA_HELMET_HEADERS);
    });

    it('has no report route', async () => {
        const before = await reports.countDocuments({});
        const res = await send(state.baseURL, legacyReport(), 'application/csp-report');
        expect(res.status).not.toBe(204);
        expect(await reports.countDocuments({})).toBe(before);
    });
});

describe('CSP_MODE=report', () => {
    let server;

    beforeAll(async () => {
        server = await startWith('report', { CSP_MODE: 'report', CSP_EXTRA_IMG_SRC: 'http://images.s8s12.example:8080' });
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => { if (server) await server.stop(); }, BOOT_TIMEOUT_MS);

    it('sends the policy as report-only on the app and on an API route, beside the helmet headers', async () => {
        for (const route of ['/', '/api/v2/changelog']) {
            const headers = await headersOf(server.baseURL, route);
            expect(headers).toMatchObject(BETA_HELMET_HEADERS);
            expect(headers[ENFORCED]).toBeUndefined();
            expect(headers['reporting-endpoints']).toBeUndefined();
            expect(headers[REPORT_ONLY]).toContain(`report-uri ${ROUTE}`);
            expect(headers[REPORT_ONLY]).not.toContain('report-to');
            expect(headers[REPORT_ONLY]).toContain("default-src 'self'");
            expect(headers[REPORT_ONLY]).toContain('http://images.s8s12.example:8080');
            expect(headers[REPORT_ONLY]).toContain(`ws://127.0.0.1:${server.port}`);
            expect(headers[REPORT_ONLY]).not.toMatch(/unsafe-eval|wasabisys/);
            expect(headers[REPORT_ONLY]).toMatch(/script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client [^;']+;/);
        }
    });

    it('names the Reporting API endpoint when the request came in over https', async () => {
        const headers = securityHeaders((await fetch(`${server.baseURL}/`, { headers: { 'x-forwarded-proto': 'https' } })).headers);
        expect(headers['reporting-endpoints']).toBe(`csp-endpoint="${ROUTE}"`);
        expect(headers[REPORT_ONLY]).toMatch(/; report-to csp-endpoint$/);
    });

    it('leaves the public share page with its own policy only', async () => {
        const headers = await headersOf(server.baseURL, '/share/s8s12-no-such-share');
        expect(headers[ENFORCED]).toContain("default-src 'none'");
        expect(headers[REPORT_ONLY]).toBeUndefined();
    });

    it('takes a report in either format without a session and keeps the host and the path shape only', async () => {
        expect((await send(server.baseURL, legacyReport(), 'application/csp-report')).status).toBe(204);
        const batch = [{ type: 'csp-violation', age: 1, url: `${state.baseURL}/?t=${SECRET}`, body: { documentURL: `${state.baseURL}/${state.companyId}/project/${SECRET}/board`, blockedURL: `https://${BLOCKED_HOST}/other.js?k=${SECRET}`, effectiveDirective: 'img-src', sample: SECRET } }];
        expect((await send(server.baseURL, batch, 'application/reports+json')).status).toBe(204);

        const rows = await reports.find({ blockedHost: BLOCKED_HOST }).toArray();
        expect(rows).toHaveLength(1);
        expect(Object.keys(rows[0]).sort()).toEqual(['__v', '_id', 'blockedHost', 'count', 'day', 'directive', 'documentPath', 'lastSeen']);
        expect(rows[0]).toMatchObject({ directive: 'img-src', documentPath: '/:id/project/:id/board', count: 2 });
    });

    it('keeps the TTL and key indexes on the collection it writes', async () => {
        const deadline = Date.now() + 10000;
        let indexes = [];
        while (Date.now() < deadline) {
            indexes = await reports.indexes().catch(() => []);
            if (indexes.some((index) => index.expireAfterSeconds !== undefined) && indexes.some((index) => index.unique)) break;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        expect(indexes).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: { day: 1 }, expireAfterSeconds: THIRTY_DAYS }),
            expect.objectContaining({ key: { day: 1, directive: 1, blockedHost: 1, documentPath: 1 }, unique: true }),
        ]));
    });

    it('never writes the token to the database or to a log', async () => {
        const stored = JSON.stringify(await reports.find({}).toArray());
        expect(stored).not.toContain(SECRET);
        expect(stored).not.toContain('pixel.gif');
        const logs = [server.logFile, ...filesUnder(server.logDir)];
        expect(logs.length).toBeGreaterThan(0);
        for (const file of logs) expect(fs.readFileSync(file, 'utf8')).not.toContain(SECRET);
    });

    it('refuses another content type and a body over the cap', async () => {
        expect((await send(server.baseURL, legacyReport(), 'application/json')).status).toBe(415);
        expect((await send(server.baseURL, legacyReport({ 'script-sample': 'x'.repeat(MAX_BODY_BYTES) }), 'application/csp-report')).status).toBe(413);
    });

    it('shows the instance owner the mode and the blocked host, and nobody else', async () => {
        const anonymous = createApiClient({ baseURL: server.baseURL });
        expect((await anonymous.get(SUMMARY)).status).toBe(401);
        const member = await login(server.baseURL, emailFor('member'));
        expect((await createApiClient({ baseURL: server.baseURL, accessToken: member.accessToken }).get(SUMMARY)).status).toBe(403);

        const owner = await login(server.baseURL, emailFor('owner'));
        const res = await createApiClient({ baseURL: server.baseURL, accessToken: owner.accessToken }).get(SUMMARY);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ mode: 'report', header: 'Content-Security-Policy-Report-Only', days: 7 });
        expect(res.body.data.policy).toBe((await headersOf(server.baseURL, '/'))[REPORT_ONLY]);
        expect(res.body.data.hosts).toEqual(expect.arrayContaining([expect.objectContaining({ blockedHost: BLOCKED_HOST, directive: 'img-src', count: 2 })]));
        expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });

    it('stops one address after its reports for the minute', async () => {
        const statuses = [];
        for (let i = 0; i < REPORTS_PER_MINUTE + 1; i += 1) statuses.push((await send(server.baseURL, legacyReport({ 'blocked-uri': 'inline' }), 'application/csp-report')).status);
        expect(statuses[0]).toBe(204);
        expect(statuses[statuses.length - 1]).toBe(429);
        expect(statuses.filter((status) => ![204, 429].includes(status))).toEqual([]);
    });
});

describe('CSP_MODE=enforce', () => {
    let server;

    beforeAll(async () => { server = await startWith('enforce', { CSP_MODE: 'enforce' }); }, BOOT_TIMEOUT_MS);
    afterAll(async () => { if (server) await server.stop(); }, BOOT_TIMEOUT_MS);

    it('sends the same policy as the enforced header', async () => {
        const headers = await headersOf(server.baseURL, '/');
        expect(headers).toMatchObject(BETA_HELMET_HEADERS);
        expect(headers[REPORT_ONLY]).toBeUndefined();
        expect(headers[ENFORCED]).toBe(csp.policyOf({ CSP_MODE: 'enforce', STORAGE_TYPE: 'server', WEBURL: server.baseURL, APIURL: `${server.baseURL}/` }));
    });

    it('still serves the app shell and its bundle', async () => {
        const html = await (await fetch(`${server.baseURL}/`)).text();
        expect(html).toContain('<div id="app">');
        expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
        expect(html).not.toMatch(/<style[\s>]/i);
    });
});

describe('a server that cannot start', () => {
    it.each([["'unsafe-eval' in an extra", { CSP_MODE: 'report', CSP_EXTRA_SCRIPT_SRC: "'unsafe-eval'" }, /CSP_EXTRA_SCRIPT_SRC/], ['an unknown mode', { CSP_MODE: 'enforced' }, /CSP_MODE/]])('refuses %s with the reason in its log', async (label, env, reason) => {
        await expect(startWith('refused', env)).rejects.toThrow(reason);
    }, BOOT_TIMEOUT_MS);
});
