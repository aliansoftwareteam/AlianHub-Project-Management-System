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
const { SENTINEL_KEYS } = require('../Modules/settings/securityPermissions/reconcileRules');
const aiRights = require('../Config/aiRights');
const migration = require('../migrations/078-ai-access-rules');

const { AI_RIGHT } = aiRights;
const NEW = '6f0000000000000000000c01';
const OLD = '6f0000000000000000000c02';
const PEOPLE = { owner: '6f0000000000000000000a01', member: '6f0000000000000000000a03', guest: '6f0000000000000000000a00', lead: '6f0000000000000000000a04' };
const ROLE_OF = { owner: 1, member: 3, guest: 0, lead: 4 };
const EVERYDAY = [AI_RIGHT.ASSISTANT, AI_RIGHT.AGENT_USE, AI_RIGHT.CONNECTORS, AI_RIGHT.EXTERNAL_CLIENTS];
const BUILDING = [AI_RIGHT.AGENTS, AI_RIGHT.SKILLS];
const AI_KEYS = Object.values(AI_RIGHT);

const logger = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });
const rules = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.RULES] || [];
const ruleFor = (companyId, key) => rules(companyId).find((r) => r.key === key && r.projectId === undefined);
const entryOf = (companyId, key, roleKey) => ((ruleFor(companyId, key) || {}).roles || []).find((r) => r.key === roleKey);
const right = (companyId, person, key) => aiRights.aiRight(companyId, PEOPLE[person], key);

const seedPeople = (companyId) => {
    const db = mockDbFor(companyId);
    db.seed(SCHEMA_TYPE.SETTINGS, { name: settingsCollectionDocs.ROLES, settings: [{ key: 0, name: 'Guest' }, { key: 1, name: 'Owner' }, { key: 2, name: 'Admin' }, { key: 3, name: 'Member' }, { key: 4, name: 'Team lead' }] });
    Object.entries(PEOPLE).forEach(([person, userId]) => db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: ROLE_OF[person], status: 2, isDelete: false }));
};

