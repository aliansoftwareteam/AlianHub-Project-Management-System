const routes = require('./routes');
const goalEvents = require('./goalEvents');

exports.init = (app) => {
    routes.init(app);
    goalEvents.start();
};
