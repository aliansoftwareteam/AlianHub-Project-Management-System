const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v1/customField', ctrl.getCustomField)
    app.put('/api/v1/customField', ctrl.updateCustomField)
    app.post('/api/v1/customField', ctrl.insertCustomField)
    app.get('/api/v2/custom-fields/formula/scope', ctrl.formulaScope)
    app.post('/api/v2/custom-fields/formula/validate', ctrl.validateFormula)
    app.post('/api/v2/custom-fields/compute', ctrl.computeFields)
}
