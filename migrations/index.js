const fs = require('fs');
const os = require('os');
const path = require('path');
const { version: appVersion } = require('../package.json');

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
                await store.put({ _id: migration.id, appliedAt: new Date(), durationMs: Date.now() - startedAt, appVersion, ok: true, error: null, companies: ctx.companies });
                applied.push(migration.id);
            } catch (error) {
                const message = String(error?.message || error);
                await store.put({ _id: migration.id, appliedAt: new Date(), durationMs: Date.now() - startedAt, appVersion, ok: false, error: message, companies: ctx.companies });
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

module.exports = { LOCK_ID, LOCK_TTL_MS, listMigrations, validateMigration, planRuns, buildContext, runMigrations, migrationStatus, refreshMigrationState, liveDeps, runMigrationsAtBoot };
