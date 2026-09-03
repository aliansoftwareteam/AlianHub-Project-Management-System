// Outgoing-webhook rules. Pure (crypto only) — no DB or network — shared by
// the controller, the dispatcher, and the unit tests.

const crypto = require('crypto');
const { normalizeChangedFields } = require('../../../utils/entityEvents');

// Task lifecycle events a webhook can subscribe to. '*' subscribes to all.
const EVENT_TYPES = Object.freeze([
    'task.created',
    'task.updated',
    'task.deleted',
    'task.archived',
    'task.restored',
]);

const WILDCARD = '*';
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const MAX_NAME_LENGTH = 80;

// Outbound payload shapes. 'json' ships the raw envelope; 'slack' and
// 'discord' render the event into that platform's incoming-webhook format.
const WEBHOOK_FORMATS = Object.freeze(['json', 'slack', 'discord']);

const EVENT_LABELS = Object.freeze({
    'task.created': 'Task created',
    'task.updated': 'Task updated',
    'task.deleted': 'Task deleted',
    'task.archived': 'Task archived',
    'task.restored': 'Task restored',
});

const isObjectIdString = (id) => OBJECT_ID_PATTERN.test(String(id || ''));

const isValidUrl = (value) => {
    try {
        const url = new URL(String(value || ''));
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
        return false;
    }
};

/* Validate create/update input. Returns { valid, reason }. */
const validateWebhookInput = ({ name, url, events, format }) => {
    if (!name || !String(name).trim() || String(name).length > MAX_NAME_LENGTH) {
        return { valid: false, reason: `A name up to ${MAX_NAME_LENGTH} characters is required.` };
    }
    if (!isValidUrl(url)) {
        return { valid: false, reason: 'A valid http or https url is required.' };
    }
    if (!Array.isArray(events) || !events.length) {
        return { valid: false, reason: 'At least one event is required.' };
    }
    const unknown = events.filter((event) => event !== WILDCARD && !EVENT_TYPES.includes(event));
    if (unknown.length) {
        return { valid: false, reason: `Unknown events: ${unknown.join(', ')}.` };
    }
    if (format !== undefined && !WEBHOOK_FORMATS.includes(String(format))) {
        return { valid: false, reason: `format must be one of: ${WEBHOOK_FORMATS.join(', ')}.` };
    }
    return { valid: true, reason: '' };
};

const normalizeFormat = (format) => (WEBHOOK_FORMATS.includes(String(format)) ? String(format) : 'json');

// Best-effort human status label from the trimmed task (status may be an
// object, a string, or absent).
const statusLabel = (task) => {
    const s = task.status;
    return String((s && (s.text || s.statusName || s.name)) || task.statusType || '—');
};

// Readable date (date only — due/start carry a date; the time is noise here).
const formatDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toDateString();
};

// Estimate is stored in minutes — render it the way a human reads it.
const formatMinutes = (mins) => {
    const n = Number(mins);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n < 60) return `${n}m`;
    const h = Math.floor(n / 60);
    const m = n % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
};

// Assignee display: resolved names (the dispatcher fills task.assigneeNames),
// falling back to a count, or "Unassigned" when there are none.
const assigneeValue = (task) => {
    const names = Array.isArray(task.assigneeNames) ? task.assigneeNames.filter(Boolean) : [];
    if (names.length) return names.join(', ');
    const ids = Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId.filter(Boolean) : [];
    if (!ids.length) return 'Unassigned';
    return `${ids.length} assignee${ids.length === 1 ? '' : 's'}`;
};

