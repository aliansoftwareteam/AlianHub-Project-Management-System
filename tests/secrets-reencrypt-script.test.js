const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { create } = require('./fixtures/fakeMongo');

/* npm run secrets:reencrypt: the operator's half of a SECRETS_KEY rotation. It reseals every company, says
 * what is left on the previous key, and only then says the previous key can go. */
const mockDbs = {};
const mockDbFor = (companyId) => (mockDbs[companyId] = mockDbs[companyId] || create());

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, query, method) => mockDbFor(String(companyId)).crud(companyId, query, method) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');

const A = '6f0000000000000000000c01';
const B = '6f0000000000000000000c02';
const KEY = crypto.randomBytes(24).toString('hex');
const PREVIOUS = crypto.randomBytes(24).toString('hex');
const VALUE = `ghp_${crypto.randomBytes(20).toString('hex')}`;
const actor = { id: '6f0000000000000000000a01' };
const root = path.join(__dirname, '..');

let store;
let recordAudit;
let reencryptCompanies;

const env = ({ on = true, key = KEY, previous } = {}) => {
    if (on) process.env.SECRETS_STORE = 'true'; else delete process.env.SECRETS_STORE;
    if (key === null) delete process.env.SECRETS_KEY; else process.env.SECRETS_KEY = key;
    if (previous === undefined) delete process.env.SECRETS_KEY_PREVIOUS; else process.env.SECRETS_KEY_PREVIOUS = previous;
    jest.resetModules();
    store = require('../Config/secrets');
    ({ recordAudit } = require('../Modules/Audit/recorder'));
    ({ reencryptCompanies } = require('../scripts/secrets-reencrypt'));
};

const rows = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.SECRETS] || [];
const listCompanies = async () => [{ _id: A, Cst_CompanyName: 'Acme' }, { _id: B, Cst_CompanyName: 'Birch' }];
const run = async () => {
    const lines = [];
    const result = await reencryptCompanies({ store, listCompanies, log: (line) => lines.push(line) });
    return { ...result, lines, text: lines.join('\n') };
};

const sealedUnderPrevious = async () => {
    env({ key: PREVIOUS });
    const made = {
        a1: await store.create({ companyId: A, name: 'A one', kind: 'integration', value: VALUE, actor }),
        a2: await store.create({ companyId: A, name: 'A two', kind: 'webhook', value: VALUE, actor }),
        b1: await store.create({ companyId: B, name: 'B one', kind: 'integration', value: VALUE, actor }),
    };
    env({ key: KEY, previous: PREVIOUS });
    return made;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
});

afterAll(() => {
    delete process.env.SECRETS_STORE;
    delete process.env.SECRETS_KEY;
    delete process.env.SECRETS_KEY_PREVIOUS;
});

