const ctrl = require('./controller');

// AHE-3792 — AI Brain (autonomous project-manager agent), Phase 1 spine.
// All endpoints are companyId-scoped (companyid header); settings + inbox
// decisions are Owner/Admin only.
exports.init = (app) => {
    // Per-company autonomy config
    app.get('/api/v1/ai-brain/settings', ctrl.getSettings);
    app.post('/api/v1/ai-brain/settings', ctrl.updateSettings);
    // The action registry (the agent's allow-listed "hands")
    app.get('/api/v1/ai-brain/actions', ctrl.listActions);
    // Audit trail ("AI did X because Y")
    app.post('/api/v1/ai-brain/audit', ctrl.listAudit);
    // AI inbox — approval queue
    app.get('/api/v1/ai-brain/inbox', ctrl.listInbox);
    app.post('/api/v1/ai-brain/inbox/decide', ctrl.decideInbox);
    // Push an action through the gate (skills / brain / manual dispatch)
    app.post('/api/v1/ai-brain/propose', ctrl.propose);
};
