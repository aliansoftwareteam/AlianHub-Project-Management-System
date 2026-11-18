const mongoose = require('mongoose');
const fakeMongo = require('./fixtures/fakeMongo');

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const createSchema = require('../utils/mongo-handler/createSchema');
const { schema } = require('../utils/mongo-handler/schema');
const { checkType, tableType } = require('../utils/mongo-handler/mongoQueries');

const ID = '042-agent-sessions';
const migration = require(`../migrations/${ID}`);

const ID_INDEX = { name: '_id_', key: { _id: 1 } };
const STATE_INDEX = { name: 'state_1_deliveredAt_1', key: { state: 1, deliveredAt: 1 } };
const CLIENT_INDEX = { name: 'client_id', key: { clientId: 1 }, unique: true };
const logger = { info: jest.fn(), error: jest.fn() };

const tenants = ({ sessionBuilds = [STATE_INDEX], endpointBuilds = [CLIENT_INDEX] } = {}) => {
    const db = fakeMongo.create();
    const indexes = {};
    const crud = async (companyId, q, method) => {
        const key = `${companyId}:${q.type}`;
        if (method === 'createIndexes') {
            indexes[key] = [ID_INDEX, ...(q.type === SCHEMA_TYPE.AGENT_SESSIONS ? sessionBuilds : endpointBuilds)];
            return undefined;
        }
        if (method === 'listIndexes') return indexes[key] || [ID_INDEX];
        return db.crud(companyId, q, method);
    };
    return { crud };
};

const contextFor = (db, companies) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });

describe('the agent session collections', () => {
    test.each([
        ['AGENT_SESSIONS', 'agent_sessions', 'agentSessions', 'agentSessionsSchema'],
        ['AGENT_SESSION_ENDPOINTS', 'agent_session_endpoints', 'agentSessionEndpoints', 'agentSessionEndpointsSchema'],
    ])('%s is registered everywhere collections are registered', (type, name, shape, schemaName) => {
        expect(SCHEMA_TYPE[type]).toBe(name);
        expect(dbCollections[type]).toBe(name);
        expect(schema[shape]).toBeDefined();
        expect(createSchema[schemaName]).toBeInstanceOf(mongoose.Schema);
        expect(checkType(SCHEMA_TYPE[type])).toBe(createSchema[schemaName]);
        expect(tableType(SCHEMA_TYPE[type])).toBe(name);
    });

    test('declares every field a session writes, so the strict schema drops none', () => {
        const declared = Object.keys(schema.agentSessions);
        ['taskId', 'clientId', 'grantId', 'delegatedBy', 'state', 'reason', 'handleHash', 'handleExpiresAt', 'tainted', 'createdAt', 'deliveredAt',
            'firstActivityAt', 'lastActivityAt', 'endedAt', 'activityCount', 'activities', 'assignedDelegator', 'privateSprint']
            .forEach((field) => expect(declared).toContain(field));
    });

    test('keeps one delivery URL per client per workspace', () => {
        expect(createSchema.agentSessionEndpointsSchema.indexes()).toContainEqual([{ clientId: 1 }, expect.objectContaining({ unique: true, name: 'client_id' })]);
    });
});

describe(`migration ${ID}`, () => {
    test('is listed after 040', () => {
        const ids = listMigrations().map((m) => m.id);
        expect(ids).toContain(ID);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('040-oauth-server'));
    });

    test('builds the indexes in every workspace', async () => {
        const db = tenants();
        await migration.up(contextFor(db, ['c1', 'c2']));
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('042 c1'));
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('042 c2'));
    });

    test('fails loudly when an index is missing after createIndexes', async () => {
        await expect(migration.indexCompany(contextFor(tenants({ sessionBuilds: [] }), ['c1']), 'c1')).rejects.toThrow(/state index/);
        await expect(migration.indexCompany(contextFor(tenants({ endpointBuilds: [] }), ['c1']), 'c1')).rejects.toThrow(/unique client index/);
    });
});
