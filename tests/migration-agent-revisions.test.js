const fakeMongo = require('./fixtures/fakeMongo');
const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');

jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const migration = require('../migrations/009-agent-revisions');
const T = SCHEMA_TYPE.AGENT_REVISIONS;
const logger = { info: jest.fn(), error: jest.fn() };
const contextFor = (db) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => [{ _id: 'c1' }] });

describe('009-agent-revisions', () => {
    test('is a valid company-scoped migration the runner lists after 008', () => {
        expect(() => validateMigration(migration, '009-agent-revisions')).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('009-agent-revisions')).toBe(ids.indexOf('008-agent-run-expiry') + 1);
    });

    test('writes revision 1 as live from every live agent record, skips agents that have one, and is idempotent', async () => {
        const db = fakeMongo.create();
        const a = db.seed(SCHEMA_TYPE.AGENTS, { name: 'Reviewer', ownerId: 'o1', autonomy: 2, allowedActions: ['task.comment'], skills: [{ key: 'qa-review' }], spendMonth: { usd: 4 }, deletedStatusKey: 0 });
        const b = db.seed(SCHEMA_TYPE.AGENTS, { name: 'Planner', autonomy: 1, skills: [], deletedStatusKey: 0 });
        const deleted = db.seed(SCHEMA_TYPE.AGENTS, { name: 'Gone', deletedStatusKey: 1 });
        db.seed(T, { agentId: b._id, n: 1, state: 'live', snapshot: { name: 'Planner' } });

        const first = contextFor(db);
        await migration.up(first);
        expect(first.companies.c1).toMatchObject({ ok: true, agents: 2, created: 1, skipped: 1 });
        const forA = db.store[T].filter((r) => r.agentId === a._id);
        expect(forA).toHaveLength(1);
        expect(forA[0]).toMatchObject({ n: 1, state: 'live', source: 'migration', createdBy: 'o1', serves: ['qa-review'], snapshot: { name: 'Reviewer', autonomy: 2, allowedActions: ['task.comment'] } });
        expect(forA[0].snapshot.spendMonth).toBeUndefined();
        expect(forA[0].skillRefs[0]).toMatchObject({ key: 'qa-review', hash: expect.any(String), n: null });
        expect(db.store[T].filter((r) => r.agentId === deleted._id)).toHaveLength(0);

        const snapshot = JSON.stringify(db.store[T]);
        const again = contextFor(db);
        await migration.up(again);
        expect(again.companies.c1).toMatchObject({ ok: true, created: 0, skipped: 2 });
        expect(JSON.stringify(db.store[T])).toBe(snapshot);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('009 c1'));
    });
});
