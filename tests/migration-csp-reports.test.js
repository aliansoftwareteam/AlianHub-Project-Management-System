const mongoose = require('mongoose');
const fakeMongo = require('./fixtures/fakeMongo');

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const createSchema = require('../utils/mongo-handler/createSchema');
const { schema } = require('../utils/mongo-handler/schema');
const { checkType, tableType } = require('../utils/mongo-handler/mongoQueries');

const ID = '033-csp-reports';
const migration = require(`../migrations/${ID}`);

const THIRTY_DAYS = 30 * 24 * 60 * 60;
const ID_INDEX = { name: '_id_', key: { _id: 1 } };
const TTL_INDEX = { name: 'day_1', key: { day: 1 }, expireAfterSeconds: THIRTY_DAYS };
const KEY_INDEX = { name: 'report_key', key: { day: 1, directive: 1, blockedHost: 1, documentPath: 1 }, unique: true };
const logger = { info: jest.fn(), error: jest.fn() };

const database = ({ builds = [TTL_INDEX, KEY_INDEX] } = {}) => {
    const db = fakeMongo.create();
    const indexes = {};
    const methods = [];
    const crud = async (companyId, q, method) => {
        methods.push([companyId, q.type, method]);
        if (method === 'createIndexes') { indexes[companyId] = [ID_INDEX, ...builds]; return undefined; }
        if (method === 'listIndexes') return indexes[companyId] || [ID_INDEX];
        return db.crud(companyId, q, method);
    };
    return { crud, methods };
};

const contextFor = (db) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => [{ _id: 'c1' }] });

beforeEach(() => jest.clearAllMocks());

describe('the csp_reports collection', () => {
    test('is registered everywhere collections are registered', () => {
        expect(SCHEMA_TYPE.CSP_REPORTS).toBe('csp_reports');
        expect(dbCollections.CSP_REPORTS).toBe('csp_reports');
        expect(schema.cspReports).toBeDefined();
        expect(createSchema.cspReportsSchema).toBeInstanceOf(mongoose.Schema);
        expect(checkType(SCHEMA_TYPE.CSP_REPORTS)).toBe(createSchema.cspReportsSchema);
        expect(tableType(SCHEMA_TYPE.CSP_REPORTS)).toBe('csp_reports');
    });

    test('expires rows 30 days after their day through a TTL index', () => {
        expect(createSchema.cspReportsSchema.indexes()).toContainEqual([{ day: 1 }, expect.objectContaining({ expireAfterSeconds: THIRTY_DAYS })]);
    });

    test('keeps one row per day, directive, blocked host and document path', () => {
        expect(createSchema.cspReportsSchema.indexes()).toContainEqual([KEY_INDEX.key, expect.objectContaining({ unique: true, name: 'report_key' })]);
    });

    test('declares the aggregate fields and drops anything else a report carries', () => {
        const Model = mongoose.model('s8s12CspReports', createSchema.cspReportsSchema);
        const now = new Date();
        const row = { day: now, directive: 'img-src', blockedHost: 'cdn.example.com', documentPath: '/:id/project', count: 3, lastSeen: now };
        const doc = new Model({ ...row, blockedUri: 'https://cdn.example.com/a?token=1', documentUri: 'https://hub.example.com/?t=1', sample: 'x', referrer: 'y', userAgent: 'z', ip: '10.0.0.1' }).toObject();
        expect(doc).toMatchObject(row);
        expect(Object.keys(doc).sort()).toEqual(['_id', 'blockedHost', 'count', 'day', 'directive', 'documentPath', 'lastSeen']);
    });
});

describe(ID, () => {
    test('is a valid global migration that sorts after 030', () => {
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('global');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('030-audit-chain'));
        expect(ids.filter((id) => id.startsWith('033-'))).toEqual([ID]);
    });

    test('builds the declared indexes in the global database only, without dropping any', async () => {
        const db = database();
        await migration.up(contextFor(db));
        expect(db.methods).toEqual([['global', SCHEMA_TYPE.CSP_REPORTS, 'createIndexes'], ['global', SCHEMA_TYPE.CSP_REPORTS, 'listIndexes']]);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('033 global'));
    });

    test('is safe to run again', async () => {
        const db = database();
        await migration.up(contextFor(db));
        await expect(migration.up(contextFor(db))).resolves.toBeUndefined();
    });

    test('fails when the TTL index did not build, so the runner retries it', async () => {
        const db = database({ builds: [KEY_INDEX] });
        await expect(migration.up(contextFor(db))).rejects.toThrow('csp_reports TTL index missing after createIndexes');
    });
});
