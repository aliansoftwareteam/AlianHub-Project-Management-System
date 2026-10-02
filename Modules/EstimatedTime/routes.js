const ctrl = require('./controller');
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    app.get('/api/v1/estimatedTime/:pid/:tid',ctrl.getEstimatedTime);
    app.put('/api/v1/estimatedTime',ctrl.updateEstimatedTime);
    app.post('/api/v1/estimatedTime', ctrl.getEstimateByAggregate);
    app.post('/api/v1/estimatedTime/ai/:tid', agentsRefused('ai.spend'), ctrl.generateAiEstimate);
    app.post('/api/v1/estimatedTime/ai/:tid/propose', agentsRefused('ai.spend'), ctrl.proposeAiEstimate);
}
