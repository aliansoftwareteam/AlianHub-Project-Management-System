const ctrl = require('./controller');
const { projectAsked } = require('../Agents/guard');

const drawn = projectAsked((req) => ({ action: 'whiteboard.update', params: { projectId: String((req.params && req.params.projectId) || '') } }));

exports.init = (app) => {
    app.get('/api/v2/whiteboards/:projectId/:sprintId', ctrl.readBoard);
    app.patch('/api/v2/whiteboards/:projectId/:sprintId', drawn, ctrl.saveBoard);
    app.get('/api/v2/whiteboards/:projectId/:sprintId/history', ctrl.listHistory);
    app.post('/api/v2/whiteboards/:projectId/:sprintId/restore', drawn, ctrl.restoreBoard);
};
