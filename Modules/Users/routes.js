const ctrl = require('./controller');
const sessions = require('./sessions');
const onboarding = require('./onboarding');
const navPreferences = require('./navPreferences');
const favourites = require('./favourites');

exports.init = (app) => {
    app.put('/api/v1/user', ctrl.updateUserStatus);
    app.post('/api/v1/userAndCompanyCheck', ctrl.checkUserAndCompany);
    app.get('/api/v1/user/:id', ctrl.getUserById);
    app.post('/api/v1/user/find', ctrl.getUserByQuey);
    app.get('/api/v2/users/sessions', sessions.listOwnSessions);
    app.delete('/api/v2/users/sessions/:sessionId', sessions.deleteOwnSession);
    app.put('/api/v2/users/onboarding', onboarding.updateOwnOnboarding);
    app.put('/api/v2/users/nav-preferences', navPreferences.updateOwnNavPreferences);
    app.get('/api/v2/users/favourites', favourites.listOwnFavourites);
    app.put('/api/v2/users/favourites', favourites.setOwnFavourite);
    app.put('/api/v2/users/favourites/order', favourites.reorderOwnFavourites);
};
