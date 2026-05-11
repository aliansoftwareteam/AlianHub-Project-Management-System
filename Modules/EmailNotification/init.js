const route = require('./routes');

/**
 * Init the module
 * @param {Object} app [Expressjs App Object]
 */
exports.init = (app) => {
    route.init(app);
};