/* Process-local operational state. Nothing here survives a restart on purpose:
 * maintenance is something an operator switches on for the minutes a restore
 * takes, and a migration failure is re-evaluated at every boot. */
const state = {
    bootedAt: new Date(),
    maintenance: false,
    migrationError: null,
    migrationsPending: 0,
    migrationsApplied: 0,
    cron: {},
};

function recordCronRun(name, { ok = true, error = null } = {}) {
    state.cron[name] = { lastRunAt: new Date(), ok, error: error ? String(error.message || error) : null };
}

module.exports = { state, recordCronRun };
