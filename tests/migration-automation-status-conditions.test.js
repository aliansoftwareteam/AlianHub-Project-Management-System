const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const migration = require('../migrations/061-automation-status-conditions');

const ACME = '6f0000000000000000000d01';
const GLOBEX = '6f0000000000000000000d02';
const WEB = '6f0000000000000000000a01';
const OPS = '6f0000000000000000000a02';
const OTHER = '6f0000000000000000000a09';

const logger = { info: jest.fn(), error: jest.fn() };
const context = () => buildContext({
    MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger,
    listCompanies: async () => [{ _id: ACME }, { _id: GLOBEX }],
});
const rules = (companyId = ACME) => mockDbFor(companyId).store[SCHEMA_TYPE.AUTOMATION_RULES] || [];
const marked = (marker, companyId = ACME) => rules(companyId).find((r) => r.marker === marker);

const rule = (marker, conditions, over = {}) => ({
    marker,
    name: marker,
    version: 2,
    trigger: { type: 'event', event: 'task.status_changed' },
    scope: { allProjects: true, projectIds: [] },
    conditions,
    steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'x' } }],
    enabled: true,
    deletedStatusKey: 0,
    ...over,
});

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
    const acme = mockDbFor(ACME);
    acme.seed(SCHEMA_TYPE.PROJECTS, { _id: WEB, deletedStatusKey: 0, taskStatusData: [{ key: 4, name: 'Blocked', type: 'active' }, { key: 6, name: 'Done', type: 'close' }] });
    acme.seed(SCHEMA_TYPE.PROJECTS, { _id: OPS, deletedStatusKey: 0, taskStatusData: [{ key: 7, name: 'Blocked', type: 'active' }, { key: 8, name: 'Code Review', type: 'active' }] });
    acme.seed(SCHEMA_TYPE.AUTOMATION_RULES, rule('named', { op: 'changedTo', field: 'statusType', value: 'Blocked' }));
    acme.seed(SCHEMA_TYPE.AUTOMATION_RULES, rule('nested', {
        op: 'and',
        args: [
            { op: 'neq', field: 'statusType', value: 'code review' },
            { op: 'eq', field: 'Task_Priority', value: 'HIGH' },
        ],
    }));
    acme.seed(SCHEMA_TYPE.AUTOMATION_RULES, rule('scoped', { op: 'eq', field: 'statusType', value: 'Blocked' }, { scope: { allProjects: false, projectIds: [OPS] } }));
    acme.seed(SCHEMA_TYPE.AUTOMATION_RULES, rule('unknown', { op: 'eq', field: 'statusType', value: 'Frozen' }));
    acme.seed(SCHEMA_TYPE.AUTOMATION_RULES, rule('outOfScope', { op: 'eq', field: 'statusType', value: 'Code Review' }, { scope: { allProjects: false, projectIds: [WEB] } }));
    acme.seed(SCHEMA_TYPE.AUTOMATION_RULES, rule('typed', { op: 'changedTo', field: 'statusType', value: 'close' }));
    acme.seed(SCHEMA_TYPE.AUTOMATION_RULES, rule('v1', {}, { version: 1, conditions: { statusType: 'Blocked' } }));

    const globex = mockDbFor(GLOBEX);
    globex.seed(SCHEMA_TYPE.PROJECTS, { _id: OTHER, deletedStatusKey: 0, taskStatusData: [{ key: 2, name: 'Parked', type: 'active' }] });
    globex.seed(SCHEMA_TYPE.AUTOMATION_RULES, rule('named', { op: 'eq', field: 'statusType', value: 'Blocked' }));
});

describe('061-automation-status-conditions', () => {
    test('is a valid company-scoped migration listed after 060', () => {
        expect(() => validateMigration(migration, '061-automation-status-conditions')).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('061-automation-status-conditions')).toBeGreaterThan(ids.indexOf('060-mention-ids'));
    });

    test('converts a status name to the keys it names in every project', async () => {
        await migration.up(context());
        expect(marked('named').conditions).toEqual({ op: 'changedTo', field: 'statusRef', value: [`${WEB}:4`, `${OPS}:7`], label: 'Blocked' });
        expect(marked('named').needsReview).toBeUndefined();
    });

    test('converts names inside an and, and leaves the other clauses alone', async () => {
        await migration.up(context());
        expect(marked('nested').conditions).toEqual({
            op: 'and',
            args: [
                { op: 'notIn', field: 'statusRef', value: [`${OPS}:8`], label: 'Code Review' },
                { op: 'eq', field: 'Task_Priority', value: 'HIGH' },
            ],
        });
    });

    test('a scoped rule resolves the name in its own projects only', async () => {
        await migration.up(context());
        expect(marked('scoped').conditions.value).toEqual([`${OPS}:7`]);
    });

    test('a name that does not resolve is left exactly as it was and flagged for review', async () => {
        await migration.up(context());
        expect(marked('unknown').conditions).toEqual({ op: 'eq', field: 'statusType', value: 'Frozen' });
        expect(marked('unknown').needsReview).toEqual([{ reason: 'unknown_status', status: 'Frozen' }]);
        expect(marked('outOfScope').conditions).toEqual({ op: 'eq', field: 'statusType', value: 'Code Review' });
        expect(marked('outOfScope').needsReview).toEqual([{ reason: 'unknown_status', status: 'Code Review' }]);
    });

    test('a status type and a v1 rule are untouched', async () => {
        await migration.up(context());
        expect(marked('typed').conditions).toEqual({ op: 'changedTo', field: 'statusType', value: 'close' });
        expect(marked('typed').needsReview).toBeUndefined();
        expect(marked('v1').conditions).toEqual({ statusType: 'Blocked' });
    });

    test('resolves against each company\'s own projects', async () => {
        await migration.up(context());
        expect(marked('named', GLOBEX).conditions).toEqual({ op: 'eq', field: 'statusType', value: 'Blocked' });
        expect(marked('named', GLOBEX).needsReview).toEqual([{ reason: 'unknown_status', status: 'Blocked' }]);
    });

    test('is idempotent — a second run converts and flags nothing new', async () => {
        const first = context();
        await migration.up(first);
        expect(first.companies[ACME]).toMatchObject({ ok: true, converted: 3, flagged: 2 });
        const after = JSON.stringify(rules());

        const second = context();
        await migration.up(second);
        expect(second.companies[ACME]).toMatchObject({ ok: true, converted: 0, flagged: 0 });
        expect(JSON.stringify(rules())).toBe(after);
    });
});