// Mongo update operators whose value is itself a { field: ... } map. The task
// update paths are inconsistent — most emit a plain field map ({ Task_Priority },
// { TaskName }, { status, statusType }), but the assignee path emits an operator
// object ({ $addToSet: { AssigneeUserId } }) — so flatten one level into these.
// What changed → how to announce it. Ordered: when exactly one category changed,
// the first match drives the headline. `value(task)` returns the row to show
// (null = headline only). Internal plumbing fields (TaskKey, groupBy*, subTasks…)
// match nothing on purpose → they fall through to a generic "Task updated".
const CHANGE_CATEGORIES = [
    { match: ['TaskName'],                                          headline: 'Task renamed',         label: 'Name',      value: (t) => t.TaskName || null },
    { match: ['status', 'statusType', 'statusKey'],                 headline: 'Status changed',       label: 'Status',    value: (t) => statusLabel(t) },
    { match: ['AssigneeUserId'],                                    headline: 'Assignees updated',    label: 'Assignees', value: (t) => assigneeValue(t) },
    { match: ['Task_Leader'],                                       headline: 'Task lead changed',    label: 'Lead',      value: (t) => t.leadName || null },
    { match: ['Task_Priority'],                                     headline: 'Priority changed',     label: 'Priority',  value: (t) => t.Task_Priority || null },
    { match: ['DueDate', 'dueDateDeadLine'],                        headline: 'Due date updated',     label: 'Due',       value: (t) => formatDate(t.DueDate) },
    { match: ['startDate'],                                         headline: 'Start date updated',   label: 'Start',     value: (t) => formatDate(t.startDate) },
    { match: ['rawDescription', 'descriptionBlock', 'description'], headline: 'Description updated',  label: null,        value: () => null },
    { match: ['checklistArray'],                                    headline: 'Checklist updated',    label: null,        value: () => null },
    { match: ['attachments'],                                       headline: 'Attachments updated',  label: null,        value: () => null },
    { match: ['relations'],                                         headline: 'Linked tasks updated', label: null,        value: () => null },
    { match: ['totalEstimatedTime'],                                headline: 'Estimate updated',     label: 'Estimate',  value: (t) => formatMinutes(t.totalEstimatedTime) },
    { match: ['points'],                                            headline: 'Story points changed', label: 'Points',    value: (t) => (t.points == null || t.points === '' ? null : String(t.points)) },
    { match: ['TaskType', 'TaskTypeKey'],                           headline: 'Task type changed',    label: 'Type',      value: (t) => t.TaskType || null },
    { match: ['customField'],                                       headline: 'Custom field updated', label: null,        value: () => null },
];

/* Turn an event + the changed field names + the (name-enriched) task into a
 * human announcement: a headline naming the ACTION, plus only the rows relevant
 * to it — never the same Status+Priority on every event. Pure. */
const summarizeTaskChange = ({ event, changedFields, task, previous }) => {
    const t = task || {};
    const prev = previous || null;
    const rowFor = (cat) => {
        if (!cat.label) return null;
        const to = cat.value(t);
        if (to == null || to === '') return null;
        // from→to when we know the prior value and it actually differs; the
        // dispatcher caches the last delivered snapshot to supply `previous`.
        const from = prev ? cat.value(prev) : null;
        const value = (from != null && from !== '' && String(from) !== String(to)) ? `${from} → ${to}` : String(to);
        return { name: cat.label, value, inline: true };
    };

    if (event === 'task.created') {
        const rows = [];
        const assignees = assigneeValue(t);
        if (assignees && assignees !== 'Unassigned') rows.push({ name: 'Assignees', value: assignees, inline: true });
        if (t.Task_Priority) rows.push({ name: 'Priority', value: String(t.Task_Priority), inline: true });
        const due = formatDate(t.DueDate);
        if (due) rows.push({ name: 'Due', value: due, inline: true });
        return { headline: EVENT_LABELS['task.created'], fields: rows };
    }
    if (event && event !== 'task.updated') {
        // deleted / archived / restored — the action is the whole story.
        return { headline: EVENT_LABELS[event] || event, fields: [] };
    }

    // task.updated — announce exactly what changed, nothing more.
    const changed = changedFields instanceof Set ? changedFields : new Set(changedFields || []);
    const matched = CHANGE_CATEGORIES.filter((cat) => cat.match.some((f) => changed.has(f)));
    if (matched.length === 1) {
        const row = rowFor(matched[0]);
        return { headline: matched[0].headline, fields: row ? [row] : [] };
    }
    if (matched.length > 1) {
        return { headline: EVENT_LABELS['task.updated'], fields: matched.map(rowFor).filter(Boolean) };
    }
    return { headline: EVENT_LABELS['task.updated'], fields: [] };
};

/* Render the canonical delivery body into the target platform's shape.
 * Slack expects { text, blocks }; Discord expects { embeds }; 'json' (and
 * anything unknown) ships the raw envelope unchanged. The message is
 * action-aware: it announces what changed and shows only the relevant rows. */
const formatForTarget = (format, body) => {
    const fmt = normalizeFormat(format);
    if (fmt === 'json') return body;

    const task = body.data || {};
    const summary = summarizeTaskChange({ event: body.event, changedFields: body.changedFields, task, previous: body.previous });
    const title = `${task.TaskKey ? task.TaskKey + ' — ' : ''}${task.TaskName || 'Task'}`;

    if (fmt === 'slack') {
        const blocks = [
            { type: 'section', text: { type: 'mrkdwn', text: `*${summary.headline}*\n${title}` } },
        ];
        if (summary.fields.length) {
            blocks.push({
                type: 'context',
                elements: [{ type: 'mrkdwn', text: summary.fields.map((f) => `*${f.name}:* ${f.value}`).join('  ·  ') }],
            });
        }
        return { text: `${summary.headline}: ${title}`, blocks };
    }

    // discord
    const embed = { title, description: summary.headline };
    if (summary.fields.length) embed.fields = summary.fields;
    return { embeds: [embed] };
};

