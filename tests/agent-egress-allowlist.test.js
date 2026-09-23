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
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Agents/skillRecord', () => ({ getSkill: jest.fn(), SOURCE: { CODE: 'code' } }));
jest.mock('../Modules/Agents/engine/pageAudit', () => ({ audit: jest.fn(), fetchPage: jest.fn(), extractUrl: (text) => (String(text || '').match(/https?:\/\/\S+/) || [null])[0] }));

const http = require('http');
const dns = require('dns');
const { myCache } = require('../Config/config');
const rules = require('../Modules/Agents/engine/egressRules');
const egressContext = require('../Modules/Agents/engine/egressContext');
const { safeFetch, resolvePublic, isBlockedHostname, isPrivateAddress } = require('../Modules/Agents/engine/safeFetch');
const store = require('../Modules/Agents/engine/egressAllowlist');
const skillRecord = require('../Modules/Agents/skillRecord');
const pageAudit = require('../Modules/Agents/engine/pageAudit');
const agentFetch = require('../Modules/Agents/engine/agentFetch');
const logger = require('../Config/loggerConfig');
const orchestrator = require('../Modules/Agents/engine/orchestrator');

const ENV_KEY = 'AGENT_EGRESS_ALLOWLIST';
const CID_A = '6f00000000000000000000a1';
const CID_B = '6f00000000000000000000b1';
const ACTOR = '6f0000000000000000000011';
const SECRET = 'TOKEN-THAT-MUST-NOT-LEAVE';

const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const audits = (companyId) => (mockDbFor(companyId).store.audit_logs || []).filter((row) => row.action === store.REFUSED_ACTION);
const listOf = (companyId) => (mockDbFor(companyId).store[store.COLLECTION] || [])[0];
const seedList = (companyId, hosts) => mockDbFor(companyId).seed(store.COLLECTION, { _id: store.DOC_ID, hosts, updatedBy: ACTOR, updatedAt: new Date() });
const listReads = (companyId) => mockDbFor(companyId).calls.filter((c) => c.type === store.COLLECTION && c.method === 'findOne').length;

const listen = (handler) => new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    delete process.env[ENV_KEY];
    myCache.flushAll();
    jest.clearAllMocks();
});

afterAll(() => { delete process.env[ENV_KEY]; });

