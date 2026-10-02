const routes = require('./routes');
const domainEventBus = require('../../event/domainEventBus');
const logger = require('../../Config/loggerConfig');
const engine = require('./engine');
const dueDateTrigger = require('./engine/dueDateTrigger');

exports.init = (app) => {
    routes.init(app);
    domainEventBus.start();
    engine.defineRecurring(dueDateTrigger.JOB_NAME, dueDateTrigger.intervalMs(), () => dueDateTrigger.tickAll())
        .catch((e) => logger.error(`[automation-engine] ${dueDateTrigger.JOB_NAME}: ${e.message}`));
    engine.start().catch((e) => logger.error(`[automation-engine] start failed: ${e.message}`));
}
