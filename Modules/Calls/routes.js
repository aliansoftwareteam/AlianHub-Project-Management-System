const iceConfig = require('./iceConfig');

exports.init = (app) => {
    // Read-only: the STUN/TURN servers the browser should use, with a short-lived TURN
    // credential minted per request. Authenticated — a relay handed to anonymous callers
    // is a relay for the whole internet.
    app.get('/api/v2/calls/ice-config', iceConfig.getIceConfig);
};
