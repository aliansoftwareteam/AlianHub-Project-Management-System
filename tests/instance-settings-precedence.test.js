const ORIGINAL_ENV = { ...process.env };
const TOUCHED = ['HOSTING_MODE', 'AI_MODEL', 'NODEMAILER_HOST', 'NODEMAILER_PORT', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'WEBURL', 'CRON_TZ', 'APP_NAME', 'TURN_URLS', 'STUN_URLS', 'JWT_SECRET'];

/* A fresh process for each case: the settings module snapshots the environment once, at load. */
async function boot({ env = {}, stored = null, managed = true } = {}) {
    jest.resetModules();
    for (const key of TOUCHED) delete process.env[key];
    Object.assign(process.env, { JWT_SECRET: 'j'.repeat(40), ...env });
    if (managed) process.env.HOSTING_MODE = 'managed';
    const writes = [];
    jest.doMock('../utils/mongo-handler/mongoQueries', () => ({
        MongoDbCrudOpration: jest.fn(async (db, { data }, method) => {
            if (method === 'findOne') return stored;
            writes.push(data);
            return null;
        }),
    }));
    const settings = require('../Config/instanceSettings');
    await settings.loadInstanceSettings({ error: jest.fn() });
    const row = (key) => settings.describe().find((r) => r.key === key);
    return { settings, writes, row };
}

afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in ORIGINAL_ENV)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
    jest.dontMock('../utils/mongo-handler/mongoQueries');
});

describe('one key resolves env > platform > saved > default, whichever sources it has', () => {
    const combos = [];
    for (let mask = 0; mask < 8; mask += 1) combos.push({ env: Boolean(mask & 4), platform: Boolean(mask & 2), saved: Boolean(mask & 1) });
    const expected = (c) => (c.env ? ['env', 'env-model'] : c.platform ? ['platform', 'platform-model'] : c.saved ? ['saved', 'saved-model'] : ['default', 'gpt-4.1']);
    const label = (c) => ['env', 'platform', 'saved'].filter((s) => c[s]).join('+') || 'default only';
    /* Env and platform rows are ours on a hosted instance, so the page gets no value for them. */
    const shown = (source, value) => (source === 'env' || source === 'platform' ? null : value);

    it.each(combos.map((c) => [label(c), c]))('%s, all loaded at boot', async (name, c) => {
        const stored = { values: c.saved ? { AI_MODEL: 'saved-model' } : {}, platformValues: c.platform ? { AI_MODEL: 'platform-model' } : {} };
        const { row } = await boot({ env: c.env ? { AI_MODEL: 'env-model' } : {}, stored });
        const [source, value] = expected(c);
        expect(row('AI_MODEL')).toMatchObject({ source, value: shown(source, value) });
        expect(process.env.AI_MODEL).toBe(source === 'default' ? undefined : value);
    });

    it.each(combos.map((c) => [label(c), c]))('%s, owner saves before the platform pushes', async (name, c) => {
        const { settings, row } = await boot({ env: c.env ? { AI_MODEL: 'env-model' } : {} });
        if (c.saved) await settings.saveInstanceSettings({ AI_MODEL: 'saved-model' });
        if (c.platform) await settings.savePlatformSettings({ AI_MODEL: 'platform-model' });
        const [source, value] = expected(c);
        expect(row('AI_MODEL')).toMatchObject({ source, value: shown(source, value) });
        if (source !== 'default') expect(process.env.AI_MODEL).toBe(value);
    });

    it.each(combos.map((c) => [label(c), c]))('%s, the platform pushes before the owner saves', async (name, c) => {
        const { settings, row } = await boot({ env: c.env ? { AI_MODEL: 'env-model' } : {} });
        if (c.platform) await settings.savePlatformSettings({ AI_MODEL: 'platform-model' });
        if (c.saved) await settings.saveInstanceSettings({ AI_MODEL: 'saved-model' });
        const [source, value] = expected(c);
        expect(row('AI_MODEL')).toMatchObject({ source, value: shown(source, value) });
        if (source !== 'default') expect(process.env.AI_MODEL).toBe(value);
    });
});

