const fakeMongo = require('./fixtures/fakeMongo');
const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { pagesSchema } = require('../utils/mongo-handler/createSchema');

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const migration = require('../migrations/024-knowledge-page-text-index');

const ID_INDEX = { name: '_id_', key: { _id: 1 } };
const TEXT_INDEX = { name: 'title_text_rawText_text', key: { _fts: 'text', _ftsx: 1 }, weights: { title: 1, rawText: 1 } };
const logger = { info: jest.fn(), error: jest.fn() };

/* fakeMongo has no index methods: createIndexes builds the declared text index per tenant, and a
 * tenant listed in `broken` refuses, the way a conflicting index on that database would. */
const tenants = ({ broken = [] } = {}) => {
    const db = fakeMongo.create();
    const indexes = {};
    const methods = [];
    const crud = async (companyId, q, method) => {
        methods.push([companyId, q.type, method]);
        if (method === 'createIndexes') {
            if (broken.includes(companyId)) throw new Error('Index with name: title_text_rawText_text already exists with different options');
            indexes[companyId] = [ID_INDEX, TEXT_INDEX];
            return undefined;
        }
        if (method === 'listIndexes') return indexes[companyId] || [ID_INDEX];
        return db.crud(companyId, q, method);
    };
    return { crud, methods };
};

const contextFor = (db, companies) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });

beforeEach(() => jest.clearAllMocks());

describe('024-knowledge-page-text-index', () => {
    test('is a valid company-scoped migration listed after 023', () => {
        expect(() => validateMigration(migration, '024-knowledge-page-text-index')).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('024-knowledge-page-text-index')).toBe(ids.indexOf('023-agent-project-scope') + 1);
    });

    test('the pages schema declares one text index over the title and the body', () => {
        const text = pagesSchema.indexes().filter(([fields]) => Object.values(fields).includes('text'));
        expect(text).toEqual([[{ title: 'text', rawText: 'text' }, expect.any(Object)]]);
    });

    test('builds the declared indexes on every tenant without dropping any, and records the text index it found', async () => {
        const db = tenants();
        const ctx = contextFor(db, ['c1', 'c2']);

        await migration.up(ctx);

        expect(ctx.companies).toEqual({
            c1: { ok: true, textIndex: 'title_text_rawText_text' },
            c2: { ok: true, textIndex: 'title_text_rawText_text' },
        });
        expect(db.methods.every(([, type]) => type === SCHEMA_TYPE.PAGES)).toBe(true);
        expect(db.methods.map(([, , method]) => method)).not.toContain('syncIndexes');
        expect(db.methods.filter(([, , method]) => method === 'createIndexes').map(([companyId]) => companyId)).toEqual(['c1', 'c2']);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('024 c1'));
    });

    test('is safe to run again', async () => {
        const db = tenants();
        await migration.up(contextFor(db, ['c1']));
        const again = contextFor(db, ['c1']);
        await migration.up(again);
        expect(again.companies.c1).toEqual({ ok: true, textIndex: 'title_text_rawText_text' });
    });

    test('keeps going past a tenant that refuses, then fails so the runner retries it', async () => {
        const db = tenants({ broken: ['c1'] });
        const ctx = contextFor(db, ['c1', 'c2']);

        await expect(migration.up(ctx)).rejects.toThrow(/1 of 2 companies failed: c1/);

        expect(ctx.companies.c1).toMatchObject({ ok: false, error: expect.stringContaining('different options') });
        expect(ctx.companies.c2).toEqual({ ok: true, textIndex: 'title_text_rawText_text' });
    });

    test('fails a tenant whose text index is still missing after the build', async () => {
        const db = tenants();
        const crud = db.crud;
        db.crud = async (companyId, q, method) => (method === 'createIndexes' ? undefined : crud(companyId, q, method));
        const ctx = contextFor(db, ['c1']);

        await expect(migration.up(ctx)).rejects.toThrow(/c1/);
        expect(ctx.companies.c1).toMatchObject({ ok: false, error: expect.stringContaining('text index') });
    });
});
