const mongoose = require('mongoose');
const fakeMongo = require('./fixtures/fakeMongo');

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const createSchema = require('../utils/mongo-handler/createSchema');
const { schema } = require('../utils/mongo-handler/schema');
const { checkType, tableType } = require('../utils/mongo-handler/mongoQueries');

const ID = '029-permission-decisions';
const migration = require(`../migrations/${ID}`);

const THIRTY_DAYS = 30 * 24 * 60 * 60;
const ID_INDEX = { name: '_id_', key: { _id: 1 } };
const TTL_INDEX = { name: 'day_1', key: { day: 1 }, expireAfterSeconds: THIRTY_DAYS };
const KEY_INDEX = { name: 'decision_key', key: { day: 1, mode: 1, method: 1, route: 1, permission: 1, role: 1, scope: 1, reason: 1 }, unique: true };
const logger = { info: jest.fn(), error: jest.fn() };

const tenants = ({ broken = [], builds = [TTL_INDEX, KEY_INDEX], globalBuilds = [TTL_INDEX, KEY_INDEX] } = {}) => {
    const db = fakeMongo.create();
    const indexes = {};
    const methods = [];
    const crud = async (companyId, q, method) => {
        methods.push([companyId, q.type, method]);
        if (method === 'createIndexes') {
            if (broken.includes(companyId)) throw new Error('Index with name: day_1 already exists with different options');
            indexes[companyId] = [ID_INDEX, ...(companyId === 'global' ? globalBuilds : builds)];
            return undefined;
        }
        if (method === 'listIndexes') return indexes[companyId] || [ID_INDEX];
        return db.crud(companyId, q, method);
    };
    return { crud, methods };
};

const contextFor = (db, companies) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });

beforeEach(() => jest.clearAllMocks());

describe('the permission_decisions collection', () => {
    test('is registered everywhere collections are registered', () => {
        expect(SCHEMA_TYPE.PERMISSION_DECISIONS).toBe('permission_decisions');
        expect(dbCollections.PERMISSION_DECISIONS).toBe('permission_decisions');
        expect(schema.permissionDecisions).toBeDefined();
        expect(createSchema.permissionDecisionsSchema).toBeInstanceOf(mongoose.Schema);
        expect(checkType(SCHEMA_TYPE.PERMISSION_DECISIONS)).toBe(createSchema.permissionDecisionsSchema);
        expect(tableType(SCHEMA_TYPE.PERMISSION_DECISIONS)).toBe('permission_decisions');
    });

    test('expires rows 30 days after their day through a TTL index', () => {
        const indexes = createSchema.permissionDecisionsSchema.indexes();
        expect(indexes).toContainEqual([{ day: 1 }, expect.objectContaining({ expireAfterSeconds: THIRTY_DAYS })]);
    });

    test('keeps one row per day, mode, method, route pattern, key, role, scope and reason', () => {
        const indexes = createSchema.permissionDecisionsSchema.indexes();
        expect(indexes).toContainEqual([KEY_INDEX.key, expect.objectContaining({ unique: true, name: 'decision_key' })]);
    });

    test('declares every field the recorder writes, and nothing that could hold a body or a query string', () => {
        const Model = mongoose.model('s8s2PermissionDecisions', createSchema.permissionDecisionsSchema);
        const now = new Date();
        const row = {
            day: now, mode: 'report', method: 'POST', route: '/api/v1/createproject', permission: 'project.project_create',
            role: 3, scope: 'global', reason: 'denied', count: 2, firstSeen: now, lastSeen: now, lastAuditedAt: now, userIds: ['6f0000000000000000000003'],
        };
        const doc = new Model({ ...row, body: { secret: 1 }, query: 'a=1', url: '/api/v1/createproject?a=1' }).toObject();
        expect(doc).toMatchObject(row);
        expect(Object.keys(doc).sort()).toEqual(['_id', 'count', 'day', 'firstSeen', 'lastAuditedAt', 'lastSeen', 'method', 'mode', 'permission', 'reason', 'role', 'route', 'scope', 'userIds'].sort());
    });
});

describe(ID, () => {
    test('is a valid company-scoped migration listed after 028', () => {
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBe(ids.indexOf('028-clear-task-update-tokens') + 1);
    });

    test('builds the declared indexes in the instance bucket and on every tenant without dropping any, and records the TTL index it found', async () => {
        const db = tenants();
        const ctx = contextFor(db, ['c1', 'c2']);

        await migration.up(ctx);

        expect(db.methods.filter(([, , method]) => method === 'createIndexes').map(([companyId]) => companyId)).toEqual(['global', 'c1', 'c2']);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('029 global'));
        expect(ctx.companies).toEqual({
            c1: { ok: true, ttlIndex: 'day_1', expireAfterSeconds: THIRTY_DAYS },
            c2: { ok: true, ttlIndex: 'day_1', expireAfterSeconds: THIRTY_DAYS },
        });
        expect(db.methods.every(([, type]) => type === SCHEMA_TYPE.PERMISSION_DECISIONS)).toBe(true);
        expect(db.methods.map(([, , method]) => method)).not.toContain('syncIndexes');
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('029 c1'));
    });

    test('is safe to run again', async () => {
        const db = tenants();
        await migration.up(contextFor(db, ['c1']));
        const again = contextFor(db, ['c1']);
        await migration.up(again);
        expect(again.companies.c1).toEqual({ ok: true, ttlIndex: 'day_1', expireAfterSeconds: THIRTY_DAYS });
    });

    test('keeps going past a tenant that refuses, then fails so the runner retries it', async () => {
        const db = tenants({ broken: ['c1'] });
        const ctx = contextFor(db, ['c1', 'c2']);

        await expect(migration.up(ctx)).rejects.toThrow(/1 of 2 companies failed: c1/);

        expect(ctx.companies.c1).toMatchObject({ ok: false, error: expect.stringContaining('different options') });
        expect(ctx.companies.c2).toEqual({ ok: true, ttlIndex: 'day_1', expireAfterSeconds: THIRTY_DAYS });
    });

    test('fails, before touching any tenant, when the instance bucket cannot be indexed', async () => {
        const db = tenants({ broken: ['global'] });
        const ctx = contextFor(db, ['c1']);

        await expect(migration.up(ctx)).rejects.toThrow(/different options/);
        expect(db.methods.map(([companyId]) => companyId)).not.toContain('c1');
    });

    test('fails a tenant whose TTL index is still missing after the build', async () => {
        const db = tenants({ builds: [KEY_INDEX] });
        const ctx = contextFor(db, ['c1']);

        await expect(migration.up(ctx)).rejects.toThrow(/c1/);
        expect(ctx.companies.c1).toMatchObject({ ok: false, error: expect.stringContaining('TTL index') });
    });
});
