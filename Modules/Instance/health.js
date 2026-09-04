const { version } = require('../../package.json');
const { state } = require('../../Config/instanceState');

const DB_TIMEOUT_MS = Number(process.env.HEALTH_DB_TIMEOUT_MS) || 3000;

const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref()),
]);

async function checkDb() {
    if (!process.env.MONGODB_URL) return { ok: false, error: 'MONGODB_URL is not set' };
    const { handleConnection } = require('../../middlewares/mongoConnector/mongoConnection');
    const startedAt = Date.now();
    try {
        const res = await withTimeout(handleConnection('global'), DB_TIMEOUT_MS, 'database ping');
        await withTimeout(res.database.db.admin().ping(), DB_TIMEOUT_MS, 'database ping');
        return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
        return { ok: false, error: error?.statusText || error?.message || String(error) };
    }
}

/* Pure: turns the probe results into the answer the process reports. Only a
 * dead database is a failure for a load balancer; everything else is a warning
 * the Instance console shows, because a restart would not fix it. */
function summarizeHealth({ db, migrationsPending = 0, migrationError = null, maintenance = false, appVersion = version }) {
    const status = db?.ok ? 'ok' : 'degraded';
    return {
        httpStatus: db?.ok ? 200 : 503,
        body: {
            status,
            version: appVersion,
            db: { ok: Boolean(db?.ok), latencyMs: db?.latencyMs ?? null, error: db?.error || null },
            migrationsPending,
            migrationError: migrationError ? String(migrationError) : null,
            maintenance: Boolean(maintenance),
            uptimeSeconds: Math.round(process.uptime()),
        },
    };
}

const getHealth = async () => summarizeHealth({
    db: await checkDb(),
    migrationsPending: state.migrationsPending,
    migrationError: state.migrationError,
    maintenance: state.maintenance,
});

module.exports = { checkDb, summarizeHealth, getHealth, withTimeout };
