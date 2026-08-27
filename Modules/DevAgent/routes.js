const rateLimit = require('express-rate-limit');
const ctrl = require('./controller');
const attach = require('./helpers/attachments');

// Throttle the pairing endpoints — the public exchange mints a PAT, so cap attempts (D6).
const pairLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

exports.init = (app) => {
    // Task "Development" conversation — chat with the AI dev-agent.
    app.post('/api/v2/dev-agent/message', ctrl.postMessage);   // user instruction (JWT)
    app.get('/api/v2/dev-agent/messages', ctrl.listMessages);  // conversation (JWT / PAT)
    app.get('/api/v2/dev-agent/conversations', ctrl.listConversations); // JWT: MY chats in a project (the chat window's rail)
    app.post('/api/v2/dev-agent/conversation/delete', ctrl.deleteConversation); // JWT: delete one of my chats + its files
    app.post('/api/v2/dev-agent/conversation/rename', ctrl.renameConversation); // JWT: name one of my chats
    // Attachments on an instruction. Multipart only on the upload route: the
    // message endpoint stays JSON, so nothing that posts to it changes.
    app.post('/api/v2/dev-agent/attachment', attach.parseOne, ctrl.uploadAttachment); // JWT
    app.get('/api/v2/dev-agent/attachment', ctrl.downloadAttachment);                 // JWT / PAT (runner fetches)
    app.get('/api/v2/dev-agent/runner-state', ctrl.runnerState); // JWT: is my machine connected and signed in to Claude?
    app.post('/api/v2/dev-agent/auth-login', ctrl.requestSignIn);// JWT: ask my machine to open the Claude sign-in
    app.post('/api/v2/dev-agent/auth-report', ctrl.reportAuth);  // PAT: the runner reports how it went
    app.get('/api/v2/dev-agent/pending', ctrl.listPending);    // runner polls pending (PAT)
    app.post('/api/v2/dev-agent/claim', ctrl.claimMessage);    // runner atomic claim (PAT)
    app.post('/api/v2/dev-agent/heartbeat', ctrl.heartbeat);   // runner keep-alive (PAT)
    app.post('/api/v2/dev-agent/reply', ctrl.postReply);       // runner replies (PAT)
    app.post('/api/v2/dev-agent/enqueue', ctrl.enqueueFollowup); // runner queues a review-feedback follow-up (PAT) → awaiting_approval
    app.post('/api/v2/dev-agent/progress', ctrl.updateProgress); // runner live progress (PAT)
    app.post('/api/v2/dev-agent/approve', ctrl.approveJob);    // JWT: approve a gated bot job (awaiting_approval → pending)
    app.post('/api/v2/dev-agent/cancel', ctrl.cancelJob);      // JWT: cancel/stop a job
    app.get('/api/v2/dev-agent/project-repo', ctrl.getProjectRepo);  // JWT: a project's saved repo (tab pre-fill)
    app.post('/api/v2/dev-agent/project-repo', ctrl.setProjectRepo); // JWT: save a project's repo (+ resume parked bot jobs)

    // Device pairing — zero-config onboarding.
    app.post('/api/v2/dev-agent/bot', ctrl.ensureBot);         // JWT: ensure the shared AI Bot user exists (per-user visibility is client-side)
    app.post('/api/v2/dev-agent/pair', pairLimiter, ctrl.generatePairing);  // JWT: signed-in dev authorizes this machine
    app.post('/api/v2/dev-pair', pairLimiter, ctrl.exchangePairing);        // PUBLIC: runner exchanges the code → fresh PAT
    app.get('/api/v2/dev-agent-runner.js', ctrl.serveRunner);  // PUBLIC: download the standalone runner
    app.get('/api/v2/dev-agent-launcher', ctrl.serveLauncher); // PUBLIC: download a pre-filled one-click "Connect Computer" launcher
};
