const ctrl = require('./controller');
const { handleEvents } = require('./events');

exports.init = (app) => {
    app.get('/api/v2/setup/status', ctrl.getStatus);
    app.post('/api/v2/setup/complete', ctrl.complete);
    app.get('/api/v2/setup/events/:id', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        handleEvents(req, res);
    });
};
