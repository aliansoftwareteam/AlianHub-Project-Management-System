const route = require('./routes');
const autoRefill = require('./aiFields/autoRefill');

exports.init = (app) => {
    route.init(app);
    autoRefill.start();
};
