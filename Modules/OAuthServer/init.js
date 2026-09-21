const routes = require('./routes');

exports.init = (app, env) => {
    routes.init(app, env);
};
