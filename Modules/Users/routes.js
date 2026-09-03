const ctrl = require('./controller');
const sessions = require('./sessions');

exports.init = (app) => {
    app.put('/api/v1/user', ctrl.updateUserStatus);
    app.post('/api/v1/userAndCompanyCheck', ctrl.checkUserAndCompany);
    app.get('/api/v1/user/:id', ctrl.getUserById);
    app.post('/api/v1/user/find', ctrl.getUserByQuey);
    app.get('/api/v2/users/sessions', sessions.listOwnSessions);
    app.delete('/api/v2/users/sessions/:sessionId', sessions.deleteOwnSession);
};
