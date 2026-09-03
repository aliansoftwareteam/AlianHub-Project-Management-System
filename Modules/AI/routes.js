const ctrl = require('./controller');
const { handleEvents } = require('./eventController');
const transcribe = require('./transcribe');
const meetingNotes = require('./meetingNotes');
const askController = require('./ask');

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
    // "Write with AI" for the task/project description editor. Provider-
    // agnostic (Anthropic / OpenAI / DeepSeek via the AIProjectGenerator
    // llmProvider). companyId resolves from the companyid header (set by the
    // axios interceptor). Returns { questions } or { description }.
    app.post('/api/v1/ai/description', ctrl.writeDescription);
    app.post('/api/v1/ai/task-summary', ctrl.summarizeTask);
    // Files a task under one of the labels its OWN project already uses (a
    // category custom field, else the project tags, else the company task
    // types). Never invents a vocabulary — a project with none gets a reason.
    app.post('/api/v1/ai/task-category', ctrl.categoriseTask);
    // Ask (handoff 13i). Retrieval is scoped to the projects the caller can
    // already open, so this endpoint can never widen anyone's permissions.
    app.get('/api/v1/ai/ask/sources', askController.sources);
    app.post('/api/v1/ai/ask', askController.ask);
    // Talk to Text — audio → text via OpenAI Whisper (multipart, field "file").
    app.post('/api/v1/ai/transcribe', ...transcribe.transcribe);
    app.post('/api/v1/ai/meeting-notes', meetingNotes.meetingNotesHandler);
    app.get('/api/v1/generatePrompt/events/:id', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        handleEvents(req, res)
    });
}