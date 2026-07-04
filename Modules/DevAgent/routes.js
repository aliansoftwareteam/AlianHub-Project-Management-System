const ctrl = require('./controller');

exports.init = (app) => {
    // Task "Development" conversation — chat with the AI dev-agent.
    app.post('/api/v2/dev-agent/message', ctrl.postMessage);   // user instruction (JWT)
    app.get('/api/v2/dev-agent/messages', ctrl.listMessages);  // conversation (JWT / PAT)
    app.get('/api/v2/dev-agent/pending', ctrl.listPending);    // runner polls pending (PAT)
    app.post('/api/v2/dev-agent/reply', ctrl.postReply);       // runner replies (PAT)

    // Device pairing — zero-config onboarding.
    app.post('/api/v2/dev-agent/pair', ctrl.generatePairing);  // JWT: signed-in dev authorizes this machine
    app.post('/api/v2/dev-pair', ctrl.exchangePairing);        // PUBLIC: runner exchanges the code → fresh PAT
    app.get('/api/v2/dev-agent-runner.js', ctrl.serveRunner);  // PUBLIC: download the standalone runner
};
