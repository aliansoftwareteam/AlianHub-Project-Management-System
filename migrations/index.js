const fs = require('fs');
const os = require('os');
const path = require('path');
const buildInfo = require('../Config/buildInfo');

const LOCK_ID = '__lock';
const LOCK_TTL_MS = 10 * 60 * 1000;
const FILE_RX = /^(\d{3})-([a-z0-9-]+)\.js$/;
const SCOPES = ['global', 'company'];

function validateMigration(migration, id) {
    if (!migration || migration.id !== id) throw new Error(`migration ${id}: "id" must equal the file name`);
    if (!SCOPES.includes(migration.scope)) throw new Error(`migration ${id}: scope must be one of ${SCOPES.join(', ')}`);
    if (typeof migration.up !== 'function') throw new Error(`migration ${id}: "up(ctx)" is required`);
    return migration;
}

function listMigrations(dir = __dirname) {
    return fs.readdirSync(dir)
        .filter((file) => FILE_RX.test(file))
        .sort()
        .map((file) => validateMigration(require(path.join(dir, file)), file.replace(/\.js$/, '')));
}

/* Pure: a failed run is retried, an applied one is not. */
function planRuns(migrations, records) {
    const byId = new Map((records || []).filter((r) => r && r._id !== LOCK_ID).map((r) => [r._id, r]));
    const applied = [];
    const pending = [];
    const failed = [];
    for (const migration of migrations) {
        const record = byId.get(migration.id);
        if (record && record.ok) applied.push(record);
        else {
            pending.push(migration);
            if (record) failed.push(record);
        }
    }
    return { applied, pending, failed };
}

function buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, dbCollections, settingsCollectionDocs, logger, listCompanies }) {
    const ctx = {
        MongoDbCrudOpration, SCHEMA_TYPE, dbCollections, settingsCollectionDocs, logger,
        global: (data, method) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, data, method),
        company: (companyId, data, method) => MongoDbCrudOpration(String(companyId), data, method),
        companies: {},
        /* Runs fn for every company, keeps going after a failure, and records every
         * outcome, so one broken tenant neither blocks the rest nor hides. */
        async forEachCompany(fn) {
            const companies = await listCompanies();
            const failures = [];
            for (const company of companies) {
                const companyId = String(company._id);
                try {
                    const result = await fn(companyId, company);
                    ctx.companies[companyId] = { ok: true, ...(result && typeof result === 'object' ? result : {}) };
                } catch (error) {
                    ctx.companies[companyId] = { ok: false, error: String(error?.message || error) };
                    failures.push(companyId);
                }
            }
            if (failures.length) throw new Error(`${failures.length} of ${companies.length} companies failed: ${failures.join(', ')}`);
            return companies.length;
        },
    };
    return ctx;
}

async function runMigrations({ store, migrations, makeContext, logger = console, owner = `${os.hostname()}:${process.pid}` }) {
    const locked = await store.tryLock(owner, LOCK_TTL_MS);
    if (!locked) return { skipped: 'locked', applied: [], failed: null, pending: [] };
    const applied = [];
    let failed = null;
    try {
        const { pending } = planRuns(migrations, await store.all());
        for (const migration of pending) {
            const ctx = makeContext();
            const startedAt = Date.now();
            logger.info(`[migrations] running ${migration.id} (${migration.scope})`);
            try {
                await migration.up(ctx);
                await store.put({ _id: migration.id, appliedAt: new Date(), durationMs: Date.now() - startedAt, appVersion: buildInfo.get().version, ok: true, error: null, companies: ctx.companies });
                applied.push(migration.id);
            } catch (error) {
                const message = String(error?.message || error);
                await store.put({ _id: migration.id, appliedAt: new Date(), durationMs: Date.now() - startedAt, appVersion: buildInfo.get().version, ok: false, error: message, companies: ctx.companies });
                logger.error(`[migrations] ${migration.id} failed: ${message}`);
                failed = { id: migration.id, error: message };
                break;
            }
        }
        const remaining = planRuns(migrations, await store.all()).pending.map((m) => m.id);
        return { skipped: false, applied, failed, pending: remaining };
    } finally {
        await store.unlock(owner);
    }
}

