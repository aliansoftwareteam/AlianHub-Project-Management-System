const route = require('./routes');
const autoRefill = require('./aiFields/autoRefill');
const computedRefresh = require('./computedRefresh');

exports.init = (app) => {
    route.init(app);
    autoRefill.start();
    computedRefresh.start();
};
