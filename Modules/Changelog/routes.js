const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/changelog', ctrl.getChangelog);
}
