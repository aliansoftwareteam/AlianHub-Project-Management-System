const mongoose = require('mongoose');
const fakeMongo = require('./fixtures/fakeMongo');

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const createSchema = require('../utils/mongo-handler/createSchema');
const { schema } = require('../utils/mongo-handler/schema');
const { checkType, tableType } = require('../utils/mongo-handler/mongoQueries');

const ID = '040-oauth-server';
const migration = require(`../migrations/${ID}`);

const COLLECTIONS = [
    ['OAUTH_CLIENTS', 'oauth_clients', 'oauthClients', 'oauthClientsSchema', 'client_id', { clientId: 1 }],
    ['OAUTH_GRANTS', 'oauth_grants', 'oauthGrants', 'oauthGrantsSchema', 'grant_id', { grantId: 1 }],
    ['OAUTH_TOKENS', 'oauth_tokens', 'oauthTokens', 'oauthTokensSchema', 'token_hash', { tokenHash: 1 }],
];
const ID_INDEX = { name: '_id_', key: { _id: 1 } };
const TTL_INDEX = { name: 'purge_at', key: { purgeAt: 1 }, expireAfterSeconds: 0 };
const logger = { info: jest.fn(), error: jest.fn() };

const database = ({ ttl = true } = {}) => {
    const db = fakeMongo.create();
    const indexes = {};
    const methods = [];
    const crud = async (companyId, q, method) => {
        methods.push([companyId, q.type, method]);
        if (method === 'createIndexes') {
            const [, , , , unique, key] = COLLECTIONS.find(([name]) => SCHEMA_TYPE[name] === q.type);
            indexes[q.type] = [ID_INDEX, { name: unique, key, unique: true }, ...(ttl && q.type === SCHEMA_TYPE.OAUTH_TOKENS ? [TTL_INDEX] : [])];
            return undefined;
        }
        if (method === 'listIndexes') return indexes[q.type] || [ID_INDEX];
        return db.crud(companyId, q, method);
    };
    return { crud, methods };
};

const contextFor = (db) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => [{ _id: 'c1' }] });

beforeEach(() => jest.clearAllMocks());

describe.each(COLLECTIONS)('the %s collection', (name, collection, schemaKey, schemaName, unique, key) => {
    test('is registered everywhere collections are registered', () => {
        expect(SCHEMA_TYPE[name]).toBe(collection);
        expect(dbCollections[name]).toBe(collection);
        expect(schema[schemaKey]).toBeDefined();
        expect(createSchema[schemaName]).toBeInstanceOf(mongoose.Schema);
        expect(checkType(SCHEMA_TYPE[name])).toBe(createSchema[schemaName]);
        expect(tableType(SCHEMA_TYPE[name])).toBe(collection);
    });

    test(`declares a unique ${unique} index`, () => {
        expect(createSchema[schemaName].indexes()).toContainEqual([key, expect.objectContaining({ unique: true, name: unique })]);
    });
});

describe('the strict schemas', () => {
    test('expire codes and tokens through a TTL index on purgeAt', () => {
        expect(createSchema.oauthTokensSchema.indexes()).toContainEqual([{ purgeAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0 })]);
    });

    test('keep every field the server writes and drop anything else, including a raw token', () => {
        const Model = mongoose.model('s10s2OauthTokens', createSchema.oauthTokensSchema);
        const now = new Date();
        const row = {
            tokenHash: 'a'.repeat(64), kind: 'code', grantId: 'g1', clientId: 'ahc_1', companyId: 'c1', userId: 'u1', scopes: ['tasks:read'],
            resource: 'https://hub.example/mcp', redirectUri: 'http://127.0.0.1:1/cb', codeChallenge: 'x'.repeat(43),
            createdAt: now, expiresAt: now, purgeAt: now, spentAt: null, revokedAt: null,
        };
        const doc = new Model({ ...row, code: 'ahoc_raw', token: 'ahoa_raw' }).toObject();
        expect(doc).toMatchObject(row);
        expect(doc.code).toBeUndefined();
        expect(doc.token).toBeUndefined();
    });

    test('keep a client secret only as its hash', () => {
        const Model = mongoose.model('s10s2OauthClients', createSchema.oauthClientsSchema);
        const row = { clientId: 'ahc_1', kind: 'preregistered', name: 'x', redirectUris: ['https://a.example/cb'], tokenEndpointAuthMethod: 'client_secret_basic', secretHash: 'b'.repeat(64), scopes: [], companyId: 'c1', createdBy: 'u1', createdAt: new Date(), revokedAt: null, revokedBy: 'u2' };
        const doc = new Model({ ...row, clientSecret: 'ahcs_raw', secret: 'ahcs_raw' }).toObject();
        expect(doc).toMatchObject(row);
        expect(JSON.stringify(doc)).not.toContain('ahcs_raw');
    });

    test('keep every grant field', () => {
        const Model = mongoose.model('s10s2OauthGrants', createSchema.oauthGrantsSchema);
        const row = { grantId: 'g1', clientId: 'ahc_1', companyId: 'c1', userId: 'u1', scopes: ['tasks:read'], resource: 'https://hub.example/mcp', createdAt: new Date(), expiresAt: new Date(), revokedAt: new Date(), revokedReason: 'code_reuse' };
        expect(new Model(row).toObject()).toMatchObject(row);
    });
});

describe(ID, () => {
    test('is a valid global migration, alone at 040', () => {
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('global');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('033-csp-reports'));
        expect(ids.filter((id) => id.startsWith('040-'))).toEqual([ID]);
    });

    test('builds the declared indexes in the global database only, without dropping any', async () => {
        const db = database();
        await migration.up(contextFor(db));
        expect(db.methods.every(([companyId]) => companyId === 'global')).toBe(true);
        expect(db.methods.map(([, , method]) => method)).toEqual(['createIndexes', 'listIndexes', 'createIndexes', 'listIndexes', 'createIndexes', 'listIndexes']);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('040 global'));
    });

    test('is safe to run again', async () => {
        const db = database();
        await migration.up(contextFor(db));
        await expect(migration.up(contextFor(db))).resolves.toBeUndefined();
    });

    test('fails when the TTL index did not build, so the runner retries it', async () => {
        await expect(migration.up(contextFor(database({ ttl: false })))).rejects.toThrow('oauth_tokens TTL index missing after createIndexes');
    });
});
