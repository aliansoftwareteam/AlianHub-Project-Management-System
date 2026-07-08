const ctrl = require('./controller');

exports.init = (app) => {
    // Task "Development" conversation — chat with the AI dev-agent.
    app.post('/api/v2/dev-agent/message', ctrl.postMessage);   // user instruction (JWT)
    app.get('/api/v2/dev-agent/messages', ctrl.listMessages);  // conversation (JWT / PAT)
    app.get('/api/v2/dev-agent/pending', ctrl.listPending);    // runner polls pending (PAT)
    app.post('/api/v2/dev-agent/claim', ctrl.claimMessage);    // runner atomic claim (PAT)
    app.post('/api/v2/dev-agent/heartbeat', ctrl.heartbeat);   // runner keep-alive (PAT)
    app.post('/api/v2/dev-agent/reply', ctrl.postReply);       // runner replies (PAT)
    app.post('/api/v2/dev-agent/progress', ctrl.updateProgress); // runner live progress (PAT)
    app.post('/api/v2/dev-agent/approve', ctrl.approveJob);    // JWT: approve a gated bot job (awaiting_approval → pending)
    app.post('/api/v2/dev-agent/cancel', ctrl.cancelJob);      // JWT: cancel/stop a job
    app.get('/api/v2/dev-agent/project-repo', ctrl.getProjectRepo);  // JWT: a project's saved repo (tab pre-fill)
    app.post('/api/v2/dev-agent/project-repo', ctrl.setProjectRepo); // JWT: save a project's repo (+ resume parked bot jobs)

    // Device pairing — zero-config onboarding.
    app.post('/api/v2/dev-agent/bot', ctrl.ensureBot);         // JWT: ensure the shared AI Bot user exists (per-user visibility is client-side)
    app.post('/api/v2/dev-agent/pair', ctrl.generatePairing);  // JWT: signed-in dev authorizes this machine
    app.post('/api/v2/dev-pair', ctrl.exchangePairing);        // PUBLIC: runner exchanges the code → fresh PAT
    app.get('/api/v2/dev-agent-runner.js', ctrl.serveRunner);  // PUBLIC: download the standalone runner
    app.get('/api/v2/dev-agent-launcher', ctrl.serveLauncher); // PUBLIC: download a pre-filled one-click "Connect Computer" launcher
};
