const routes = require('./routes');
const engine = require('../Automations/engine');
const logger = require('../../Config/loggerConfig');
const sweep = require('./sweep');

exports.init = (app) => {
    require('../Agents/connectors/flag').logBootState();
    routes.init(app);
    engine.defineRecurring(sweep.JOB_NAME, sweep.intervalMs(), () => sweep.sweepAll()).catch((e) => logger.error(`[connectors] ${sweep.JOB_NAME}: ${e.message}`));
};
