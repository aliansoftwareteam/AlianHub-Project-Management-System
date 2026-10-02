const { requireInstanceAdmin } = require('../Instance/guard');
const ctrl = require('./controller');
const { handleEvents } = require('./eventController');
const transcribe = require('./transcribe');
const meetingNotes = require('./meetingNotes');
const askController = require('./ask');
const askStream = require('./askStream');
const askThreads = require('./askThreads');
const askCard = require('./askCard');
const askPost = require('./askPost');
const taskValues = require('./taskValues');
const feedback = require('./feedback');
const quality = require('./quality');
const aiProfile = require('./aiProfile');
const aiProfileImport = require('./aiProfileImport');
const askBuild = require('./askBuild');
const { requireTaskWritePermission } = require('../../Config/permissionGuard');
const { TASK_WRITE_ROUTES } = require('../../Config/taskWritePermissions');
const { chatSummaryHandler } = require('./chatSummary');
const notesToTasks = require('./notesToTasks');
const assist = require('./assistController');
const { chatAskHandler, chatAskPostHandler } = require('./chatAsk');
const { agentsRefused } = require('../Agents/guard');

/* The workspace's AI writes these when a person asks for them. */
const askedByPeople = agentsRefused('ai.spend');

exports.init = (app) => {
    app.post('/api/v1/generatePrompt', askedByPeople, ctrl.generatePrompt);
    app.post('/api/v1/generatePromptChat', askedByPeople, ctrl.generatePromptChat);
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
    app.post('/api/v1/ai/description', askedByPeople, ctrl.writeDescription);
    app.post('/api/v1/ai/task-summary', askedByPeople, ctrl.summarizeTask);
    // The kept summary and area of the rows a table shows. Reads only: never a model call.
    app.post('/api/v1/ai/task-values', taskValues.keptValues);
    // Files a task under one of the labels its OWN project already uses (a
    // category custom field, else the project tags, else the company task
    // types). Never invents a vocabulary — a project with none gets a reason.
    app.post('/api/v1/ai/task-category', askedByPeople, ctrl.categoriseTask);
    app.get('/api/v1/ai/task-assist', assist.capabilities);
    app.post('/api/v1/ai/task-next-steps', askedByPeople, assist.nextSteps);
    app.post('/api/v1/ai/task-research', askedByPeople, assist.research);
    app.post('/api/v1/ai/selection/improve', askedByPeople, assist.improve);
    app.post('/api/v1/ai/selection/tasks', askedByPeople, assist.splitTasks);
    // Ask (handoff 13i). Retrieval is scoped to the projects the caller can
    // already open, so this endpoint can never widen anyone's permissions.
    app.get('/api/v1/ai/ask/sources', askController.sources);
    app.post('/api/v1/ai/ask', askedByPeople, askController.ask);
    app.post('/api/v1/ai/ask/stream', askedByPeople, askStream.askStream);
    app.get('/api/v1/ai/ask/threads', askThreads.listThreads);
    app.get('/api/v1/ai/ask/threads/:id', askThreads.getThread);
    app.put('/api/v1/ai/ask/threads/:id', askThreads.renameThread);
    app.delete('/api/v1/ai/ask/threads/:id', askThreads.deleteThread);
    app.get('/api/v1/ai/ask/card/:dashboardId/:cardUid', askCard.readAnswer);
    app.post('/api/v1/ai/ask/card/:dashboardId/:cardUid', askedByPeople, askCard.askAnswer);
    app.get('/api/v1/ai/ask/post/targets', askPost.targets);
    app.post('/api/v1/ai/ask/post', agentsRefused('ai.answer.post'), askPost.post);
    app.put('/api/v1/ai/feedback', feedback.saveFeedback);
    app.get('/api/v1/ai/feedback/mine', feedback.listMine);
    app.delete('/api/v1/ai/feedback/:id', feedback.removeFeedback);
    app.get('/api/v1/ai/quality', quality.getQuality);
    app.post('/api/v1/ai/quality/held-out', quality.runHeldOut);
    app.get('/api/v1/ai/memory', aiProfile.getProfile);
    app.put('/api/v1/ai/memory', agentsRefused('ai.memory.edit'), aiProfile.saveProfile);
    app.delete('/api/v1/ai/memory', aiProfile.clearProfile);
    app.post('/api/v1/ai/memory/import/preview', askedByPeople, aiProfileImport.previewImport);
    app.post('/api/v1/ai/memory/import/confirm', agentsRefused('ai.memory.edit'), aiProfileImport.confirmImport);
    app.get('/api/v1/ai/ask/build/:projectId', askBuild.buildTarget);
    app.post('/api/v1/ai/ask/create-tasks', agentsRefused('tasks.import'), requireTaskWritePermission(TASK_WRITE_ROUTES['POST /api/v1/ai/ask/create-tasks'].entry), askBuild.createTasks);
    // Talk to Text — audio → text via OpenAI Whisper (multipart, field "file").
    app.post('/api/v1/ai/transcribe', askedByPeople, ...transcribe.transcribe);
    app.post('/api/v1/ai/meeting-notes', askedByPeople, meetingNotes.meetingNotesHandler);
    app.post('/api/v1/ai/chat-summary', askedByPeople, chatSummaryHandler);
    app.post('/api/v1/ai/notes-to-tasks/propose', askedByPeople, notesToTasks.proposeHandler);
    app.post('/api/v1/ai/notes-to-tasks', agentsRefused('tasks.import'), notesToTasks.createHandler);
    app.post('/api/v1/ai/notes-to-tasks/undo', agentsRefused('task.delete'), notesToTasks.undoHandler);
    app.post('/api/v1/ai/chat-ask', askedByPeople, chatAskHandler);
    app.post('/api/v1/ai/chat-ask/post', agentsRefused('ai.answer.post'), chatAskPostHandler);
    app.get('/api/v1/generatePrompt/events/:id', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        handleEvents(req, res)
    });
}