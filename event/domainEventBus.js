const EventEmitter = require('events');
const { ulid } = require('ulid');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const logger = require('../Config/loggerConfig');
const telemetry = require('../Config/telemetry');
const socketEmitter = require('./socketEventEmitter');
const { normalizeChangedFields, createSnapshotStore } = require('../utils/entityEvents');

// Canonical domain-event bus — stage 1 of the automation engine (ADR 002).
//
// Subscribes to the namespaced socketEmitter events every mutation already fires,
// exactly as Modules/Webhooks/dispatcher.js does, so no existing write path needed
// changing. Raw Mongoose documents never reach a rule: everything is normalised to
// one envelope shape first, because `previous` and `changedFields` are what make
// "when status changes FROM In Progress TO Done" expressible at all.
//
// Phase 0 only observes. Nothing here matches rules or mutates data — envelopes are
// emitted for future consumers and optionally recorded, so a week of real traffic
// can be read before the matcher is built against a shape that turns out wrong.

const LOG_PREFIX = '[domain-events]';
const DEBOUNCE_MS = 2000;
const MAX_DEPTH = 3;

// Actor kinds. Events an automation itself caused are marked so rules can ignore
// them by default — without this, rule A's write wakes rule B, whose write wakes
// rule A, and one tenant's database absorbs the difference.
const ACTOR_KINDS = Object.freeze(['user', 'automation', 'agent', 'system']);

const bus = new EventEmitter();
bus.setMaxListeners(50);

// What we last *observed* per task. Deliberately not shared with the webhook
// dispatcher's store, which holds what it last *delivered* — a task the dispatcher
// filtered out still moved, and the engine has to see that.
const taskSnapshots = createSnapshotStore({ max: 5000 });

// `${companyId}:${entityId}:${type}` -> { companyId, doc, changed, emitType, actor, depth, timer }
const pending = new Map();

let started = false;
let recording = String(process.env.AUTOMATION_EVENT_LOG || '').toLowerCase() === 'true';

const isRecording = () => recording;
const setRecording = (on) => { recording = !!on; };

/* Which envelope type a task emit represents. Insert is unambiguous; an update is
 * named after the field that changed so rules can subscribe narrowly instead of
 * filtering every task.updated. Returns null for emits that carry no field change
 * (counter bumps and similar plumbing) — those are noise, not domain events. */
const classifyTaskEvent = (type, changedFields) => {
    if (type === 'insert') return 'task.created';
    if (!changedFields || !changedFields.size) return null;
    if (changedFields.has('statusType') || changedFields.has('status') || changedFields.has('statusKey')) return 'task.status_changed';
    if (changedFields.has('AssigneeUserId')) return 'task.assignee_changed';
    if (changedFields.has('Task_Priority')) return 'task.priority_changed';
    if (changedFields.has('Task_Leader')) return 'task.lead_changed';
    if (changedFields.has('DueDate') || changedFields.has('dueDateDeadLine')) return 'task.due_date_changed';
    if (changedFields.has('TaskName')) return 'task.renamed';
    if (changedFields.has('sprintId')) return 'task.sprint_changed';
    return 'task.updated';
};

/* The subset of a task an envelope carries. Bounded on purpose: the envelope is
 * copied into every matching run document, so putting the whole task in here makes
 * the run log grow with the description field. */
const trimTask = (doc) => ({
    _id: String(doc._id),
    TaskKey: doc.TaskKey || null,
    TaskName: doc.TaskName || null,
    statusType: doc.statusType || null,
    statusKey: doc.statusKey || null,
    Task_Priority: doc.Task_Priority || null,
    AssigneeUserId: Array.isArray(doc.AssigneeUserId) ? doc.AssigneeUserId.map(String) : [],
    Task_Leader: doc.Task_Leader ? String(doc.Task_Leader) : null,
    DueDate: doc.DueDate || null,
    startDate: doc.startDate || null,
    taskType: doc.taskType || null,
    isParentTask: doc.isParentTask !== false,
    ProjectID: doc.ProjectID ? String(doc.ProjectID) : null,
    sprintId: doc.sprintId ? String(doc.sprintId) : null,
});

/* An emit tells us a task changed but not who changed it. Until every write path
 * threads an actor through, fall back to system rather than inventing a user id —
 * a wrong actor on an audit entry is worse than an honest unknown. */
const resolveActor = (payload) => {
    const raw = payload?.actor;
    const kind = ACTOR_KINDS.includes(raw?.kind) ? raw.kind : 'system';
    return { userId: raw?.userId ? String(raw.userId) : null, kind };
};

const buildEnvelope = ({ companyId, type, doc, changedFields, previous, actor, depth }) => ({
    id: ulid(),
    companyId: String(companyId),
    type,
    occurredAt: new Date().toISOString(),
    traceId: telemetry.traceIdNow() || telemetry.newTraceId(),
    actor,
    depth: Number(depth) || 0,
    scope: {
        projectId: doc.ProjectID ? String(doc.ProjectID) : null,
        sprintId: doc.sprintId ? String(doc.sprintId) : null,
    },
    entity: { kind: 'task', id: String(doc._id), key: doc.TaskKey || null },
    data: trimTask(doc),
    previous: previous || null,
    changedFields: Array.from(changedFields || []),
});

