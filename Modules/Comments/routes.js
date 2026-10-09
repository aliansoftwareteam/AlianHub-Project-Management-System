const ctrl = require('./controller');
const threads = require('./threads');
const { chatGuard } = require('../Agents/guard');
const named = require('./helpers/namedThread');
const { asked, every } = require('./helpers/askedWrites');

const POSTED = { task: 'task.comment', project: 'project.comment', channel: 'chat.post' };

exports.init = (app) => {
    app.post('/api/v1/comments', chatGuard(named.posted), asked(named.posted, POSTED), ctrl.save);
    app.put('/api/v1/comments', chatGuard(named.ofBodyId), asked(named.ofBodyId, every('comment.update')), ctrl.update);
    app.get('/api/v1/comments/get-paginated-messages', chatGuard(named.paged), ctrl.getPaginatedMessages);
    app.get('/api/v1/comments/get-searched-messages', chatGuard(named.searched), ctrl.searchMessageFromMainChat);
    app.get('/api/v1/comments/replies', chatGuard(named.ofParent), threads.listReplies);
    app.get('/api/v1/comments/action-items', chatGuard(named.queried), threads.actionItems);
    app.get('/api/v1/comments/assigned-to-me', threads.assignedToMe);
    app.post('/api/v1/comments/assign', chatGuard(named.ofBodyId), asked(named.ofBodyId, every('comment.assign')), threads.assign);
    app.post('/api/v1/comments/resolve', chatGuard(named.ofBodyId), asked(named.ofBodyId, every('comment.resolve')), threads.resolve);
}