describe('egress allowlist entries', () => {
    const valid = (list) => rules.validateHosts(list, { isBlockedHostname });

    it('accepts exact hostnames, suffix patterns and optional ports, lowercased and deduplicated', () => {
        const out = valid(['Example.com', 'API.Example.com.', '*.Example.org', 'example.com:8443', '*.example.org:8443', ' example.com ', 'example.com']);
        expect(out.errors).toEqual([]);
        expect(out.hosts).toEqual(['example.com', 'api.example.com', '*.example.org', 'example.com:8443', '*.example.org:8443']);
    });

    it.each([
        ['203.0.113.10', 'address'], ['[2001:db8::1]', 'address'], ['2001:db8::1', 'address'], ['0x7f000001', 'address'], ['2130706433', 'address'], ['127.1', 'address'], ['::1', 'address'],
        ['10.0.0.1', 'address'], ['169.254.169.254', 'address'], ['192.168.1.10:8080', 'address'],
        ['localhost', 'private'], ['app.localhost', 'private'], ['printer.local', 'private'], ['db.internal', 'private'], ['*.internal', 'private'], ['intranet', 'private'],
        ['https://example.com', 'scheme'], ['http://example.com/', 'scheme'], ['ftp://example.com', 'scheme'],
        ['example.com/api', 'path'], ['example.com/24', 'path'], ['example.com?x=1', 'path'], ['example.com#frag', 'path'],
        ['*.com', 'wildcard'], ['*', 'wildcard'], ['a.*.com', 'wildcard'], ['*example.com', 'wildcard'], ['**.example.com', 'wildcard'],
        ['example.com:0', 'port'], ['example.com:70000', 'port'], ['example.com:abc', 'invalid'],
        ['user@example.com', 'invalid'], ['exa mple.com', 'invalid'], ['-bad.example.com', 'invalid'], [`${'a'.repeat(64)}.example.com`, 'invalid'],
    ])('refuses %s as %s', (entry, reason) => {
        const out = valid([entry]);
        expect(out.hosts).toEqual([]);
        expect(out.errors).toEqual([{ entry: entry.trim(), reason }]);
    });

    it.each([
        ['*.co.uk'], ['*.com.au'], ['*.co.in'], ['*.github.io'], ['*.herokuapp.com'], ['*.pages.dev'], ['*.amazonaws.com'], ['*.s3.amazonaws.com'],
        ['*.s3.eu-west-1.amazonaws.com'], ['*.blob.core.windows.net'], ['*.a.run.app'], ['*.co.uk:8443'], ['*.GitHub.io.'],
    ])('refuses the wildcard %s: its base is a suffix anyone can register under', (entry) => {
        const out = valid([entry]);
        expect(out.hosts).toEqual([]);
        expect(out.errors).toEqual([{ entry, reason: 'public_suffix' }]);
    });

    it('still accepts an exact host, or a wildcard on a registered name, under a shared suffix', () => {
        const list = ['acme.github.io', 'bbc.co.uk', '*.acme.co.uk', 'bucket.s3.amazonaws.com', '*.acme.pages.dev', '*.example.com'];
        expect(valid(list)).toEqual({ hosts: list, errors: [] });
        expect(rules.validateHosts(['*.github.io']).errors).toEqual([{ entry: '*.github.io', reason: 'public_suffix' }]);
    });

    const WILDCARD_DNS = ['nip.io', 'sslip.io', 'xip.io', 'traefik.me', 'localtest.me', 'lvh.me', 'backname.io', 'nip.direct'];
    const SHARED_HOSTING = [
        'ngrok.io', 'ngrok.dev', 'ngrok-free.app', 'loca.lt', 'trycloudflare.com', 'github.io', 'github.dev', 'myshopify.com', 'readthedocs.io',
        'azurestaticapps.net', 'firebaseio.com', 'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'blogspot.com',
        'appspot.com', 'web.app',
    ];

    it.each(WILDCARD_DNS)('refuses a wildcard at any depth under %s, whose names resolve to any address written into them', (suffix) => {
        for (const check of [valid, (list) => rules.validateHosts(list)]) {
            expect(check([`*.${suffix}`]).errors).toEqual([{ entry: `*.${suffix}`, reason: 'wildcard_dns' }]);
            expect(check([`*.team.${suffix}`]).errors).toEqual([{ entry: `*.team.${suffix}`, reason: 'wildcard_dns' }]);
            expect(check([`*.${suffix}:443`]).errors).toEqual([{ entry: `*.${suffix}:443`, reason: 'wildcard_dns' }]);
        }
        expect(rules.hostMatches([`*.${suffix}`], `10.0.0.1.${suffix}`, 443)).toBe(false);
        expect(rules.hostMatches([`*.team.${suffix}`], `x.team.${suffix}`, 443)).toBe(false);
    });

    it.each(WILDCARD_DNS)('still accepts an exact host under %s', (suffix) => {
        expect(valid([`myapp.${suffix}`])).toEqual({ hosts: [`myapp.${suffix}`], errors: [] });
    });

    it.each(SHARED_HOSTING)('refuses the wildcard *.%s, a shared-hosting suffix, and keeps exact hosts under it', (suffix) => {
        expect(valid([`*.${suffix}`]).errors).toEqual([{ entry: `*.${suffix}`, reason: 'public_suffix' }]);
        expect(rules.validateHosts([`*.${suffix}`]).errors).toEqual([{ entry: `*.${suffix}`, reason: 'public_suffix' }]);
        expect(valid([`myapp.${suffix}`])).toEqual({ hosts: [`myapp.${suffix}`], errors: [] });
        expect(rules.hostMatches([`*.${suffix}`], `attacker.${suffix}`, 443)).toBe(false);
    });

    it('a stored wildcard on a shared suffix matches nothing', () => {
        expect(rules.hostMatches(['*.github.io'], 'attacker.github.io', 443)).toBe(false);
        expect(rules.hostMatches(['*.co.uk'], 'attacker.co.uk', 443)).toBe(false);
    });

    it('drops empty entries and refuses a list over the cap', () => {
        expect(valid(['', '  ', null, 'example.com'])).toEqual({ hosts: ['example.com'], errors: [] });
        const many = Array.from({ length: rules.MAX_HOSTS + 1 }, (_, i) => `h${i}.example.com`);
        const out = valid(many);
        expect(out.errors).toEqual([{ entry: `h${rules.MAX_HOSTS}.example.com`, reason: 'too_many' }]);
        expect(out.hosts).toHaveLength(rules.MAX_HOSTS);
    });

    it('refuses something that is not a list of strings', () => {
        expect(valid('example.com').errors).toEqual([{ entry: '', reason: 'invalid' }]);
        expect(valid([{ host: 'example.com' }]).errors).toEqual([{ entry: '', reason: 'invalid' }]);
    });

    it('validates without the server host check too, for the browser', () => {
        const out = rules.validateHosts(['example.com', 'localhost', '10.0.0.1', 'printer.local']);
        expect(out.hosts).toEqual(['example.com']);
        expect(out.errors.map((e) => e.reason)).toEqual(['private', 'address', 'private']);
    });

    it('matches an exact entry on that host only, any port unless the entry names one', () => {
        expect(rules.hostMatches(['example.com'], 'example.com', 443)).toBe(true);
        expect(rules.hostMatches(['example.com'], 'EXAMPLE.com.', 8080)).toBe(true);
        expect(rules.hostMatches(['example.com'], 'api.example.com', 443)).toBe(false);
        expect(rules.hostMatches(['example.com'], 'notexample.com', 443)).toBe(false);
        expect(rules.hostMatches(['example.com:8443'], 'example.com', 8443)).toBe(true);
        expect(rules.hostMatches(['example.com:8443'], 'example.com', 443)).toBe(false);
    });

    it('matches a suffix pattern on subdomains only', () => {
        expect(rules.hostMatches(['*.example.com'], 'api.example.com', 443)).toBe(true);
        expect(rules.hostMatches(['*.example.com'], 'a.b.example.com', 443)).toBe(true);
        expect(rules.hostMatches(['*.example.com'], 'example.com', 443)).toBe(false);
        expect(rules.hostMatches(['*.example.com'], 'evil-example.com', 443)).toBe(false);
        expect(rules.hostMatches(['*.example.com'], 'example.com.evil.net', 443)).toBe(false);
        expect(rules.hostMatches(['*.example.com:8443'], 'api.example.com', 443)).toBe(false);
        expect(rules.hostMatches(['*.example.com:8443'], 'api.example.com', 8443)).toBe(true);
    });

    it('never matches with an empty list', () => {
        expect(rules.hostMatches([], 'example.com', 443)).toBe(false);
    });
});

