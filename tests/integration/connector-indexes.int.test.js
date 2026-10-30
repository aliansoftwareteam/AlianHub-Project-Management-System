/* Task 064's connector_connections index and migration 079 against a real MongoDB, so the partial-index rules
 * the unit test models in JS are Mongo's own. Uses a throwaway database of its own, dropped after. */
const mongoose = require('mongoose');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { connectorConnectionsSchema, connectorAppsSchema, connectorUsageSchema } = require('../../utils/mongo-handler/createSchema');
const migration = require('../../migrations/079-connector-indexes');

const DB = `it_connector_indexes_${process.pid}_${Date.now()}`;
const SCHEMAS = {
    [SCHEMA_TYPE.CONNECTOR_CONNECTIONS]: connectorConnectionsSchema,
    [SCHEMA_TYPE.CONNECTOR_APPS]: connectorAppsSchema,
    [SCHEMA_TYPE.CONNECTOR_USAGE]: connectorUsageSchema,
};

let connection;
let models;

// What MongoDbCrudOpration does with these methods: dropIndex on the collection, everything else on the model.
const ctx = () => ({
    SCHEMA_TYPE,
    company: (companyId, { type, data }, method) => (method === 'dropIndex' ? models[type].collection.dropIndex(...data) : models[type][method](...data)),
});

const Connections = () => models[SCHEMA_TYPE.CONNECTOR_CONNECTIONS];
const live = (extra = {}) => ({ companyId: 'c1', userId: 'u1', provider: 'google', account: { id: 'g-1', label: 'a@example.com' }, deletedStatusKey: 0, ...extra });
const insert = (doc) => Connections().collection.insertOne(doc);
const duplicate = expect.objectContaining({ code: 11000 });

beforeAll(async () => {
    connection = await mongoose.createConnection(`${resolveMongoUrl()}/${DB}`, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 }).asPromise();
    models = Object.fromEntries(Object.entries(SCHEMAS).map(([type, schema]) => [type, connection.model(type, schema, type)]));
});

afterAll(async () => {
    if (connection) {
        await connection.dropDatabase();
        await connection.close();
    }
});

beforeEach(async () => {
    await Connections().collection.drop().catch(() => {});
    await migration.indexCompany(ctx(), DB);
});

describe('connector_connections in MongoDB', () => {
    it('builds one unique connection index, partial on live module rows', async () => {
        const unique = (await Connections().listIndexes()).filter((index) => index.unique);
        expect(unique.map((index) => index.name)).toEqual(['one_live_per_account']);
        expect(unique[0].partialFilterExpression).toEqual({
            companyId: { $type: 'string' }, provider: { $type: 'string' }, 'account.id': { $type: 'string' }, deletedStatusKey: { $eq: 0 },
        });
    });

    it('refuses the same account twice', async () => {
        await insert(live());
        await expect(insert(live())).rejects.toEqual(duplicate);
    });

    it('lets a person connect a second account of the same provider', async () => {
        await insert(live());
        await expect(insert(live({ account: { id: 'g-2' } }))).resolves.toBeDefined();
    });

    it('never lets a pending row block a connect, or another pending row', async () => {
        await insert(live({ status: 'pending', account: undefined }));
        await insert(live({ status: 'pending', account: undefined }));
        await expect(insert(live())).resolves.toBeDefined();
    });

    it('lets the same account connect again after a disconnect', async () => {
        await insert(live({ deletedStatusKey: 1 }));
        await expect(insert(live())).resolves.toBeDefined();
    });

    it('keeps other people, providers and companies apart', async () => {
        await insert(live());
        await insert(live({ userId: 'u2' }));
        await insert(live({ provider: 'dropbox' }));
        await expect(insert(live({ companyId: 'c2' }))).resolves.toBeDefined();
    });

    it('leaves rows from before the module, and rows without companyId, outside the index', async () => {
        const older = { userId: 'u1', connector: 'google_calendar', account: { email: 'a@example.com', sub: 'g-1' }, deletedStatusKey: 0 };
        await insert({ ...older });
        await insert({ ...older });
        await insert(live({ companyId: undefined }));
        await expect(insert(live({ companyId: undefined }))).resolves.toBeDefined();
    });

    it('refuses to save a module row without companyId', async () => {
        await expect(Connections().create({ userId: 'u1', provider: 'google', deletedStatusKey: 0 })).rejects.toThrow(/companyId/);
        await expect(Connections().create({ connector: 'slack', deletedStatusKey: 0 })).resolves.toBeDefined();
    });
});

describe('migration 079 on a database that built the first indexes', () => {
    beforeEach(async () => {
        await Connections().collection.drop().catch(() => {});
        await Connections().collection.createIndex(
            { companyId: 1, userId: 1, provider: 1, 'account.id': 1 },
            { unique: true, name: 'one_live_per_account', partialFilterExpression: { provider: { $type: 'string' }, 'account.id': { $type: 'string' }, deletedStatusKey: { $eq: 0 } } },
        );
        await Connections().collection.createIndex(
            { companyId: 1, userId: 1, provider: 1 },
            { unique: true, name: 'one_live_per_provider', partialFilterExpression: { provider: { $type: 'string' }, deletedStatusKey: { $eq: 0 } } },
        );
        await insert(live());
    });

    it('drops the old indexes, builds the new one, and then takes a second account', async () => {
        await expect(insert(live({ account: { id: 'g-2' } }))).rejects.toEqual(duplicate);
        const built = await migration.indexCompany(ctx(), DB);
        expect(built.dropped.sort()).toEqual(['one_live_per_account', 'one_live_per_provider']);
        const names = (await Connections().listIndexes()).map((index) => index.name);
        expect(names).toContain('one_live_per_account');
        expect(names).not.toContain('one_live_per_provider');
        await expect(insert(live({ account: { id: 'g-2' } }))).resolves.toBeDefined();
        await expect(insert(live())).rejects.toEqual(duplicate);
    });

    it('changes nothing on a second run', async () => {
        await migration.indexCompany(ctx(), DB);
        await expect(migration.indexCompany(ctx(), DB)).resolves.toMatchObject({ dropped: [] });
    });
});
