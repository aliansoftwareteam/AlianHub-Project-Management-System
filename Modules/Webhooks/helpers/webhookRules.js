// Outgoing-webhook rules. Pure (crypto only) — no DB or network — shared by
// the controller, the dispatcher, and the unit tests.

const crypto = require('crypto');

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
const validateWebhookInput = ({ name, url, events }) => {
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
    return { valid: true, reason: '' };
};

/* Does a webhook's subscription cover this event? */
const subscribesTo = (webhook, event) => {
    const events = webhook?.events || [];
    return events.includes(WILDCARD) || events.includes(event);
};

/* Classify a task socket payload into a webhook event name.
 * Tasks emit 'update' for almost everything; deletions/archives are
 * deletedStatusKey transitions, and creations are recognised by the
 * TaskKey being assigned moments after the document was created. */
const classifyTaskEvent = ({ type, doc, updatedFields, now = Date.now() }) => {
    if (!doc) return null;
    if (type === 'insert') return 'task.created';

    const fields = updatedFields || {};
    if ('deletedStatusKey' in fields) {
        if (fields.deletedStatusKey === 1) return 'task.deleted';
        if (fields.deletedStatusKey === 2) return 'task.archived';
        if (fields.deletedStatusKey === 0) return 'task.restored';
    }
    if ('TaskKey' in fields && doc.createdAt && (now - new Date(doc.createdAt).getTime()) < 15000) {
        return 'task.created';
    }
    return 'task.updated';
};

/* Whitelisted task payload — never ship the raw document. */
const trimTaskForDelivery = (doc) => ({
    _id: doc._id,
    TaskKey: doc.TaskKey,
    TaskName: doc.TaskName,
    status: doc.status,
    statusType: doc.statusType,
    Task_Priority: doc.Task_Priority,
    ProjectID: doc.ProjectID,
    sprintId: doc.sprintId,
    AssigneeUserId: doc.AssigneeUserId,
    DueDate: doc.DueDate,
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
    isObjectIdString,
    isValidUrl,
    validateWebhookInput,
    subscribesTo,
    classifyTaskEvent,
    trimTaskForDelivery,
    signPayload,
    generateSecret,
};
