const ctrl = require('./controller');
const { agentsRefused, projectAsked } = require('../Agents/guard');

const text = (value) => (typeof value === 'string' ? value : '');
const planned = projectAsked((req, body) => ({ action: 'time.plan', params: { taskId: text(body.taskId), projectId: text(body.projectId) } }));

exports.init = (app) => {
    app.get('/api/v1/estimatedTime/:pid/:tid',ctrl.getEstimatedTime);
    app.put('/api/v1/estimatedTime', planned, ctrl.updateEstimatedTime);
    app.post('/api/v1/estimatedTime', ctrl.getEstimateByAggregate);
    app.post('/api/v1/estimatedTime/ai/:tid', agentsRefused('ai.spend'), ctrl.generateAiEstimate);
    app.post('/api/v1/estimatedTime/ai/:tid/propose', agentsRefused('ai.spend'), ctrl.proposeAiEstimate);
}
