const ctrl = require('./controller');

exports.init = (app) => {
    app.post('/api/v2/reactions', ctrl.toggleReaction);
}