describe('the flag', () => {
    it('is off unless AGENT_EGRESS_ALLOWLIST is exactly true', () => {
        expect(egressContext.ENV_KEY).toBe(ENV_KEY);
        expect(egressContext.isOn()).toBe(false);
        process.env[ENV_KEY] = 'TRUE';
        expect(egressContext.isOn()).toBe(true);
        process.env[ENV_KEY] = 'yes';
        expect(egressContext.isOn()).toBe(false);
    });
});

describe('the gateway', () => {
    let server; let port; let hits;
    beforeAll(async () => {
        hits = [];
        ({ server, port } = await listen((req, res) => {
            hits.push(`${req.headers.host}${req.url}`);
            if (req.url === '/secret') return res.end(SECRET);
            if (req.url === '/page') return res.end('<html><title>page</title></html>');
            if (req.url === '/to-other') { res.writeHead(302, { Location: `http://other.public.test:${port}/secret` }); return res.end(); }
            if (req.url === '/to-self') { res.writeHead(302, { Location: '/page' }); return res.end(); }
            if (/^\/loop\/\d+$/.test(req.url)) { const n = Number(req.url.split('/')[2]); res.writeHead(302, { Location: `/loop/${n + 1}` }); return res.end(); }
            res.writeHead(404); res.end();
        }));
    });
    afterAll(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
    beforeEach(() => { hits.length = 0; });

    /* Every name under .public.test is "public" and lands on the local server; anything else takes the real rule. */
    const resolve = (url) => {
        const u = new URL(url);
        if (u.hostname.endsWith('.public.test')) return Promise.resolve({ url: u, address: '127.0.0.1', family: 4 });
        return resolvePublic(url);
    };
    const opts = (over = {}) => ({ resolve, timeoutMs: 3000, maxRedirects: 5, maxBytes: 1024 * 1024, ...over });
    const inContext = (companyId, fn) => egressContext.run({ companyId, actor: ACTOR }, fn);
    const fetchAs = (companyId, url, over) => inContext(companyId, () => safeFetch(url, opts(over)));

    describe('with the flag off', () => {
        it('fetches a public host as before and never reads a list', async () => {
            seedList(CID_A, ['docs.example.com']);
            const page = await fetchAs(CID_A, `http://api.public.test:${port}/page`);
            expect(page.status).toBe(200);
            expect(hits).toEqual([`api.public.test:${port}/page`]);
            expect(listReads(CID_A)).toBe(0);
            await settle();
            expect(audits(CID_A)).toEqual([]);
        });

        it('refuses a private host as before, with no audit row', async () => {
            await expect(fetchAs(CID_A, `http://127.0.0.1:${port}/secret`)).rejects.toThrow(/private|reserved/i);
            expect(hits).toEqual([]);
            await settle();
            expect(audits(CID_A)).toEqual([]);
        });
    });

    describe('with the flag on', () => {
        beforeEach(() => { process.env[ENV_KEY] = 'true'; });

        it('an empty list keeps today\'s behaviour: public passes, private is refused, nothing is audited', async () => {
            const page = await fetchAs(CID_A, `http://api.public.test:${port}/page`);
            expect(page.status).toBe(200);
            await expect(fetchAs(CID_A, `http://127.0.0.1:${port}/secret`)).rejects.toThrow(/private|reserved/i);
            await expect(fetchAs(CID_A, `http://169.254.169.254/latest/meta-data/`)).rejects.toThrow(/private|reserved/i);
            expect(hits).toEqual([`api.public.test:${port}/page`]);
            await settle();
            expect(audits(CID_A)).toEqual([]);
        });

        it('a list of hosts written as [] is an empty list too', async () => {
            seedList(CID_A, []);
            expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
        });

        it('lets a listed host through and refuses an unlisted one with an audit row that names the host, not the URL', async () => {
            seedList(CID_A, ['api.public.test']);
            const page = await fetchAs(CID_A, `http://api.public.test:${port}/page`);
            expect(page.status).toBe(200);
            await expect(fetchAs(CID_A, `http://other.public.test:${port}/secret?token=${SECRET}`)).rejects.toThrow(/other\.public\.test.*allow/i);
            expect(hits).toEqual([`api.public.test:${port}/page`]);
            await settle();
            expect(audits(CID_A)).toHaveLength(1);
            expect(audits(CID_A)[0]).toMatchObject({ action: store.REFUSED_ACTION, actorId: ACTOR, entityType: 'host', entityId: 'other.public.test', meta: { reason: 'unlisted', host: 'other.public.test', port, hop: 0 } });
            expect(JSON.stringify(audits(CID_A)[0])).not.toContain(SECRET);
            expect(JSON.stringify(audits(CID_A)[0])).not.toContain('/secret');
        });

        it('a suffix pattern admits subdomains and not the bare domain', async () => {
            seedList(CID_A, ['*.public.test']);
            expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
            expect((await fetchAs(CID_A, `http://deep.api.public.test:${port}/page`)).status).toBe(200);
            await expect(fetchAs(CID_A, `http://public.test:${port}/page`)).rejects.toThrow(/allow/i);
            expect(hits).toHaveLength(2);
        });

        it('a listed entry with a port admits that port only', async () => {
            seedList(CID_A, [`api.public.test:${port}`]);
            expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
            await expect(fetchAs(CID_A, `http://api.public.test:${port + 1}/page`)).rejects.toThrow(/allow/i);
            expect(hits).toHaveLength(1);
        });

        it('an entry naming the https port does not admit plain http on the default port', async () => {
            seedList(CID_A, ['api.public.test:443']);
            await expect(fetchAs(CID_A, 'http://api.public.test/page')).rejects.toThrow(/not on this workspace's egress allowlist/);
            expect(hits).toEqual([]);
            await settle();
            expect(audits(CID_A)[0].meta).toEqual({ reason: 'unlisted', host: 'api.public.test', port: 80, hop: 0 });
        });

        it('an entry naming the http port does not admit https on the default port', async () => {
            seedList(CID_A, ['api.public.test:80']);
            await expect(fetchAs(CID_A, 'https://api.public.test/page')).rejects.toThrow(/not on this workspace's egress allowlist/);
            expect(hits).toEqual([]);
            await settle();
            expect(audits(CID_A)[0].meta).toEqual({ reason: 'unlisted', host: 'api.public.test', port: 443, hop: 0 });
        });

        it('a private host stays refused even when the list names it', async () => {
            seedList(CID_A, ['localhost', '127.0.0.1', 'printer.local']);
            await expect(fetchAs(CID_A, `http://localhost:${port}/secret`)).rejects.toThrow(/private|local/i);
            await expect(fetchAs(CID_A, `http://127.0.0.1:${port}/secret`)).rejects.toThrow(/private|reserved/i);
            await expect(fetchAs(CID_A, `http://printer.local/`)).rejects.toThrow(/private|local|internal/i);
            expect(hits).toEqual([]);
            await settle();
            expect(audits(CID_A).map((row) => row.meta.reason)).toEqual(['private_host', 'private_host', 'private_host']);
        });

        it('only http and https leave the box', async () => {
            seedList(CID_A, ['api.public.test']);
            await expect(fetchAs(CID_A, 'ftp://api.public.test/x')).rejects.toThrow(/http/);
            await settle();
            expect(audits(CID_A)).toEqual([]);
        });

        it('refuses a redirect from a listed host to an unlisted one at the hop', async () => {
            seedList(CID_A, ['api.public.test']);
            await expect(fetchAs(CID_A, `http://api.public.test:${port}/to-other`)).rejects.toThrow(/other\.public\.test.*allow/i);
            expect(hits).toEqual([`api.public.test:${port}/to-other`]);
            await settle();
            expect(audits(CID_A)).toHaveLength(1);
            expect(audits(CID_A)[0].meta).toMatchObject({ reason: 'unlisted', host: 'other.public.test', hop: 1 });
        });

        it('follows a redirect that stays on a listed host and caps a loop', async () => {
            seedList(CID_A, ['api.public.test']);
            const page = await fetchAs(CID_A, `http://api.public.test:${port}/to-self`);
            expect(page.status).toBe(200);
            expect(page.body).toContain('page');
            await expect(fetchAs(CID_A, `http://api.public.test:${port}/loop/0`)).rejects.toThrow(/redirect/i);
            expect(hits.length).toBeLessThanOrEqual(2 + 6);
        });

        it('refuses a listed host that resolves to a private address and audits it', async () => {
            seedList(CID_A, ['internal.example.com']);
            const lookup = jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '10.0.0.7', family: 4 }]);
            try {
                await expect(inContext(CID_A, () => safeFetch('https://internal.example.com/x', { timeoutMs: 3000 }))).rejects.toThrow(/private|reserved/i);
                expect(lookup).toHaveBeenCalledWith('internal.example.com', expect.objectContaining({ all: true }));
            } finally {
                lookup.mockRestore();
            }
            expect(hits).toEqual([]);
            await settle();
            expect(audits(CID_A)).toHaveLength(1);
            expect(audits(CID_A)[0].meta).toMatchObject({ reason: 'private_address', host: 'internal.example.com' });
        });

        it.each([
            ['the lookup fails', () => Promise.reject(Object.assign(new Error('getaddrinfo ENOTFOUND private-registry.example.com'), { code: 'ENOTFOUND' }))],
            ['the lookup answers nothing', () => Promise.resolve([])],
        ])('a DNS failure for a listed host is not a refusal when %s: no audit row, nothing counted', async (_, answer) => {
            seedList(CID_A, ['private-registry.example.com']);
            const lookup = jest.spyOn(dns.promises, 'lookup').mockImplementation(answer);
            try {
                await expect(inContext(CID_A, () => safeFetch('https://private-registry.example.com/v2/', { timeoutMs: 3000 }))).rejects.toMatchObject({ code: 'dns_failed', message: expect.stringMatching(/could not resolve private-registry\.example\.com/) });
            } finally {
                lookup.mockRestore();
            }
            await settle();
            expect(audits(CID_A)).toEqual([]);
            expect(await store.refusedSince(CID_A, new Date(Date.now() - 60000))).toBe(0);
        });

        it('decides the refusal on the error code, never on its text', async () => {
            seedList(CID_A, ['api.public.test']);
            const failing = (error) => () => Promise.reject(error);
            await expect(fetchAs(CID_A, `http://api.public.test:${port}/page`, { resolve: failing(new Error('the private reserved resolver is down')) })).rejects.toThrow(/resolver is down/);
            await settle();
            expect(audits(CID_A)).toEqual([]);
            await expect(fetchAs(CID_A, `http://api.public.test:${port}/page`, { resolve: failing(Object.assign(new Error('no'), { code: 'private_address' })) })).rejects.toThrow('no');
            await settle();
            expect(audits(CID_A).map((row) => row.meta.reason)).toEqual(['private_address']);
        });

        it('applies the list of the workspace in context and never another workspace\'s', async () => {
            seedList(CID_A, ['docs.example.com']);
            seedList(CID_B, ['api.public.test']);
            await expect(fetchAs(CID_A, `http://api.public.test:${port}/page`)).rejects.toThrow(/allow/i);
            expect((await fetchAs(CID_B, `http://api.public.test:${port}/page`)).status).toBe(200);
            expect((await inContext('6f00000000000000000000c1', () => safeFetch(`http://api.public.test:${port}/page`, opts()))).status).toBe(200);
            await settle();
            expect(audits(CID_A)).toHaveLength(1);
            expect(audits(CID_B)).toEqual([]);
        });

        it('takes the workspace from the options over the context, and stays out of a fetch with neither', async () => {
            seedList(CID_A, ['docs.example.com']);
            seedList(CID_B, ['api.public.test']);
            expect((await inContext(CID_A, () => safeFetch(`http://api.public.test:${port}/page`, opts({ companyId: CID_B, actor: ACTOR })))).status).toBe(200);
            expect((await safeFetch(`http://api.public.test:${port}/page`, opts())).status).toBe(200);
            expect(listReads(CID_A)).toBe(0);
        });

        it('refuses when the list cannot be read rather than fetching blind', async () => {
            const db = mockDbFor(CID_A);
            db.crud.mockImplementationOnce(async () => { throw new Error('mongo down'); });
            await expect(fetchAs(CID_A, `http://api.public.test:${port}/page`)).rejects.toThrow(/allowlist.*read|could not read/i);
            expect(hits).toEqual([]);
        });

        const failNextListRead = (companyId) => {
            store.invalidate(companyId);
            mockDbFor(companyId).crud.mockImplementationOnce(async () => { throw new Error('mongo down'); });
        };

        it('an unreadable list still refuses a workspace whose last known list had hosts', async () => {
            seedList(CID_A, ['api.public.test']);
            expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
            failNextListRead(CID_A);
            await expect(fetchAs(CID_A, `http://api.public.test:${port}/page`)).rejects.toThrow(/allowlist.*read/i);
            expect(hits).toHaveLength(1);
        });

        it('an unreadable list keeps today\'s behaviour for a workspace last known to have none, and is read again next time', async () => {
            expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
            expect(listReads(CID_A)).toBe(1);
            failNextListRead(CID_A);
            expect((await fetchAs(CID_A, `http://other.public.test:${port}/page`)).status).toBe(200);
            await expect(fetchAs(CID_A, `http://127.0.0.1:${port}/secret`)).rejects.toThrow(/private|reserved/i);
            expect(listReads(CID_A)).toBe(2);
            expect(hits).toHaveLength(2);
        });

        it('a write is the last known state: a first host closes the workspace, removing the last one reopens it', async () => {
            expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
            await store.replaceHosts(CID_A, ['docs.example.com'], ACTOR);
            failNextListRead(CID_A);
            await expect(fetchAs(CID_A, `http://api.public.test:${port}/page`)).rejects.toThrow(/allowlist.*read/i);
            await store.replaceHosts(CID_A, [], ACTOR);
            failNextListRead(CID_A);
            expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
        });

        describe('the last known emptiness, on a clock', () => {
            let clock;
            let wallShift;
            let now;
            let mono;
            const WINDOW_MS = store.CACHE_TTL_SECONDS * 1000;
            const failNextRead = () => mockDbFor(CID_A).crud.mockImplementationOnce(async () => { throw new Error('mongo down'); });

            // `clock` is time that passes; `wallShift` is the system clock being set, which must not move the window.
            beforeEach(() => {
                clock = 0;
                wallShift = 0;
                const wallStart = Date.now();
                const monoStart = performance.now();
                now = jest.spyOn(Date, 'now').mockImplementation(() => wallStart + clock + wallShift);
                mono = jest.spyOn(performance, 'now').mockImplementation(() => monoStart + clock);
            });
            afterEach(() => { now.mockRestore(); mono.mockRestore(); });

            it('a system clock set back does not stretch the window', async () => {
                expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
                clock += WINDOW_MS + 1000;
                wallShift = -60 * 60 * 1000;
                failNextListRead(CID_A);
                await expect(fetchAs(CID_A, `http://api.public.test:${port}/page`)).rejects.toThrow(/allowlist.*read/i);
            });

            it('a system clock set forward does not cut the window short', async () => {
                expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
                clock += 1000;
                wallShift = 60 * 60 * 1000;
                failNextListRead(CID_A);
                expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
            });

            it('lets a failed read fetch as without a list within one cache window of the empty read', async () => {
                expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
                clock += WINDOW_MS - 1000;
                failNextListRead(CID_A);
                expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
                expect(hits).toHaveLength(2);
            });

            it('refuses a failed read once the window since the empty read has passed, another server may have added hosts', async () => {
                expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
                clock += WINDOW_MS + 1000;
                failNextRead();
                await expect(fetchAs(CID_A, `http://api.public.test:${port}/page`)).rejects.toThrow(/allowlist.*read/i);
                expect(hits).toHaveLength(1);
            });

            it('a write that empties the list starts the window again, and it ends too', async () => {
                await store.replaceHosts(CID_A, [], ACTOR);
                clock += WINDOW_MS - 1000;
                failNextListRead(CID_A);
                expect((await fetchAs(CID_A, `http://api.public.test:${port}/page`)).status).toBe(200);
                clock += 2000;
                failNextListRead(CID_A);
                await expect(fetchAs(CID_A, `http://api.public.test:${port}/page`)).rejects.toThrow(/allowlist.*read/i);
            });
        });

        it('counts the list read against the fetch deadline', async () => {
            mockDbFor(CID_A).crud.mockImplementationOnce(() => new Promise((resolve) => { setTimeout(() => resolve(null), 700); }));
            const started = Date.now();
            await expect(fetchAs(CID_A, `http://api.public.test:${port}/page`, { timeoutMs: 200 })).rejects.toThrow(/time budget/);
            expect(Date.now() - started).toBeLessThan(600);
            expect(hits).toEqual([]);
            await new Promise((resolve) => { setTimeout(resolve, 600); });
        });
    });
});

