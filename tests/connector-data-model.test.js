const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { checkType, tableType } = require('../utils/mongo-handler/mongoQueries');
const { connectorConnectionsSchema, connectorAppsSchema, connectorUsageSchema } = require('../utils/mongo-handler/createSchema');

const indexNamed = (schema, name) => {
    const found = schema.indexes().find(([, options]) => options.name === name);
    if (!found) throw new Error(`no index ${name}`);
    return { keys: Object.keys(found[0]), options: found[1] };
};

const valueAt = (doc, dotted) => dotted.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);

/* Mongo's rule for a partial unique index, for the operators these indexes use: two documents clash when both
 * match the filter and agree on every key, a missing key counting as null. */
const matchesFilter = (doc, filter = {}) => Object.entries(filter).every(([field, condition]) => {
    const value = valueAt(doc, field);
    if (condition.$type === 'string') return typeof value === 'string';
    if (Object.prototype.hasOwnProperty.call(condition, '$eq')) return value === condition.$eq;
    throw new Error(`untested operator in ${field}`);
});
const clash = ({ keys, options }, a, b) => matchesFilter(a, options.partialFilterExpression) && matchesFilter(b, options.partialFilterExpression)
    && keys.every((key) => (valueAt(a, key) ?? null) === (valueAt(b, key) ?? null));

const live = (extra = {}) => ({ companyId: 'c1', userId: 'u1', provider: 'google', account: { id: 'g-1', label: 'a@example.com' }, deletedStatusKey: 0, ...extra });
const UNIQUE = ['one_live_per_provider', 'one_live_per_account'];
const refused = (a, b) => UNIQUE.some((name) => clash(indexNamed(connectorConnectionsSchema, name), a, b));

describe('connector_connections indexes', () => {
    it.each(UNIQUE)('declares %s as unique and partial', (name) => {
        const { options } = indexNamed(connectorConnectionsSchema, name);
        expect(options.unique).toBe(true);
        expect(options.partialFilterExpression).toMatchObject({ provider: { $type: 'string' }, deletedStatusKey: { $eq: 0 } });
    });

    it('keys one live connection on company, person and provider, and one account on its id', () => {
        expect(indexNamed(connectorConnectionsSchema, 'one_live_per_provider').keys).toEqual(['companyId', 'userId', 'provider']);
        expect(indexNamed(connectorConnectionsSchema, 'one_live_per_account').keys).toEqual(['companyId', 'userId', 'provider', 'account.id']);
    });

    it('refuses a second live connection for the same person and provider', () => {
        expect(refused(live(), live())).toBe(true);
        expect(refused(live(), live({ account: { id: 'g-2' } }))).toBe(true);
        expect(refused(live(), live({ account: undefined }))).toBe(true);
    });

    it('lets a disconnected row stand beside a new connection', () => {
        expect(refused(live({ deletedStatusKey: 1 }), live())).toBe(false);
        expect(refused(live({ deletedStatusKey: 1 }), live({ deletedStatusKey: 1 }))).toBe(false);
    });

    it('keeps other people, providers and companies apart', () => {
        expect(refused(live(), live({ userId: 'u2' }))).toBe(false);
        expect(refused(live(), live({ provider: 'dropbox' }))).toBe(false);
        expect(refused(live(), live({ companyId: 'c2' }))).toBe(false);
    });

    it('never touches rows from before the module, which have no provider', () => {
        const older = { userId: 'u1', connector: 'google_calendar', account: { email: 'a@example.com', sub: 'g-1' }, deletedStatusKey: 0 };
        expect(refused(older, { ...older })).toBe(false);
        expect(refused(older, live())).toBe(false);
    });

    it('keeps the indexes the existing Google and Slack code reads by', () => {
        const keys = connectorConnectionsSchema.indexes().map(([fields]) => Object.keys(fields).join(','));
        expect(keys).toEqual(expect.arrayContaining(['connector,deletedStatusKey', 'userId,connector,deletedStatusKey']));
    });

    it('takes the module fields under the strict schema', () => {
        ['companyId', 'provider', 'products', 'lastError', 'app', 'handles', 'backoffUntil'].forEach((field) => expect(connectorConnectionsSchema.path(field)).toBeDefined());
        expect(connectorConnectionsSchema.path('connector').isRequired).toBeFalsy();
    });
});

describe('connector_apps', () => {
    it('allows one app per company and provider', () => {
        const index = indexNamed(connectorAppsSchema, 'one_per_provider');
        expect(index.keys).toEqual(['companyId', 'provider']);
        expect(index.options.unique).toBe(true);
    });

    it('requires the fields 065 writes, and has no field for a secret in clear', () => {
        ['companyId', 'provider', 'clientId', 'secretHandle', 'setBy'].forEach((field) => expect(connectorAppsSchema.path(field).isRequired).toBe(true));
        expect(connectorAppsSchema.path('clientSecret')).toBeUndefined();
    });
});

describe('connector_usage', () => {
    it('keeps one document per connection, caller and day', () => {
        const index = indexNamed(connectorUsageSchema, 'one_per_caller_day');
        expect(index.keys).toEqual(['connectionId', 'actor.type', 'actor.id', 'day']);
        expect(index.options.unique).toBe(true);
    });

    it('starts its counters at zero', () => {
        expect(connectorUsageSchema.path('reads').defaultValue).toBe(0);
        expect(connectorUsageSchema.path('writeProposals').defaultValue).toBe(0);
    });
});

describe('the connector collections are named once', () => {
    it.each([
        ['CONNECTOR_CONNECTIONS', 'connector_connections', connectorConnectionsSchema],
        ['CONNECTOR_APPS', 'connector_apps', connectorAppsSchema],
        ['CONNECTOR_USAGE', 'connector_usage', connectorUsageSchema],
    ])('%s resolves to its schema and collection', (key, name, schema) => {
        expect(SCHEMA_TYPE[key]).toBe(name);
        expect(dbCollections[key]).toBe(name);
        expect(checkType(SCHEMA_TYPE[key])).toBe(schema);
        expect(tableType(SCHEMA_TYPE[key])).toBe(name);
    });
});
