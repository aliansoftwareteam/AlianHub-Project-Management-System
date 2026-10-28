const hostingMode = require('../../Config/hostingMode');
const logger = require('../../Config/loggerConfig');
const routes = require('./routes');

/* What the platform stored, loaded into memory once the database is reachable, then the first
 * entitlements pull. Self-hosted there is nothing to load. */
async function boot({ pull = true } = {}) {
    if (!hostingMode.isManaged()) return false;
    const steps = [
        ['lifecycle', () => require('./lifecycle').loadLifecycle()],
        ['entitlements', () => require('./entitlements').loadEntitlements()],
        ['support session', () => require('./supportSession').loadSupportSession()],
    ];
    for (const [name, run] of steps) {
        await run().catch((error) => logger.error(`[platform] boot: ${name} not loaded: ${error && error.message ? error.message : error}`));
    }
    if (pull) await require('./entitlements').pullEntitlements();
    return true;
}

exports.boot = boot;

exports.init = (app) => {
    routes.init(app);
    if (hostingMode.isManaged()) setImmediate(() => boot().catch((error) => logger.error(`[platform] boot failed: ${error.message}`)));
};
