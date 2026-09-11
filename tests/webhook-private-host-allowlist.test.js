const http = require('http');
const dns = require('dns');

const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { parseAllowlist, compileAllowlist, isNeverAllowedAddress, webhookAllowlist, ALLOWLIST_ENV } = require('../Modules/Webhooks/helpers/privateHostAllowlist');
const { resolvePublic, safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { validateWebhookInput } = require('../Modules/Webhooks/helpers/webhookRules');
const { validateSettings, byKey } = require('../Modules/Instance/settingsCatalog');
const { deliverToHook } = require('../Modules/Webhooks/dispatcher');
const ctrl = require('../Modules/Webhooks/controller');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER = '300000000000000000000001';

const NEVER_ALLOWED = [
    '169.254.169.254', '169.254.170.2', '169.254.170.23', '169.254.0.23', '169.254.1.1', '100.100.100.200',
    'fd00:ec2::254', 'FD00:EC2:0::254', 'fd00:ec2::23', 'fd20:ce::254', 'fd00:c1::a9fe:a9fe', 'fe80::1', 'fe80::1%eth0',
    '::ffff:169.254.170.2', '::ffff:a9fe:aa02', '::ffff:100.100.100.200',
];

describe('parsing the private webhook host allowlist', () => {
    it('is empty by default', () => {
        expect(parseAllowlist('')).toEqual({ entries: [], invalid: [], refused: [] });
        expect(parseAllowlist(undefined)).toEqual({ entries: [], invalid: [], refused: [] });
        expect(compileAllowlist('').size).toBe(0);
    });

    it('accepts hostnames, addresses and CIDR ranges separated by commas, spaces or new lines', () => {
        const { entries, invalid, refused } = parseAllowlist('Hooks.LAN., 192.168.10.0/24\n10.1.2.3  fd12:3456::/32\n[fd00::7]');
        expect(invalid).toEqual([]);
        expect(refused).toEqual([]);
        expect(entries).toEqual([
            { kind: 'host', host: 'hooks.lan' },
            { kind: 'cidr', address: '192.168.10.0', prefix: 24, family: 4 },
            { kind: 'cidr', address: '10.1.2.3', prefix: 32, family: 4 },
            { kind: 'cidr', address: 'fd12:3456::', prefix: 32, family: 6 },
            { kind: 'cidr', address: 'fd00::7', prefix: 128, family: 6 },
        ]);
    });

    it('names the entries that are neither', () => {
        expect(parseAllowlist('ok.lan, *.lan, 10.0.0.0/33, fd00::/129, http://x.lan, a_b.lan, 1.2.3/8').invalid)
            .toEqual(['*.lan', '10.0.0.0/33', 'fd00::/129', 'http://x.lan', 'a_b.lan', '1.2.3/8']);
    });

    it('rejects numeric IPv4 spellings the URL parser rewrites, which could never match', () => {
        const spellings = ['0x7f000001', '0x7f.1', '127.0x0.1', '0177.0.0.1', '127.1', '2130706433', 'hooks.123'];
        expect(parseAllowlist(spellings.join(', ')).invalid).toEqual(spellings);
        expect(validateSettings({ [ALLOWLIST_ENV]: 'hooks.lan, 0x7f000001' }).errors).toEqual({ [ALLOWLIST_ENV]: 'allowlist' });
    });

    it('reads an IPv4-mapped IPv6 entry as the IPv4 range it names', () => {
        expect(parseAllowlist('::ffff:192.168.10.0/120').entries).toEqual([{ kind: 'cidr', address: '192.168.10.0', prefix: 24, family: 4 }]);
    });
});

describe('an entry too broad to allow', () => {
    it('is refused below /8 for IPv4 and /32 for IPv6', () => {
        const broad = ['0.0.0.0/0', '10.0.0.5/0', '8.0.0.0/7', '::/0', 'fd00::/31', '::ffff:0:0/96'];
        expect(parseAllowlist(broad.join(', ')).refused).toEqual(broad.map((entry) => ({ entry, reason: 'broad' })));
        expect(parseAllowlist('10.0.0.0/8, fd12:3456::/32').refused).toEqual([]);
    });

    it('is refused when it swallows 0.0.0.0/8, 127.0.0.0/8 or :: without being exactly that block', () => {
        expect(parseAllowlist('::/32, ::/127, 0:0:0:0:0:fffe::/95').refused.map((r) => r.reason)).toEqual(['broad', 'broad', 'broad']);
        const { entries, refused } = parseAllowlist('127.0.0.0/8, 0.0.0.0/8, 127.0.0.1, ::, ::1, ::ffff:127.0.0.0/104');
        expect(refused).toEqual([]);
        expect(entries[entries.length - 1]).toEqual({ kind: 'cidr', address: '127.0.0.0', prefix: 8, family: 4 });
    });

    it('fails the setting with its own error and opens nothing when it arrives unvalidated', () => {
        expect(validateSettings({ [ALLOWLIST_ENV]: 'hooks.lan\n10.0.0.5/0' }).errors).toEqual({ [ALLOWLIST_ENV]: 'allowlist_broad' });
        const list = compileAllowlist('0.0.0.0/0, ::/0, 10.0.0.5/0');
        ['127.0.0.1', '10.9.9.9', '192.168.1.1', '::1', 'fd12::1'].forEach((ip) => expect([ip, list.allowsHost(ip)]).toEqual([ip, false]));
    });
});

describe('addresses no entry can open', () => {
    it('cover link-local and the AWS, GCP, Alibaba, Tencent and Oracle metadata and credential endpoints, in any spelling', () => {
        NEVER_ALLOWED.forEach((ip) => expect([ip, isNeverAllowedAddress(ip)]).toEqual([ip, true]));
        ['100.100.100.201', '10.0.0.1', '169.255.0.1', 'fd00:ec2:0:1::254', 'fd20:ce::253', 'fd12::1', 'hooks.lan']
            .forEach((ip) => expect([ip, isNeverAllowedAddress(ip)]).toEqual([ip, false]));
    });

    it('refuse an entry that is or overlaps one of them, with their own error', () => {
        const overlapping = ['169.254.169.254', '169.254.0.0/16', '169.0.0.0/8', '169.254.170.2', '100.64.0.0/10', '100.100.100.200',
            'fe80::/10', 'fe80::1', 'fd00:c1::/32', 'fd00:ec2::/32', 'fd20:ce::254', 'fd00:c1::a9fe:a9fe', '::ffff:169.254.0.0/112'];
        expect(parseAllowlist(overlapping.join(', ')).refused).toEqual(overlapping.map((entry) => ({ entry, reason: 'reserved' })));
        expect(validateSettings({ [ALLOWLIST_ENV]: 'hooks.lan\n169.254.0.0/16' }).errors).toEqual({ [ALLOWLIST_ENV]: 'allowlist_reserved' });
        expect(parseAllowlist('100.64.0.0/11, fd00:ec3::/32, fd20:cf::/32').refused).toEqual([]);
    });

    it('stay closed when a broad range arrives unvalidated, and whatever a listed hostname resolves to', () => {
        const list = compileAllowlist('169.254.0.0/16, 100.64.0.0/10, fd00::/16, fe80::/10, metadata.google.internal, 100.64.0.0/11');
        NEVER_ALLOWED.forEach((ip) => {
            expect([ip, list.allowsHost(ip)]).toEqual([ip, false]);
            expect([ip, list.allowsAddress('metadata.google.internal', ip)]).toEqual([ip, false]);
        });
        expect(list.allowsHost('100.64.0.9')).toBe(true);
        expect(list.allowsHost('100.96.0.9')).toBe(false);
    });
});

describe('matching a destination against the allowlist', () => {
    const list = compileAllowlist('hooks.lan, jenkins.internal, 192.168.10.0/24, fd12:3456::/32, 169.254.169.254, 169.254.0.0/16, fd00:ec2::254, metadata.google.internal');

    it('matches a hostname exactly, never a subdomain or parent', () => {
        expect(list.allowsHost('hooks.lan')).toBe(true);
        expect(list.allowsHost('HOOKS.lan.')).toBe(true);
        expect(list.allowsHost('jenkins.internal')).toBe(true);
        expect(list.allowsHost('evil.hooks.lan')).toBe(false);
        expect(list.allowsHost('lan')).toBe(false);
        expect(list.allowsAddress('hooks.lan', '10.9.9.9')).toBe(true);
        expect(list.allowsAddress('other.lan', '10.9.9.9')).toBe(false);
    });

    it('matches IPv4 ranges, including an IPv4-mapped IPv6 answer', () => {
        expect(list.allowsHost('192.168.10.44')).toBe(true);
        expect(list.allowsHost('192.168.11.44')).toBe(false);
        expect(list.allowsHost('[::ffff:c0a8:a2c]')).toBe(true);
        expect(list.allowsAddress('printer.example.com', '192.168.10.9')).toBe(true);
        expect(list.allowsAddress('printer.example.com', '::ffff:192.168.10.9')).toBe(true);
        expect(list.allowsAddress('printer.example.com', '10.0.0.1')).toBe(false);
    });

    it('matches IPv6 ranges', () => {
        expect(list.allowsHost('[fd12:3456:1::9]')).toBe(true);
        expect(list.allowsAddress('nas.example.com', 'fd12:3456:ffff::1')).toBe(true);
        expect(list.allowsAddress('nas.example.com', 'fd12:3457::1')).toBe(false);
    });

    it('drops the metadata and link-local entries and never allows those addresses', () => {
        expect(list.refused).toEqual([
            { entry: '169.254.169.254', reason: 'reserved' },
            { entry: '169.254.0.0/16', reason: 'reserved' },
            { entry: 'fd00:ec2::254', reason: 'reserved' },
        ]);
        expect(list.allowsHost('169.254.169.254')).toBe(false);
        expect(list.allowsHost('[fd00:ec2::254]')).toBe(false);
        expect(list.allowsHost('169.254.1.1')).toBe(false);
        expect(list.allowsAddress('metadata.google.internal', '169.254.169.254')).toBe(false);
        expect(list.allowsAddress('hooks.lan', 'fd00:ec2::254')).toBe(false);
    });

    it('reads the live setting each time it is asked', () => {
        const before = process.env[ALLOWLIST_ENV];
        try {
            process.env[ALLOWLIST_ENV] = 'hooks.lan';
            expect(webhookAllowlist().allowsHost('hooks.lan')).toBe(true);
            delete process.env[ALLOWLIST_ENV];
            expect(webhookAllowlist().allowsHost('hooks.lan')).toBe(false);
        } finally {
            if (before === undefined) delete process.env[ALLOWLIST_ENV]; else process.env[ALLOWLIST_ENV] = before;
        }
    });
});

describe('resolving with an allowlist', () => {
    let lookup;
    beforeEach(() => { lookup = jest.spyOn(dns.promises, 'lookup'); });
    afterEach(() => lookup.mockRestore());

    it('without one, private hosts stay refused', async () => {
        lookup.mockResolvedValue([{ address: '192.168.10.5', family: 4 }]);
        await expect(resolvePublic('http://hooks.lan/x')).rejects.toThrow(/private|reserved/i);
        await expect(resolvePublic('http://192.168.10.5/x', { allowlist: compileAllowlist('') })).rejects.toThrow(/private/i);
    });

    it('lets a listed hostname through and pins the address it resolved to', async () => {
        lookup.mockResolvedValue([{ address: '192.168.10.5', family: 4 }]);
        await expect(resolvePublic('http://hooks.lan:8080/x', { allowlist: compileAllowlist('hooks.lan') }))
            .resolves.toMatchObject({ address: '192.168.10.5', family: 4 });
    });

    it('lets an address inside a listed range through, but not one outside it', async () => {
        const allowlist = compileAllowlist('192.168.10.0/24');
        await expect(resolvePublic('http://192.168.10.5/x', { allowlist })).resolves.toMatchObject({ address: '192.168.10.5' });
        await expect(resolvePublic('http://192.168.11.5/x', { allowlist })).rejects.toThrow(/private/i);
        lookup.mockResolvedValue([{ address: '192.168.10.7', family: 4 }, { address: '10.0.0.1', family: 4 }]);
        await expect(resolvePublic('http://split.example.com/x', { allowlist })).rejects.toThrow(/10\.0\.0\.1/);
    });

    it('keeps the metadata service blocked even when it is listed', async () => {
        const allowlist = compileAllowlist('169.254.169.254, 169.254.0.0/16, metadata.google.internal, fd00:ec2::254');
        await expect(resolvePublic('http://169.254.169.254/latest/meta-data', { allowlist })).rejects.toThrow(/private/i);
        await expect(resolvePublic('http://[fd00:ec2::254]/latest', { allowlist })).rejects.toThrow(/private/i);
        lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
        await expect(resolvePublic('http://metadata.google.internal/computeMetadata/v1', { allowlist })).rejects.toThrow(/169\.254\.169\.254/);
    });

    it('keeps credential endpoints inside a broad range blocked, by literal and by listed name', async () => {
        const allowlist = compileAllowlist('169.254.0.0/16, 100.64.0.0/10, hooks.lan');
        await expect(resolvePublic('http://169.254.170.2/v2/credentials/x', { allowlist })).rejects.toThrow(/private/i);
        await expect(resolvePublic('http://100.100.100.200/latest/meta-data/', { allowlist })).rejects.toThrow(/private/i);
        lookup.mockResolvedValue([{ address: 'fd20:ce::254', family: 6 }]);
        await expect(resolvePublic('http://hooks.lan/computeMetadata/v1', { allowlist })).rejects.toThrow(/fd20:ce::254/);
    });
});

describe('the instance setting', () => {
    it('is a security setting that validates its entries', () => {
        expect(byKey.get(ALLOWLIST_ENV)).toMatchObject({ group: 'security', type: 'list', default: '' });
        expect(validateSettings({ [ALLOWLIST_ENV]: ' hooks.lan\n192.168.10.0/24 ' })).toEqual({ values: { [ALLOWLIST_ENV]: 'hooks.lan\n192.168.10.0/24' }, errors: {}, valid: true });
        expect(validateSettings({ [ALLOWLIST_ENV]: 'hooks.lan, not a host!' }).errors).toEqual({ [ALLOWLIST_ENV]: 'allowlist' });
        expect(validateSettings({ [ALLOWLIST_ENV]: '' }).values).toEqual({ [ALLOWLIST_ENV]: '' });
    });

    it('reports the first rejected entry in the order the owner wrote them', () => {
        expect(validateSettings({ [ALLOWLIST_ENV]: '169.254.0.0/16, 0.0.0.0/0, *.lan' }).errors).toEqual({ [ALLOWLIST_ENV]: 'allowlist_reserved' });
        expect(validateSettings({ [ALLOWLIST_ENV]: '*.lan, 0.0.0.0/0' }).errors).toEqual({ [ALLOWLIST_ENV]: 'allowlist' });
    });
});

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, { body = {}, params = {} } = {}) => {
    const r = res();
    await handler({ headers: { companyid: COMPANY }, uid: OWNER, body, params, query: {} }, r);
    return r;
};

