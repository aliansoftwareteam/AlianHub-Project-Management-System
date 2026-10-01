const routes = require('./routes');

exports.init = (app) => {
    require('../Agents/connectors/flag').logBootState();
    routes.init(app);
};
