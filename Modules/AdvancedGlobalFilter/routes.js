const ctrl = require('./controller');
const { searchComments } = require('../Comments/controller');
const { keepVisibleProjects } = require('../../Config/projectAccess');
const { keepTaskListProjectIds } = require('../Tasks/helpers/taskListProjects');
const logger = require('../../Config/loggerConfig');
const { limitCallerFilters } = require('../Company/helpers/callerQueryRules');

const visibleProjects = keepVisibleProjects({
    get: (req) => {
        const pids = req.body && req.body.pids;
        if (Array.isArray(pids)) return pids;
        return typeof pids === 'string' ? pids.split(',').map((id) => id.trim()).filter(Boolean) : [];
    },
    set: (req, ids) => { req.body = { ...(req.body || {}), pids: ids }; },
});

/* Every search here reads a project's tasks or what hangs off them, so the projects are kept to
 * the ones whose tasks the caller may list. */
const taskListProjects = async (req, res, next) => {
    try {
        req.body.pids = await keepTaskListProjectIds(String(req.headers['companyid'] || ''), req.uid, req.body.pids);
        return next();
    } catch (error) {
        logger.error(`advanced search projects: ${error.message || error}`);
        return res.status(403).json({ status: false, statusText: 'Permission check failed.', error: 'Forbidden' });
    }
};

const searchedProjects = [visibleProjects, taskListProjects];
const searchFilters = limitCallerFilters('filterQuery', 'publicQuery', 'privateQuery');

exports.init = (app) => {
    app.post('/api/v1/advance/filter/create', ctrl.saveFilter);
    app.get('/api/v1/advance/filter/:userId/:filterType', ctrl.getFilter);
    app.put('/api/v1/advance/filter/update', ctrl.updateFilter);
    app.delete('/api/v1/advance/filter/delete/:cid/:id', ctrl.deleteFilter);
    app.post('/api/v1/advance/filter/search/tasks', searchFilters, ...searchedProjects, ctrl.searchTasks);
    app.post('/api/v1/advance/filter/search/projects', searchFilters, ctrl.searchProjects);
    app.post('/api/v1/advance/filter/search/files', searchFilters, ...searchedProjects, ctrl.searchFiles);
    app.post('/api/v1/advance/filter/search/links', searchFilters, ...searchedProjects, ctrl.searchLinks);
    app.post('/api/v1/advance/filter/search/comments', searchFilters, ...searchedProjects, searchComments);
};