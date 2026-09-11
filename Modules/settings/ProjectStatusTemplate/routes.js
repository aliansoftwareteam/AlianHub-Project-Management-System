const ctrl = require('./controller');
const { requireCompanyAdmin } = require('../../../Config/permissionGuard');

const companyAdmin = requireCompanyAdmin();

exports.init = (app) => {
    app.post('/api/v1/project-status-template', companyAdmin, ctrl.create);
    app.get('/api/v1/project-status-template', ctrl.get);
    app.put('/api/v1/project-status-template', companyAdmin, ctrl.update);
    app.delete('/api/v1/project-status-template/:id', companyAdmin, ctrl.delete);
}
