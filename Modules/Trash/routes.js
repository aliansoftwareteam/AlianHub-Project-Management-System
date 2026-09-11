const ctrl = require('./controller');
const { requireProjectAccess, DELETE_OR_CLOSE } = require('../../Config/projectAccess');

exports.init = (app) => {
    app.get('/api/v2/trash', ctrl.list);
    app.put('/api/v2/trash/:kind/:id/restore', requireProjectAccess({ projectIds: (req) => (req.params.kind === 'projects' ? req.params.id : []), permissions: () => [DELETE_OR_CLOSE] }), ctrl.restore);
    app.delete('/api/v2/sample-data', ctrl.removeSampleData);
};
