const ctrl = require('./controller');

exports.init = (app) => {
    app.post('/api/v1/project/personal', ctrl.getOrCreatePersonalProject);
};
