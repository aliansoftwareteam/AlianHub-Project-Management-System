const ctrl = require('./controller');
const comments = require('./comments');
const versions = require('./versions');
const { agentsRefused } = require('../Agents/guard');

const commentsByPeople = agentsRefused('page.comment');

exports.init = (app) => {
    app.get('/api/v2/pages/ai-status', ctrl.aiStatus);
    app.post('/api/v2/pages/ai', ctrl.composeWithAi);
    app.get('/api/v2/pages/:id/comments/people', comments.listPeople);
    app.get('/api/v2/pages/:id/comments', comments.listComments);
    app.post('/api/v2/pages/:id/comments', commentsByPeople, comments.createComment);
    app.put('/api/v2/pages/:id/comments/:commentId/assign', commentsByPeople, comments.assignComment);
    app.put('/api/v2/pages/:id/comments/:commentId/reaction', commentsByPeople, comments.reactToComment);
    app.put('/api/v2/pages/:id/comments/:commentId/resolve', commentsByPeople, comments.resolveComment);
    app.put('/api/v2/pages/:id/comments/:commentId', commentsByPeople, comments.updateComment);
    app.delete('/api/v2/pages/:id/comments/:commentId', comments.deleteComment);
    app.get('/api/v2/pages/:id/versions', versions.listVersions);
    app.post('/api/v2/pages/:id/versions', versions.saveVersion);
    app.post('/api/v2/pages/:id/versions/:versionId/restore', versions.restoreVersion);
    app.get('/api/v2/pages/:id/versions/:versionId', versions.getVersion);
    app.put('/api/v2/pages/:id/versions/:versionId', versions.renameVersion);
    app.put('/api/v2/pages/:id/review', ctrl.markReviewed);
    app.put('/api/v2/pages/:id/approve', agentsRefused('page.approve'), ctrl.approvePage);
    app.put('/api/v2/pages/:id/restore', ctrl.restorePage);
    app.post('/api/v2/pages/:id/images', ctrl.uploadImage);
    app.get('/api/v2/pages/:id', ctrl.getPage);
    app.put('/api/v2/pages/:id', ctrl.updatePage);
    app.delete('/api/v2/pages/:id', ctrl.deletePage);
    app.get('/api/v2/pages', ctrl.listPages);
    app.post('/api/v2/pages', ctrl.createPage);
};
