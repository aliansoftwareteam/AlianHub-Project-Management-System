const routes = require('./routes');
const domainEventBus = require('../../event/domainEventBus');
const engine = require('./engine');

exports.init = (app) => {
    routes.init(app);
    domainEventBus.start();
    engine.start().catch((e) => require('../../Config/loggerConfig').error(`[automation-engine] start failed: ${e.message}`));
}
