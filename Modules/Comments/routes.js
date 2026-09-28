const ctrl = require('./controller');
const threads = require('./threads');

exports.init = (app) => {
    app.post('/api/v1/comments', ctrl.save);
    app.put('/api/v1/comments', ctrl.update);
    app.get('/api/v1/comments/get-paginated-messages', ctrl.getPaginatedMessages);
    app.get('/api/v1/comments/get-searched-messages', ctrl.searchMessageFromMainChat);
    app.get('/api/v1/comments/replies', threads.listReplies);
    app.get('/api/v1/comments/action-items', threads.actionItems);
    app.get('/api/v1/comments/assigned-to-me', threads.assignedToMe);
    app.post('/api/v1/comments/assign', threads.assign);
    app.post('/api/v1/comments/resolve', threads.resolve);
}