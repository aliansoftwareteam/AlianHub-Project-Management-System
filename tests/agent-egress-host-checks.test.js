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

const http = require('http');
const dns = require('dns');
const { myCache } = require('../Config/config');
const rules = require('../Modules/Agents/engine/egressRules');
const egressContext = require('../Modules/Agents/engine/egressContext');
const store = require('../Modules/Agents/engine/egressAllowlist');
const { safeFetch, resolvePublic, isBlockedHostname, isPrivateAddress } = require('../Modules/Agents/engine/safeFetch');

const ENV_KEY = 'AGENT_EGRESS_ALLOWLIST';
const CID = '6f00000000000000000000a1';
const ACTOR = '6f0000000000000000000011';

const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const audits = () => (mockDbFor(CID).store.audit_logs || []).filter((row) => row.action === store.REFUSED_ACTION);
const seedList = (hosts) => mockDbFor(CID).seed(store.COLLECTION, { _id: store.DOC_ID, hosts, updatedBy: ACTOR, updatedAt: new Date() });

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    delete process.env[ENV_KEY];
    myCache.flushAll();
    jest.clearAllMocks();
});

afterAll(() => { delete process.env[ENV_KEY]; });

const FLAG_STATES = [['off', ''], ['on', 'true']];

/* IANA IPv4 and IPv6 special-purpose registries: every block that is not globally reachable. */
const PRIVATE_V4 = [
    ['0.0.0.0/8', '0.1.2.3'], ['10.0.0.0/8', '10.20.30.40'], ['100.64.0.0/10 (CGNAT)', '100.64.0.1'], ['100.64.0.0/10 (CGNAT)', '100.127.255.254'],
    ['127.0.0.0/8', '127.0.0.2'], ['169.254.0.0/16', '169.254.169.254'], ['172.16.0.0/12', '172.31.255.1'],
    ['192.0.0.0/24', '192.0.0.8'], ['192.0.0.0/24', '192.0.0.170'], ['192.0.2.0/24 (TEST-NET-1)', '192.0.2.1'],
    ['192.88.99.0/24 (6to4 relay)', '192.88.99.1'], ['192.168.0.0/16', '192.168.1.1'],
    ['198.18.0.0/15 (benchmarking)', '198.18.0.1'], ['198.18.0.0/15 (benchmarking)', '198.19.255.254'],
    ['198.51.100.0/24 (TEST-NET-2)', '198.51.100.7'], ['203.0.113.0/24 (TEST-NET-3)', '203.0.113.9'],
    ['224.0.0.0/4 (multicast)', '224.0.0.1'], ['224.0.0.0/4 (multicast)', '239.255.255.250'],
    ['240.0.0.0/4', '240.0.0.1'], ['255.255.255.255/32', '255.255.255.255'],
];

const PUBLIC_V4 = ['8.8.8.8', '1.1.1.1', '100.63.255.255', '100.128.0.1', '192.0.1.1', '192.0.3.1', '192.88.98.1', '198.17.255.255', '198.20.0.1', '198.51.99.1', '203.0.112.1', '223.255.255.255'];

const PRIVATE_V6 = [
    ['::/128', '::'], ['::1/128', '::1'],
    ['::ffff:0:0/96 (IPv4-mapped)', '::ffff:10.0.0.1'], ['::ffff:0:0/96 (IPv4-mapped)', '::ffff:7f00:1'],
    ['::ffff:0:0:0/96 (IPv4-translated)', '::ffff:0:a00:1'], ['::ffff:0:0:0/96 (IPv4-translated)', '::ffff:0:10.0.0.1'], ['::ffff:0:0:0/96 (IPv4-translated)', '::ffff:0:a9fe:a9fe'],
    ['::/96 (IPv4-compatible)', '::a00:1'], ['::/96 (IPv4-compatible)', '::127.0.0.1'],
    ['64:ff9b::/96 (NAT64)', '64:ff9b::a00:1'], ['64:ff9b::/96 (NAT64)', '64:ff9b::169.254.169.254'],
    ['64:ff9b:1::/48 (local-use NAT64)', '64:ff9b:1::1'], ['64:ff9b:1::/48 (local-use NAT64)', '64:ff9b:1:ffff::808:808'],
    ['100::/64 (discard-only)', '100::1'],
    ['2001::/32 (Teredo, private client)', '2001:0:4136:e378:8000:63bf:f5ff:fffe'],
    ['2001::/32 (Teredo, private server)', '2001:0:a00:1:8000:63bf:f7f7:f7f7'],
    ['2001:2::/48 (benchmarking)', '2001:2::1'],
    ['2001:db8::/32 (documentation)', '2001:db8::1'], ['2001:db8::/32 (documentation)', '2001:db8:ffff::1'],
    ['2002::/16 (6to4)', '2002:a00:1::1'], ['2002::/16 (6to4)', '2002:c0a8:101::5'],
    ['3fff::/20 (documentation)', '3fff::1'], ['3fff::/20 (documentation)', '3fff:fff::1'],
    ['5f00::/16 (SRv6 SIDs)', '5f00::1'],
    ['fc00::/7 (unique local)', 'fc00::1'], ['fc00::/7 (unique local)', 'fd12:3456::1'],
    ['fe80::/10 (link-local)', 'fe80::1'], ['fe80::/10 (link-local)', 'febf::1'], ['fe80::/10 (link-local)', 'fe80::1%eth0'],
    ['fec0::/10 (site-local)', 'fec0::1'], ['fec0::/10 (site-local)', 'feff::1'],
    ['ff00::/8 (multicast)', 'ff02::1'],
];

