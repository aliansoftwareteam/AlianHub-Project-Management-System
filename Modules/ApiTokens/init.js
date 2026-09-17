const routes = require('./routes');
const logger = require('../../Config/loggerConfig');
const { noteStrictMode } = require('./helpers/strictSince');

exports.init = (app) => {
    routes.init(app);
    // At boot rather than on first use, so a quiet instance does not start the legacy-token grace late.
    noteStrictMode().catch((error) => logger.error(`api token strict mode: ${error.message}`));
}
