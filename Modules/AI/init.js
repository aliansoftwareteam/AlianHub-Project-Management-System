const route = require('./routes');
const taskAiValues = require('./taskAiValues');

exports.init = (app) => {
    route.init(app);
    taskAiValues.start();
};