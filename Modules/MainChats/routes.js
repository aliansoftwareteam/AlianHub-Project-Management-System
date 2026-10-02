const ctrl = require('./controller');
const { chatGuard } = require('../Agents/guard');
const { DIRECT, CHANNEL } = require('../Comments/helpers/conversation');

/* The list of chat spaces is where channels are found; the other route lists the caller's direct messages. */
exports.init = (app) => {
    app.get('/api/v1/main-chats', chatGuard(() => CHANNEL), ctrl.getChats);
    app.post('/api/v1/main-chats/find', chatGuard(() => DIRECT), ctrl.setChats);
};