const withAllowlist = (value) => {
    const before = process.env[ALLOWLIST_ENV];
    beforeEach(() => { if (value === undefined) delete process.env[ALLOWLIST_ENV]; else process.env[ALLOWLIST_ENV] = value; });
    afterEach(() => { if (before === undefined) delete process.env[ALLOWLIST_ENV]; else process.env[ALLOWLIST_ENV] = before; });
};

describe('saving a webhook to a private host', () => {
    const T = SCHEMA_TYPE.WEBHOOKS;
    let lookup;
    beforeEach(() => {
        mockDb.store[T] = [];
        lookup = jest.spyOn(dns.promises, 'lookup');
    });
    afterEach(() => lookup.mockRestore());

    describe('with no entry', () => {
        withAllowlist(undefined);

        it('is refused for a literal and for a name that resolves privately', async () => {
            expect(validateWebhookInput({ name: 'x', url: 'http://192.168.10.5/hook', events: ['*'] }).valid).toBe(false);
            lookup.mockResolvedValue([{ address: '192.168.10.5', family: 4 }]);
            const r = await call(ctrl.createWebhook, { body: { name: 'LAN', url: 'http://hooks.lan/hook', events: ['*'] } });
            expect(r.body.status).toBe(false);
            expect(mockDb.store[T]).toHaveLength(0);
        });
    });

    describe('with an entry', () => {
        withAllowlist('hooks.lan, 192.168.10.0/24, 169.254.169.254');

        it('saves a listed hostname and an address in a listed range', async () => {
            lookup.mockImplementation(async (host) => [{ address: host === 'hooks.lan' ? '192.168.20.5' : host, family: 4 }]);
            const byName = await call(ctrl.createWebhook, { body: { name: 'LAN', url: 'http://hooks.lan/hook', events: ['*'] } });
            expect(byName.body.status).toBe(true);
            const byRange = await call(ctrl.createWebhook, { body: { name: 'NAS', url: 'http://192.168.10.5:9000/hook', events: ['*'] } });
            expect(byRange.body.status).toBe(true);
            expect(mockDb.store[T]).toHaveLength(2);
        });

        it('still refuses an update to an unlisted private host and the metadata service', async () => {
            const hook = mockDb.seed(T, { name: 'ok', url: 'http://hooks.lan/a', events: ['*'], secret: 's', active: true, createdBy: OWNER });
            const unlisted = await call(ctrl.updateWebhook, { params: { id: hook._id }, body: { url: 'http://10.0.0.9/a' } });
            expect(unlisted.body.status).toBe(false);
            const metadata = await call(ctrl.updateWebhook, { params: { id: hook._id }, body: { url: 'http://169.254.169.254/latest' } });
            expect(metadata.body.status).toBe(false);
            expect(mockDb.store[T][0].url).toBe('http://hooks.lan/a');
        });
    });

    describe('with a broad range set outside the settings page', () => {
        withAllowlist('169.254.0.0/16, 100.64.0.0/10, 0.0.0.0/0');

        it('refuses the metadata and credential endpoints and loopback', async () => {
            for (const url of ['http://169.254.170.2/v2/credentials/x', 'http://100.100.100.200/latest/meta-data/', 'http://127.0.0.1:27017/', 'http://0x7f000001:4000/']) {
                const r = await call(ctrl.createWebhook, { body: { name: 'probe', url, events: ['*'] } });
                expect([url, r.body.status]).toEqual([url, false]);
            }
            expect(mockDb.store[T]).toHaveLength(0);
        });
    });
});

