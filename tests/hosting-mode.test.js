const crypto = require('crypto');
const hostingMode = require('../Config/hostingMode');

const { publicKey } = crypto.generateKeyPairSync('ed25519');
const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
const rawKey = spkiDer.subarray(spkiDer.length - 32);

const goodEnv = () => ({
    HOSTING_MODE: 'managed',
    INSTANCE_ID: 'ins_01jd3k8m2n4p6q8r0s2t4v',
    PLATFORM_API_KEY: 'k'.repeat(48),
    PLATFORM_PUBLIC_KEY: rawKey.toString('base64'),
    PLATFORM_URL: 'https://account.alianhub.com',
    WEBURL: 'https://acme.alianhub.com',
    JWT_SECRET: 's'.repeat(64),
});

describe('the hosting mode', () => {
    const saved = process.env.HOSTING_MODE;
    afterEach(() => {
        if (saved === undefined) delete process.env.HOSTING_MODE; else process.env.HOSTING_MODE = saved;
        hostingMode._resetForTests();
    });

    it('is self unless HOSTING_MODE says managed, in any case', () => {
        delete process.env.HOSTING_MODE;
        expect(hostingMode.mode()).toBe('self');
        expect(hostingMode.isManaged()).toBe(false);
        hostingMode._resetForTests();
        process.env.HOSTING_MODE = ' Managed ';
        expect(hostingMode.mode()).toBe('managed');
        expect(hostingMode.isManaged()).toBe(true);
    });

    it('is read once, so a later change to the environment cannot split a running process', () => {
        process.env.HOSTING_MODE = 'managed';
        expect(hostingMode.mode()).toBe('managed');
        process.env.HOSTING_MODE = 'self';
        expect(hostingMode.mode()).toBe('managed');
    });

    it('names the platform this instance answers to', () => {
        expect(hostingMode.platform(goodEnv())).toEqual({ instanceId: 'ins_01jd3k8m2n4p6q8r0s2t4v', url: 'https://account.alianhub.com', publicKey: rawKey.toString('base64') });
        expect(hostingMode.platform({})).toEqual({ instanceId: '', url: '', publicKey: '' });
    });
});

describe('the boot checks', () => {
    it('let a self-hosted boot through with nothing set', () => {
        expect(hostingMode.bootProblems({})).toEqual([]);
        expect(hostingMode.bootProblems({ HOSTING_MODE: 'self', JWT_SECRET: 'short' })).toEqual([]);
    });

    it('let a well-formed managed boot through', () => {
        expect(hostingMode.bootProblems(goodEnv())).toEqual([]);
    });

    it('refuse a HOSTING_MODE that is neither mode, so a typo cannot open a hosted instance as self-hosted', () => {
        expect(hostingMode.bootProblems({ HOSTING_MODE: 'manged' })).toEqual(['HOSTING_MODE must be "self" or "managed"']);
    });

    it.each([
        ['INSTANCE_ID', undefined, 'INSTANCE_ID is not set'],
        ['INSTANCE_ID', 'ins_SHORT', 'INSTANCE_ID must be'],
        ['INSTANCE_ID', 'acme_01jd3k8m2n4p6q8r0s2t4v', 'INSTANCE_ID must be'],
        ['PLATFORM_API_KEY', 'k'.repeat(31), 'PLATFORM_API_KEY must be at least 32'],
        ['PLATFORM_PUBLIC_KEY', 'not-a-key', 'PLATFORM_PUBLIC_KEY is not an Ed25519'],
        ['PLATFORM_URL', 'http://account.alianhub.com', 'PLATFORM_URL must be an https://'],
        ['WEBURL', 'http://acme.alianhub.com', 'WEBURL must be an https://'],
        ['WEBURL', undefined, 'WEBURL must be an https://'],
        ['JWT_SECRET', 'x'.repeat(31), 'JWT_SECRET must be at least 32'],
    ])('refuse %s = %p', (key, value, problem) => {
        const env = { ...goodEnv(), [key]: value };
        if (value === undefined) delete env[key];
        const problems = hostingMode.bootProblems(env);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain(problem);
    });

    it('log every problem in one fatal line, without the values, and exit 1', () => {
        const env = { HOSTING_MODE: 'managed', JWT_SECRET: 'tiny-secret', PLATFORM_API_KEY: 'tiny-key' };
        const log = jest.fn();
        const exit = jest.fn();
        expect(hostingMode.refuseBadBoot({ env, log, exit })).toBe(false);
        expect(exit).toHaveBeenCalledWith(1);
        expect(log).toHaveBeenCalledTimes(1);
        const line = log.mock.calls[0][0];
        expect(line).toMatch(/^\[FATAL\] hosting-mode: refusing to start: /);
        for (const key of ['INSTANCE_ID', 'PLATFORM_API_KEY', 'PLATFORM_PUBLIC_KEY', 'PLATFORM_URL', 'WEBURL', 'JWT_SECRET']) expect(line).toContain(key);
        expect(line).not.toContain('tiny-secret');
        expect(line).not.toContain('tiny-key');
    });

    it('do nothing on a good boot', () => {
        const log = jest.fn();
        const exit = jest.fn();
        expect(hostingMode.refuseBadBoot({ env: {}, log, exit })).toBe(true);
        expect(hostingMode.refuseBadBoot({ env: goodEnv(), log, exit })).toBe(true);
        expect(log).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
    });
});

describe('the platform public key', () => {
    it('is read as PEM, or as base64 or base64url of the raw key or of its SPKI DER', () => {
        const pem = publicKey.export({ format: 'pem', type: 'spki' });
        for (const text of [pem, rawKey.toString('base64'), rawKey.toString('base64url'), spkiDer.toString('base64')]) {
            expect(hostingMode.ed25519PublicKey(text)?.asymmetricKeyType).toBe('ed25519');
        }
    });

    it('is refused when it is another kind of key or not a key at all', () => {
        const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ format: 'pem', type: 'spki' });
        for (const text of [rsa, '', 'abc$%', Buffer.alloc(31).toString('base64'), undefined]) expect(hostingMode.ed25519PublicKey(text)).toBeNull();
    });
});

describe('what the SPA learns before login', () => {
    const keys = ['HOSTING_MODE', 'PLATFORM_URL'];
    const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    afterEach(() => {
        for (const key of keys) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
        hostingMode._resetForTests();
    });

    it('says self with no portal on a self-hosted instance', () => {
        delete process.env.HOSTING_MODE;
        process.env.PLATFORM_URL = 'https://account.alianhub.com';
        expect(require('../Config/instanceSettings').publicConfig().hosting).toEqual({ mode: 'self', portalUrl: '' });
    });

    it('says managed with the platform as the portal until entitlements name one', () => {
        process.env.HOSTING_MODE = 'managed';
        process.env.PLATFORM_URL = 'https://account.alianhub.com';
        const { publicConfig } = require('../Config/instanceSettings');
        expect(publicConfig().hosting).toEqual({ mode: 'managed', portalUrl: 'https://account.alianhub.com', lifecycle: 'active' });
        hostingMode.setPortalUrl('https://account.alianhub.com/i/ins_1');
        expect(publicConfig().hosting.portalUrl).toBe('https://account.alianhub.com/i/ins_1');
    });
});
