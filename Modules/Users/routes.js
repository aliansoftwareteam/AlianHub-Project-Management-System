const ctrl = require('./controller');

exports.init = (app) => {
    app.put('/api/v1/user', ctrl.updateUserStatus);
    app.post('/api/v1/userAndCompanyCheck', ctrl.checkUserAndCompany);
    app.get('/api/v1/user/:id', ctrl.getUserById);
    app.post('/api/v1/user/find', ctrl.getUserByQuey);
};