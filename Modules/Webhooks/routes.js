const ctrl = require('./controller');
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    app.get('/api/v2/webhooks/events', ctrl.listEvents);
    app.get('/api/v2/webhooks/:id/logs', ctrl.listWebhookLogs);
    app.get('/api/v2/webhooks', ctrl.listWebhooks);
    app.post('/api/v2/webhooks', agentsRefused('webhook.manage'), ctrl.createWebhook);
    app.put('/api/v2/webhooks/:id', agentsRefused('webhook.manage'), ctrl.updateWebhook);
    app.delete('/api/v2/webhooks/:id', ctrl.deleteWebhook);
}
