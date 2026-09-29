const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const migration = require('../migrations/062-workflow-status-conditions');

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
const rows = (type, companyId = ACME) => mockDbFor(companyId).store[type] || [];
const rule = (marker, companyId = ACME) => rows(SCHEMA_TYPE.AUTOMATION_RULES, companyId).find((r) => r.marker === marker);
const workflow = (marker, companyId = ACME) => rows(SCHEMA_TYPE.WORKFLOW_DEFINITIONS, companyId).find((r) => r.marker === marker);

const ruleWith = (marker, steps, over = {}) => ({
    marker,
    name: marker,
    version: 2,
    trigger: { type: 'event', event: 'task.status_changed' },
    scope: { allProjects: true, projectIds: [] },
    conditions: {},
    steps,
    enabled: true,
    deletedStatusKey: 0,
    ...over,
});

const workflowWith = (marker, steps, over = {}) => ({ marker, name: marker, steps, enabled: false, deletedStatusKey: 0, ...over });

const onBlocked = { op: 'eq', field: 'statusType', value: 'Blocked' };

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
    const acme = mockDbFor(ACME);
    acme.seed(SCHEMA_TYPE.PROJECTS, { _id: WEB, deletedStatusKey: 0, taskStatusData: [{ key: 4, name: 'Blocked', type: 'active' }, { key: 6, name: 'Done', type: 'close' }] });
    acme.seed(SCHEMA_TYPE.PROJECTS, { _id: OPS, deletedStatusKey: 0, taskStatusData: [{ key: 7, name: 'Blocked', type: 'active' }, { key: 9, name: 'Complete', type: 'close' }] });

    acme.seed(SCHEMA_TYPE.AUTOMATION_RULES, ruleWith('step', [
        { id: 's1', type: 'condition', condition: { op: 'changedTo', field: 'statusType', value: 'Blocked' } },
        { id: 's2', type: 'action', action: 'add_comment', config: { body: 'Blocked' } },
    ]));
    acme.seed(SCHEMA_TYPE.AUTOMATION_RULES, ruleWith('scoped', [{ id: 's1', type: 'condition', condition: onBlocked }], { scope: { allProjects: false, projectIds: [OPS] } }));
    acme.seed(SCHEMA_TYPE.AUTOMATION_RULES, ruleWith('unknown', [{ id: 's1', type: 'condition', condition: { op: 'eq', field: 'statusType', value: 'Frozen' } }], {
        needsReview: [{ reason: 'unknown_status', status: 'Parked' }],
    }));
    acme.seed(SCHEMA_TYPE.AUTOMATION_RULES, ruleWith('typed', [{ id: 's1', type: 'condition', condition: { op: 'eq', field: 'statusType', value: 'close' } }]));
    acme.seed(SCHEMA_TYPE.AUTOMATION_RULES, ruleWith('deleted', [{ id: 's1', type: 'condition', condition: onBlocked }], { deletedStatusKey: 1 }));

    acme.seed(SCHEMA_TYPE.WORKFLOW_DEFINITIONS, workflowWith('branch', [
        { id: 'sIf', type: 'condition', config: { when: { op: 'and', args: [onBlocked, { op: 'eq', field: 'Task_Priority', value: 'HIGH' }] }, then: ['sYes'], else: ['sNo'] } },
        { id: 'sYes', type: 'wait', dependsOn: ['sIf'], config: { forMs: 10 } },
        { id: 'sNo', type: 'wait', dependsOn: ['sIf'], config: { forMs: 10 } },
        { id: 'sLoop', type: 'loop', dependsOn: ['sYes'], config: { body: ['sYes'], while: { op: 'neq', field: 'statusType', value: 'Done' } } },
    ]));
    acme.seed(SCHEMA_TYPE.WORKFLOW_DEFINITIONS, workflowWith('unknown', [{ id: 'sIf', type: 'condition', config: { when: { op: 'eq', field: 'statusType', value: 'Frozen' }, then: [], else: [] } }]));
    acme.seed(SCHEMA_TYPE.WORKFLOW_DEFINITIONS, workflowWith('neverWiden', [{ id: 'sIf', type: 'condition', config: { when: { op: 'eq', field: 'statusType', value: 'Closed' }, then: [], else: [] } }]));

    const globex = mockDbFor(GLOBEX);
    globex.seed(SCHEMA_TYPE.PROJECTS, { _id: OTHER, deletedStatusKey: 0, taskStatusData: [{ key: 2, name: 'Parked', type: 'active' }] });
    globex.seed(SCHEMA_TYPE.AUTOMATION_RULES, ruleWith('step', [{ id: 's1', type: 'condition', condition: onBlocked }]));
    globex.seed(SCHEMA_TYPE.WORKFLOW_DEFINITIONS, workflowWith('branch', [{ id: 'sIf', type: 'condition', config: { when: { op: 'eq', field: 'statusType', value: 'Parked' }, then: [], else: [] } }]));
});