/* Pages, projects and members have no field-level classification: an envelope names what
 * happened to the entity, and its data is the few fields a consumer needs to act on it. */
const buildEntityEnvelope = ({ companyId, type, entity, scope = {}, data = {}, actor, depth }) => ({
    id: ulid(),
    companyId: String(companyId),
    type,
    occurredAt: new Date().toISOString(),
    traceId: telemetry.traceIdNow() || telemetry.newTraceId(),
    actor: resolveActor({ actor }),
    depth: Number(depth) || 0,
    scope: {
        projectId: scope.projectId ? String(scope.projectId) : null,
        sprintId: scope.sprintId ? String(scope.sprintId) : null,
    },
    entity,
    data,
    previous: null,
    changedFields: [],
});

/* A page delete is one emit for the whole subtree it took, carrying every id in `ids`. */
const classifyPageEvent = (emitType, doc) => {
    if (Number(doc.deletedStatusKey) === 1) return 'page.deleted';
    return emitType === 'insert' ? 'page.created' : 'page.updated';
};

const trimPage = (doc) => ({
    _id: String(doc._id),
    ids: Array.isArray(doc.ids) && doc.ids.length ? doc.ids.map(String) : [String(doc._id)],
    ProjectID: doc.ProjectID ? String(doc.ProjectID) : null,
    visibility: doc.visibility || null,
    createdByAgent: doc.createdByAgent === true,
    deletedStatusKey: Number(doc.deletedStatusKey) || 0,
});

/* A comment is deleted by setting isDeleted, so its delete arrives as an update emit. */
const classifyCommentEvent = (emitType, doc) => {
    if (doc.isDeleted === true) return 'comment.deleted';
    return emitType === 'insert' ? 'comment.created' : 'comment.updated';
};

const idOrNull = (value) => (value ? String(value) : null);

const trimComment = (doc) => ({
    _id: String(doc._id),
    projectId: idOrNull(doc.projectId),
    sprintId: idOrNull(doc.sprintId),
    taskId: idOrNull(doc.taskId),
    isDeleted: doc.isDeleted === true,
});

/* Call notes are discarded by setting deletedStatusKey. The envelope never carries the transcript
 * or who was on the call: a consumer that needs them reads the row. */
const classifyTranscriptEvent = (emitType, doc) => {
    if (Number(doc.deletedStatusKey) === 1) return 'transcript.deleted';
    return emitType === 'insert' ? 'transcript.created' : 'transcript.updated';
};

const trimCall = (doc) => ({
    _id: String(doc._id),
    projectId: idOrNull(doc.projectId),
    deletedStatusKey: Number(doc.deletedStatusKey) || 0,
});

// Mongo rejects with strings, plain objects and sometimes nothing at all.
const failureText = (error) => (error && error.message) || String(error);

const eventLabel = (envelope) => {
    const entity = (envelope && envelope.entity) || {};
    return `${envelope && envelope.type} on ${entity.kind} ${entity.id} in company ${envelope && envelope.companyId}`;
};

async function record(envelope) {
    if (!recording) return;
    await MongoDbCrudOpration(envelope.companyId, {
        type: SCHEMA_TYPE.AUTOMATION_EVENT_LOG,
        data: {
            eventId: envelope.id,
            type: envelope.type,
            occurredAt: envelope.occurredAt,
            actor: envelope.actor,
            depth: envelope.depth,
            scope: envelope.scope,
            entity: envelope.entity,
            changedFields: envelope.changedFields,
            hasPrevious: !!envelope.previous,
        },
    }, 'save');
}

function publish(envelope) {
    if (envelope.depth > MAX_DEPTH) {
        logger.error(`${LOG_PREFIX} dropped ${envelope.type} for ${envelope.entity.id} — depth ${envelope.depth} exceeds ${MAX_DEPTH}`);
        return;
    }
    bus.emit('domain.event', envelope);
    bus.emit(envelope.type, envelope);
    record(envelope).catch((error) => logger.error(`${LOG_PREFIX} could not record ${eventLabel(envelope)}: ${failureText(error)}`));
}

function flush(entry) {
    const { companyId, doc, changed, actor, depth, emitType } = entry;
    const type = classifyTaskEvent(emitType, changed);
    if (!type) return;

    const taskId = String(doc._id);
    const previous = taskSnapshots.get(taskId);
    const data = trimTask(doc);
    taskSnapshots.remember(taskId, data);

    publish(buildEnvelope({ companyId, type, doc, changedFields: changed, previous, actor, depth }));
}