/* A company seeded before the AI rows: today's catalogue without them, and a role an owner added later. */
const seedOldCompany = async (companyId) => {
    seedPeople(companyId);
    await importCompanyRules(companyId);
    const db = mockDbFor(companyId);
    db.store[SCHEMA_TYPE.RULES] = rules(companyId).filter((r) => !AI_KEYS.includes(r.key));
    const section = ruleFor(companyId, 'artificial_intelligence');
    section.roles = section.roles.filter((r) => r.key !== 3);
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe('the AI rows of the catalogue', () => {
    test('a new company gets every AI row under Artificial Intelligence, and the repair watches each of them', async () => {
        seedPeople(NEW);
        await importCompanyRules(NEW);
        const section = ruleFor(NEW, 'artificial_intelligence');
        AI_KEYS.forEach((key) => {
            expect(ruleFor(NEW, key)).toMatchObject({ dependency: 'artificial_intelligence', isParent: false, parentId: section._id });
            expect(SENTINEL_KEYS).toContain(key);
        });
        expect(ruleFor(NEW, AI_RIGHT.ASSISTANT).switchOnly).toBe(true);
        expect(ruleFor(NEW, AI_RIGHT.AGENTS).switchOnly).toBeUndefined();
        expect(ruleFor(NEW, AI_RIGHT.SKILL_RISK).riskField).toBe(true);
    });

    test('the rules schema keeps every field an AI row is saved with, or the matrix loses its switch and risk levels', async () => {
        const { schema } = jest.requireActual('../utils/mongo-handler/schema');
        seedPeople(NEW);
        await importCompanyRules(NEW);
        AI_KEYS.forEach((key) => {
            Object.keys(ruleFor(NEW, key)).filter((field) => !['_id', 'createdAt', 'updatedAt'].includes(field))
                .forEach((field) => expect([key, Object.keys(schema.rules)]).toEqual([key, expect.arrayContaining([field])]));
        });
    });

    test('a new company gives a member the everyday AI, a guest Ask AI and their own AI, and neither anything to build with', async () => {
        seedPeople(NEW);
        await importCompanyRules(NEW);
        for (const key of EVERYDAY) expect(await right(NEW, 'member', key)).toBe(true);
        for (const key of [AI_RIGHT.ASSISTANT, AI_RIGHT.EXTERNAL_CLIENTS]) expect(await right(NEW, 'guest', key)).toBe(true);
        for (const key of [AI_RIGHT.AGENT_USE, AI_RIGHT.CONNECTORS]) expect(await right(NEW, 'guest', key)).toBeNull();
        for (const key of [...BUILDING, AI_RIGHT.SKILL_RISK]) {
            expect(await right(NEW, 'member', key)).toBeNull();
            expect(await right(NEW, 'guest', key)).toBeNull();
        }
        expect(entryOf(NEW, 'artificial_intelligence', 3)).toMatchObject({ permission: true });
        expect(await aiRights.skillRiskCap(NEW, PEOPLE.member)).toBeNull();
    });

    test('an owner holds every AI right and may use a skill of any risk', async () => {
        seedPeople(NEW);
        await importCompanyRules(NEW);
        for (const key of [...EVERYDAY, ...BUILDING]) expect(await aiRights.mayUse(NEW, PEOPLE.owner, key)).toBe(true);
        expect(await aiRights.skillRiskCap(NEW, PEOPLE.owner)).toBe('high');
    });

    test('a project keeps only the AI token limit among its own rules', async () => {
        seedPeople(NEW);
        await importCompanyRules(NEW, 'project', '6f0000000000000000000b01');
        const projectRules = mockDbFor(NEW).store[SCHEMA_TYPE.PROJECT_RULES] || [];
        expect(projectRules.map((r) => r.key)).toContain('per_user_generate_limit');
        AI_KEYS.forEach((key) => expect(projectRules.map((r) => r.key)).not.toContain(key));
    });
});

describe('078-ai-access-rules', () => {
    test('is a valid company-scoped migration listed after 077, with a down()', () => {
        expect(() => validateMigration(migration, '078-ai-access-rules')).not.toThrow();
        expect(typeof migration.down).toBe('function');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('078-ai-access-rules')).toBeGreaterThan(ids.indexOf('077-agents-built-in-index'));
    });

    test('a company from before the AI rows gets them, and every role keeps the everyday AI it had', async () => {
        await seedOldCompany(OLD);
        expect(ruleFor(OLD, AI_RIGHT.ASSISTANT)).toBeUndefined();

        await migration.up(contextFor([OLD]));

        expect(await right(OLD, 'member', AI_RIGHT.ASSISTANT)).toBe(true);
        expect(await right(OLD, 'member', AI_RIGHT.AGENT_USE)).toBe(true);
        expect(await right(OLD, 'lead', AI_RIGHT.ASSISTANT)).toBe(true);
        expect(await right(OLD, 'lead', AI_RIGHT.AGENT_USE)).toBe(true);
        expect(await right(OLD, 'lead', AI_RIGHT.CONNECTORS)).toBe(true);
        expect(await right(OLD, 'lead', AI_RIGHT.EXTERNAL_CLIENTS)).toBe(true);
        expect(await right(OLD, 'guest', AI_RIGHT.ASSISTANT)).toBe(true);
        expect(await right(OLD, 'guest', AI_RIGHT.EXTERNAL_CLIENTS)).toBe(true);
        expect(await right(OLD, 'guest', AI_RIGHT.AGENT_USE)).toBeNull();
        expect(await right(OLD, 'guest', AI_RIGHT.CONNECTORS)).toBeNull();
    });

    test('nobody but owners and admins can build agents, write skills or see every agent after it', async () => {
        await seedOldCompany(OLD);
        await migration.up(contextFor([OLD]));
        for (const person of ['member', 'lead', 'guest']) {
            for (const key of BUILDING) expect(await right(OLD, person, key)).toBeNull();
            expect(await aiRights.skillRiskCap(OLD, PEOPLE[person])).toBeNull();
        }
        expect(await aiRights.mayUse(OLD, PEOPLE.owner, AI_RIGHT.AGENTS)).toBe(true);
    });

    test('a role that got AI has the AI section switched on, so its cells can be edited in the matrix', async () => {
        await seedOldCompany(OLD);
        await migration.up(contextFor([OLD]));
        expect(entryOf(OLD, 'artificial_intelligence', 4)).toMatchObject({ permission: true, seededBy: migration.SEEDED_BY });
        expect(entryOf(OLD, 'artificial_intelligence', 3)).toMatchObject({ permission: true });
    });

    test('running it twice changes nothing', async () => {
        await seedOldCompany(OLD);
        await migration.up(contextFor([OLD]));
        const first = JSON.stringify(rules(OLD).map((r) => [r.key, r.roles]).sort());

        await migration.up(contextFor([OLD]));

        expect(JSON.stringify(rules(OLD).map((r) => [r.key, r.roles]).sort())).toBe(first);
        expect(await migration.grantCompany(contextFor([OLD]), OLD)).toEqual({ granted: 0 });
    });

    test('a value an owner has set is left alone', async () => {
        seedPeople(OLD);
        await importCompanyRules(OLD);
        const assistant = ruleFor(OLD, AI_RIGHT.ASSISTANT);
        assistant.roles = [...assistant.roles.filter((r) => r.key !== 4), { key: 4, permission: false }];

        await migration.grantCompany(contextFor([OLD]), OLD);

        expect(entryOf(OLD, AI_RIGHT.ASSISTANT, 4)).toEqual({ key: 4, permission: false });
    });

    test('down() takes back only what it gave and is still as given', async () => {
        await seedOldCompany(OLD);
        await migration.up(contextFor([OLD]));
        entryOf(OLD, AI_RIGHT.ASSISTANT, 4).permission = null;

        await migration.down(contextFor([OLD]));

        expect(entryOf(OLD, AI_RIGHT.ASSISTANT, 4)).toMatchObject({ permission: null, seededBy: migration.SEEDED_BY });
        expect(entryOf(OLD, AI_RIGHT.AGENT_USE, 4)).toBeUndefined();
        expect(await right(OLD, 'guest', AI_RIGHT.ASSISTANT)).toBe(true);
        expect(await right(OLD, 'member', AI_RIGHT.ASSISTANT)).toBe(true);
    });

    test('a company whose rules were never seeded is skipped', async () => {
        seedPeople(OLD);
        await migration.up(contextFor([OLD]));
        expect(rules(OLD)).toEqual([]);
    });
});

