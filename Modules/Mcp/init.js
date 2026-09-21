const routes = require('./routes');
const cursor = require('./cursor');

exports.init = (app) => {
    cursor.assertKey();
    routes.init(app);
};
