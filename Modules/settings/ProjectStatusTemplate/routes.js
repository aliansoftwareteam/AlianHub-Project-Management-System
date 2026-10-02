const ctrl = require('./controller');
const { requireCompanyAdmin } = require('../../../Config/permissionGuard');
const { agentsRefused } = require('../../Agents/guard');

const companyAdmin = requireCompanyAdmin();
const statusesByPeople = agentsRefused('project.setup');

exports.init = (app) => {
    app.post('/api/v1/project-status-template', statusesByPeople, companyAdmin, ctrl.create);
    app.get('/api/v1/project-status-template', ctrl.get);
    app.put('/api/v1/project-status-template', statusesByPeople, companyAdmin, ctrl.update);
    app.delete('/api/v1/project-status-template/:id', companyAdmin, ctrl.delete);
}
