const fakeMongo = require('./fixtures/fakeMongo');
const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const migration = require('../migrations/032-knowledge-file-sweep');

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const KEY = { sourceType: 1, extractDueAt: 1 };
const ID_INDEX = { name: '_id_', key: { _id: 1 } };
const BUILT = { [CHUNKS]: [ID_INDEX, { name: 'sourceType_1_extractDueAt_1', key: KEY }] };
const RECORDED = { fileSweepIndex: 'sourceType_1_extractDueAt_1' };
const logger = { info: jest.fn(), error: jest.fn() };

const tenants = ({ broken = [] } = {}) => {
    const db = fakeMongo.create();
    const indexes = {};
    const methods = [];
    const crud = async (companyId, q, method) => {
        methods.push([companyId, q.type, method]);
        if (method === 'createIndexes') {
            if (broken.includes(companyId)) throw new Error('Index build failed: disk full');
            indexes[`${companyId}:${q.type}`] = BUILT[q.type];
            return undefined;
        }
        if (method === 'listIndexes') return indexes[`${companyId}:${q.type}`] || [ID_INDEX];
        return db.crud(companyId, q, method);
    };
    return { crud, methods };
};

const contextFor = (db, companies) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });

beforeEach(() => jest.clearAllMocks());

describe('032-knowledge-file-sweep', () => {
    it('is a valid company-scoped migration listed after 031', () => {
        expect(() => validateMigration(migration, '032-knowledge-file-sweep')).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('032-knowledge-file-sweep')).toBe(ids.indexOf('031-secrets-by-handle') + 1);
    });

    it('declares the due time on the strict chunk schema and the key the sweep reads, only over rows that have one', () => {
        expect(knowledgeChunksSchema.path('extractDueAt')).toBeDefined();
        expect(knowledgeChunksSchema.path('extractDueAt').instance).toBe('Date');
        expect(knowledgeChunksSchema.get('strict')).toBe(true);
        expect(knowledgeChunksSchema.indexes()).toContainEqual([KEY, expect.objectContaining({ partialFilterExpression: { extractDueAt: { $type: 'date' } } })]);
    });

    it('builds the sweep index on every tenant with createIndexes, never syncIndexes, and records its name', async () => {
        const db = tenants();
        const ctx = contextFor(db, ['c1', 'c2']);

        await migration.up(ctx);

        expect(ctx.companies).toEqual({ c1: { ok: true, ...RECORDED }, c2: { ok: true, ...RECORDED } });
        expect(db.methods.filter(([, , method]) => method === 'createIndexes').map(([companyId, type]) => `${companyId}:${type}`)).toEqual([`c1:${CHUNKS}`, `c2:${CHUNKS}`]);
        expect(db.methods.map(([, , method]) => method)).not.toContain('syncIndexes');
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('032 c1'));
    });

    it('is safe to run again', async () => {
        const db = tenants();
        await migration.up(contextFor(db, ['c1']));
        const again = contextFor(db, ['c1']);
        await migration.up(again);
        expect(again.companies.c1).toEqual({ ok: true, ...RECORDED });
    });

    it('keeps going past a tenant that refuses, then fails so the runner retries it', async () => {
        const db = tenants({ broken: ['c1'] });
        const ctx = contextFor(db, ['c1', 'c2']);

        await expect(migration.up(ctx)).rejects.toThrow(/1 of 2 companies failed: c1/);
        expect(ctx.companies.c1).toMatchObject({ ok: false, error: expect.stringContaining('disk full') });
        expect(ctx.companies.c2).toEqual({ ok: true, ...RECORDED });
    });

    it('fails a tenant whose index is still missing after the build', async () => {
        const db = tenants();
        const crud = db.crud;
        db.crud = async (companyId, q, method) => (method === 'listIndexes' ? [ID_INDEX] : crud(companyId, q, method));
        const ctx = contextFor(db, ['c1']);

        await expect(migration.up(ctx)).rejects.toThrow(/c1/);
        expect(ctx.companies.c1).toMatchObject({ ok: false, error: expect.stringContaining('knowledge_chunks file sweep') });
    });
});
