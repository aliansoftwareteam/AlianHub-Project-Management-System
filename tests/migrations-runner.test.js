const path = require('path');
const { listMigrations, validateMigration, planRuns, buildContext, runMigrations, migrationStatus, LOCK_ID } = require('../migrations');
const { createMemoryStore } = require('../migrations/store');
const { rekey, withIcon, hasIcon } = require('../migrations/lib/taskTypeIcons');

const quiet = { info() {}, error() {} };
const mig = (id, up, scope = 'global') => ({ id, scope, up });
const deps = (migrations, store = createMemoryStore()) => ({ store, migrations, makeContext: () => ({ companies: {} }), logger: quiet, owner: 'test' });

describe('the shipped migrations', () => {
    it('are named after their file, ordered, and each declares a scope and an up()', () => {
        const all = listMigrations(path.join(__dirname, '..', 'migrations'));
        expect(all.map((m) => m.id)).toEqual([...all.map((m) => m.id)].sort());
        expect(all.length).toBeGreaterThanOrEqual(6);
        for (const m of all) expect(() => validateMigration(m, m.id)).not.toThrow();
    });

    it('rejects a migration whose id disagrees with its file name or lacks a scope', () => {
        expect(() => validateMigration({ id: 'x', scope: 'global', up() {} }, '007-y')).toThrow(/file name/);
        expect(() => validateMigration({ id: '007-y', scope: 'tenant', up() {} }, '007-y')).toThrow(/scope/);
        expect(() => validateMigration({ id: '007-y', scope: 'global' }, '007-y')).toThrow(/up\(ctx\)/);
    });
});

describe('planning', () => {
    it('skips applied ids, retries failed ones, and never counts the lock row', () => {
        const migrations = [mig('001-a'), mig('002-b'), mig('003-c')];
        const records = [{ _id: '001-a', ok: true }, { _id: '002-b', ok: false, error: 'boom' }, { _id: LOCK_ID, owner: 'x' }];
        const { applied, pending, failed } = planRuns(migrations, records);
        expect(applied.map((r) => r._id)).toEqual(['001-a']);
        expect(pending.map((m) => m.id)).toEqual(['002-b', '003-c']);
        expect(failed.map((r) => r._id)).toEqual(['002-b']);
    });
});

describe('running', () => {
    it('applies in order, records each run, and reports nothing pending', async () => {
        const order = [];
        const store = createMemoryStore();
        const migrations = [mig('001-a', () => order.push('a')), mig('002-b', () => order.push('b'))];
        const result = await runMigrations(deps(migrations, store));
        expect(order).toEqual(['a', 'b']);
        expect(result).toMatchObject({ skipped: false, applied: ['001-a', '002-b'], failed: null, pending: [] });
        const status = await migrationStatus({ store, migrations });
        expect(status.applied.map((m) => m.id)).toEqual(['001-a', '002-b']);
        expect(status.applied[0].appVersion).toBe(require('../package.json').version);
        expect(store.docs.has(LOCK_ID)).toBe(false);
    });

    it('stops at the first failure, records it, keeps the rest pending, and releases the lock', async () => {
        const store = createMemoryStore();
        const ran = [];
        const migrations = [mig('001-a', () => ran.push('a')), mig('002-b', () => { throw new Error('bad index'); }), mig('003-c', () => ran.push('c'))];
        const result = await runMigrations(deps(migrations, store));
        expect(ran).toEqual(['a']);
        expect(result.failed).toEqual({ id: '002-b', error: 'bad index' });
        expect(result.pending).toEqual(['002-b', '003-c']);
        const status = await migrationStatus({ store, migrations });
        expect(status.failed).toEqual([expect.objectContaining({ id: '002-b', error: 'bad index' })]);
        expect(store.docs.has(LOCK_ID)).toBe(false);
    });

    it('a second run only picks up what is left, and a rerun of a failed one clears the failure', async () => {
        const store = createMemoryStore();
        let attempts = 0;
        const flaky = mig('002-b', () => { attempts += 1; if (attempts === 1) throw new Error('once'); });
        const migrations = [mig('001-a', () => {}), flaky];
        await runMigrations(deps(migrations, store));
        const second = await runMigrations(deps(migrations, store));
        expect(second.applied).toEqual(['002-b']);
        expect((await migrationStatus({ store, migrations })).failed).toEqual([]);
    });

    it('does nothing while another process holds a live lock, and takes over an expired one', async () => {
        const store = createMemoryStore();
        await store.tryLock('other', 60000);
        const migrations = [mig('001-a', () => {})];
        expect(await runMigrations(deps(migrations, store))).toMatchObject({ skipped: 'locked', applied: [] });
        store.docs.set(LOCK_ID, { _id: LOCK_ID, owner: 'crashed', expiresAt: new Date(Date.now() - 1) });
        expect((await runMigrations(deps(migrations, store))).applied).toEqual(['001-a']);
    });
});

describe('the company context', () => {
    const SCHEMA_TYPE = { GOLBAL: 'global', COMPANIES: 'companies' };
    const make = (companies, MongoDbCrudOpration = jest.fn()) => buildContext({
        MongoDbCrudOpration, SCHEMA_TYPE, dbCollections: {}, settingsCollectionDocs: {}, logger: quiet, listCompanies: async () => companies,
    });

    it('visits every company, records each outcome, and fails the migration if any company failed', async () => {
        const ctx = make([{ _id: 'c1' }, { _id: 'c2' }, { _id: 'c3' }]);
        await expect(ctx.forEachCompany(async (id) => { if (id === 'c2') throw new Error('nope'); return { touched: 1 }; }))
            .rejects.toThrow('1 of 3 companies failed: c2');
        expect(ctx.companies).toEqual({ c1: { ok: true, touched: 1 }, c2: { ok: false, error: 'nope' }, c3: { ok: true, touched: 1 } });
    });

    it('scopes company reads to that company and global reads to the global database', async () => {
        const crud = jest.fn(async () => 'ok');
        const ctx = make([], crud);
        await ctx.company('c9', { type: 'tasks', data: [{}] }, 'find');
        await ctx.global({ type: 'users', data: [{}] }, 'find');
        expect(crud.mock.calls[0][0]).toBe('c9');
        expect(crud.mock.calls[1][0]).toBe('global');
    });
});

describe('task-type key and icon repair (migration 004)', () => {
    it('re-keys NaN and duplicate keys, merges same-value duplicates, and keeps valid keys', () => {
        const { entries, changes, merges } = rekey([
            { value: 'bug', key: 1 }, { value: 'task', key: NaN }, { value: 'design', key: 1 }, { value: 'Bug', key: 7, iconValue: 'mdi:bug' },
        ]);
        expect(entries.map((e) => e.key)).toEqual([7, 8, 1]);
        expect(merges).toEqual([{ value: 'bug', kept: 7, droppedCount: 1 }]);
        expect(changes).toEqual([{ value: 'task', old: NaN, new: 8 }]);
    });

    it('stamps a library icon once and leaves an existing icon alone on rerun', () => {
        const first = withIcon({ value: 'bug', key: 1 });
        expect(first).toMatchObject({ iconType: 'library', iconValue: 'mdi:bug', iconColor: '#DC2626' });
        expect(hasIcon(first)).toBe(true);
        const recoloured = { ...first, iconColor: '#000000' };
        expect(withIcon(recoloured)).toBe(recoloured);
        expect(withIcon({ value: 'something-new', name: 'Weekly meeting' }).iconValue).toBe('mdi:account-group');
    });
});
