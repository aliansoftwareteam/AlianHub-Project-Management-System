jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const nodemailer = require('nodemailer');
const { GROUPS, GROUP_OWNER, OWNERS, CATALOG, byKey, ownerOf, platformOwnedKeys } = require('../Modules/Instance/settingsCatalog');
const meta = require('../scripts/env-doc.meta.json');
const hostingMode = require('../Config/hostingMode');

const keysOf = (group) => CATALOG.filter((f) => f.group === group).map((f) => f.key);

describe('who owns each setting on a hosted instance', () => {
    it('names an owner for every group and only known owners on fields', () => {
        expect(Object.keys(GROUP_OWNER).sort()).toEqual([...GROUPS].sort());
        for (const owner of Object.values(GROUP_OWNER)) expect(OWNERS).toContain(owner);
        for (const f of CATALOG) if (f.owner !== undefined) expect(OWNERS).toContain(f.owner);
    });

    it.each([
        ['WEBURL', 'platform'], ['APIURL', 'platform'], ['APP_NAME', 'customer'], ['CRON_TZ', 'customer'],
        ['TURN_URLS', 'customer'], ['TURN_STATIC_AUTH_SECRET', 'customer'], ['TURN_USERNAME', 'customer'], ['TURN_PASSWORD', 'customer'], ['STUN_URLS', 'customer'],
        ['TRUST_PROXY', 'platform'], ['GLOBAL_RATE_LIMIT_PER_MIN', 'platform'], ['HELMET_ENABLED', 'platform'], ['WEBHOOK_ALLOWED_PRIVATE_HOSTS', 'platform'],
        ['PERMISSION_ENFORCEMENT_MODE', 'customer'], ['AUDIT_RETENTION_DAYS', 'customer'],
    ])('gives %s to the %s', (key, owner) => {
        expect(ownerOf(key)).toBe(owner);
    });

    it.each([['mail', 'platform'], ['storage', 'platform'], ['ai', 'customer'], ['auth', 'customer']])('gives every %s setting to the %s', (group, owner) => {
        for (const key of keysOf(group)) expect([key, ownerOf(key)]).toEqual([key, owner]);
    });

    it('hands the whole mail group to the customer when their plan allows their own SMTP', () => {
        const before = platformOwnedKeys();
        const after = platformOwnedKeys({ mail: 'customer' });
        expect(before).toEqual(expect.arrayContaining(keysOf('mail')));
        expect(after.filter((key) => keysOf('mail').includes(key))).toEqual([]);
        expect(before.filter((key) => !after.includes(key)).sort()).toEqual(keysOf('mail').sort());
    });

    it('lets a key override beat a group override', () => {
        expect(ownerOf('NODEMAILER_HOST', { mail: 'customer', NODEMAILER_HOST: 'platform' })).toBe('platform');
        expect(ownerOf('NOT_A_KEY')).toBeNull();
    });

    it('lets the owner edit what the env audit found customer-relevant', () => {
        for (const key of ['MAGIC_LINK_ENABLED', 'TWO_FACTOR_ISSUER', 'AUDIT_RETENTION_DAYS', 'AI_FIELD_DAILY_LIMIT', 'AI_REPLAY', 'GITLAB_BASE_API_URL']) {
            expect(byKey.get(key)).toBeDefined();
            expect(ownerOf(key)).toBe('customer');
            expect(byKey.get(key).readOnly).toBeUndefined();
        }
    });
});

describe('the env matrix agrees with the catalog', () => {
    const classified = Object.entries(meta).filter(([key]) => byKey.has(key));

    it('marks a variable customer only when the console lets the owner set it', () => {
        for (const [key, entry] of Object.entries(meta).filter(([, e]) => e.managed === 'customer')) {
            expect([key, byKey.has(key)]).toEqual([key, true]);
            expect([key, ownerOf(key), Boolean(byKey.get(key).readOnly)]).toEqual([key, 'customer', false]);
            expect(entry.managed).toBe('customer');
        }
    });

    it('marks a variable platform only when the platform owns it in the catalog, so 062 can push it', () => {
        for (const [key] of Object.entries(meta).filter(([, e]) => e.managed === 'platform')) {
            expect([key, ownerOf(key)]).toEqual([key, 'platform']);
        }
    });

    it('classifies every catalog key the generator lists the way its owner says', () => {
        for (const [key, entry] of classified) {
            const def = byKey.get(key);
            const expected = ownerOf(key) === 'platform' ? ['bootstrap', 'platform'] : def.readOnly ? ['fixed'] : ['customer'];
            expect([key, expected.includes(entry.managed)]).toEqual([key, true]);
        }
    });
});

