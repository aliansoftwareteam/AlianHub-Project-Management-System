const { requireInstanceAdmin } = require('../Instance/guard');
const ctrl = require('./controller');
const { handleEvents } = require('./eventController');
const transcribe = require('./transcribe');
const meetingNotes = require('./meetingNotes');
const askController = require('./ask');
const askStream = require('./askStream');
const askThreads = require('./askThreads');
const feedback = require('./feedback');
const quality = require('./quality');
const aiProfile = require('./aiProfile');
const aiProfileImport = require('./aiProfileImport');
const askBuild = require('./askBuild');
const { requireTaskWritePermission } = require('../../Config/permissionGuard');
const { TASK_WRITE_ROUTES } = require('../../Config/taskWritePermissions');
const { chatSummaryHandler } = require('./chatSummary');

exports.init = (app) => {
    app.post('/api/v1/generatePrompt', ctrl.generatePrompt);
    app.post('/api/v1/generatePromptChat', ctrl.generatePromptChat);
    app.post('/api/v1/deleteUserChat', ctrl.deleteUserChat);
    app.post('/api/v1/getPrompts', ctrl.getPrompts);
    app.post('/api/v1/findOnePrompts', ctrl.findOnePrompts);
    app.post('/api/v1/getAiCategory', ctrl.getAiCategory);
    app.post('/api/v1/getAiModels', ctrl.getAiModels);
    app.post('/api/v1/updateAiModel', requireInstanceAdmin, ctrl.updateAiModel);
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
    app.post('/api/v1/ai/ask/stream', askStream.askStream);
    app.get('/api/v1/ai/ask/threads', askThreads.listThreads);
    app.get('/api/v1/ai/ask/threads/:id', askThreads.getThread);
    app.put('/api/v1/ai/ask/threads/:id', askThreads.renameThread);
    app.delete('/api/v1/ai/ask/threads/:id', askThreads.deleteThread);
    app.put('/api/v1/ai/feedback', feedback.saveFeedback);
    app.get('/api/v1/ai/feedback/mine', feedback.listMine);
    app.delete('/api/v1/ai/feedback/:id', feedback.removeFeedback);
    app.get('/api/v1/ai/quality', quality.getQuality);
    app.post('/api/v1/ai/quality/held-out', quality.runHeldOut);
    app.get('/api/v1/ai/memory', aiProfile.getProfile);
    app.put('/api/v1/ai/memory', aiProfile.saveProfile);
    app.delete('/api/v1/ai/memory', aiProfile.clearProfile);
    app.post('/api/v1/ai/memory/import/preview', aiProfileImport.previewImport);
    app.post('/api/v1/ai/memory/import/confirm', aiProfileImport.confirmImport);
    app.get('/api/v1/ai/ask/build/:projectId', askBuild.buildTarget);
    app.post('/api/v1/ai/ask/create-tasks', requireTaskWritePermission(TASK_WRITE_ROUTES['POST /api/v1/ai/ask/create-tasks'].entry), askBuild.createTasks);
    // Talk to Text — audio → text via OpenAI Whisper (multipart, field "file").
    app.post('/api/v1/ai/transcribe', ...transcribe.transcribe);
    app.post('/api/v1/ai/meeting-notes', meetingNotes.meetingNotesHandler);
    app.post('/api/v1/ai/chat-summary', chatSummaryHandler);
    app.get('/api/v1/generatePrompt/events/:id', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        handleEvents(req, res)
    });
}