/* Reverts one applied migration that defines down(ctx, options) and forgets its
 * record so `up` can apply it again. Only the caller's explicit options reach the
 * migration; a rollback that rewrites data guards itself on them. */
async function rollbackMigration({ store, migrations, makeContext, logger = console, owner = `${os.hostname()}:${process.pid}` }, id, options = {}) {
    const migration = migrations.find((m) => m.id === id);
    if (!migration) throw new Error(`unknown migration "${id}"`);
    if (typeof migration.down !== 'function') throw new Error(`${id} has no down()`);
    const record = (await store.all()).find((r) => r._id === id);
    if (!record || !record.ok) throw new Error(`${id} is not applied`);
    const locked = await store.tryLock(owner, LOCK_TTL_MS);
    if (!locked) return { skipped: 'locked' };
    try {
        const ctx = makeContext();
        logger.info(`[migrations] rolling back ${id} (${migration.scope})`);
        await migration.down(ctx, options);
        await store.remove(id);
        return { skipped: false, id, companies: ctx.companies };
    } finally {
        await store.unlock(owner);
    }
}

const errorText = (error) => String((error && error.message) || error);

function groupWrites(writes) {
    const groups = new Map();
    for (const w of writes) {
        const key = [w.collection, w.op, (w.filter || []).join(','), w.update || ''].join('|');
        if (!groups.has(key)) groups.set(key, { collection: w.collection, op: w.op, calls: 0, dbs: new Set(), documents: 0, upserts: 0, filter: w.filter || [], update: w.update || null });
        const group = groups.get(key);
        group.calls += 1;
        group.dbs.add(w.db);
        group.documents = group.documents === null || w.documents === null || w.documents === undefined ? null : group.documents + w.documents;
        group.upserts += w.upserts || 0;
    }
    return [...groups.values()].map(({ dbs, ...group }) => ({ ...group, databases: dbs.size }));
}

function cannotDryRunReason(id, journal) {
    const [read] = journal.readsAfterWrite;
    if (read) {
        const by = read.writtenBy === id ? 'this migration' : read.writtenBy;
        const more = journal.readsAfterWrite.length - 1;
        return `reads ${read.collection} (${read.op}) after ${by} would write it (${read.writeOp})${more ? `, and ${more} more like it` : ''}`;
    }
    const [op] = journal.unsupported;
    return op ? `uses ${op.op} on ${op.collection}, which a dry run cannot record` : null;
}

/* Runs every pending up() with the driver-level guard recording instead of writing, so the plan
 * comes from the migration's own code. No lock and no schema_versions row: nothing is applied.
 * A migration that reads what it (or an earlier pending one) would have written sees the old
 * data, so its plan would mislead; it is reported as cannot-dry-run instead. */
async function dryRunMigrations({ store, migrations, makeContext, guard }) {
    const results = [];
    try {
        guard.refuse();
        const { pending } = planRuns(migrations, await store.all());
        guard.forget();
        for (const migration of pending) {
            const ctx = makeContext();
            guard.record(migration.id);
            let error = null;
            try {
                await migration.up(ctx);
            } catch (e) {
                error = errorText(e);
            }
            const journal = guard.take();
            const outcome = { id: migration.id, scope: migration.scope, writes: groupWrites(journal.writes) };
            const reason = cannotDryRunReason(migration.id, journal);
            if (reason) Object.assign(outcome, { status: 'cannot-dry-run', reason });
            else if (error) Object.assign(outcome, { status: 'failed', error });
            else outcome.status = 'plan';
            results.push(outcome);
        }
    } finally {
        guard.off();
    }
    return { results };
}

/* Runs the optional verify(ctx) of every applied migration with every write refused. verify
 * resolves to a list of problems, empty while the migration's guarantee still holds. */
