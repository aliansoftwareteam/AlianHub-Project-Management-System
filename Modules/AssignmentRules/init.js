const routes = require('./routes');
const engine = require('./engine');
const dispatcher = require('./dispatcher/gate');

exports.init = (app) => {
    routes.init(app);
    engine.start();
    dispatcher.start();
};
