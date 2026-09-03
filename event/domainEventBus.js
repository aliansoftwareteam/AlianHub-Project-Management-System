const EventEmitter = require('events');
const { ulid } = require('ulid');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const logger = require('../Config/loggerConfig');
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

// `${companyId}:${entityId}:${type}` -> { timer, doc, changed, actor }
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

async function record(envelope) {
    if (!recording) return;
    try {
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
    } catch (error) {
        // Recording is diagnostic. A failed write must never stop the envelope.
        logger.error(`${LOG_PREFIX} could not record ${envelope.type}: ${error.message}`);
    }
}

function publish(envelope) {
    if (envelope.depth > MAX_DEPTH) {
        logger.error(`${LOG_PREFIX} dropped ${envelope.type} for ${envelope.entity.id} — depth ${envelope.depth} exceeds ${MAX_DEPTH}`);
        return;
    }
    bus.emit('domain.event', envelope);
    bus.emit(envelope.type, envelope);
    record(envelope);
}

function flush(key) {
    const entry = pending.get(key);
    pending.delete(key);
    if (!entry) return;

    const { companyId, doc, changed, actor, depth, emitType } = entry;
    const type = classifyTaskEvent(emitType, changed);
    if (!type) return;

    const taskId = String(doc._id);
    const previous = taskSnapshots.get(taskId);
    const data = trimTask(doc);
    taskSnapshots.remember(taskId, data);

    publish(buildEnvelope({ companyId, type, doc, changedFields: changed, previous, actor, depth }));
}

/* One user action fires several emits (the write, then counter and index updates).
 * Collapsing them within a window means a status+priority change in the same save
 * produces one envelope carrying both fields, not two envelopes that each see half
 * the change. Same window the webhook dispatcher uses, for the same reason. */
function onTaskEvent(emitType) {
    return (payload) => {
        try {
            const doc = payload?.data;
            if (!doc || !doc.CompanyId || !doc._id) return;

            const companyId = String(doc.CompanyId);
            const key = `${companyId}:${String(doc._id)}:${emitType}`;
            const existing = pending.get(key);
            if (existing) clearTimeout(existing.timer);

            const changed = new Set(existing ? existing.changed : []);
            normalizeChangedFields(payload?.updatedFields).forEach((field) => changed.add(field));

            pending.set(key, {
                companyId,
                doc,
                changed,
                emitType,
                actor: resolveActor(payload),
                depth: Number(payload?.depth) || 0,
                timer: setTimeout(() => {
                    try {
                        flush(key);
                    } catch (error) {
                        logger.error(`${LOG_PREFIX} flush failed: ${error.message}`);
                    }
                }, DEBOUNCE_MS),
            });
        } catch (error) {
            logger.error(`${LOG_PREFIX} event handling failed: ${error.message}`);
        }
    };
}

function start() {
    if (started) return;
    started = true;
    socketEmitter.on('task:update', onTaskEvent('update'));
    socketEmitter.on('task:insert', onTaskEvent('insert'));
    logger.info(`${LOG_PREFIX} listening for task events (recording=${recording})`);
}

module.exports = {
    start,
    bus,
    isRecording,
    setRecording,
    MAX_DEPTH,
    ACTOR_KINDS,
    // Exported for unit tests — pure, no IO.
    classifyTaskEvent,
    trimTask,
    resolveActor,
    buildEnvelope,
};