const PUBLIC_V6 = [
    '2606:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '::ffff:0:808:808', '::8.8.8.8', '64:ff9b::808:808', '64:ff9b:2::1',
    '2002:808:808::1', '2001:0:4136:e378:8000:63bf:f7f7:f7f7', '2001:db9::1', '3fff:1000::1', '5f01::1', 'fbff::1',
];

describe.each(FLAG_STATES)('the private-address check with the flag %s', (_, flag) => {
    beforeEach(() => { process.env[ENV_KEY] = flag; });

    it.each(PRIVATE_V4)('%s: %s is private', (_range, ip) => {
        expect(isPrivateAddress(ip)).toBe(true);
        expect(isBlockedHostname(ip)).toBe(true);
    });

    it.each(PUBLIC_V4)('%s stays public', (ip) => {
        expect(isPrivateAddress(ip)).toBe(false);
        expect(isBlockedHostname(ip)).toBe(false);
    });

    it.each(PRIVATE_V6)('%s: %s is private, bare and bracketed', (_range, ip) => {
        expect(isPrivateAddress(ip)).toBe(true);
        expect(isBlockedHostname(`[${ip}]`)).toBe(true);
    });

    it.each(PUBLIC_V6)('%s stays public', (ip) => {
        expect(isPrivateAddress(ip)).toBe(false);
        expect(isBlockedHostname(`[${ip}]`)).toBe(false);
    });

    it.each(PRIVATE_V4.map(([, ip]) => ip))('refuses a name that resolves to %s after resolution', async (ip) => {
        const lookup = jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: ip, family: 4 }]);
        try {
            await expect(resolvePublic('https://name.example.com/')).rejects.toMatchObject({ code: 'private_address' });
        } finally {
            lookup.mockRestore();
        }
    });

    it.each(PRIVATE_V6.map(([, ip]) => ip).filter((ip) => !ip.includes('%')))('refuses a name that resolves to %s after resolution', async (ip) => {
        const lookup = jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: ip, family: 6 }]);
        try {
            await expect(resolvePublic('https://name.example.com/')).rejects.toMatchObject({ code: 'private_address' });
        } finally {
            lookup.mockRestore();
        }
    });
});

const BLOCKED_NAMES = [
    'localhost.', 'LOCALHOST.', 'localhost..', 'api.localhost.', 'printer.local.', 'Printer.LOCAL.', 'vault.internal.', 'vault.internal..',
    '127.0.0.1.', '2130706433.', '0x7f.1.', '0x.0x.0x.0x', '0x.0x.0x.0x.', '0X7F.0.0.1', '1.2.3.4.5', 'foo.127', 'docs.0x10', '[::1].',
];

const PUBLIC_NAMES = ['example.com', 'example.com.', 'Docs.Example.COM.', '1password.com', '123.example.com', 'x0.example.com', '0x.example.com', 'local.example.com.'];

describe.each(FLAG_STATES)('the host name check with the flag %s', (_, flag) => {
    beforeEach(() => { process.env[ENV_KEY] = flag; });

    it.each(BLOCKED_NAMES)('%s is blocked before any lookup', async (host) => {
        expect(isBlockedHostname(host)).toBe(true);
    });

    it.each(PUBLIC_NAMES)('%s is not blocked by name', (host) => {
        expect(isBlockedHostname(host)).toBe(false);
    });

    it.each(['http://localhost./', 'http://LOCALHOST./', 'http://api.localhost./', 'http://vault.internal./', 'http://printer.local./'])('resolvePublic refuses %s by name, with no DNS lookup', async (url) => {
        const lookup = jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
        try {
            await expect(resolvePublic(url)).rejects.toMatchObject({ code: 'private_host' });
            expect(lookup).not.toHaveBeenCalled();
        } finally {
            lookup.mockRestore();
        }
    });
});