describe('the platform source', () => {
    it('is replaced whole by each push; a key left out falls back to the owner value', async () => {
        const { settings, row } = await boot();
        await settings.saveInstanceSettings({ AI_MODEL: 'saved-model' });
        await settings.savePlatformSettings({ AI_MODEL: 'platform-model', RESEND_FROM_EMAIL: 'a@alianhub.com' });
        expect(process.env.AI_MODEL).toBe('platform-model');
        await settings.savePlatformSettings({ RESEND_FROM_EMAIL: 'a@alianhub.com' });
        expect(process.env.AI_MODEL).toBe('saved-model');
        expect(row('AI_MODEL').source).toBe('saved');
        await settings.savePlatformSettings({});
        expect(process.env.RESEND_FROM_EMAIL).toBe('');
        expect(settings.platformKeys()).toEqual([]);
    });

    it('reports only what changed, and asks for a restart only for restart-bound keys that changed', async () => {
        const { settings } = await boot();
        expect(await settings.savePlatformSettings({ RESEND_FROM_EMAIL: 'a@alianhub.com', CRON_TZ: 'Asia/Kolkata' })).toEqual({ applied: ['RESEND_FROM_EMAIL', 'CRON_TZ'], restartRequired: ['CRON_TZ'] });
        expect(await settings.savePlatformSettings({ RESEND_FROM_EMAIL: 'a@alianhub.com', CRON_TZ: 'Asia/Kolkata' })).toEqual({ applied: [], restartRequired: [] });
    });

    it('is refused whole when any value is invalid, keeping the last good set', async () => {
        const { settings, writes } = await boot();
        await settings.savePlatformSettings({ NODEMAILER_PORT: '2525' });
        const before = writes.length;
        await expect(settings.savePlatformSettings({ NODEMAILER_PORT: 'abc', RESEND_FROM_EMAIL: 'b@alianhub.com' })).rejects.toMatchObject({
            code: 'invalid_settings', statusCode: 400, errors: { NODEMAILER_PORT: 'number' },
        });
        expect(writes).toHaveLength(before);
        expect(process.env.NODEMAILER_PORT).toBe('2525');
        expect(process.env.RESEND_FROM_EMAIL).toBeUndefined();
    });

    it('stores secrets encrypted, and a secret mask keeps the one already pushed', async () => {
        const { settings, writes } = await boot();
        await settings.savePlatformSettings({ RESEND_API_KEY: 're_live_123' });
        const stored = writes.at(-1)[1].$set.platformValues;
        expect(settings.isEncrypted(stored.RESEND_API_KEY)).toBe(true);
        expect(JSON.stringify(writes)).not.toContain('re_live_123');
        await settings.savePlatformSettings({ RESEND_API_KEY: { set: true }, RESEND_FROM_EMAIL: 'a@alianhub.com' });
        expect(process.env.RESEND_API_KEY).toBe('re_live_123');
        expect(settings.platformKeys().sort()).toEqual(['RESEND_API_KEY', 'RESEND_FROM_EMAIL']);
    });

    it('never reaches a key set in the environment', async () => {
        const { settings, row } = await boot({ env: { WEBURL: 'https://acme.alianhub.com' } });
        await settings.savePlatformSettings({ WEBURL: 'https://other.alianhub.com' });
        expect(process.env.WEBURL).toBe('https://acme.alianhub.com');
        expect(row('WEBURL').source).toBe('env');
    });

    it('is ignored on a self-hosted instance, so an exported hosted database brings none of our values', async () => {
        const { row } = await boot({ managed: false, stored: { values: {}, platformValues: { RESEND_FROM_EMAIL: 'a@alianhub.com' } } });
        expect(process.env.RESEND_FROM_EMAIL).toBeUndefined();
        expect(row('RESEND_FROM_EMAIL').source).toBe('unset');
    });
});

