const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/who-can-see/:kind/:id', ctrl.whoCanSee);
};
