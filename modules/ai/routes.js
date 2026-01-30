const ctrl = require('./controller');
const { handleEvents } = require('./event-controller');

exports.init = (app) => {
    app.post('/api/v1/generatePrompt', ctrl.generatePrompt);
    app.post('/api/v1/generatePromptChat', ctrl.generatePromptChat);
    app.post('/api/v1/deleteUserChat', ctrl.deleteUserChat);
    app.post('/api/v1/getPrompts', ctrl.getPrompts);
    app.post('/api/v1/findOnePrompts', ctrl.findOnePrompts);
    app.post('/api/v1/getAiCategory', ctrl.getAiCategory);
    app.post('/api/v1/getAiModels', ctrl.getAiModels);
    app.post('/api/v1/updateAiModel', ctrl.updateAiModel);
    app.post('/api/v1/findOneAiModel', ctrl.findOneAiModel);
    app.get('/api/v1/generatePrompt/events/:id', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        handleEvents(req, res)
    });
}