const envelope = { event: 'task.created', companyId: COMPANY, deliveredAt: 'now', changedFields: [], data: { _id: 't1', name: 'Task' } };

describe('delivering to a private host', () => {
    let hits = 0;
    let sink;
    beforeAll(() => new Promise((resolve) => {
        const server = http.createServer((req, response) => { hits += 1; response.end('ok'); });
        server.listen(0, '127.0.0.1', () => { sink = { server, port: server.address().port }; resolve(); });
    }));
    afterAll(() => new Promise((done) => sink.server.close(done)));
    beforeEach(() => {
        hits = 0;
        mockDb.store[SCHEMA_TYPE.WEBHOOK_LOGS] = [];
    });

    describe('with an entry', () => {
        withAllowlist('127.0.0.1');

        it('posts to the listed address', async () => {
            await deliverToHook(COMPANY, { _id: 'h1', url: `http://127.0.0.1:${sink.port}/hook`, secret: 's', format: 'json' }, envelope, 2);
            expect(hits).toBe(1);
            expect(mockDb.store[SCHEMA_TYPE.WEBHOOK_LOGS][0]).toMatchObject({ success: true, statusCode: 200 });
        });
    });

    describe('once the entry is removed', () => {
        withAllowlist('');

        it('stops posting and logs the refusal', async () => {
            await deliverToHook(COMPANY, { _id: 'h1', url: `http://127.0.0.1:${sink.port}/hook`, secret: 's', format: 'json' }, envelope, 2);
            expect(hits).toBe(0);
            expect(mockDb.store[SCHEMA_TYPE.WEBHOOK_LOGS][0]).toMatchObject({ success: false });
            expect(mockDb.store[SCHEMA_TYPE.WEBHOOK_LOGS][0].error).toMatch(/private|local|internal/i);
        });
    });
});

