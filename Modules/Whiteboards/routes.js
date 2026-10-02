const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/whiteboards/:projectId/:sprintId', ctrl.readBoard);
    app.patch('/api/v2/whiteboards/:projectId/:sprintId', ctrl.saveBoard);
    app.get('/api/v2/whiteboards/:projectId/:sprintId/history', ctrl.listHistory);
    app.post('/api/v2/whiteboards/:projectId/:sprintId/restore', ctrl.restoreBoard);
};
