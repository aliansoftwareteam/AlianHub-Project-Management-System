const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const migration = require('../migrations/021-automation-rule-name-sentence');

const COMPANY = '6f0000000000000000000d01';
const STALE = 'When a task priority changes, post a comment saying "".';
const REPAIRED = 'When a task priority changes, post a comment saying "Sweep automation fired".';

const logger = { info: jest.fn(), error: jest.fn() };
const context = () => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger, listCompanies: async () => [{ _id: COMPANY }] });
const rules = () => mockDbFor(COMPANY).store[SCHEMA_TYPE.AUTOMATION_RULES] || [];
const named = (name) => rules().find((r) => r.marker === name);

const commenter = (marker, name, body = 'Sweep automation fired') => ({
    marker,
    name,
    version: 2,
    trigger: { type: 'event', event: 'task.priority_changed' },
    scope: { allProjects: true, projectIds: [] },
    steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body } }],
    enabled: true,
    deletedStatusKey: 0,
});

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
    const db = mockDbFor(COMPANY);
    db.seed(SCHEMA_TYPE.AUTOMATION_RULES, commenter('stale', STALE));
    db.seed(SCHEMA_TYPE.AUTOMATION_RULES, commenter('current', REPAIRED));
    db.seed(SCHEMA_TYPE.AUTOMATION_RULES, commenter('authored', 'Sweep watcher'));
    db.seed(SCHEMA_TYPE.AUTOMATION_RULES, { ...commenter('v1', STALE), version: 1 });
});

describe('021-automation-rule-name-sentence', () => {
    test('is a valid company-scoped migration listed after 020', () => {
        expect(() => validateMigration(migration, '021-automation-rule-name-sentence')).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('021-automation-rule-name-sentence')).toBeGreaterThan(ids.indexOf('020-workflow-definitions'));
    });

    test('rewrites a generated name that lost the action body', async () => {
        await migration.up(context());
        expect(named('stale').name).toBe(REPAIRED);
    });

    test('leaves a name somebody typed, a name already correct, and a v1 rule alone', async () => {
        await migration.up(context());
        expect(named('authored').name).toBe('Sweep watcher');
        expect(named('current').name).toBe(REPAIRED);
        expect(named('v1').name).toBe(STALE);
    });

    test('is idempotent — a second run finds nothing left to rewrite', async () => {
        const first = context();
        await migration.up(first);
        expect(first.companies[COMPANY]).toMatchObject({ ok: true, renamed: 1 });

        const second = context();
        await migration.up(second);
        expect(second.companies[COMPANY]).toMatchObject({ ok: true, renamed: 0 });
        expect(named('stale').name).toBe(REPAIRED);
    });
});