describe('resolvePublic', () => {
    const resolving = async (answers, url = 'https://name.example.com/') => {
        const lookup = jest.spyOn(dns.promises, 'lookup').mockImplementation(answers);
        try { return await resolvePublic(url).then(() => null, (error) => error); } finally { lookup.mockRestore(); }
    };

    it('types its errors, so a caller never has to read the message', async () => {
        expect(await resolving(() => Promise.reject(Object.assign(new Error('x'), { code: 'EAI_AGAIN' })))).toMatchObject({ code: 'dns_failed', message: expect.stringContaining('EAI_AGAIN') });
        expect(await resolving(() => Promise.resolve([]))).toMatchObject({ code: 'dns_failed' });
        expect(await resolving(() => Promise.resolve([{ address: '10.0.0.7', family: 4 }]))).toMatchObject({ code: 'private_address', message: expect.stringContaining('10.0.0.7') });
        expect(await resolving(() => Promise.resolve([]), 'http://localhost/')).toMatchObject({ code: 'private_host' });
    });
});

describe('IPv6 transition addresses', () => {
    const CARRYING_PRIVATE = ['64:ff9b::a00:1', '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b::a9fe:a9fe', '2002:a00:1::1', '2002:7f00:1::', '2002:c0a8:101::5', '::a00:1', '::10.0.0.1', '::169.254.169.254'];
    const CARRYING_PUBLIC = ['64:ff9b::808:808', '2002:808:808::1', '::8.8.8.8'];

    it.each(CARRYING_PRIVATE)('with the flag off %s is private too: the IPv4 address it carries is', (ip) => {
        expect(isPrivateAddress(ip)).toBe(true);
        expect(isBlockedHostname(`[${ip}]`)).toBe(true);
    });

    describe('with the flag on', () => {
        beforeEach(() => { process.env[ENV_KEY] = 'true'; });

        it.each(CARRYING_PRIVATE)('%s is private: the IPv4 address it carries is', (ip) => {
            expect(isPrivateAddress(ip)).toBe(true);
            expect(isBlockedHostname(`[${ip}]`)).toBe(true);
        });

        it.each(CARRYING_PUBLIC)('%s stays public, so a DNS64 network still reaches IPv4 sites', (ip) => {
            expect(isPrivateAddress(ip)).toBe(false);
        });

        it('leaves every other answer as it was', () => {
            expect(['::', '::1', '::ffff:10.0.0.1', 'fc00::1', 'fe80::1', 'ff02::1', '10.0.0.1'].map(isPrivateAddress)).toEqual([true, true, true, true, true, true, true]);
            expect(['2606:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '8.8.8.8'].map(isPrivateAddress)).toEqual([false, false, false, false]);
        });

        it('refuses and audits a listed name that resolves to one', async () => {
            seedList(CID_A, ['nat64.example.com']);
            const lookup = jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '64:ff9b::a9fe:a9fe', family: 6 }]);
            try {
                await expect(egressContext.run({ companyId: CID_A, actor: ACTOR }, () => safeFetch('http://nat64.example.com/', { timeoutMs: 1000 }))).rejects.toMatchObject({ code: 'private_address' });
            } finally {
                lookup.mockRestore();
            }
            await settle();
            expect(audits(CID_A).map((row) => row.meta)).toEqual([expect.objectContaining({ reason: 'private_address', host: 'nat64.example.com' })]);
        });
    });
});

