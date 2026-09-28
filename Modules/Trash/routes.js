const ctrl = require('./controller');
const { requireRestoreAccess } = require('./restoreAccess');

exports.init = (app) => {
    app.get('/api/v2/trash', ctrl.list);
    app.put('/api/v2/trash/:kind/:id/restore', requireRestoreAccess, ctrl.restore);
    app.delete('/api/v2/sample-data', ctrl.removeSampleData);
};
