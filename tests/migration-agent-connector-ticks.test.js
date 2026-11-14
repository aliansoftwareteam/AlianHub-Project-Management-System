const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const migration = require('../migrations/085-agent-connector-ticks');

/* Agents saved before ticks existed keep the connected apps their skills already use, so none stops working; one
 * saved since, with its own ticks or none, is left alone, and a second run changes nothing. */

const COMPANY = '6f0000000000000000000e01';
const OTHER = '6f0000000000000000000e02';
const logger = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });

const agents = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.AGENTS] || [];
const named = (companyId, name) => agents(companyId).find((a) => a.name === name);

const calendarSkill = (over = {}) => ({
    key: 'team.calendar', name: 'Calendar digest', inputs: [], enabled: true,
    gather: [{ reader: 'google.calendar.events.list', as: 'events', params: {} }, { reader: 'task', as: 'task', params: {} }],
    emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }], emits: ['task.comment'],
    ...over,
});

const seedCompany = (companyId) => {
    const db = mockDbFor(companyId);
    db.seed(SCHEMA_TYPE.AGENT_SKILLS, calendarSkill());
    db.seed(SCHEMA_TYPE.AGENT_SKILLS, calendarSkill({ key: 'team.retired', retiredAt: new Date('2026-10-01'), enabled: false }));
    db.seed(SCHEMA_TYPE.AGENTS, { name: 'Slack summary', skills: [{ key: 'slack.summary', name: 'Slack summariser', enabled: true }], deletedStatusKey: 0 });
    db.seed(SCHEMA_TYPE.AGENTS, { name: 'Calendar', skills: [{ key: 'team.calendar', enabled: false }, 'qa-review'], deletedStatusKey: 0 });
    db.seed(SCHEMA_TYPE.AGENTS, { name: 'Reviewer', skills: [{ key: 'qa-review', enabled: true }], deletedStatusKey: 0 });
    db.seed(SCHEMA_TYPE.AGENTS, { name: 'Retired skill', skills: [{ key: 'team.retired', enabled: true }], deletedStatusKey: 0 });
    db.seed(SCHEMA_TYPE.AGENTS, { name: 'Already chosen', skills: [{ key: 'slack.summary', enabled: true }], connectors: [{ provider: 'slack', tools: ['slack.channel.read'] }], deletedStatusKey: 0 });
    db.seed(SCHEMA_TYPE.AGENTS, { name: 'New since', skills: [{ key: 'team.calendar', enabled: true }], connectors: [], deletedStatusKey: 0 });
    return db;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe('085-agent-connector-ticks', () => {
    test('is a valid company-scoped migration listed after 082', () => {
        expect(() => validateMigration(migration, '085-agent-connector-ticks')).not.toThrow();
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('085-agent-connector-ticks')).toBeGreaterThan(ids.indexOf('084-cloud-storage-to-connectors'));
    });

    test('ticks what each agent\'s skills read and propose through a connected app', async () => {
        seedCompany(COMPANY);
        await migration.up(contextFor([COMPANY]));

        expect(named(COMPANY, 'Slack summary').connectors).toEqual([{ provider: 'slack', tools: ['slack.channel.read', 'slack.message.post'] }]);
        expect(named(COMPANY, 'Calendar').connectors).toEqual([{ provider: 'google', tools: ['google.calendar.events.list'] }]);
        expect(named(COMPANY, 'Reviewer').connectors).toEqual([]);
        expect(named(COMPANY, 'Retired skill').connectors).toEqual([]);
    });

    test('leaves an agent that already has ticks, or none chosen since, as it is', async () => {
        seedCompany(COMPANY);
        await migration.up(contextFor([COMPANY]));

        expect(named(COMPANY, 'Already chosen').connectors).toEqual([{ provider: 'slack', tools: ['slack.channel.read'] }]);
        expect(named(COMPANY, 'New since').connectors).toEqual([]);
    });

    test('changes nothing on a second run', async () => {
        seedCompany(COMPANY);
        const ctx = contextFor([COMPANY]);
        await migration.up(ctx);
        const first = JSON.stringify(agents(COMPANY));
        expect(ctx.companies[COMPANY]).toMatchObject({ ok: true, agents: 4, ticked: 2 });

        const again = contextFor([COMPANY]);
        await migration.up(again);
        expect(JSON.stringify(agents(COMPANY))).toBe(first);
        expect(again.companies[COMPANY]).toMatchObject({ ok: true, agents: 0, ticked: 0 });
    });

    test('keeps each workspace to its own skills', async () => {
        seedCompany(COMPANY);
        mockDbFor(OTHER).seed(SCHEMA_TYPE.AGENTS, { name: 'Calendar', skills: [{ key: 'team.calendar', enabled: true }], deletedStatusKey: 0 });
        await migration.up(contextFor([COMPANY, OTHER]));

        expect(named(OTHER, 'Calendar').connectors).toEqual([]);
        expect(named(COMPANY, 'Calendar').connectors).toEqual([{ provider: 'google', tools: ['google.calendar.events.list'] }]);
    });
});