describe('the agent-facing fetch', () => {
    const PAGE = { status: 200, html: '<html></html>', bytes: 13 };
    const URL_WITH_SECRET = `https://docs.example.com/pricing?token=${SECRET}`;
    beforeEach(() => {
        pageAudit.fetchPage.mockResolvedValue(PAGE);
        pageAudit.audit.mockResolvedValue({ ok: true, facts: [] });
    });

    it('with the flag off reads with or without a workspace, as before', async () => {
        expect(await agentFetch.fetchPage(URL_WITH_SECRET)).toBe(PAGE);
        expect(await agentFetch.audit(URL_WITH_SECRET)).toEqual({ ok: true, facts: [] });
        expect(logger.error).not.toHaveBeenCalled();
    });

    describe('with the flag on', () => {
        beforeEach(() => { process.env[ENV_KEY] = 'true'; });

        it.each([
            ['no egress context', (fn) => fn()],
            ['a context with no company id', (fn) => egressContext.run({ actor: ACTOR }, fn)],
        ])('refuses a read with %s before anything is fetched, and logs the host only', async (_, within) => {
            await expect(within(() => agentFetch.fetchPage(URL_WITH_SECRET))).rejects.toMatchObject({ code: 'no_workspace', message: expect.stringMatching(/workspace/i) });
            await expect(within(() => agentFetch.audit(URL_WITH_SECRET))).rejects.toMatchObject({ code: 'no_workspace' });
            expect(pageAudit.fetchPage).not.toHaveBeenCalled();
            expect(pageAudit.audit).not.toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalledTimes(2);
            expect(logger.error.mock.calls[0][0]).toContain('docs.example.com');
            expect(JSON.stringify(logger.error.mock.calls)).not.toContain(SECRET);
            expect(JSON.stringify(logger.error.mock.calls)).not.toContain('/pricing');
        });

        it('reads inside a workspace context', async () => {
            const within = (fn) => egressContext.run({ companyId: CID_A, actor: ACTOR }, fn);
            expect(await within(() => agentFetch.fetchPage(URL_WITH_SECRET))).toBe(PAGE);
            expect(await within(() => agentFetch.audit(URL_WITH_SECRET))).toEqual({ ok: true, facts: [] });
            expect(pageAudit.fetchPage).toHaveBeenCalledWith(URL_WITH_SECRET);
        });
    });
});

