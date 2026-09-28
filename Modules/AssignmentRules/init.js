const routes = require('./routes');
const engine = require('./engine');

exports.init = (app) => {
    routes.init(app);
    engine.start();
};
