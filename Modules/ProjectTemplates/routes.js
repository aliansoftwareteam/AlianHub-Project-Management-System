const ctrl = require('./controller');
const { requireCompanyAdmin } = require('../../Config/permissionGuard');

const companyAdmin = requireCompanyAdmin();
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    app.post('/api/v1/project/template/custom', agentsRefused('template.save'), companyAdmin, ctrl.createTemplate);
    app.post('/api/v1/project/template/custom/ai-generate', agentsRefused('ai.spend'), companyAdmin, ctrl.createTemplateWithAI);
    app.delete('/api/v1/project/template/custom/:id', companyAdmin, ctrl.deleteTemplate);
    app.get('/api/v1/project/template/custom', ctrl.getTemplates);
}