describe('062-workflow-status-conditions', () => {
    test('is a valid company-scoped migration listed after 061', () => {
        expect(() => validateMigration(migration, '062-workflow-status-conditions')).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('062-workflow-status-conditions')).toBeGreaterThan(ids.indexOf('061-automation-status-conditions'));
    });

    test('keys a status name in a rule\'s condition step and leaves its other steps alone', async () => {
        await migration.up(context());
        expect(rule('step').steps).toEqual([
            { id: 's1', type: 'condition', condition: { op: 'changedTo', field: 'statusRef', value: [`${WEB}:4`, `${OPS}:7`], label: 'Blocked' } },
            { id: 's2', type: 'action', action: 'add_comment', config: { body: 'Blocked' } },
        ]);
        expect(rule('step').needsReview).toBeUndefined();
    });

    test('a scoped rule resolves its step names in its own projects only', async () => {
        await migration.up(context());
        expect(rule('scoped').steps[0].condition.value).toEqual([`${OPS}:7`]);
    });

    test('keys workflow condition and loop steps, inside an and as well', async () => {
        await migration.up(context());
        const steps = workflow('branch').steps;
        expect(steps[0].config.when).toEqual({
            op: 'and',
            args: [
                { op: 'in', field: 'statusRef', value: [`${WEB}:4`, `${OPS}:7`], label: 'Blocked' },
                { op: 'eq', field: 'Task_Priority', value: 'HIGH' },
            ],
        });
        expect(steps[0].config.then).toEqual(['sYes']);
        expect(steps[3].config.while).toEqual({ op: 'notIn', field: 'statusRef', value: [`${WEB}:6`], label: 'Done' });
        expect(workflow('branch').needsReview).toBeUndefined();
    });

    test('an unknown name is left as written and flagged, keeping what 061 flagged', async () => {
        await migration.up(context());
        expect(rule('unknown').steps[0].condition).toEqual({ op: 'eq', field: 'statusType', value: 'Frozen' });
        expect(rule('unknown').needsReview).toEqual([
            { reason: 'unknown_status', status: 'Parked' },
            { reason: 'unknown_status', status: 'Frozen', step: 's1' },
        ]);
        expect(workflow('unknown').steps[0].config.when).toEqual({ op: 'eq', field: 'statusType', value: 'Frozen' });
        expect(workflow('unknown').needsReview).toEqual([{ reason: 'unknown_status', status: 'Frozen', step: 'sIf' }]);
    });

    test('never turns a name into a status type', async () => {
        await migration.up(context());
        expect(workflow('neverWiden').steps[0].config.when).toEqual({ op: 'eq', field: 'statusType', value: 'Closed' });
        expect(workflow('neverWiden').needsReview).toEqual([{ reason: 'unknown_status', status: 'Closed', step: 'sIf' }]);
    });

    test('a status type and a deleted rule are untouched', async () => {
        await migration.up(context());
        expect(rule('typed').steps[0].condition).toEqual({ op: 'eq', field: 'statusType', value: 'close' });
        expect(rule('typed').needsReview).toBeUndefined();
        expect(rule('deleted').steps[0].condition).toEqual(onBlocked);
    });

    test('resolves against each company\'s own projects', async () => {
        await migration.up(context());
        expect(rule('step', GLOBEX).steps[0].condition).toEqual(onBlocked);
        expect(rule('step', GLOBEX).needsReview).toEqual([{ reason: 'unknown_status', status: 'Blocked', step: 's1' }]);
        expect(workflow('branch', GLOBEX).steps[0].config.when).toEqual({ op: 'in', field: 'statusRef', value: [`${OTHER}:2`], label: 'Parked' });
    });

    test('is idempotent — a second run converts and flags nothing new', async () => {
        const first = context();
        await migration.up(first);
        expect(first.companies[ACME]).toMatchObject({ ok: true, converted: 3, flagged: 3 });
        const after = JSON.stringify([rows(SCHEMA_TYPE.AUTOMATION_RULES), rows(SCHEMA_TYPE.WORKFLOW_DEFINITIONS)]);

        const second = context();
        await migration.up(second);
        expect(second.companies[ACME]).toMatchObject({ ok: true, converted: 0, flagged: 0 });
        expect(JSON.stringify([rows(SCHEMA_TYPE.AUTOMATION_RULES), rows(SCHEMA_TYPE.WORKFLOW_DEFINITIONS)])).toBe(after);
    });
});
