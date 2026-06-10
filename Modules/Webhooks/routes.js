const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/webhooks/events', ctrl.listEvents);
    app.get('/api/v2/webhooks/:id/logs', ctrl.listWebhookLogs);
    app.get('/api/v2/webhooks', ctrl.listWebhooks);
    app.post('/api/v2/webhooks', ctrl.createWebhook);
    app.put('/api/v2/webhooks/:id', ctrl.updateWebhook);
    app.delete('/api/v2/webhooks/:id', ctrl.deleteWebhook);
}
