const ctrl = require('./controller');
const { searchComments } = require('../Comments/controller');

exports.init = (app) => {
    app.post('/api/v1/advance/filter/create', ctrl.saveFilter);
    app.get('/api/v1/advance/filter/:userId/:filterType', ctrl.getFilter);
    app.put('/api/v1/advance/filter/update', ctrl.updateFilter);
    app.delete('/api/v1/advance/filter/delete/:cid/:id', ctrl.deleteFilter);
    app.post('/api/v1/advance/filter/search/tasks', ctrl.searchTasks);
    app.post('/api/v1/advance/filter/search/projects', ctrl.searchProjects);
    app.post('/api/v1/advance/filter/search/files', ctrl.searchFiles);
    app.post('/api/v1/advance/filter/search/links', ctrl.searchLinks);
    app.post('/api/v1/advance/filter/search/comments', searchComments);
};