const fakeMongo = require('./fixtures/fakeMongo');
const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema, knowledgeIndexStateSchema, commentSchema } = require('../utils/mongo-handler/createSchema');

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const migration = require('../migrations/026-knowledge-sources');

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const COMMENTS = SCHEMA_TYPE.COMMENTS;
const ID_INDEX = { name: '_id_', key: { _id: 1 } };
const BUILT = {
    [CHUNKS]: [ID_INDEX, { name: 'sourceType_1_taskId_1', key: { sourceType: 1, taskId: 1 } }],
    [COMMENTS]: [ID_INDEX, { name: 'taskId_1', key: { taskId: 1 } }],
};
const RECORDED = { taskIndex: 'sourceType_1_taskId_1', commentTaskIndex: 'taskId_1' };
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

describe('026-knowledge-sources', () => {
    it('is a valid company-scoped migration listed after 025', () => {
        expect(() => validateMigration(migration, '026-knowledge-sources')).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('026-knowledge-sources')).toBe(ids.indexOf('025-knowledge-chunks') + 1);
    });

    it('declares the fields comments, transcripts, tombstone reasons and the heartbeat are written with, and the task keys', () => {
        ['taskId', 'sprintId', 'participants', 'tombstoneReason'].forEach((field) => expect(knowledgeChunksSchema.path(field)).toBeDefined());
        expect(knowledgeChunksSchema.get('strict')).toBe(true);
        expect(knowledgeChunksSchema.indexes()).toContainEqual([{ sourceType: 1, taskId: 1 }, expect.any(Object)]);
        ['lastSeenOnAt', 'catchUpFrom', 'catchUpPass'].forEach((field) => expect(knowledgeIndexStateSchema.path(field)).toBeDefined());
        expect(knowledgeIndexStateSchema.get('strict')).toBe(true);
        expect(commentSchema.indexes()).toContainEqual([{ taskId: 1 }, expect.any(Object)]);
    });

    it("builds the chunk store's and the comments' indexes on every tenant with createIndexes, never syncIndexes, and records both task keys", async () => {
        const db = tenants();
        const ctx = contextFor(db, ['c1', 'c2']);

        await migration.up(ctx);

        expect(ctx.companies).toEqual({ c1: { ok: true, ...RECORDED }, c2: { ok: true, ...RECORDED } });
        expect(db.methods.filter(([, , method]) => method === 'createIndexes').map(([companyId, type]) => `${companyId}:${type}`))
            .toEqual([`c1:${CHUNKS}`, `c1:${COMMENTS}`, `c2:${CHUNKS}`, `c2:${COMMENTS}`]);
        expect(db.methods.map(([, , method]) => method)).not.toContain('syncIndexes');
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('026 c1'));
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

    it.each([
        ['knowledge_chunks task', CHUNKS],
        ['comments task', COMMENTS],
    ])('fails a tenant whose %s index is still missing after the build', async (label, type) => {
        const db = tenants();
        const crud = db.crud;
        db.crud = async (companyId, q, method) => (method === 'listIndexes' && q.type === type ? [ID_INDEX] : crud(companyId, q, method));
        const ctx = contextFor(db, ['c1']);

        await expect(migration.up(ctx)).rejects.toThrow(/c1/);
        expect(ctx.companies.c1).toMatchObject({ ok: false, error: expect.stringContaining(label) });
    });
});
