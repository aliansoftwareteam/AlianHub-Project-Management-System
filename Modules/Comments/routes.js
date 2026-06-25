const ctrl = require('./controller');

exports.init = (app) => {
    app.post('/api/v1/comments', ctrl.save);
    app.put('/api/v1/comments', ctrl.update);
    app.get('/api/v1/comments/get-paginated-messages', ctrl.getPaginatedMessages);
    app.get('/api/v1/comments/get-searched-messages', ctrl.searchMessageFromMainChat);
}