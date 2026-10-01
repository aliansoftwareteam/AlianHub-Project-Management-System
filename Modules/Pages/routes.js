const ctrl = require('./controller');
const comments = require('./comments');

exports.init = (app) => {
    app.get('/api/v2/pages/ai-status', ctrl.aiStatus);
    app.post('/api/v2/pages/ai', ctrl.composeWithAi);
    app.get('/api/v2/pages/:id/comments', comments.listComments);
    app.post('/api/v2/pages/:id/comments', comments.createComment);
    app.put('/api/v2/pages/:id/comments/:commentId/resolve', comments.resolveComment);
    app.put('/api/v2/pages/:id/comments/:commentId', comments.updateComment);
    app.delete('/api/v2/pages/:id/comments/:commentId', comments.deleteComment);
    app.put('/api/v2/pages/:id/review', ctrl.markReviewed);
    app.put('/api/v2/pages/:id/approve', ctrl.approvePage);
    app.put('/api/v2/pages/:id/restore', ctrl.restorePage);
    app.post('/api/v2/pages/:id/images', ctrl.uploadImage);
    app.get('/api/v2/pages/:id', ctrl.getPage);
    app.put('/api/v2/pages/:id', ctrl.updatePage);
    app.delete('/api/v2/pages/:id', ctrl.deletePage);
    app.get('/api/v2/pages', ctrl.listPages);
    app.post('/api/v2/pages', ctrl.createPage);
};