/* Does a webhook's subscription cover this event? */
const subscribesTo = (webhook, event) => {
    const events = webhook?.events || [];
    return events.includes(WILDCARD) || events.includes(event);
};

// Fields written by internal task plumbing (not user-facing edits). Updates
// touching ONLY these — or carrying no updatedFields at all — are not real
// "task updated" events. Used to suppress the create-flow churn below.
const INTERNAL_FIELDS = Object.freeze([
    'TaskKey',
    'groupByStatusIndex', 'groupByAssigneeIndex', 'groupByPriorityIndex', 'groupByDueDateIndex',
    'subTasks', 'updateToken', 'islocalSnapStop', 'lastMessage', 'message', 'queueListArray',
]);

/* Classify a task socket payload into a webhook event name.
 * Tasks emit 'update' for almost everything; deletions/archives are
 * deletedStatusKey transitions, and creations are an 'insert'. The create flow
 * also fires several follow-up updates moments later (TaskKey assignment +
 * counter/index writes) — those must NOT produce a spurious task.updated. */
const classifyTaskEvent = ({ type, doc, updatedFields, now = Date.now() }) => {
    if (!doc) return null;
    if (type === 'insert') return 'task.created';

    const fields = updatedFields || {};
    if ('deletedStatusKey' in fields) {
        if (fields.deletedStatusKey === 1) return 'task.deleted';
        if (fields.deletedStatusKey === 2) return 'task.archived';
        if (fields.deletedStatusKey === 0) return 'task.restored';
    }

    const justCreated = doc.createdAt && (now - new Date(doc.createdAt).getTime()) < 15000;

    // The TaskKey is assigned via an update right after the row is inserted —
    // part of the create flow → task.created (collapses with the insert's event).
    if ('TaskKey' in fields && justCreated) {
        return 'task.created';
    }

    // Suppress the rest of the create-flow churn: the TaskKey assignment emits
    // with NO updatedFields, plus counter/group-index writes fire moments after
    // insert. The insert already produced task.created, so within the create
    // window an update that touched only internal fields (or carried no field
    // info) must not deliver a duplicate task.updated. A genuine field change
    // still notifies — and any update outside the window is unchanged.
    const fieldKeys = Object.keys(fields);
    const onlyInternal = fieldKeys.length === 0 || fieldKeys.every((field) => INTERNAL_FIELDS.includes(field));
    if (justCreated && onlyInternal) {
        return null;
    }

    return 'task.updated';
};

/* The dispatcher re-reads the task by _id before delivery; this decides what to
 * do with the result. A task webhook must correspond to a real task row, but
 * some create-flow emits carry a NON-task document under module:'task' — notably
 * the project counter bump (internals.js fires { data: <project>, updatedFields:
 * {} } when it increments lastTaskId). Its _id is a project id, so the task
 * re-read finds nothing — and that must NOT go out as a phantom task.updated.
 * Returns: real task found → deliver; clean read + no task → drop; read errored
 * → best-effort delivery with whatever the socket gave us. */
const shouldDeliverTask = (freshTask, readErrored) => {
    if (freshTask && freshTask._id) return true;
    return Boolean(readErrored);
};

/* Whitelisted task payload — never ship the raw document. */
const trimTaskForDelivery = (doc) => ({
    _id: doc._id,
    TaskKey: doc.TaskKey,
    TaskName: doc.TaskName,
    status: doc.status,
    statusType: doc.statusType,
    Task_Priority: doc.Task_Priority,
    totalEstimatedTime: doc.totalEstimatedTime,
    points: doc.points,
    Task_Leader: doc.Task_Leader,
    TaskType: doc.TaskType,
    ProjectID: doc.ProjectID,
    sprintId: doc.sprintId,
    AssigneeUserId: doc.AssigneeUserId,
    DueDate: doc.DueDate,
    startDate: doc.startDate,
    deletedStatusKey: doc.deletedStatusKey,
    updatedAt: doc.updatedAt,
});

/* HMAC-SHA256 signature over the raw JSON body. */
const signPayload = (secret, bodyString) =>
    'sha256=' + crypto.createHmac('sha256', String(secret)).update(bodyString).digest('hex');

const generateSecret = () => crypto.randomBytes(24).toString('hex');

module.exports = {
    EVENT_TYPES,
    WILDCARD,
    WEBHOOK_FORMATS,
    isObjectIdString,
    isValidUrl,
    validateWebhookInput,
    subscribesTo,
    classifyTaskEvent,
    shouldDeliverTask,
    normalizeChangedFields,
    summarizeTaskChange,
    trimTaskForDelivery,
    signPayload,
    generateSecret,
    normalizeFormat,
    formatForTarget,
};
