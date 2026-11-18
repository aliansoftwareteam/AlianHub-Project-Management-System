/* Task 047, owner decision 1: the AI tools are on by default for new installs only. Migration 074 keeps an
   existing install's old default (off) in its instance settings for each flag its .env does not name. */
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const instance = require('../Config/instanceSettings');
const migration = require('../migrations/074-mcp-old-defaults-for-existing-installs');
const dataFlag = require('../Modules/Mcp/dataFlag');
const manageFlag = require('../Modules/Mcp/manageFlag');
const workFlag = require('../Modules/Mcp/workFlag');
const oauth = require('../Modules/OAuthServer/config');

const ID = '074-mcp-old-defaults-for-existing-installs';
const KEYS = ['MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_OAUTH', 'AGENT_TAINT_ROUTING', 'APIURL'];
const quiet = { info: jest.fn(), error: jest.fn() };

/* The global database as the migration and the boot guard reach it: companies, the settings document and the
 * runner's records. */
const fakeGlobal = ({ companies = 0, values = null, applied = false } = {}) => {
    const db = { doc: values ? { _id: 'instance', values: { ...values } } : null, writes: [] };
    db.global = async ({ type, data }, method) => {
        if (type === SCHEMA_TYPE.COMPANIES && method === 'countDocuments') return companies;
        if (type === SCHEMA_TYPE.SCHEMA_VERSIONS && method === 'findOne') return applied ? { _id: ID, ok: true } : null;
        if (type === SCHEMA_TYPE.INSTANCE_SETTINGS && method === 'findOne') return db.doc;
        if (type === SCHEMA_TYPE.INSTANCE_SETTINGS && method === 'findOneAndUpdate') {
            db.writes.push(data);
            const set = data[1].$set;
            db.doc = db.doc || { _id: data[0]._id, values: {} };
            Object.entries(set).forEach(([path, value]) => { db.doc.values[path.replace(/^values\./, '')] = value; });
            return db.doc;
        }
        throw new Error(`unexpected ${method} on ${type}`);
    };
    return db;
};

const contextFor = (db) => ({ ...buildContext({ MongoDbCrudOpration: async () => null, SCHEMA_TYPE, logger: quiet, listCompanies: async () => [] }), global: db.global });

const flagsNow = () => ({ data: dataFlag.enabled(), manage: manageFlag.enabled(), work: workFlag.enabled(), oauth: oauth.mode({ ...process.env, APIURL: 'https://hub.example.com' }) });

let saved;
beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    KEYS.forEach((key) => { delete process.env[key]; });
    instance._resetForTests();
});
afterEach(() => {
    KEYS.forEach((key) => {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    });
    instance._resetForTests();
});

describe(ID, () => {
    test('is a global migration, the only one of its number, after the ones before it', () => {
        const ids = listMigrations().map((m) => m.id);
        expect(ids.filter((id) => id.startsWith('074-'))).toEqual([ID]);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('073-asked-in-chat-index'));
        expect(migration.scope).toBe('global');
    });

    test('a new install (no workspace yet) records nothing, and the tools stay on', async () => {
        const db = fakeGlobal({ companies: 0 });
        await migration.up(contextFor(db));
        expect(db.writes).toEqual([]);
        expect(flagsNow()).toEqual({ data: true, manage: true, work: true, oauth: 'both' });
    });

    test('an existing install records off for every flag its .env leaves out, and runs with it at once', async () => {
        const db = fakeGlobal({ companies: 2, values: { APP_NAME: 'Acme' } });
        await migration.up(contextFor(db));
        expect(db.doc.values).toEqual({ APP_NAME: 'Acme', MCP_TOOLS_DATA: 'false', MCP_TOOLS_MANAGE: 'false', MCP_TOOLS_WORK: 'false', MCP_OAUTH: 'off' });
        expect(instance.savedValues()).toMatchObject({ MCP_TOOLS_DATA: 'false', MCP_OAUTH: 'off' });
        expect(flagsNow()).toEqual({ data: false, manage: false, work: false, oauth: 'off' });
        expect(require('../Modules/Agents/taint').enabled()).toBe(false);
    });

    test('a flag the .env names is left to the .env, on or off', async () => {
        process.env.MCP_TOOLS_DATA = 'on';
        process.env.MCP_OAUTH = 'off';
        const db = fakeGlobal({ companies: 1 });
        await migration.up(contextFor(db));
        expect(db.doc.values).toEqual({ MCP_TOOLS_MANAGE: 'false', MCP_TOOLS_WORK: 'false' });
        expect(dataFlag.enabled()).toBe(true);
    });

    test('a value an owner already saved is kept', async () => {
        const db = fakeGlobal({ companies: 1, values: { MCP_TOOLS_WORK: 'true' } });
        await migration.up(contextFor(db));
        expect(db.doc.values).toMatchObject({ MCP_TOOLS_WORK: 'true', MCP_TOOLS_DATA: 'false' });
    });

    test('an owner can turn a kept flag on afterwards in the console', async () => {
        const db = fakeGlobal({ companies: 1 });
        await migration.up(contextFor(db));
        const { values, valid } = require('../Modules/Instance/settingsCatalog').validateSettings({ MCP_TOOLS_MANAGE: 'true' });
        expect(valid).toBe(true);
        instance.adoptStored(values);
        expect(manageFlag.enabled()).toBe(true);
    });

    test('a second run changes nothing', async () => {
        const db = fakeGlobal({ companies: 1 });
        await migration.up(contextFor(db));
        const writes = db.writes.length;
        await migration.up(contextFor(db));
        expect(db.writes.length).toBe(writes);
    });
});

describe('at boot, before the migration has run', () => {
    test('an existing install already runs with the old defaults, without storing them', async () => {
        const db = fakeGlobal({ companies: 1 });
        expect(await migration.holdUntilApplied({ global: db.global, SCHEMA_TYPE })).toEqual({ MCP_TOOLS_DATA: 'false', MCP_TOOLS_MANAGE: 'false', MCP_TOOLS_WORK: 'false', MCP_OAUTH: 'off' });
        expect(db.writes).toEqual([]);
        expect(flagsNow()).toEqual({ data: false, manage: false, work: false, oauth: 'off' });
    });

    test('the migration still records them afterwards, since the .env never named them', async () => {
        const db = fakeGlobal({ companies: 1 });
        instance.lockedKeys();
        await migration.holdUntilApplied({ global: db.global, SCHEMA_TYPE });
        await migration.up(contextFor(db));
        expect(db.doc.values).toEqual({ MCP_TOOLS_DATA: 'false', MCP_TOOLS_MANAGE: 'false', MCP_TOOLS_WORK: 'false', MCP_OAUTH: 'off' });
    });

    test('a new install and an install that has run it are left alone', async () => {
        expect(await migration.holdUntilApplied({ global: fakeGlobal({ companies: 0 }).global, SCHEMA_TYPE })).toEqual({});
        expect(await migration.holdUntilApplied({ global: fakeGlobal({ companies: 1, applied: true }).global, SCHEMA_TYPE })).toEqual({});
        expect(flagsNow()).toEqual({ data: true, manage: true, work: true, oauth: 'both' });
    });
});
