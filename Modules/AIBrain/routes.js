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
    // Perceive — read-only project context the brain / skills reason over
    app.post('/api/v1/ai-brain/perceive', ctrl.getProjectContext);
    // Skills (the Think step) — list + run against a project
    app.get('/api/v1/ai-brain/skills', ctrl.listSkills);
    app.post('/api/v1/ai-brain/skills/run', ctrl.runSkill);
    // Phase B — per-project repo bindings ("work location" for the dev runner)
    app.get('/api/v1/ai-brain/repos', ctrl.listRepos);
    app.post('/api/v1/ai-brain/repos', ctrl.setRepo);
    // Phase B — dev-job pipeline. Admin (re)generates the runner token; the
    // self-hosted runner uses it (x-airunner-token header) to poll + report.
    app.post('/api/v1/ai-brain/runner-token', ctrl.generateRunnerToken);
    app.get('/api/v1/ai-brain/dev-jobs', ctrl.listDevJobs);
    app.post('/api/v1/ai-brain/dev-jobs/:id/claim', ctrl.claimDevJob);
    app.post('/api/v1/ai-brain/dev-jobs/:id/result', ctrl.completeDevJob);
};
