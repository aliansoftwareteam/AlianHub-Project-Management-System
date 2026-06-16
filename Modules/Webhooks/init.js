const routes = require('./routes');
const dispatcher = require('./dispatcher');

exports.init = (app) => {
    routes.init(app);
    dispatcher.start();
}
