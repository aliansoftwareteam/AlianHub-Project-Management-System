const routes = require('./routes');

exports.init = (app) => {
    require('./chain').logBootState();
    routes.init(app);
}
