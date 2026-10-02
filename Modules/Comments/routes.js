const ctrl = require('./controller');
const threads = require('./threads');
const { chatGuard } = require('../Agents/guard');
const named = require('./helpers/namedThread');

exports.init = (app) => {
    app.post('/api/v1/comments', chatGuard(named.posted), ctrl.save);
    app.put('/api/v1/comments', chatGuard(named.ofBodyId), ctrl.update);
    app.get('/api/v1/comments/get-paginated-messages', chatGuard(named.paged), ctrl.getPaginatedMessages);
    app.get('/api/v1/comments/get-searched-messages', chatGuard(named.searched), ctrl.searchMessageFromMainChat);
    app.get('/api/v1/comments/replies', chatGuard(named.ofParent), threads.listReplies);
    app.get('/api/v1/comments/action-items', chatGuard(named.queried), threads.actionItems);
    app.get('/api/v1/comments/assigned-to-me', threads.assignedToMe);
    app.post('/api/v1/comments/assign', chatGuard(named.ofBodyId), threads.assign);
    app.post('/api/v1/comments/resolve', chatGuard(named.ofBodyId), threads.resolve);
}