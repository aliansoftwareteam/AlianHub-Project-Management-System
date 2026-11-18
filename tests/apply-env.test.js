const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadDotEnv, RUNTIME_DEFAULTS } = require('../Config/applyEnv');

const KEYS = ['JWT_ALGORITHM', 'JWT_EXP'];
const saved = {};

beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('loadDotEnv — the keys a login needs always have a value', () => {
    it('fills JWT_ALGORITHM and JWT_EXP when neither the environment nor .env sets them', () => {
        loadDotEnv(path.join(os.tmpdir(), 'does-not-exist.env'));
        expect(process.env.JWT_ALGORITHM).toBe(RUNTIME_DEFAULTS.JWT_ALGORITHM);
        expect(process.env.JWT_EXP).toBe(RUNTIME_DEFAULTS.JWT_EXP);
    });

    it('lets .env and the real environment win over the defaults', () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ah-env-')), '.env');
        fs.writeFileSync(file, 'JWT_EXP=12h\n');
        process.env.JWT_ALGORITHM = 'HS512';
        loadDotEnv(file);
        expect(process.env.JWT_EXP).toBe('12h');
        expect(process.env.JWT_ALGORITHM).toBe('HS512');
    });
});
