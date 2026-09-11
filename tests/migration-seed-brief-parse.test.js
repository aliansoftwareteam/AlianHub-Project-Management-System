const fakeMongo = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 3), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid || null })), isAgent: (a) => a && a.kind === 'agent' }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const seed = require('../Modules/Agents/skills/seeds/briefParse');
const skillsCtrl = require('../Modules/Agents/skillsController');
const migration = require('../migrations/010-seed-brief-parse-skill');

const T = SCHEMA_TYPE.AGENT_SKILLS;
const C1 = '6f0000000000000000000c01';
const C2 = '6f0000000000000000000c02';
const logger = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies = [C1, C2]) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });
const rows = (companyId) => mockDbFor(companyId).store[T] || [];

const listSkills = async (companyId) => {
    const r = { code: 200 };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    await skillsCtrl.listSkills({ headers: { companyid: companyId }, uid: 'member1', params: {}, query: {}, body: {} }, r);
    return r.body;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe('010-seed-brief-parse-skill', () => {
    test('is a valid company-scoped migration the runner lists after 008', () => {
        expect(fakeMongo.create).toBeInstanceOf(Function);
        expect(() => validateMigration(migration, '010-seed-brief-parse-skill')).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('010-seed-brief-parse-skill')).toBeGreaterThan(ids.indexOf('008-agent-run-expiry'));
        expect(ids).toEqual([...ids].sort());
    });

    test('inserts brief.parse as version 1 in each company where absent, logs counts, and is idempotent', async () => {
        const first = contextFor();
        await migration.up(first);
        expect(first.companies[C1]).toEqual({ ok: true, inserted: 1, present: 0 });
        expect(first.companies[C2]).toEqual({ ok: true, inserted: 1, present: 0 });
        [C1, C2].forEach((c) => {
            expect(rows(c)).toHaveLength(1);
            expect(rows(c)[0]).toMatchObject({ key: 'brief.parse', version: 1, enabled: true, emits: ['subtask.create', 'task.comment'] });
        });
        expect(mockDbFor(C1).calls.every((call) => call.companyId === C1)).toBe(true);
        expect(logger.info).toHaveBeenCalledWith(`[migrations] 010 ${C1}: {"inserted":1,"present":0}`);

        const snapshot = JSON.stringify([rows(C1), rows(C2)]);
        const again = contextFor();
        await migration.up(again);
        expect(again.companies[C1]).toEqual({ ok: true, inserted: 0, present: 1 });
        expect(again.companies[C2]).toEqual({ ok: true, inserted: 0, present: 1 });
        expect(JSON.stringify([rows(C1), rows(C2)])).toBe(snapshot);
    });

    test('a company that already holds brief.parse, even retired, keeps its own document', async () => {
        mockDbFor(C1).seed(T, { ...validateSkill({ ...seed, name: 'Our intake' }).value, enabled: false, retiredAt: new Date(1) });
        const ctx = contextFor();
        await migration.up(ctx);
        expect(ctx.companies[C1]).toEqual({ ok: true, inserted: 0, present: 1 });
        expect(ctx.companies[C2]).toEqual({ ok: true, inserted: 1, present: 0 });
        expect(rows(C1)).toHaveLength(1);
        expect(rows(C1)[0]).toMatchObject({ name: 'Our intake', enabled: false });
    });

    test('the seeded document validates with zero errors as stored', async () => {
        await migration.up(contextFor([C1]));
        const { _id, createdAt, ...stored } = rows(C1)[0];
        expect(_id).toBeTruthy();
        expect(createdAt).toBeInstanceOf(Date);
        const again = validateSkill(stored);
        expect(again.errors).toEqual([]);
        expect(again.value).toEqual(validateSkill(seed).value);
        expect(stored).toEqual(validateSkill(seed).value);
    });

    test('GET /api/v2/agents/skills lists brief.parse as a data skill after the seed, once', async () => {
        const before = await listSkills(C1);
        expect(before.data.filter((s) => s.key === 'brief.parse')).toEqual([expect.objectContaining({ source: 'code' })]);

        await migration.up(contextFor([C1]));
        const after = await listSkills(C1);
        expect(after.status).toBe(true);
        expect(after.data.filter((s) => s.key === 'brief.parse')).toEqual([
            expect.objectContaining({ source: 'data', version: 1, enabled: true, inputs: ['brief'], reads: ['task'], emits: ['subtask.create', 'task.comment'], risk: 'low' }),
        ]);
        expect((await listSkills(C2)).data.find((s) => s.key === 'brief.parse').source).toBe('code');
    });
});
