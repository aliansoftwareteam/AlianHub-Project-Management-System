const ctrl = require('./controller');
const { requireCompanyAdmin } = require('../../Config/permissionGuard');

const companyAdmin = requireCompanyAdmin();

exports.init = (app) => {
    app.post('/api/v1/project/template/custom', companyAdmin, ctrl.createTemplate);
    app.post('/api/v1/project/template/custom/ai-generate', companyAdmin, ctrl.createTemplateWithAI);
    app.delete('/api/v1/project/template/custom/:id', companyAdmin, ctrl.deleteTemplate);
    app.get('/api/v1/project/template/custom', ctrl.getTemplates);
}