async function verifyMigrations({ store, migrations, makeContext, guard }) {
    try {
        guard.refuse();
        const { applied, pending } = planRuns(migrations, await store.all());
        const appliedIds = new Set(applied.map((r) => r._id));
        const results = [];
        for (const migration of migrations.filter((m) => appliedIds.has(m.id))) {
            if (typeof migration.verify !== 'function') {
                results.push({ id: migration.id, status: 'no-check', problems: [] });
                continue;
            }
            guard.take();
            let problems = [];
            let error = null;
            try {
                const found = await migration.verify(makeContext());
                problems = Array.isArray(found) ? found.map(String) : [];
            } catch (e) {
                error = errorText(e);
            }
            const { writes } = guard.take();
            if (writes.length) error = `tried to write: ${[...new Set(writes.map((w) => `${w.op} on ${w.collection}`))].join(', ')}`;
            results.push({ id: migration.id, status: error || problems.length ? 'fail' : 'pass', problems, error });
        }
        return { results, notApplied: pending.map((m) => m.id) };
    } finally {
        guard.off();
    }
}

async function migrationStatus({ store, migrations }) {
    const { applied, pending, failed } = planRuns(migrations, await store.all());
    return {
        applied: applied.map(({ _id, appliedAt, durationMs, appVersion: v }) => ({ id: _id, appliedAt, durationMs, appVersion: v })),
        pending: pending.map((m) => ({ id: m.id, scope: m.scope })),
        failed: failed.map(({ _id, error, appliedAt }) => ({ id: _id, error, at: appliedAt })),
    };
}

function liveDeps() {
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    const { SCHEMA_TYPE } = require('../Config/schemaType');
    const { dbCollections, settingsCollectionDocs } = require('../Config/collections');
    const logger = require('../Config/loggerConfig');
    const { createMongoStore } = require('./store');
    const listCompanies = () => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.COMPANIES, data: [{}, { _id: 1, Cst_CompanyName: 1 }],
    }, 'find');
    return {
        store: createMongoStore({ MongoDbCrudOpration, SCHEMA_TYPE, lockId: LOCK_ID }),
        migrations: listMigrations(),
        makeContext: () => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, dbCollections, settingsCollectionDocs, logger, listCompanies }),
        logger,
        /* Set before the first model compiles, or Mongoose's own index and collection
         * creation would land in the plan as if the migration asked for it. */
        installWriteGuard() {
            const mongoose = require('mongoose');
            mongoose.set('autoIndex', false);
            mongoose.set('autoCreate', false);
            return require('./writeGuard').installWriteGuard(mongoose.mongo);
        },
    };
}

/* Read-only: what /health and the Upgrade page report. */
async function refreshMigrationState(deps = liveDeps()) {
    const { state } = require('../Config/instanceState');
    const status = await migrationStatus(deps);
    state.migrationsApplied = status.applied.length;
    state.migrationsPending = status.pending.length;
    return status;
}

/* Boot hook: never throws, never blocks on a dead database; the outcome lands in
 * instanceState for /health and the Upgrade page. With MIGRATIONS_AUTO=false only
 * the status is read, so pending work is still visible. */
async function runMigrationsAtBoot({ auto = process.env.MIGRATIONS_AUTO !== 'false' } = {}) {
    const { state } = require('../Config/instanceState');
    const { checkDb } = require('../Modules/Instance/health');
    const logger = require('../Config/loggerConfig');
    const db = await checkDb();
    if (!db.ok) {
        state.migrationError = `skipped at boot: ${db.error}`;
        logger.error(`[migrations] ${state.migrationError}`);
        return null;
    }
    try {
        const deps = liveDeps();
        const result = auto ? await runMigrations(deps) : { skipped: 'MIGRATIONS_AUTO=false', applied: [], failed: null };
        const status = await refreshMigrationState(deps);
        state.migrationError = result.failed ? `${result.failed.id}: ${result.failed.error}` : null;
        if (result.skipped) logger.info(`[migrations] skipped: ${result.skipped}; ${status.pending.length} pending`);
        else logger.info(`[migrations] applied ${result.applied.length}, pending ${status.pending.length}`);
        return result;
    } catch (error) {
        state.migrationError = String(error?.message || error);
        logger.error(`[migrations] runner failed: ${state.migrationError}`);
        return null;
    }
}

module.exports = { LOCK_ID, LOCK_TTL_MS, listMigrations, validateMigration, planRuns, buildContext, runMigrations, rollbackMigration, dryRunMigrations, verifyMigrations, migrationStatus, refreshMigrationState, liveDeps, runMigrationsAtBoot };
