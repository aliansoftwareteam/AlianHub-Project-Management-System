const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/trash', ctrl.list);
    app.put('/api/v2/trash/:kind/:id/restore', ctrl.restore);
    app.delete('/api/v2/sample-data', ctrl.removeSampleData);
};