describe('the store', () => {
    beforeEach(() => { process.env[ENV_KEY] = 'true'; });

    it('reads a workspace list once per cache window and again after a write', async () => {
        seedList(CID_A, ['a.example.com']);
        expect(await store.hostsFor(CID_A)).toEqual(['a.example.com']);
        expect(await store.hostsFor(CID_A)).toEqual(['a.example.com']);
        expect(listReads(CID_A)).toBe(1);
        expect(store.CACHE_TTL_SECONDS).toBe(30);
        expect(myCache.getTtl(`egressAllowlist:${CID_A}`)).toBeGreaterThan(Date.now() + 25000);

        const saved = await store.replaceHosts(CID_A, ['b.example.com'], ACTOR);
        expect(saved).toMatchObject({ hosts: ['b.example.com'], updatedBy: ACTOR });
        expect(saved.updatedAt).toBeInstanceOf(Date);
        expect(listOf(CID_A)).toMatchObject({ _id: store.DOC_ID, hosts: ['b.example.com'], updatedBy: ACTOR });
        expect(await store.hostsFor(CID_A)).toEqual(['b.example.com']);
        expect(listReads(CID_A)).toBe(2);
    });

    it('caches an empty list too, and per workspace', async () => {
        seedList(CID_B, ['b.example.com']);
        expect(await store.hostsFor(CID_A)).toEqual([]);
        expect(await store.hostsFor(CID_A)).toEqual([]);
        expect(listReads(CID_A)).toBe(1);
        expect(await store.hostsFor(CID_B)).toEqual(['b.example.com']);
        store.invalidate(CID_B);
        expect(await store.hostsFor(CID_B)).toEqual(['b.example.com']);
        expect(listReads(CID_B)).toBe(2);
    });

    it('a first save on version 0 creates the list and answers with version 1', async () => {
        const saved = await store.replaceHosts(CID_A, ['a.example.com'], ACTOR, 0);
        expect(saved).toMatchObject({ hosts: ['a.example.com'], updatedBy: ACTOR, version: 1 });
        expect(listOf(CID_A)).toMatchObject({ _id: store.DOC_ID, hosts: ['a.example.com'], version: 1 });
    });

    it('a save on the version it read answers with the next version', async () => {
        mockDbFor(CID_A).seed(store.COLLECTION, { _id: store.DOC_ID, hosts: ['a.example.com'], version: 3 });
        expect(await store.replaceHosts(CID_A, ['b.example.com'], ACTOR, 3)).toMatchObject({ hosts: ['b.example.com'], version: 4 });
    });

    it('a first save on version 0 that loses the race to another first save answers null and changes nothing', async () => {
        mockDbFor(CID_A).seed(store.COLLECTION, { _id: store.DOC_ID, hosts: ['other.example.com'], version: 1 });
        expect(await store.replaceHosts(CID_A, ['mine.example.com'], ACTOR, 0)).toBeNull();
        expect(mockDbFor(CID_A).store[store.COLLECTION]).toEqual([expect.objectContaining({ hosts: ['other.example.com'], version: 1 })]);
    });

    it('a save on a stale version answers null and changes nothing', async () => {
        mockDbFor(CID_A).seed(store.COLLECTION, { _id: store.DOC_ID, hosts: ['other.example.com'], version: 2 });
        expect(await store.replaceHosts(CID_A, ['mine.example.com'], ACTOR, 1)).toBeNull();
        expect(listOf(CID_A)).toMatchObject({ hosts: ['other.example.com'], version: 2 });
    });

    it('keeps one document per workspace', async () => {
        await store.replaceHosts(CID_A, ['a.example.com'], ACTOR);
        await store.replaceHosts(CID_A, ['b.example.com', 'c.example.com'], ACTOR);
        expect(mockDbFor(CID_A).store[store.COLLECTION]).toHaveLength(1);
        expect(listOf(CID_A).hosts).toEqual(['b.example.com', 'c.example.com']);
    });

    it('counts the refusals of the last window from the audit log', async () => {
        const day = 24 * 60 * 60 * 1000;
        const db = mockDbFor(CID_A);
        db.seed('audit_logs', { action: store.REFUSED_ACTION, createdAt: new Date(Date.now() - 2 * day) });
        db.seed('audit_logs', { action: store.REFUSED_ACTION, createdAt: new Date(Date.now() - 6 * day) });
        db.seed('audit_logs', { action: store.REFUSED_ACTION, createdAt: new Date(Date.now() - 8 * day) });
        db.seed('audit_logs', { action: 'agent.action', createdAt: new Date() });
        expect(await store.refusedSince(CID_A, new Date(Date.now() - 7 * day))).toBe(2);
    });
});

