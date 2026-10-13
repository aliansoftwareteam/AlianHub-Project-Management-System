const routes = require('./routes');

exports.init = (app) => {
    require('../../Config/secrets').logBootState();
    routes.init(app);
};
