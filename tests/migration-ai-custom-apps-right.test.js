const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0, keys: () => [] } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Modules/MainChats/controller', () => ({ updateMainChat: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { importCompanyRules } = require('../utils/data');
const aiRights = require('../Config/aiRights');
const migration = require('../migrations/086-ai-custom-apps-right');

const OLD = '6f0000000000000000000c71';
const PEOPLE = { owner: '6f0000000000000000000a71', member: '6f0000000000000000000a73', guest: '6f0000000000000000000a70' };
const ROLE_OF = { owner: 1, member: 3, guest: 0 };
const KEY = aiRights.AI_RIGHT.CUSTOM_APPS;

const logger = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });
const rules = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.RULES] || [];
const ruleFor = (companyId, key) => rules(companyId).find((r) => r.key === key && r.projectId === undefined);

/* A workspace seeded before the row existed: today's catalogue without it, and a member who holds every other AI row. */
const seedOldCompany = async (companyId) => {
    const db = mockDbFor(companyId);
    db.seed(SCHEMA_TYPE.SETTINGS, { name: settingsCollectionDocs.ROLES, settings: [{ key: 0, name: 'Guest' }, { key: 1, name: 'Owner' }, { key: 2, name: 'Admin' }, { key: 3, name: 'Member' }] });
    Object.entries(PEOPLE).forEach(([person, userId]) => db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: ROLE_OF[person], status: 2, isDelete: false }));
    await importCompanyRules(companyId);
    db.store[SCHEMA_TYPE.RULES] = rules(companyId).filter((r) => r.key !== KEY);
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe('086-ai-custom-apps-right', () => {
    test('is a valid company-scoped migration listed after 082', () => {
        expect(() => validateMigration(migration, '086-ai-custom-apps-right')).not.toThrow();
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('086-ai-custom-apps-right')).toBeGreaterThan(ids.indexOf('085-agent-connector-ticks'));
    });

    test('adds the row to a workspace that lacks it and grants it to nobody', async () => {
        await seedOldCompany(OLD);
        expect(ruleFor(OLD, KEY)).toBeUndefined();
        await migration.up(contextFor([OLD]));
        expect(ruleFor(OLD, KEY)).toMatchObject({ dependency: 'artificial_intelligence', switchOnly: true });
        expect(await aiRights.mayUse(OLD, PEOPLE.member, KEY)).toBe(false);
        expect(await aiRights.mayUse(OLD, PEOPLE.guest, KEY)).toBe(false);
        expect(await aiRights.mayUse(OLD, PEOPLE.owner, KEY)).toBe(true);
    });

    test('changes nothing on a second run', async () => {
        await seedOldCompany(OLD);
        await migration.up(contextFor([OLD]));
        const after = JSON.stringify(rules(OLD));
        await migration.up(contextFor([OLD]));
        expect(JSON.stringify(rules(OLD))).toBe(after);
    });
});
