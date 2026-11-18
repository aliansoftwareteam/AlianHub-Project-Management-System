const routes = require('./routes');

exports.init = (app) => {
    const chain = require('./chain');
    chain.logBootState();
    if (chain.config().keyValid) chain.installShutdownFlush();
    routes.init(app);
}
