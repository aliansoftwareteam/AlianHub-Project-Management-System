const fakeMongo = require('./fixtures/fakeMongo');
const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const ID = '043-knowledge-chunk-size';
const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const KEY = { sourceType: 1, deleted: 1, sourceId: 1, embeddingModel: 1, updatedAt: 1, textBytes: 1 };
const NAME = 'sourceType_1_deleted_1_sourceId_1_embeddingModel_1_updatedAt_1_textBytes_1';
const ID_INDEX = { name: '_id_', key: { _id: 1 } };
const logger = { info: jest.fn(), error: jest.fn() };

const load = () => require(`../migrations/${ID}`);

/* Answers the pipeline update the way the server does: $strLenBytes of the text, or of '' when it has none. */
const sizeOf = (doc, stage) => {
    const [field, fallback] = stage.$set.textBytes.$strLenBytes.$ifNull;
    const value = doc[field.slice(1)];
    return Buffer.byteLength(value == null ? fallback : String(value), 'utf8');
};

const tenants = ({ broken = [] } = {}) => {
    const db = fakeMongo.create();
    const indexes = {};
    const methods = [];
    const crud = async (companyId, q, method) => {
        methods.push([companyId, q.type, method, q.data]);
        if (method === 'createIndexes') {
            if (broken.includes(companyId)) throw new Error('Index build failed: disk full');
            indexes[`${companyId}:${q.type}`] = [ID_INDEX, { name: NAME, key: KEY }];
            return undefined;
        }
        if (method === 'dropIndex') {
            const before = indexes[`${companyId}:${q.type}`] || [ID_INDEX];
            const kept = before.filter((index) => index.name !== q.data[0]);
            if (kept.length === before.length) throw Object.assign(new Error('index not found with name'), { code: 27 });
            indexes[`${companyId}:${q.type}`] = kept;
            return undefined;
        }
        if (method === 'listIndexes') return indexes[`${companyId}:${q.type}`] || [ID_INDEX];
        if (method === 'updateMany' && Array.isArray(q.data[1])) {
            const rows = (db.store[q.type] || []).filter((doc) => String(doc.companyId) === companyId && doc.textBytes === undefined);
            rows.forEach((doc) => { doc.textBytes = sizeOf(doc, q.data[1][0]); });
            return { matchedCount: rows.length, modifiedCount: rows.length };
        }
        return db.crud(companyId, q, method);
    };
    return { db, crud, methods, indexes };
};

const contextFor = (t, companies) => buildContext({ MongoDbCrudOpration: t.crud, SCHEMA_TYPE, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });

beforeEach(() => jest.clearAllMocks());

describe('043-knowledge-chunk-size', () => {
    it('is a valid company-scoped migration listed after 042', () => {
        const migration = load();
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBe(ids.indexOf('042-agent-sessions') + 1);
    });

    it('stores the UTF-8 size of every chunk that has none, leaves a stored one alone, and keeps updatedAt', async () => {
        const t = tenants();
        const at = new Date('2026-09-01T00:00:00Z');
        t.db.seed(CHUNKS, { companyId: 'c1', sourceType: 'page', sourceId: 'p1', ordinal: 0, text: 'café ☕', updatedAt: at });
        t.db.seed(CHUNKS, { companyId: 'c1', sourceType: 'file', sourceId: 'f1', ordinal: 0, updatedAt: at });
        t.db.seed(CHUNKS, { companyId: 'c1', sourceType: 'page', sourceId: 'p2', ordinal: 0, text: 'abc', textBytes: 99, updatedAt: at });
        const ctx = contextFor(t, ['c1']);

        await load().up(ctx);

        const rows = t.db.store[CHUNKS];
        expect(rows.map((row) => row.textBytes)).toEqual([Buffer.byteLength('café ☕', 'utf8'), 0, 99]);
        rows.forEach((row) => expect(row.updatedAt).toEqual(at));
        const update = t.methods.find(([, type, method]) => type === CHUNKS && method === 'updateMany');
        expect(update[3][0]).toEqual({ textBytes: { $exists: false } });
        expect(update[3][2]).toMatchObject({ timestamps: false });
        expect(ctx.companies.c1).toEqual({ ok: true, sized: 2, figuresIndex: NAME });
    });

    it('builds the figures index with createIndexes after the sizes are stored, never syncIndexes', async () => {
        const t = tenants();
        await load().up(contextFor(t, ['c1', 'c2']));
        const chunkMethods = t.methods.filter(([, type]) => type === CHUNKS).map(([companyId, , method]) => `${companyId}:${method}`);
        expect(chunkMethods.indexOf('c1:updateMany')).toBeLessThan(chunkMethods.indexOf('c1:createIndexes'));
        expect(chunkMethods).toContain('c2:createIndexes');
        expect(chunkMethods.join(' ')).not.toMatch(/syncIndexes/);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('043 c1'));
    });

    it('is safe to run again', async () => {
        const t = tenants();
        t.db.seed(CHUNKS, { companyId: 'c1', sourceType: 'page', sourceId: 'p1', ordinal: 0, text: 'abc' });
        await load().up(contextFor(t, ['c1']));
        const again = contextFor(t, ['c1']);
        await load().up(again);
        expect(again.companies.c1).toEqual({ ok: true, sized: 0, figuresIndex: NAME });
    });

    it('keeps going past a tenant that refuses, then fails so the runner retries it', async () => {
        const t = tenants({ broken: ['c1'] });
        const ctx = contextFor(t, ['c1', 'c2']);
        await expect(load().up(ctx)).rejects.toThrow(/1 of 2 companies failed: c1/);
        expect(ctx.companies.c2).toMatchObject({ ok: true, figuresIndex: NAME });
    });

    it('drops the index on the way down, safely twice', async () => {
        const t = tenants();
        await load().up(contextFor(t, ['c1']));
        const down = contextFor(t, ['c1']);
        await load().down(down);
        expect(down.companies.c1).toMatchObject({ ok: true, dropped: NAME });
        expect(t.indexes[`c1:${CHUNKS}`].map((index) => index.name)).not.toContain(NAME);
        const twice = contextFor(t, ['c1']);
        await load().down(twice);
        expect(twice.companies.c1).toMatchObject({ ok: true, dropped: null });
    });

    it('builds the index the schema declares', () => {
        expect(knowledgeChunksSchema.indexes().map(([key]) => key)).toContainEqual(KEY);
    });
});
