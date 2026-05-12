const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v1/customField', ctrl.getCustomField)
    app.put('/api/v1/customField', ctrl.updateCustomField)
    app.post('/api/v1/customField', ctrl.insertCustomField)
}