describe('requireAiRight', () => {
    const run = async (person, key, options) => {
        const req = { headers: { companyid: NEW }, uid: PEOPLE[person] };
        const res = { status: jest.fn(function status() { return this; }), json: jest.fn() };
        const next = jest.fn();
        await aiRights.requireAiRight(key, options)(req, res, next);
        return { res, next };
    };

    test('lets a person through who holds the right, and refuses one who does not, naming the row', async () => {
        seedPeople(NEW);
        await importCompanyRules(NEW);

        expect((await run('member', AI_RIGHT.ASSISTANT)).next).toHaveBeenCalled();

        const { res, next } = await run('member', AI_RIGHT.AGENTS);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: false, permission: 'artificial_intelligence.ai_agents', message: aiRights.REFUSAL[AI_RIGHT.AGENTS] }));
    });

    test('Read is enough when the route asks only to see', async () => {
        seedPeople(NEW);
        await importCompanyRules(NEW);
        const agents = ruleFor(NEW, AI_RIGHT.AGENTS);
        agents.roles.push({ key: 3, permission: false });

        expect((await run('member', AI_RIGHT.AGENTS, { write: false })).next).toHaveBeenCalled();
        expect((await run('member', AI_RIGHT.AGENTS)).next).not.toHaveBeenCalled();
    });

    test('refuses a person with no seat, and refuses when the rules cannot be read', async () => {
        seedPeople(NEW);
        await importCompanyRules(NEW);
        const stranger = { headers: { companyid: NEW }, uid: '6f0000000000000000000aff' };
        const res = { status: jest.fn(function status() { return this; }), json: jest.fn() };
        const next = jest.fn();
        await aiRights.requireAiRight(AI_RIGHT.ASSISTANT)(stranger, res, next);
        expect(next).not.toHaveBeenCalled();

        mockDbFor(NEW).crud.mockImplementationOnce(async () => { throw new Error('down'); });
        const { res: failed, next: notCalled } = await run('member', AI_RIGHT.ASSISTANT);
        expect(notCalled).not.toHaveBeenCalled();
        expect(failed.json).toHaveBeenCalledWith(expect.objectContaining({ message: aiRights.UNCHECKED }));
    });
});

describe('skill risk', () => {
    test.each([
        [null, 'low', false],
        ['low', 'low', true],
        ['low', 'medium', false],
        ['medium', 'medium', true],
        ['medium', 'high', false],
        ['high', 'high', true],
        ['low', undefined, true],
    ])('a cap of %s %s a %s skill', (cap, risk, allowed) => {
        expect(aiRights.riskWithin(cap, risk)).toBe(allowed);
    });

    test('the stored number reads as a cap', async () => {
        seedPeople(NEW);
        await importCompanyRules(NEW);
        const risk = ruleFor(NEW, AI_RIGHT.SKILL_RISK);
        risk.roles = risk.roles.filter((r) => r.key !== 3);
        risk.roles.push({ key: 3, permission: 2 });
        expect(await aiRights.skillRiskCap(NEW, PEOPLE.member)).toBe('medium');
    });
});