const fieldValue = (doc, field) => {
    const value = doc ? doc[field] : undefined;
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

/* Whether this emit is a second change rather than another echo of the pending one.
 * The window exists to collapse the several emits ONE write produces, and those all
 * carry the same values; an emit that reports a NEW value for a field the pending
 * emit already moved is a separate domain event, and merging the two would publish
 * one envelope for two changes — an automation that should fire twice fires once. */
const supersedesPending = (entry, doc, changedNow) => Boolean(entry) && [...changedNow]
    .some((field) => entry.changed.has(field) && fieldValue(entry.doc, field) !== fieldValue(doc, field));

function flushSafely(entry) {
    try {
        flush(entry);
    } catch (error) {
        logger.error(`${LOG_PREFIX} flush failed for ${entry.emitType} on task ${entry.doc._id} in company ${entry.companyId}: ${failureText(error)}`);
    }
}

/* One user action fires several emits (the write, then counter and index updates).
 * Collapsing them within a window means a status+priority change in the same save
 * produces one envelope carrying both fields, not two envelopes that each see half
 * the change. Same window the webhook dispatcher uses, for the same reason.
 *
 * The window is fixed from its first emit: re-arming it on every emit let a task
 * that kept emitting hold its automations back indefinitely. */
function onTaskEvent(emitType) {
    return (payload) => {
        try {
            const doc = payload?.data;
            if (!doc || !doc.CompanyId || !doc._id) return;

            const companyId = String(doc.CompanyId);
            const key = `${companyId}:${String(doc._id)}:${emitType}`;
            const changedNow = normalizeChangedFields(payload?.updatedFields);
            const actor = resolveActor(payload);
            const depth = Number(payload?.depth) || 0;

            const existing = pending.get(key);
            if (supersedesPending(existing, doc, changedNow)) {
                clearTimeout(existing.timer);
                pending.delete(key);
                flushSafely(existing);
            }

            const open = pending.get(key);
            if (open) {
                open.doc = doc;
                changedNow.forEach((field) => open.changed.add(field));
                // The loop guard only holds if a merged envelope is never shallower than
                // an emit it absorbed, so the deepest emit's actor and depth win.
                if (depth >= open.depth) {
                    open.actor = actor;
                    open.depth = depth;
                }
                return;
            }

            const entry = { companyId, doc, changed: new Set(changedNow), emitType, actor, depth };
            entry.timer = setTimeout(() => {
                if (pending.get(key) !== entry) return;
                pending.delete(key);
                flushSafely(entry);
            }, DEBOUNCE_MS);
            pending.set(key, entry);
        } catch (error) {
            logger.error(`${LOG_PREFIX} event handling failed: ${failureText(error)}`);
        }
    };
}

function publishEntityEvent(input) {
    const envelope = buildEntityEnvelope(input);
    publish(envelope);
    return envelope;
}

/* Page, comment and call rows carry no company id, so their emits carry it beside the row
 * (Modules/Pages/helpers/pageEvents.js, Modules/Comments/controller.js, Modules/Calls/notes.js);
 * one without it is dropped, never guessed. */
function onEntityEmit(kind, emitType, classify, trim) {
    return (payload) => {
        try {
            const doc = payload?.data;
            if (!payload?.companyId || !doc || !doc._id) return;
            const data = trim(doc);
            publishEntityEvent({
                companyId: payload.companyId,
                type: classify(emitType, doc),
                entity: { kind, id: data._id },
                scope: { projectId: data.ProjectID || data.projectId, sprintId: data.sprintId },
                data,
                actor: payload.actor,
            });
        } catch (error) {
            logger.error(`${LOG_PREFIX} ${kind} event handling failed: ${failureText(error)}`);
        }
    };
}

const listening = new Set();

function listenFor(kind, modules, classify, trim) {
    if (listening.has(kind)) return;
    listening.add(kind);
    modules.forEach((module) => ['insert', 'update'].forEach((emitType) => {
        socketEmitter.on(`${module}:${emitType}`, onEntityEmit(kind, emitType, classify, trim));
    }));
    logger.info(`${LOG_PREFIX} listening for ${kind} events`);
}

const listenForPages = () => listenFor('page', ['pages'], classifyPageEvent, trimPage);
const listenForComments = () => listenFor('comment', ['comments', 'comments_project'], classifyCommentEvent, trimComment);
const listenForCalls = () => listenFor('transcript', ['calls'], classifyTranscriptEvent, trimCall);

function start() {
    if (started) return;
    started = true;
    socketEmitter.on('task:update', onTaskEvent('update'));
    socketEmitter.on('task:insert', onTaskEvent('insert'));
    logger.info(`${LOG_PREFIX} listening for task events (recording=${recording})`);
}

module.exports = {
    start,
    listenForPages,
    listenForComments,
    listenForCalls,
    publishEntityEvent,
    bus,
    isRecording,
    setRecording,
    eventLabel,
    failureText,
    MAX_DEPTH,
    ACTOR_KINDS,
    // Exported for unit tests — pure, no IO.
    classifyTaskEvent,
    trimTask,
    resolveActor,
    buildEnvelope,
    buildEntityEnvelope,
    classifyPageEvent,
    trimPage,
    classifyCommentEvent,
    trimComment,
    classifyTranscriptEvent,
    trimCall,
    supersedesPending,
};
