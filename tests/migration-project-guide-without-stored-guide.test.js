const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { documentOf, SEEDS } = require('../Modules/Agents/skills/seeds');
const firstSeed = require('../migrations/lib/projectGuideFirstSeed');
const migration = require('../migrations/076-project-guide-without-stored-guide');

const UNTOUCHED = '6f0000000000000000000d01';
const EDITED = '6f0000000000000000000d02';
const NONE = '6f0000000000000000000d03';

const logger = { info: jest.fn(), error: jest.fn() };
const context = () => buildContext({
    MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger,
    listCompanies: async () => [{ _id: UNTOUCHED }, { _id: EDITED }, { _id: NONE }],
});
const guideOf = (companyId) => (mockDbFor(companyId).store[SCHEMA_TYPE.AGENT_SKILLS] || []).find((s) => s.key === 'project.guide');

describe('migration 076: project.guide answers without a stored guide', () => {
    beforeEach(() => {
        Object.keys(mockDbs).forEach((id) => delete mockDbs[id]);
        mockDbFor(UNTOUCHED).seed(SCHEMA_TYPE.AGENT_SKILLS, { ...documentOf(firstSeed), enabled: false, model: 'kept-model' });
        mockDbFor(EDITED).seed(SCHEMA_TYPE.AGENT_SKILLS, { ...documentOf(firstSeed), name: 'Our guide' });
    });

    it('is listed and fingerprints the first seed, which the current seed no longer matches', () => {
        expect(listMigrations().map((m) => m.id)).toContain(migration.id);
        expect(migration.fingerprint(documentOf(firstSeed))).toBe(migration.FIRST_SEED_SHA256);
        expect(migration.fingerprint(documentOf(SEEDS.projectGuide))).not.toBe(migration.FIRST_SEED_SHA256);
    });

    it('moves an unedited copy to the new seed, keeps an edited one, and is a no-op the second time', async () => {
        await migration.up(context());
        const updated = guideOf(UNTOUCHED);
        expect(updated.gather[0].params.requireGuide).toBe(false);
        expect(updated.prompt.template).toContain('none stored for this project');
        expect(migration.fingerprint(updated)).toBe(migration.fingerprint(documentOf(SEEDS.projectGuide)));
        expect(updated).toMatchObject({ enabled: false, model: 'kept-model' });

        const edited = guideOf(EDITED);
        expect(edited.name).toBe('Our guide');
        expect(edited.gather[0].params.requireGuide).toBe(true);
        expect(guideOf(NONE)).toBeUndefined();

        await migration.up(context());
        expect(migration.fingerprint(guideOf(UNTOUCHED))).toBe(migration.fingerprint(documentOf(SEEDS.projectGuide)));
    });

    it('down() puts the first seed back on copies still on the new seed, and leaves edited ones', async () => {
        await migration.up(context());
        await migration.down(context());
        expect(migration.fingerprint(guideOf(UNTOUCHED))).toBe(migration.FIRST_SEED_SHA256);
        expect(guideOf(UNTOUCHED).gather[0].params.requireGuide).toBe(true);
        expect(guideOf(UNTOUCHED)).toMatchObject({ enabled: false, model: 'kept-model' });
        expect(guideOf(EDITED).name).toBe('Our guide');
    });
});
