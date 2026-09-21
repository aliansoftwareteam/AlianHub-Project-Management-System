const mongoose = require('mongoose');
const fakeMongo = require('./fixtures/fakeMongo');

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const createSchema = require('../utils/mongo-handler/createSchema');
const { schema } = require('../utils/mongo-handler/schema');
const { checkType, tableType } = require('../utils/mongo-handler/mongoQueries');

const ID = '041-oauth-client-approvals';
const migration = require(`../migrations/${ID}`);
const ID_INDEX = { name: '_id_', key: { _id: 1 } };
const logger = { info: jest.fn(), error: jest.fn() };

const database = ({ unique = true } = {}) => {
    const db = fakeMongo.create();
    const indexes = {};
    const methods = [];
    const crud = async (companyId, q, method) => {
        methods.push([companyId, q.type, method]);
        if (method === 'createIndexes') {
            indexes[q.type] = [ID_INDEX, ...(unique ? [{ name: 'company_client', key: { companyId: 1, clientId: 1 }, unique: true }] : [])];
            return undefined;
        }
        if (method === 'listIndexes') return indexes[q.type] || [ID_INDEX];
        return db.crud(companyId, q, method);
    };
    return { crud, methods };
};

const contextFor = (db) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => [{ _id: 'c1' }] });

beforeEach(() => jest.clearAllMocks());

describe('the oauth_client_approvals collection', () => {
    test('is registered everywhere collections are registered', () => {
        expect(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS).toBe('oauth_client_approvals');
        expect(dbCollections.OAUTH_CLIENT_APPROVALS).toBe('oauth_client_approvals');
        expect(schema.oauthClientApprovals).toBeDefined();
        expect(createSchema.oauthClientApprovalsSchema).toBeInstanceOf(mongoose.Schema);
        expect(checkType(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS)).toBe(createSchema.oauthClientApprovalsSchema);
        expect(tableType(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS)).toBe('oauth_client_approvals');
    });

    test('holds one approval per client per workspace', () => {
        expect(createSchema.oauthClientApprovalsSchema.indexes()).toContainEqual([{ companyId: 1, clientId: 1 }, expect.objectContaining({ unique: true, name: 'company_client' })]);
    });

    test('keeps every field the server writes, the private-sprint opt-in included, and drops anything else', () => {
        const Model = mongoose.model('s10s3OauthClientApprovals', createSchema.oauthClientApprovalsSchema);
        const now = new Date();
        const row = {
            companyId: 'c1', clientId: 'https://agent.example/client.json', clientName: 'Agent', clientKind: 'metadata_document', redirectHosts: ['127.0.0.1'],
            status: 'approved', scopes: ['tasks:read'], requestedScopes: ['tasks:read', 'tasks:write'], privateSprints: true,
            requestedBy: 'u1', requestedAt: now, decidedBy: 'u2', decidedAt: now, revokedBy: 'u3', revokedAt: now, updatedAt: now,
        };
        const doc = new Model({ ...row, secret: 'x' }).toObject();
        expect(doc).toMatchObject(row);
        expect(doc.secret).toBeUndefined();
    });

    test('keeps when a grant was last used', () => {
        const Model = mongoose.model('s10s3OauthGrants', createSchema.oauthGrantsSchema);
        const lastUsedAt = new Date();
        expect(new Model({ grantId: 'g1', lastUsedAt }).toObject().lastUsedAt).toEqual(lastUsedAt);
    });
});

describe(ID, () => {
    test('is a valid global migration, alone at 041, after 040', () => {
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('global');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('040-oauth-server'));
        expect(ids.filter((id) => id.startsWith('041-'))).toEqual([ID]);
    });

    test('builds the declared indexes in the global database only, without dropping any', async () => {
        const db = database();
        await migration.up(contextFor(db));
        expect(db.methods.every(([companyId]) => companyId === 'global')).toBe(true);
        expect(db.methods.map(([, type, method]) => [type, method])).toEqual([
            ['oauth_client_approvals', 'createIndexes'], ['oauth_client_approvals', 'listIndexes'],
            ['oauth_grants', 'createIndexes'],
        ]);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('041 global'));
    });

    test('is safe to run again', async () => {
        const db = database();
        await migration.up(contextFor(db));
        await expect(migration.up(contextFor(db))).resolves.toBeUndefined();
    });

    test('fails when the unique index did not build, so the runner retries it', async () => {
        await expect(migration.up(contextFor(database({ unique: false })))).rejects.toThrow(/company_client/);
    });
});
