const routes = require('./routes');
const logger = require('../../Config/loggerConfig');
const { noteStrictMode } = require('./helpers/strictSince');
const { noteMaxLifetime } = require('./helpers/maxLifetimeSince');
const { maxDaysProblem } = require('./helpers/apiTokenRules');

exports.init = (app) => {
    routes.init(app);
    const problem = maxDaysProblem();
    if (problem) logger.warn(problem);
    // At boot rather than on first use, so a quiet instance does not start the legacy-token grace or the lifetime cap late.
    noteStrictMode().catch((error) => logger.error(`api token strict mode: ${error.message}`));
    noteMaxLifetime().catch((error) => logger.error(`api token maximum lifetime: ${error.message}`));
}
