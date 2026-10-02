const ctrl = require('./controller');
const { requireRestoreAccess } = require('./restoreAccess');
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    app.get('/api/v2/trash', ctrl.list);
    app.put('/api/v2/trash/:kind/:id/restore', agentsRefused('trash.restore'), requireRestoreAccess, ctrl.restore);
    app.delete('/api/v2/sample-data', ctrl.removeSampleData);
};
