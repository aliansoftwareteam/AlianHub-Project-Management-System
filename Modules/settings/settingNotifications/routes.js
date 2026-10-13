const ctrl = require('./controller');
const preferences = require('./preferences');

exports.init = (app) => {
    app.put('/api/v1/notifications', ctrl.updateNotifications);
    app.get('/api/v1/notifications/preferences', preferences.getPreferences);
    app.put('/api/v1/notifications/preferences', preferences.updatePreferences);
    app.get('/api/v1/notifications/:id', ctrl.getNotifications);
}
