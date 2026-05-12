const route = require('./routes');
const route2 = require('./routes2');

/**
 * Init the module
 * @param {Object} app [Expressjs App Object]
 */
exports.init = (app) => {
    route.init(app);
    route2.init(app);
};