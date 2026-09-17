const fakeMongo = require('./fixtures/fakeMongo');
const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema, knowledgeIndexStateSchema } = require('../utils/mongo-handler/createSchema');

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const migration = require('../migrations/025-knowledge-chunks');

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const STATE = SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE;
const ID_INDEX = { name: '_id_', key: { _id: 1 } };
const TEXT_INDEX = { name: 'text_text', key: { _fts: 'text', _ftsx: 1 }, weights: { text: 1 } };
const SOURCE_INDEX = { name: 'sourceType_1_sourceId_1_ordinal_1', key: { sourceType: 1, sourceId: 1, ordinal: 1 }, unique: true };
const STATE_INDEX = { name: 'sourceType_1', key: { sourceType: 1 }, unique: true };
const logger = { info: jest.fn(), error: jest.fn() };

/* fakeMongo has no index methods: createIndexes builds the declared indexes per tenant and collection, and a
 * tenant listed in `broken` refuses, the way a conflicting index on that database would. */
const tenants = ({ broken = [] } = {}) => {
    const db = fakeMongo.create();
    const indexes = {};
    const methods = [];
    const crud = async (companyId, q, method) => {
        methods.push([companyId, q.type, method]);
        if (method === 'createIndexes') {
            if (broken.includes(companyId)) throw new Error('Index with name: text_text already exists with different options');
            indexes[`${companyId}:${q.type}`] = q.type === CHUNKS ? [ID_INDEX, TEXT_INDEX, SOURCE_INDEX] : [ID_INDEX, STATE_INDEX];
            return undefined;
        }
        if (method === 'listIndexes') return indexes[`${companyId}:${q.type}`] || [ID_INDEX];
        return db.crud(companyId, q, method);
    };
    return { crud, methods };
};

const contextFor = (db, companies) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });
const RECORDED = { textIndex: 'text_text', sourceIndex: 'sourceType_1_sourceId_1_ordinal_1', stateIndex: 'sourceType_1' };

beforeEach(() => jest.clearAllMocks());

describe('025-knowledge-chunks', () => {
    it('is a valid company-scoped migration listed after 024', () => {
        expect(() => validateMigration(migration, '025-knowledge-chunks')).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('025-knowledge-chunks')).toBe(ids.indexOf('024-knowledge-page-text-index') + 1);
    });

    it('the chunk schema declares a text index over the chunk text and one chunk per source and ordinal', () => {
        const declared = knowledgeChunksSchema.indexes();
        expect(declared.filter(([fields]) => Object.values(fields).includes('text'))).toEqual([[{ text: 'text' }, expect.any(Object)]]);
        expect(declared).toContainEqual([{ sourceType: 1, sourceId: 1, ordinal: 1 }, expect.objectContaining({ unique: true })]);
        expect(knowledgeIndexStateSchema.indexes()).toContainEqual([{ sourceType: 1 }, expect.objectContaining({ unique: true })]);
    });

    it('declares every field a chunk is written with, since the schema is strict', () => {
        ['companyId', 'sourceType', 'sourceId', 'ordinal', 'projectId', 'visibility', 'createdBy', 'authorKind', 'title', 'headingPath', 'text', 'contentHash', 'embeddingModel', 'deleted', 'deletedAt', 'sourceUpdatedAt']
            .forEach((field) => expect(knowledgeChunksSchema.path(field)).toBeDefined());
        expect(knowledgeChunksSchema.get('strict')).toBe(true);
        ['companyId', 'sourceType', 'status', 'cursor', 'indexed', 'skipped', 'startedAt', 'finishedAt', 'lastRunAt', 'error']
            .forEach((field) => expect(knowledgeIndexStateSchema.path(field)).toBeDefined());
    });

    it('builds both collections\' indexes on every tenant without dropping any, and records what it found', async () => {
        const db = tenants();
        const ctx = contextFor(db, ['c1', 'c2']);

        await migration.up(ctx);

        expect(ctx.companies).toEqual({ c1: { ok: true, ...RECORDED }, c2: { ok: true, ...RECORDED } });
        expect(db.methods.every(([, type]) => [CHUNKS, STATE].includes(type))).toBe(true);
        expect(db.methods.map(([, , method]) => method)).not.toContain('syncIndexes');
        expect(db.methods.filter(([, , method]) => method === 'createIndexes').map(([companyId, type]) => `${companyId}:${type}`))
            .toEqual([`c1:${CHUNKS}`, `c1:${STATE}`, `c2:${CHUNKS}`, `c2:${STATE}`]);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('025 c1'));
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

        expect(ctx.companies.c1).toMatchObject({ ok: false, error: expect.stringContaining('different options') });
        expect(ctx.companies.c2).toEqual({ ok: true, ...RECORDED });
    });

    it.each([
        ['text index', (list) => list.filter((index) => index.key._fts !== 'text')],
        ['unique source index', (list) => list.filter((index) => !index.unique)],
    ])('fails a tenant whose %s is still missing after the build', async (label, strip) => {
        const db = tenants();
        const crud = db.crud;
        db.crud = async (companyId, q, method) => (method === 'listIndexes' && q.type === CHUNKS ? strip(await crud(companyId, q, method)) : crud(companyId, q, method));
        const ctx = contextFor(db, ['c1']);

        await expect(migration.up(ctx)).rejects.toThrow(/c1/);
        expect(ctx.companies.c1).toMatchObject({ ok: false, error: expect.stringContaining(label.split(' ')[0]) });
    });
});