describe('the orchestrator', () => {
    const task = { _id: 't1', TaskName: 'Review https://example.com/pricing', ProjectID: 'p1' };

    it('runs a skill\'s gather inside the workspace egress context', async () => {
        let seen = null;
        skillRecord.getSkill.mockResolvedValue({ slug: 'pr.summary', kind: 'generic', gather: async () => { seen = egressContext.get(); return { url: 'x' }; } });
        const out = await orchestrator.gather({ skillSlug: 'pr.summary', task, companyId: CID_A, startedBy: ACTOR });
        expect(out.status).toBe(orchestrator.GATHERED);
        expect(seen).toEqual({ companyId: CID_A, actor: ACTOR });
        expect(egressContext.get()).toBeNull();
    });

    it('runs the page audit inside the workspace egress context', async () => {
        let seen = null;
        skillRecord.getSkill.mockResolvedValue({ slug: 'qa-review', kind: 'audit', maxFindings: 5, buildUserPrompt: () => '' });
        pageAudit.audit.mockImplementation(async () => { seen = egressContext.get(); return { ok: false, fatal: 'stop here', facts: [] }; });
        const out = await orchestrator.analyse({ skillSlug: 'qa-review', task, context: { url: 'https://example.com/pricing' }, spend: { companyId: CID_A, userId: ACTOR }, companyId: CID_A });
        expect(out.status).toBe('failed');
        expect(seen).toEqual({ companyId: CID_A, actor: ACTOR });
    });
});
