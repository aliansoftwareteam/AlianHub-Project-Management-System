const ctrl = require('./controller');
const { chatGuard } = require('../Agents/guard');
const { reactedTo } = require('../Comments/helpers/namedThread');

exports.init = (app) => {
    app.post('/api/v2/reactions', chatGuard(reactedTo), ctrl.toggleReaction);
}