describe('allowlist entries that encode an address', () => {
    const ENCODED = ['0x.0x.0x.0x', '0x.1', '0x.0x.0x.0x.', '1.2.3.4.5', 'foo.127', 'docs.0x10', 'a.0x', '0x7f.1.', '2130706433.', '0177.0.0.1', '::ffff:0:a00:1', '[::ffff:10.0.0.1]', '64:ff9b::a00:1'];

    it.each(ENCODED)('refuses %s as an address, on the server', (raw) => {
        expect(rules.validateHosts([raw], { isBlockedHostname }).errors).toEqual([{ entry: raw, reason: rules.REASON.ADDRESS }]);
    });

    it.each(ENCODED)('refuses %s as an address, in the browser', (raw) => {
        expect(rules.validateHosts([raw]).errors).toEqual([{ entry: raw, reason: rules.REASON.ADDRESS }]);
    });

    it.each(['0x.example.com', '123.example.com', 'api.v2.example.com', 'x0.example.com'])('still accepts %s, which only starts with a number', (raw) => {
        expect(rules.validateHosts([raw], { isBlockedHostname })).toEqual({ hosts: [raw], errors: [] });
    });

    it('stores a trailing dot and upper case as the plain host', () => {
        expect(rules.validateHosts(['Docs.Example.COM.', '*.API.example.com.'], { isBlockedHostname })).toEqual({ hosts: ['docs.example.com', '*.api.example.com'], errors: [] });
    });

    it.each(['localhost.', 'printer.local.', 'vault.internal.', 'Vault.Internal.'])('refuses %s as private', (raw) => {
        expect(rules.validateHosts([raw], { isBlockedHostname }).errors).toEqual([{ entry: raw, reason: rules.REASON.PRIVATE }]);
    });
});

describe('allowlist matching ignores a trailing dot and case', () => {
    it.each([
        [['docs.example.com'], 'docs.example.com.', true],
        [['docs.example.com'], 'DOCS.Example.com.', true],
        [['docs.example.com.'], 'docs.example.com', true],
        [['*.example.com'], 'api.example.com.', true],
        [['*.example.com'], 'example.com.', false],
        [['docs.example.com'], 'docs.example.com.evil.test', false],
        [['docs.example.com:8443'], 'docs.example.com.', false],
    ])('%j admits %s: %s', (hosts, hostname, admitted) => {
        expect(rules.hostMatches(hosts, hostname, 443)).toBe(admitted);
    });
});

describe('the egress gateway with a trailing dot', () => {
    let server; let port; let hits;
    beforeAll(async () => {
        hits = [];
        server = http.createServer((req, res) => { hits.push(req.url); res.end('ok'); });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
    });
    afterAll(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }));
    beforeEach(() => {
        hits.length = 0;
        process.env[ENV_KEY] = 'true';
    });

    const resolve = (url) => {
        const u = new URL(url);
        if (/\.public\.test\.?$/.test(u.hostname)) return Promise.resolve({ url: u, address: '127.0.0.1', family: 4 });
        return resolvePublic(url);
    };
    const fetchAs = (url) => egressContext.run({ companyId: CID, actor: ACTOR }, () => safeFetch(url, { resolve, timeoutMs: 3000 }));

    it('admits a listed host written with a trailing dot', async () => {
        seedList(['api.public.test']);
        expect((await fetchAs(`http://api.public.test.:${port}/page`)).status).toBe(200);
        expect(hits).toEqual(['/page']);
    });

    it('refuses an unlisted host with a trailing dot and audits it under its plain name', async () => {
        seedList(['api.public.test']);
        await expect(fetchAs(`http://other.public.test.:${port}/page`)).rejects.toThrow(/allowlist/);
        await settle();
        expect(audits().map((row) => row.meta)).toEqual([{ reason: 'unlisted', host: 'other.public.test', port, hop: 0 }]);
        expect(hits).toEqual([]);
    });

    it.each(['localhost', 'vault.internal'])('refuses %s. as a private host, listed or not', async (name) => {
        seedList(['api.public.test']);
        await expect(fetchAs(`http://${name}.:${port}/page`)).rejects.toThrow(/private, local or internal/);
        await settle();
        expect(audits().map((row) => row.meta)).toEqual([{ reason: 'private_host', host: name, port, hop: 0 }]);
        expect(hits).toEqual([]);
    });
});
