const { ulid } = require('ulid');
const logger = require('../../../Config/loggerConfig');
const domainEventBus = require('../../../event/domainEventBus');

// `form.submitted` envelopes.
//
// Task events reach the bus by listening to the socket emits every task write
// already fires. A form submission has no such emit to observe — the public
// handler is the only place that knows a submission happened — so it builds the
// envelope itself and publishes it in the same shape the matcher and runner read.
//
// `entity` is the TASK the submission filed when there is one, because every
// action in the registry acts on a task and the rules this trigger exists for
// ("severity Blocking → priority Urgent") are about that task. With task
// creation switched off there is no task to act on, so the entity is the form
// and a task action on such a rule fails loudly rather than touching the wrong
// document.

const LOG_PREFIX = '[form-events]';
const EVENT_TYPE = 'form.submitted';

/* Answers keyed by question id, so a condition reads `answers.<questionId>`.
 * The transcript a submission produces is a list, which no operator can index. */
const answerMap = (record) => {
    const out = {};
    (Array.isArray(record) ? record : []).forEach((row) => {
        if (!row || !row.questionId) return;
        out[String(row.questionId)] = Array.isArray(row.value) ? row.value.map(String) : row.value;
    });
    return out;
};

const buildFormEnvelope = ({ companyId, form, submissionId, answers, task, actor }) => {
    const projectId = form && form.ProjectID ? String(form.ProjectID) : null;
    const taskId = task && task._id ? String(task._id) : null;
    return {
        id: ulid(),
        companyId: String(companyId),
        type: EVENT_TYPE,
        occurredAt: new Date().toISOString(),
        actor: {
            userId: actor && actor.userId ? String(actor.userId) : null,
            kind: actor && actor.kind ? actor.kind : 'system',
        },
        depth: 0,
        scope: {
            projectId,
            sprintId: form && form.sprintId ? String(form.sprintId) : null,
        },
        entity: taskId
            ? { kind: 'task', id: taskId, key: (task && task.TaskKey) || null }
            : { kind: 'form', id: form && form._id ? String(form._id) : null, key: (form && form.title) || null },
        data: {
            formId: form && form._id ? String(form._id) : null,
            formTitle: (form && form.title) || null,
            submissionId: submissionId ? String(submissionId) : null,
            ProjectID: projectId,
            sprintId: form && form.sprintId ? String(form.sprintId) : null,
            taskId,
            taskKey: (task && task.TaskKey) || null,
            TaskName: (task && task.TaskName) || null,
            statusType: (task && task.statusType) || null,
            statusKey: (task && task.statusKey) || null,
            Task_Priority: (task && task.Task_Priority) || null,
            answers: answerMap(answers),
        },
        previous: null,
        changedFields: [],
    };
};

/* Fire-and-forget: a submission is already stored by the time this runs, and a
 * broken rule must never turn a successful submission into an error page. */
const publishFormSubmitted = (input) => {
    try {
        const envelope = buildFormEnvelope(input);
        domainEventBus.bus.emit('domain.event', envelope);
        domainEventBus.bus.emit(EVENT_TYPE, envelope);
        return envelope;
    } catch (error) {
        logger.error(`${LOG_PREFIX} could not publish ${EVENT_TYPE}: ${error.message}`);
        return null;
    }
};

module.exports = { publishFormSubmitted, buildFormEnvelope, answerMap, EVENT_TYPE };