describe('what the owner sees on a hosted instance', () => {
    it('hides the value of every managed row, set or not, secret or not', async () => {
        const { settings, row } = await boot({ env: { WEBURL: 'https://acme.alianhub.com' }, stored: { values: {}, platformValues: { NODEMAILER_HOST: 'smtp.internal' } } });
        for (const key of ['WEBURL', 'NODEMAILER_HOST', 'NODEMAILER_PORT', 'RESEND_API_KEY', 'TURN_URLS']) {
            expect(row(key)).toMatchObject({ managed: true, locked: true, value: null, default: null });
        }
        expect(row('NODEMAILER_HOST').source).toBe('platform');
        expect(row('WEBURL').source).toBe('env');
        expect(JSON.stringify(settings.describe())).not.toMatch(/smtp\.internal|acme\.alianhub\.com/);
    });

    it('keeps the customer rows editable and visible', async () => {
        const { row } = await boot({ stored: { values: { APP_NAME: 'Acme Projects' } } });
        expect(row('APP_NAME')).toMatchObject({ managed: false, locked: false, value: 'Acme Projects', source: 'saved' });
        expect(row('AI_MODEL')).toMatchObject({ managed: false, locked: false, value: 'gpt-4.1' });
        expect(row('STUN_URLS')).toMatchObject({ managed: false });
    });

    it('does not apply an owner value saved for a platform-owned key', async () => {
        const { row } = await boot({ stored: { values: { NODEMAILER_HOST: 'smtp.customer.example' } } });
        expect(process.env.NODEMAILER_HOST).toBeUndefined();
        expect(row('NODEMAILER_HOST').source).toBe('unset');
    });

    it('flips mail to the customer when their plan allows their own SMTP, and back', async () => {
        const { settings, row } = await boot({ stored: { values: { NODEMAILER_HOST: 'smtp.customer.example' } } });
        expect(settings.setOwnershipOverrides({ mail: 'customer' })).toEqual({ mail: 'customer' });
        expect(process.env.NODEMAILER_HOST).toBe('smtp.customer.example');
        expect(row('NODEMAILER_HOST')).toMatchObject({ managed: false, locked: false, value: 'smtp.customer.example', source: 'saved' });
        expect(settings.refusedKeys({ NODEMAILER_HOST: 'x' })).toEqual({});
        settings.setOwnershipOverrides({});
        expect(process.env.NODEMAILER_HOST).toBe('');
        expect(row('NODEMAILER_HOST')).toMatchObject({ managed: true, value: null });
    });

    it('ignores an override that names neither owner', async () => {
        const { settings } = await boot();
        expect(settings.setOwnershipOverrides({ mail: 'nobody', ai: 'platform' })).toEqual({ ai: 'platform' });
        expect(settings.refusedKeys({ AI_MODEL: 'x' })).toEqual({ AI_MODEL: 'managed' });
    });
});

describe('an owner PUT of a key it cannot set', () => {
    it('names managed keys on a hosted instance, env and unset alike', async () => {
        const { settings } = await boot({ env: { WEBURL: 'https://acme.alianhub.com' } });
        expect(settings.refusedKeys({ NODEMAILER_HOST: 'smtp.example.com', WEBURL: 'https://x', APP_NAME: 'Acme', RESEND_API_KEY: { set: true } })).toEqual({ NODEMAILER_HOST: 'managed', WEBURL: 'managed' });
    });

    it('names env keys as locked on a self-hosted instance and refuses nothing else', async () => {
        const { settings } = await boot({ managed: false, env: { NODEMAILER_HOST: 'smtp.env.example' } });
        expect(settings.refusedKeys({ NODEMAILER_HOST: 'x', NODEMAILER_PORT: '465', WEBURL: 'https://x' })).toEqual({ NODEMAILER_HOST: 'locked' });
    });

    it('locks only env keys on a self-hosted instance, exactly as before', async () => {
        const { settings, row } = await boot({ managed: false, env: { NODEMAILER_HOST: 'smtp.env.example' } });
        expect(settings.lockedKeys()).toEqual(['NODEMAILER_HOST']);
        expect(settings.describe().filter((r) => r.managed)).toEqual([]);
        expect(row('NODEMAILER_HOST')).toMatchObject({ value: 'smtp.env.example', source: 'env', locked: true });
    });
});
