const fakeMongo = require('./fixtures/fakeMongo');
const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const runs = require('../Modules/Agents/runs');

jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const migration = require('../migrations/008-agent-run-expiry');
const T = SCHEMA_TYPE.AGENT_RUNS;
const logger = { info: jest.fn(), error: jest.fn() };
const DAY = 24 * 3600 * 1000;

/* fakeMongo has no index methods; the first sync reports the old TTL index dropped, later ones nothing. */
const dbWithIndexes = () => {
    const db = fakeMongo.create();
    const synced = [];
    const crud = async (companyId, q, method) => {
        if (method === 'syncIndexes') { synced.push(companyId); return synced.filter((c) => c === companyId).length === 1 ? ['createdAt_1'] : []; }
        return db.crud(companyId, q, method);
    };
    return { ...db, crud, synced };
};

const contextFor = (db) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => [{ _id: 'c1' }] });

describe('008-agent-run-expiry', () => {
    test('is a valid company-scoped migration the runner lists after 007', () => {
        expect(() => validateMigration(migration, '008-agent-run-expiry')).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('008-agent-run-expiry')).toBe(ids.indexOf('007-encrypt-integration-secrets') + 1);
    });

    test('syncs the indexes, backfills expiresAt for terminal runs only, and is idempotent', async () => {
        const db = dbWithIndexes();
        const finishedAt = new Date(Date.now() - 10 * DAY);
        const createdAt = new Date(Date.now() - 20 * DAY);
        const done = db.seed(T, { agentId: 'a', status: 'done', finishedAt, createdAt });
        const failedNoFinish = db.seed(T, { agentId: 'a', status: 'failed', createdAt });
        const already = db.seed(T, { agentId: 'a', status: 'stopped', finishedAt, expiresAt: new Date(1) });
        const waiting = db.seed(T, { agentId: 'a', status: 'waiting_approval', createdAt: new Date(Date.now() - 400 * DAY) });
        const running = db.seed(T, { agentId: 'a', status: 'running', createdAt });

        const first = contextFor(db);
        await migration.up(first);
        expect(first.companies.c1).toMatchObject({ ok: true, droppedIndexes: ['createdAt_1'], backfilled: 2, skipped: 1 });
        expect(db.synced).toEqual(['c1']);

        const rows = db.store[T];
        const at = (id) => rows.find((r) => r._id === id);
        expect(at(done._id).expiresAt.getTime()).toBe(finishedAt.getTime() + runs.RETENTION_SECONDS * 1000);
        expect(at(failedNoFinish._id).expiresAt.getTime()).toBe(createdAt.getTime() + runs.RETENTION_SECONDS * 1000);
        expect(at(already._id).expiresAt.getTime()).toBe(1);
        expect(at(waiting._id).expiresAt).toBeUndefined();
        expect(at(running._id).expiresAt).toBeUndefined();

        const snapshot = JSON.stringify(rows);
        const again = contextFor(db);
        await migration.up(again);
        expect(again.companies.c1).toMatchObject({ ok: true, droppedIndexes: [], backfilled: 0, skipped: 3 });
        expect(JSON.stringify(db.store[T])).toBe(snapshot);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('008 c1'));
    });
});