describe('npm run secrets:reencrypt', () => {
    it('reseals every company, reports the counts, and only then says the previous key can be unset', async () => {
        await sealedUnderPrevious();
        const out = await run();
        expect(out.exitCode).toBe(0);
        expect(out.safeToUnset).toBe(true);
        expect(out.companies[A]).toMatchObject({ moved: 2, kept: 0, failed: 0, onPreviousKey: 0 });
        expect(out.companies[B]).toMatchObject({ moved: 1, onPreviousKey: 0 });
        expect(out.text).toMatch(new RegExp(`${A}.*moved 2`));
        expect(out.text).toMatch(/Live secrets still on the previous key: 0/);
        expect(out.text).toMatch(/safe to unset SECRETS_KEY_PREVIOUS/i);
        expect([...rows(A), ...rows(B)].every((r) => r.keyId === store.config().keyId)).toBe(true);

        env({ key: KEY });
        expect(await store.resolve({ companyId: A, handle: rows(A)[0].handle })).toBe(VALUE);
    });

    it('does not say the previous key can go while a live secret is still sealed under it', async () => {
        const made = await sealedUnderPrevious();
        const stuck = rows(B).find((r) => r.handle === made.b1.handle);
        stuck.tag = Buffer.alloc(16).toString('base64');
        const out = await run();
        expect(out.exitCode).toBe(1);
        expect(out.safeToUnset).toBe(false);
        expect(out.companies[B]).toMatchObject({ moved: 0, failed: 1, onPreviousKey: 1 });
        expect(out.text).toMatch(/Live secrets still on the previous key: 1/);
        expect(out.text).toMatch(/keep SECRETS_KEY_PREVIOUS set/i);
        expect(out.text).not.toMatch(/safe to unset/i);
    });

    it('reports revoked rows apart, and they do not hold the previous key back', async () => {
        const made = await sealedUnderPrevious();
        await store.revoke({ companyId: A, handle: made.a2.handle, actor });
        const out = await run();
        expect(out.companies[A]).toMatchObject({ moved: 1, revoked: 1, onPreviousKey: 0 });
        expect(out.text).toMatch(/revoked 1/);
        expect(out.safeToUnset).toBe(true);
    });

    it('revokes the copies that were orphaned while no key was set, and reports them', async () => {
        const made = await sealedUnderPrevious();
        env({ on: false, key: null });
        expect(await store.retire({ companyId: A, handle: made.a1.handle, actor })).toBe('orphaned');
        env({ key: KEY, previous: PREVIOUS });
        const out = await run();
        expect(out.companies[A]).toMatchObject({ orphansRevoked: 1, moved: 1, revoked: 1 });
        expect(rows(A).find((r) => r.handle === made.a1.handle).revokedAt).toBeInstanceOf(Date);
    });

    it('writes one audit row per company, with counts and one run id, and never a value or a key', async () => {
        await sealedUnderPrevious();
        recordAudit.mockClear();
        const out = await run();
        const written = recordAudit.mock.calls.filter(([, entry]) => entry.action === 'secret.reencrypt');
        expect(written.map(([companyId]) => companyId)).toEqual([A, B]);
        expect(written[0][1]).toMatchObject({ actorId: 'script:secrets-reencrypt', meta: { moved: 2, kept: 0, failed: 0, raced: 0, revoked: 0, onPreviousKey: 0, onUnknownKey: 0, keyId: store.config().keyId } });
        expect(new Set(written.map(([, entry]) => entry.meta.run)).size).toBe(1);
        const everything = JSON.stringify([recordAudit.mock.calls, out.lines]);
        for (const secret of [VALUE, KEY, PREVIOUS]) expect(everything).not.toContain(secret);
    });

    it('keeps going after a company fails, and then does not say the previous key can go', async () => {
        await sealedUnderPrevious();
        const broken = async () => [{ _id: 'not-a-company' }, { _id: B }];
        const lines = [];
        const out = await reencryptCompanies({ store, listCompanies: broken, log: (line) => lines.push(line) });
        expect(out.companies['not-a-company']).toMatchObject({ error: expect.any(String) });
        expect(out.companies[B]).toMatchObject({ moved: 1 });
        expect(out.exitCode).toBe(1);
        expect(out.safeToUnset).toBe(false);
    });

    it.each([['missing', null], ['short', 'too-short']])('refuses with a %s SECRETS_KEY before it reads any company', async (label, key) => {
        env({ key });
        await expect(run()).rejects.toThrow(/SECRETS_KEY/);
        expect(Object.keys(mockDbs)).toEqual([]);
    });

    it('is wired to npm run secrets:reencrypt, and the env docs name that command', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        expect(pkg.scripts['secrets:reencrypt']).toBe('node scripts/secrets-reencrypt.js');
        const meta = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'env-doc.meta.json'), 'utf8'));
        for (const name of ['SECRETS_KEY', 'SECRETS_KEY_PREVIOUS']) {
            expect(meta[name].description).toContain('npm run secrets:reencrypt');
            expect(meta[name].description).not.toContain('reencryptAll');
        }
        expect(fs.readFileSync(path.join(root, 'docs', 'ENV.md'), 'utf8')).toContain('npm run secrets:reencrypt');
    });
});
