const fakeMongo = require('./fixtures/fakeMongo');
const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const migration = require('../migrations/026-knowledge-sources');

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const ID_INDEX = { name: '_id_', key: { _id: 1 } };
const TASK_INDEX = { name: 'sourceType_1_taskId_1', key: { sourceType: 1, taskId: 1 } };
const logger = { info: jest.fn(), error: jest.fn() };

const tenants = ({ broken = [] } = {}) => {
    const db = fakeMongo.create();
    const indexes = {};
    const methods = [];
    const crud = async (companyId, q, method) => {
        methods.push([companyId, q.type, method]);
        if (method === 'createIndexes') {
            if (broken.includes(companyId)) throw new Error('Index build failed: disk full');
            indexes[`${companyId}:${q.type}`] = [ID_INDEX, TASK_INDEX];
            return undefined;
        }
        if (method === 'listIndexes') return indexes[`${companyId}:${q.type}`] || [ID_INDEX];
        return db.crud(companyId, q, method);
    };
    return { crud, methods };
};

const contextFor = (db, companies) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });

beforeEach(() => jest.clearAllMocks());

describe('026-knowledge-sources', () => {
    it('is a valid company-scoped migration listed after 025', () => {
        expect(() => validateMigration(migration, '026-knowledge-sources')).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('026-knowledge-sources')).toBe(ids.indexOf('025-knowledge-chunks') + 1);
    });

    it('the chunk schema declares the fields comments and transcripts are written with, and the task key a task change looks chunks up by', () => {
        ['taskId', 'sprintId', 'participants'].forEach((field) => expect(knowledgeChunksSchema.path(field)).toBeDefined());
        expect(knowledgeChunksSchema.get('strict')).toBe(true);
        expect(knowledgeChunksSchema.indexes()).toContainEqual([{ sourceType: 1, taskId: 1 }, expect.any(Object)]);
    });

    it("builds the chunk store's indexes on every tenant with createIndexes, never syncIndexes, and records the task key", async () => {
        const db = tenants();
        const ctx = contextFor(db, ['c1', 'c2']);

        await migration.up(ctx);

        expect(ctx.companies).toEqual({ c1: { ok: true, taskIndex: 'sourceType_1_taskId_1' }, c2: { ok: true, taskIndex: 'sourceType_1_taskId_1' } });
        expect(db.methods.every(([, type]) => type === CHUNKS)).toBe(true);
        expect(db.methods.map(([, , method]) => method)).not.toContain('syncIndexes');
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('026 c1'));
    });

    it('is safe to run again', async () => {
        const db = tenants();
        await migration.up(contextFor(db, ['c1']));
        const again = contextFor(db, ['c1']);
        await migration.up(again);
        expect(again.companies.c1).toEqual({ ok: true, taskIndex: 'sourceType_1_taskId_1' });
    });

    it('keeps going past a tenant that refuses, then fails so the runner retries it', async () => {
        const db = tenants({ broken: ['c1'] });
        const ctx = contextFor(db, ['c1', 'c2']);

        await expect(migration.up(ctx)).rejects.toThrow(/1 of 2 companies failed: c1/);
        expect(ctx.companies.c1).toMatchObject({ ok: false, error: expect.stringContaining('disk full') });
        expect(ctx.companies.c2).toEqual({ ok: true, taskIndex: 'sourceType_1_taskId_1' });
    });

    it('fails a tenant whose task key is still missing after the build', async () => {
        const db = tenants();
        const crud = db.crud;
        db.crud = async (companyId, q, method) => (method === 'listIndexes' ? [ID_INDEX] : crud(companyId, q, method));
        const ctx = contextFor(db, ['c1']);

        await expect(migration.up(ctx)).rejects.toThrow(/c1/);
        expect(ctx.companies.c1).toMatchObject({ ok: false, error: expect.stringContaining('task') });
    });
});
