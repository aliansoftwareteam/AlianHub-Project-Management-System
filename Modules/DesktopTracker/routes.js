const ctrl = require('./controller');

exports.init = (app) => {
    // Public: the tracker asks before anyone signs in, and the answer carries only what the sign-in page shows.
    app.get('/api/v2/tracker/handshake', ctrl.handshake);
    app.get('/api/v2/tracker/desktop-app', ctrl.desktopApp);
};
