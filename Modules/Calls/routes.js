const iceConfig = require('./iceConfig');
const notes = require('./notes');

exports.init = (app) => {
    // Read-only: the STUN/TURN servers the browser should use, with a short-lived TURN
    // credential minted per request. Authenticated — a relay handed to anonymous callers
    // is a relay for the whole internet.
    app.get('/api/v2/calls/ice-config', iceConfig.getIceConfig);

    // Meeting notes written by the notetaker when a call ends. Only participants can read
    // or edit them; the filter enforces that, not the client.
    app.post('/api/v2/calls/notes', notes.createNotes);
    app.get('/api/v2/calls/notes', notes.listNotes);
    app.get('/api/v2/calls/notes/:id', notes.getNotes);
    app.patch('/api/v2/calls/notes/:id', notes.updateNotes);
};
