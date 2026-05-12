const ctrl = require('./controller');

exports.init = (app) => {
    app.post('/api/v1/validateRefferalCode', ctrl.validateRefferalCode);
    app.get('/api/v1/getreferralpercentage', ctrl.getreferralpercentage);
}