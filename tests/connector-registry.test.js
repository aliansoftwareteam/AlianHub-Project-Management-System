jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const path = require('path');
const logger = require('../Config/loggerConfig');
const { createRegistry } = require('../Modules/Connectors/registry');
const { validate } = require('../Modules/Connectors/validate');
const { CODE, resolveConnection } = require('../Modules/Connectors/resolveConnection');
const google = require('../Modules/Connectors/providers/google');

const FIXTURES = path.join(__dirname, 'fixtures', 'connectors');
const KEYS = ['CONNECTORS', 'CONNECTOR_FAKE_CLIENT_ID', 'CONNECTOR_FAKE_CLIENT_SECRET', 'CONNECTOR_GOOGLE_CLIENT_ID', 'CONNECTOR_GOOGLE_CLIENT_SECRET'];
const FAKE_APP = { CONNECTOR_FAKE_CLIENT_ID: 'id', CONNECTOR_FAKE_CLIENT_SECRET: 'secret' };

const withEnv = (env, fn) => {
    const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    KEYS.forEach((k) => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; });
    try { return fn(); } finally { KEYS.forEach((k) => { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }); }
};

beforeEach(() => logger.error.mockClear());

describe('the connector registry', () => {
    it('picks up a provider from one folder, with no other change', () => {
        const registry = createRegistry({ dir: FIXTURES });
        expect(registry.list().map((p) => p.id)).toEqual(['fake']);
        expect(registry.get('fake').name).toBe('Fake');
        expect(registry.get('missing')).toBeNull();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('loads the Google provider from the module itself', () => {
        const registry = createRegistry();
        expect(registry.get('google')).toBe(google);
        expect(Object.keys(google.products)).toEqual(['calendar', 'meet', 'drive']);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('offers a provider only when CONNECTORS names it and an app is set', () => {
        const registry = createRegistry({ dir: FIXTURES });
        withEnv({ ...FAKE_APP }, () => expect(registry.isOffered('fake')).toBe(false));
        withEnv({ CONNECTORS: 'fake' }, () => expect(registry.isOffered('fake')).toBe(false));
        withEnv({ CONNECTORS: 'fake', CONNECTOR_FAKE_CLIENT_ID: 'id' }, () => expect(registry.isOffered('fake')).toBe(false));
        withEnv({ CONNECTORS: 'off', ...FAKE_APP }, () => expect(registry.offered()).toEqual([]));
        withEnv({ CONNECTORS: 'slack, fake', ...FAKE_APP }, () => {
            expect(registry.isOffered('fake')).toBe(true);
            expect(registry.offered().map((p) => p.id)).toEqual(['fake']);
        });
    });

    it('offers a provider on a company app when the instance has none', () => withEnv({ CONNECTORS: 'fake' }, () => {
        const registry = createRegistry({ dir: FIXTURES });
        expect(registry.isOffered('fake', { companyApps: ['fake'] })).toBe(true);
        expect(registry.isOffered('fake', { companyApps: ['google'] })).toBe(false);
    }));

    it('never offers a provider it has no definition for', () => withEnv({ CONNECTORS: 'ghost', CONNECTOR_GHOST_CLIENT_ID: 'id', CONNECTOR_GHOST_CLIENT_SECRET: 's' }, () => {
        expect(createRegistry({ dir: FIXTURES }).isOffered('ghost', { companyApps: ['ghost'] })).toBe(false);
    }));
});

describe('scopes for ticked products', () => {
    const registry = createRegistry({ dir: FIXTURES });

    it('are the base scopes plus the union of the ticked products, without duplicates', () => {
        expect(registry.scopesFor('fake', ['files', 'notes'])).toEqual(['profile', 'notes.read', 'notes.write', 'files.read']);
        expect(registry.scopesFor('fake', ['files'])).toEqual(['profile', 'files.read', 'notes.read']);
        expect(registry.scopesFor('fake', [])).toEqual(['profile']);
    });

    it('ask Google only for the ticked products', () => {
        const scopes = createRegistry().scopesFor('google', ['drive']);
        expect(scopes).toEqual(['openid', 'email', 'https://www.googleapis.com/auth/drive.file']);
    });

    it('refuse an unknown provider or product', () => {
        expect(() => registry.scopesFor('ghost', [])).toThrow('unknown connector provider ghost');
        expect(() => registry.scopesFor('fake', ['mail'])).toThrow('fake has no product mail');
    });
});

describe('a provider definition', () => {
    const fake = require('./fixtures/connectors/fake');

    it('is valid as the fixture and the Google file are written', () => {
        expect(validate(fake)).toEqual([]);
        expect(validate(google)).toEqual([]);
    });

    it.each([
        ['a non-https endpoint', { auth: { ...fake.auth, tokenUrl: 'http://api.fake.test/token' } }, 'auth.tokenUrl is not an https URL'],
        ['a host outside egressHosts', { auth: { ...fake.auth, tokenUrl: 'https://elsewhere.test/token' } }, 'auth.tokenUrl host elsewhere.test is not in egressHosts'],
        ['a client secret in the file', { auth: { ...fake.auth, clientSecret: 's' } }, 'auth.clientSecret must not be in the definition'],
        ['plain PKCE', { auth: { ...fake.auth, pkce: 'plain' } }, 'auth.pkce must be S256 or empty'],
        ['no products', { products: {} }, 'products is empty'],
        ['a product without scopes', { products: { notes: [] } }, 'product notes needs a lower-case name and at least one scope'],
        ['an upper-case id', { id: 'Fake' }, 'id must be lower-case letters, digits and _'],
        ['no account reader', { readAccount: null }, 'readAccount is not a function'],
    ])('is refused with %s', (label, change, problem) => {
        expect(validate({ ...fake, ...change })).toContain(problem);
    });

    it('reads the Google account by its stable id', () => {
        const claims = Buffer.from(JSON.stringify({ sub: '1234', email: 'a@example.com', email_verified: true })).toString('base64url');
        expect(google.readAccount({ tokenResponse: { id_token: `h.${claims}.s` } })).toEqual({ id: '1234', label: 'a@example.com' });
    });
});

describe('resolveConnection, until 066', () => {
    it('refuses a provider that does not exist', async () => {
        await expect(resolveConnection({ companyId: 'c', userId: 'u', provider: 'ghost' })).rejects.toMatchObject({ code: CODE.PROVIDER_OFF });
    });

    it('says the person has not connected', async () => {
        await expect(resolveConnection({ companyId: 'c', userId: 'u', provider: 'google' })).rejects.toMatchObject({ code: CODE.NOT_CONNECTED, provider: 'google' });
    });

    it('needs a company and a person', async () => {
        await expect(resolveConnection({ provider: 'google' })).rejects.toThrow(TypeError);
    });
});