describe('the mail test on a hosted instance', () => {
    const before = { mode: process.env.HOSTING_MODE, host: process.env.NODEMAILER_HOST, resend: process.env.RESEND_API_KEY };
    const timeout = () => Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' });

    beforeEach(() => {
        delete process.env.RESEND_API_KEY;
        hostingMode._resetForTests();
        nodemailer.createTransport.mockReturnValue({ verify: () => Promise.reject(timeout()) });
    });
    afterAll(() => {
        for (const [key, value] of [['HOSTING_MODE', before.mode], ['NODEMAILER_HOST', before.host], ['RESEND_API_KEY', before.resend]]) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        hostingMode._resetForTests();
    });

    it.each([25, 465, 587])('says the provider blocks port %i instead of a bare timeout', async (port) => {
        process.env.HOSTING_MODE = 'managed';
        const { probeMail } = require('../Modules/Instance/probes');
        const result = await probeMail({ NODEMAILER_HOST: 'smtp.example.com', NODEMAILER_PORT: String(port) });
        expect(result.status).toBe(false);
        expect(result.statusText).toBe("Our hosting provider blocks this port. Use an API key (Resend) or your provider's alternate port, such as 2525.");
        expect(result.data).toEqual({ code: 'smtp_port_blocked', port });
    });

    it('keeps the plain timeout on another port, and on a self-hosted instance', async () => {
        const { probeMail } = require('../Modules/Instance/probes');
        process.env.HOSTING_MODE = 'managed';
        expect((await probeMail({ NODEMAILER_HOST: 'smtp.example.com', NODEMAILER_PORT: '2525' })).statusText).toBe('Connection timeout');
        hostingMode._resetForTests();
        delete process.env.HOSTING_MODE;
        expect((await probeMail({ NODEMAILER_HOST: 'smtp.example.com', NODEMAILER_PORT: '587' })).statusText).toBe('Connection timeout');
    });

    it('keeps a login failure a login failure', async () => {
        process.env.HOSTING_MODE = 'managed';
        nodemailer.createTransport.mockReturnValue({ verify: () => Promise.reject(new Error('Invalid login: 535')) });
        const { probeMail } = require('../Modules/Instance/probes');
        expect((await probeMail({ NODEMAILER_HOST: 'smtp.example.com', NODEMAILER_PORT: '587' })).statusText).toBe('Invalid login: 535');
    });
});

describe('private webhook hosts on a hosted instance', () => {
    const before = { mode: process.env.HOSTING_MODE, hosts: process.env.WEBHOOK_ALLOWED_PRIVATE_HOSTS };
    afterEach(() => {
        for (const [key, value] of [['HOSTING_MODE', before.mode], ['WEBHOOK_ALLOWED_PRIVATE_HOSTS', before.hosts]]) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        hostingMode._resetForTests();
    });

    it('are forced empty: the private network there is ours', () => {
        const { webhookAllowlist } = require('../Modules/Webhooks/helpers/privateHostAllowlist');
        process.env.WEBHOOK_ALLOWED_PRIVATE_HOSTS = 'hooks.lan, 192.168.10.0/24';
        delete process.env.HOSTING_MODE;
        expect(webhookAllowlist().allowsHost('hooks.lan')).toBe(true);
        hostingMode._resetForTests();
        process.env.HOSTING_MODE = 'managed';
        expect(webhookAllowlist().allowsHost('hooks.lan')).toBe(false);
        expect(webhookAllowlist().allowsAddress('x', '192.168.10.5')).toBe(false);
    });
});
