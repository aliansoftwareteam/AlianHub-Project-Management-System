const ctrl = require('./controller');
const comments = require('./comments');
const versions = require('./versions');
const shares = require('./shares');
const { agentsRefused, pageCreateGuard } = require('../Agents/guard');

const commentsByPeople = agentsRefused('page.comment');
const sharesByPeople = agentsRefused('page.share');

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
    app.post('/api/v2/pages/:id/versions', agentsRefused('page.version.save'), versions.saveVersion);
    app.post('/api/v2/pages/:id/versions/:versionId/restore', agentsRefused('page.version.restore'), versions.restoreVersion);
    app.get('/api/v2/pages/:id/versions/:versionId', versions.getVersion);
    app.put('/api/v2/pages/:id/versions/:versionId', agentsRefused('page.version.rename'), versions.renameVersion);
    app.get('/api/v2/pages/:id/shares', shares.listShares);
    app.put('/api/v2/pages/:id/shares/:userId', sharesByPeople, shares.putShare);
    app.delete('/api/v2/pages/:id/shares/:userId', sharesByPeople, shares.removeShare);
    app.put('/api/v2/pages/:id/review', agentsRefused('page.review'), ctrl.markReviewed);
    app.put('/api/v2/pages/:id/approve', agentsRefused('page.approve'), ctrl.approvePage);
    app.put('/api/v2/pages/:id/restore', agentsRefused('page.restore'), ctrl.restorePage);
    app.post('/api/v2/pages/:id/images', agentsRefused('page.image'), ctrl.uploadImage);
    app.get('/api/v2/pages/:id', ctrl.getPage);
    app.put('/api/v2/pages/:id', agentsRefused('page.update'), ctrl.updatePage);
    app.delete('/api/v2/pages/:id', ctrl.deletePage);
    app.get('/api/v2/pages', ctrl.listPages);
    app.post('/api/v2/pages', pageCreateGuard, ctrl.createPage);
};
