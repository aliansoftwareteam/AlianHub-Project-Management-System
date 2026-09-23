const ctrl = require('./controller');
const { searchComments } = require('../Comments/controller');
const { keepVisibleProjects } = require('../../Config/projectAccess');

const commentSearchProjects = keepVisibleProjects({
    get: (req) => {
        const pids = req.body && req.body.pids;
        if (Array.isArray(pids)) return pids;
        return typeof pids === 'string' ? pids.split(',').map((id) => id.trim()).filter(Boolean) : [];
    },
    set: (req, ids) => { req.body = { ...(req.body || {}), pids: ids }; },
});

exports.init = (app) => {
    app.post('/api/v1/advance/filter/create', ctrl.saveFilter);
    app.get('/api/v1/advance/filter/:userId/:filterType', ctrl.getFilter);
    app.put('/api/v1/advance/filter/update', ctrl.updateFilter);
    app.delete('/api/v1/advance/filter/delete/:cid/:id', ctrl.deleteFilter);
    app.post('/api/v1/advance/filter/search/tasks', ctrl.searchTasks);
    app.post('/api/v1/advance/filter/search/projects', ctrl.searchProjects);
    app.post('/api/v1/advance/filter/search/files', ctrl.searchFiles);
    app.post('/api/v1/advance/filter/search/links', ctrl.searchLinks);
    app.post('/api/v1/advance/filter/search/comments', commentSearchProjects, searchComments);
};