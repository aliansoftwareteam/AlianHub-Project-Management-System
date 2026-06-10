const ctrl = require('./controller');

exports.init = (app) => {
    app.post('/api/v2/search', ctrl.globalSearch);
}
