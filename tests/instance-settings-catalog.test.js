const { GROUPS, CATALOG, byKey, validateSettings, describeSettings } = require('../Modules/Instance/settingsCatalog');

describe('the settings catalog', () => {
    it('only uses known groups, unique keys, and marks every secret as such', () => {
        const keys = CATALOG.map((f) => f.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const f of CATALOG) {
            expect(GROUPS).toContain(f.group);
            expect(['text', 'secret', 'number', 'boolean', 'select', 'list']).toContain(f.type);
            expect(f.secret).toBe(f.type === 'secret');
            if (f.type === 'select') expect(f.options.length).toBeGreaterThan(1);
        }
        for (const key of ['NODEMAILER_EMAIL_PASSWORD', 'RESEND_API_KEY', 'WASABI_SECRET_ACCESS_KEY', 'AI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_SECRET', 'GITLAB_CLIENT_SECRET', 'TURN_STATIC_AUTH_SECRET', 'TURN_PASSWORD']) {
            expect(byKey.get(key).secret).toBe(true);
        }
    });

    it('marks what is read at module load as needing a restart', () => {
        for (const key of ['STORAGE_TYPE', 'TRUST_PROXY', 'GLOBAL_RATE_LIMIT_PER_MIN', 'HELMET_ENABLED', 'CRON_TZ']) expect(byKey.get(key).restart).toBe(true);
        for (const key of ['NODEMAILER_HOST', 'AI_API_KEY', 'GOOGLE_CLIENT_ID']) expect(byKey.get(key).restart).toBeUndefined();
    });

    it('applies every storage value but the driver on save, so a rotated key needs no restart', () => {
        const storage = CATALOG.filter((f) => f.group === 'storage' && f.key !== 'STORAGE_TYPE');
        expect(storage.map((f) => f.key)).toEqual(expect.arrayContaining(['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_PREFIX', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_FORCE_PATH_STYLE', 'S3_PUBLIC_BASE_URL', 'WASABI_ACCESS_KEY']));
        expect(storage.filter((f) => f.restart).map((f) => f.key)).toEqual([]);
        expect(byKey.get('S3_SECRET_KEY').secret).toBe(true);
        expect(byKey.get('STORAGE_TYPE').options).toEqual(expect.arrayContaining(['server', 's3', 'wasabi']));
    });

    it('shows a Wasabi-named field only while it holds a value', () => {
        const row = (rows, key) => rows.find((r) => r.key === key);
        const unset = describeSettings({});
        expect(row(unset, 'WASABI_ACCESS_KEY').hidden).toBe(true);
        expect(row(unset, 'WASABIENDPOINT').hidden).toBe(true);
        expect(row(unset, 'S3_ACCESS_KEY').hidden).toBe(false);
        expect(row(describeSettings({ saved: { WASABI_ACCESS_KEY: 'AK' } }), 'WASABI_ACCESS_KEY').hidden).toBe(false);
        expect(row(describeSettings({ env: { WASABIENDPOINT: 'https://s3.wasabisys.com' }, locked: ['WASABIENDPOINT'] }), 'WASABIENDPOINT').hidden).toBe(false);
    });

    it('refuses a key prefix that could climb out of its folder', () => {
        expect(validateSettings({ S3_PREFIX: 'ins_01jd3k/' }).valid).toBe(true);
        expect(validateSettings({ S3_PREFIX: 'a/../b/' }).errors).toEqual({ S3_PREFIX: 'prefix' });
        expect(validateSettings({ S3_PREFIX: 'a//b' }).errors).toEqual({ S3_PREFIX: 'prefix' });
    });
});

describe('validating a save', () => {
    it('keeps typed values, clears empties, ignores the secret mask, and refuses junk', () => {
        const { values, errors, valid } = validateSettings({
            NODEMAILER_HOST: ' smtp.example.com ', NODEMAILER_PORT: '465', AI_API_KEY: { set: true }, RESEND_API_KEY: '', GOOGLE_LOGIN_ENABLED: 'true', LLM_PROVIDER: 'anthropic',
        });
        expect(valid).toBe(true);
        expect(errors).toEqual({});
        expect(values).toEqual({ NODEMAILER_HOST: 'smtp.example.com', NODEMAILER_PORT: '465', RESEND_API_KEY: '', GOOGLE_LOGIN_ENABLED: 'true', LLM_PROVIDER: 'anthropic' });
    });

    it('names every problem: unknown keys, bad numbers, non-booleans, unknown options', () => {
        const { errors, valid } = validateSettings({ JWT_SECRET: 'x', NODEMAILER_PORT: 'abc', HELMET_ENABLED: 'yes', STORAGE_TYPE: 'dropbox' });
        expect(valid).toBe(false);
        expect(errors).toEqual({ JWT_SECRET: 'unknown', NODEMAILER_PORT: 'number', HELMET_ENABLED: 'boolean', STORAGE_TYPE: 'option' });
    });
});

describe('describing the effective settings', () => {
    const rows = (args) => Object.fromEntries(describeSettings(args).map((r) => [r.key, r]));

    it('the environment wins over a saved value and is reported as locked', () => {
        const r = rows({ saved: { NODEMAILER_HOST: 'saved.example' }, env: { NODEMAILER_HOST: 'env.example' }, locked: ['NODEMAILER_HOST'] });
        expect(r.NODEMAILER_HOST).toMatchObject({ value: 'env.example', source: 'env', locked: true });
    });

    it('a saved value applies when the environment is silent, else the default, else unset', () => {
        const r = rows({ saved: { NODEMAILER_HOST: 'saved.example' }, env: {}, locked: [] });
        expect(r.NODEMAILER_HOST).toMatchObject({ value: 'saved.example', source: 'saved', locked: false });
        expect(r.LLM_PROVIDER).toMatchObject({ value: 'openai', source: 'default' });
        expect(r.TURN_URLS).toMatchObject({ value: '', source: 'unset' });
    });

    it('never returns a secret, only whether one is set', () => {
        const r = rows({ saved: { AI_API_KEY: 'sk-live' }, env: { ANTHROPIC_API_KEY: 'sk-ant' }, locked: ['ANTHROPIC_API_KEY'] });
        expect(r.AI_API_KEY.value).toEqual({ set: true });
        expect(r.ANTHROPIC_API_KEY).toMatchObject({ value: { set: true }, locked: true });
        expect(r.DEEPSEEK_API_KEY.value).toEqual({ set: false });
        expect(JSON.stringify(r)).not.toMatch(/sk-live|sk-ant/);
    });
});

describe('secrets at rest', () => {
    const { encrypt, decrypt, isEncrypted, decodeStored } = require('../Config/instanceSettings');

    it('round-trips with the derived key and is unreadable with another', () => {
        const stored = encrypt('hunter2', 'jwt-a');
        expect(isEncrypted(stored)).toBe(true);
        expect(stored).not.toContain('hunter2');
        expect(decrypt(stored, 'jwt-a')).toBe('hunter2');
        expect(() => decrypt(stored, 'jwt-b')).toThrow();
    });

    it('a secret that no longer decrypts reads as unset instead of breaking the load', () => {
        const saved = process.env.JWT_SECRET;
        process.env.JWT_SECRET = 'jwt-b';
        try {
            const errors = [];
            const out = decodeStored({ AI_API_KEY: encrypt('k', 'jwt-a'), AI_MODEL: 'gpt', NOT_A_KEY: 'x' }, { error: (m) => errors.push(m) });
            expect(out).toEqual({ AI_MODEL: 'gpt' });
            expect(errors[0]).toMatch(/AI_API_KEY/);
        } finally {
            if (saved === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = saved;
        }
    });
});
