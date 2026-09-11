const http = require('http');
const dns = require('dns');

const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { parseAllowlist, compileAllowlist, isMetadataAddress, webhookAllowlist, ALLOWLIST_ENV } = require('../Modules/Webhooks/helpers/privateHostAllowlist');
const { resolvePublic } = require('../Modules/Agents/engine/safeFetch');
const { validateWebhookInput } = require('../Modules/Webhooks/helpers/webhookRules');
const { validateSettings, byKey } = require('../Modules/Instance/settingsCatalog');
const { deliverToHook } = require('../Modules/Webhooks/dispatcher');
const ctrl = require('../Modules/Webhooks/controller');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER = '300000000000000000000001';

describe('parsing the private webhook host allowlist', () => {
    it('is empty by default', () => {
        expect(parseAllowlist('')).toEqual({ entries: [], invalid: [] });
        expect(parseAllowlist(undefined)).toEqual({ entries: [], invalid: [] });
        expect(compileAllowlist('').size).toBe(0);
    });

    it('accepts hostnames, addresses and CIDR ranges separated by commas, spaces or new lines', () => {
        const { entries, invalid } = parseAllowlist('Hooks.LAN., 192.168.10.0/24\n10.1.2.3  fd12:3456::/32\n[fd00::7]');
        expect(invalid).toEqual([]);
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
        expect(list.allowsAddress('printer.example.com', '192.168.10.9')).toBe(true);
        expect(list.allowsAddress('printer.example.com', '::ffff:192.168.10.9')).toBe(true);
        expect(list.allowsAddress('printer.example.com', '10.0.0.1')).toBe(false);
    });

    it('matches IPv6 ranges', () => {
        expect(list.allowsHost('[fd12:3456:1::9]')).toBe(true);
        expect(list.allowsAddress('nas.example.com', 'fd12:3456:ffff::1')).toBe(true);
        expect(list.allowsAddress('nas.example.com', 'fd12:3457::1')).toBe(false);
    });

    it('never allows a cloud metadata address, however it is listed or reached', () => {
        ['169.254.169.254', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', 'fd00:ec2::254', 'FD00:EC2:0::254'].forEach((ip) => expect([ip, isMetadataAddress(ip)]).toEqual([ip, true]));
        expect(isMetadataAddress('169.254.1.1')).toBe(false);
        expect(list.allowsHost('169.254.169.254')).toBe(false);
        expect(list.allowsHost('[fd00:ec2::254]')).toBe(false);
        expect(list.allowsHost('169.254.1.1')).toBe(true);
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
});

describe('the instance setting', () => {
    it('is a security setting that validates its entries', () => {
        expect(byKey.get(ALLOWLIST_ENV)).toMatchObject({ group: 'security', type: 'list', default: '' });
        expect(validateSettings({ [ALLOWLIST_ENV]: ' hooks.lan\n192.168.10.0/24 ' })).toEqual({ values: { [ALLOWLIST_ENV]: 'hooks.lan\n192.168.10.0/24' }, errors: {}, valid: true });
        expect(validateSettings({ [ALLOWLIST_ENV]: 'hooks.lan, not a host!' }).errors).toEqual({ [ALLOWLIST_ENV]: 'allowlist' });
        expect(validateSettings({ [ALLOWLIST_ENV]: '' }).values).toEqual({ [ALLOWLIST_ENV]: '' });
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
});

describe('delivering to a private host', () => {
    const envelope = { event: 'task.created', companyId: COMPANY, deliveredAt: 'now', changedFields: [], data: { _id: 't1', name: 'Task' } };
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