describe('following a redirect from a listed host', () => {
    const received = { redirector: [], target: [] };
    const servers = {};
    const locations = {
        '/to-unlisted-address': () => 'http://10.0.0.9/hook',
        '/to-unlisted-name': () => `http://localhost:${servers.target.port}/hook`,
        '/to-metadata': () => 'http://169.254.169.254/latest/meta-data/',
        '/to-credentials': () => 'http://[::ffff:169.254.170.2]/v2/credentials/x',
        '/to-listed': () => `http://127.0.0.1:${servers.target.port}/hook`,
    };
    const listen = (name, answer) => new Promise((resolve) => {
        const server = http.createServer((req, response) => {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                received[name].push({ method: req.method, path: req.url, body });
                answer(req, response);
            });
        });
        server.listen(0, '127.0.0.1', () => { servers[name] = { server, port: server.address().port }; resolve(); });
    });

    beforeAll(async () => {
        await listen('target', (req, response) => response.end('landed'));
        await listen('redirector', (req, response) => {
            response.writeHead(307, { Location: locations[req.url]() });
            response.end();
        });
    });
    afterAll(() => Promise.all(Object.values(servers).map(({ server }) => new Promise((done) => server.close(done)))));
    beforeEach(() => {
        received.redirector = [];
        received.target = [];
        mockDb.store[SCHEMA_TYPE.WEBHOOK_LOGS] = [];
    });

    const post = (path, allowlistText = '127.0.0.1') => safeFetch(`http://127.0.0.1:${servers.redirector.port}${path}`, {
        method: 'post', data: '{"n":1}', headers: { 'content-type': 'application/json' }, allowlist: compileAllowlist(allowlistText), timeoutMs: 2000,
    });

    it('refuses a hop to an unlisted private address or name and sends it nothing', async () => {
        await expect(post('/to-unlisted-address')).rejects.toThrow(/10\.0\.0\.9 is a private/);
        await expect(post('/to-unlisted-name')).rejects.toThrow(/localhost is a private/);
        expect(received.redirector).toHaveLength(2);
        expect(received.target).toHaveLength(0);
    });

    it('refuses a hop to a metadata or credential endpoint, even when the setting lists it', async () => {
        await expect(post('/to-metadata')).rejects.toThrow(/169\.254\.169\.254 is a private/);
        await expect(post('/to-credentials', '127.0.0.1, 169.254.0.0/16, 169.254.170.2')).rejects.toThrow(/is a private/);
        expect(received.redirector).toHaveLength(2);
    });

    it('follows a hop to the listed host and replays the POST', async () => {
        await expect(post('/to-listed')).resolves.toMatchObject({ status: 200, body: 'landed' });
        expect(received.target).toEqual([{ method: 'POST', path: '/hook', body: '{"n":1}' }]);
    });

    describe('during a webhook delivery', () => {
        withAllowlist('127.0.0.1');

        it('logs the refused hop and delivers only to the listed one', async () => {
            await deliverToHook(COMPANY, { _id: 'h1', url: `http://127.0.0.1:${servers.redirector.port}/to-unlisted-name`, secret: 's', format: 'json' }, envelope, 2);
            expect(mockDb.store[SCHEMA_TYPE.WEBHOOK_LOGS][0]).toMatchObject({ success: false });
            expect(mockDb.store[SCHEMA_TYPE.WEBHOOK_LOGS][0].error).toMatch(/localhost is a private/);
            expect(received.target).toHaveLength(0);

            await deliverToHook(COMPANY, { _id: 'h1', url: `http://127.0.0.1:${servers.redirector.port}/to-listed`, secret: 's', format: 'json' }, envelope, 2);
            expect(mockDb.store[SCHEMA_TYPE.WEBHOOK_LOGS][1]).toMatchObject({ success: true, statusCode: 200 });
            expect(received.target).toHaveLength(1);
            expect(JSON.parse(received.target[0].body)).toMatchObject({ event: 'task.created' });
        });
    });
});
