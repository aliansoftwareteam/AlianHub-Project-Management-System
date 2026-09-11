// General-purpose reminders — HTTP handlers. CRUD on a user's standalone
// reminders plus a manual run-due / run-now so the firing path can be exercised
// in dev. The route sits behind verifyJWTTokenWithCRoute, so the acting user is
// always req.uid and every mutation is scoped to the reminder's recipient.
const mongoose = require('mongoose');
const helper = require('./helper');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { normalizeNotifyBefore, computeNotifyAt, DONT_NOTIFY } = require('./generalReminderRules');
const queue = require('./queue');

const LOG_PREFIX = '[general-reminders]';
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const ACTIVE_MEMBER_STATUS = 2;

const isObjectId = (value) => OBJECT_ID_PATTERN.test(String(value || ''));
const fail = (res, code, statusText) => res.status(code).send({ status: false, statusText });

// Never throws — a socket problem must not fail the HTTP request that already succeeded.
function emitReminderChange(type, data) {
    try {
        if (!data || !data.userId) return;
        socketEmitter.emit(type, { type, data, updatedFields: {}, module: 'generalReminder' });
    } catch (e) {
        logger.error(`${LOG_PREFIX} socket emit failed: ${e.message}`);
    }
}

async function isActiveMember(companyId, userId) {
    if (!isObjectId(userId)) return false;
    const member = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: String(userId), status: ACTIVE_MEMBER_STATUS }],
    }, 'findOne');
    return Boolean(member);
}

// The author still sees a reminder raised for someone else under ?filter=assigned,
// but the panel offers no actions there: only the recipient manages it.
async function loadOwnReminder(req, res) {
    const companyId = req.headers['companyid'];
    const id = req.params.id;
    if (!isObjectId(id)) {
        fail(res, 400, 'Invalid reminder id');
        return null;
    }
    const reminder = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.GENERAL_REMINDERS,
        data: [{ _id: new mongoose.Types.ObjectId(id), deletedStatusKey: 0 }],
    }, 'findOne');
    if (!reminder) {
        fail(res, 404, 'Reminder not found');
        return null;
    }
    if (String(reminder.userId) !== String(req.uid)) {
        fail(res, 403, 'Only the person this reminder is for can change it');
        return null;
    }
    return reminder;
}

// Keep only the attachment fields we understand, so an arbitrary payload can't
// be persisted wholesale into the document.
function sanitizeAttachments(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 20).map((a) => ({
        name: a && a.name ? String(a.name) : '',
        url: a && a.url ? String(a.url) : '',
        extension: a && a.extension ? String(a.extension) : '',
        size: a && Number.isFinite(Number(a.size)) ? Number(a.size) : 0,
    })).filter((a) => a.name || a.url);
}

exports.createReminder = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const b = req.body || {};
        const userId = req.uid;
        const title = typeof b.title === 'string' ? b.title.trim() : '';
        if (!companyId || !userId) {
            return fail(res, 400, 'companyId and userId are required');
        }
        if (!title) {
            return fail(res, 400, 'Reminder name is required');
        }
        if (!b.remindAt) {
            return fail(res, 400, 'remindAt is required');
        }
        const when = new Date(b.remindAt);
        if (Number.isNaN(when.getTime())) {
            return fail(res, 400, 'remindAt is not a valid date');
        }
        if (b.assignedTo && !(await isActiveMember(companyId, b.assignedTo))) {
            return fail(res, 400, 'A reminder can only be assigned to an active member of this company');
        }
        const notifyBefore = normalizeNotifyBefore(b.notifyBefore);
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            title,
            description: typeof b.description === 'string' ? b.description : '',
            userId: b.assignedTo ? String(b.assignedTo) : String(userId),
            createdBy: String(userId),
            companyId: String(companyId),
            remindAt: when,
            notifyBefore,
            notifyAt: computeNotifyAt(when, notifyBefore),
            attachments: sanitizeAttachments(b.attachments),
            fired: false,
            isDone: false,
            deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.GENERAL_REMINDERS, data: doc }, 'save');
        // The scheduler reads a global due-index instead of sweeping every tenant; "Don't notify" never fires.
        if (notifyBefore !== DONT_NOTIFY) {
            await queue.enqueue(companyId, doc._id, doc.notifyAt);
        }
        emitReminderChange('insert', saved && saved.toObject ? saved.toObject() : (saved || doc));
        res.send({ status: true, statusText: 'Reminder created', data: saved });
    } catch (error) {
        logger.error(`${LOG_PREFIX} create failed: ${error.message}`);
        fail(res, 500, error.message);
    }
};

exports.listMine = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = req.uid;
        if (!companyId || !userId) {
            return fail(res, 400, 'companyId and userId are required');
        }
        const filter = (req.query && req.query.filter) || '';
        const query = filter === 'assigned'
            ? { createdBy: String(userId), userId: { $ne: String(userId) }, deletedStatusKey: 0 }
            : { userId: String(userId), deletedStatusKey: 0 };
        if (filter === 'upcoming') query.isDone = false;
        if (filter === 'done') query.isDone = true;
        const reminders = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.GENERAL_REMINDERS,
            data: [query, null, { sort: { remindAt: 1 } }],
        }, 'find');
        res.send({ status: true, data: reminders || [] });
    } catch (error) {
        logger.error(`${LOG_PREFIX} list failed: ${error.message}`);
        fail(res, 500, error.message);
    }
};

exports.updateReminder = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = req.uid;
        const b = req.body || {};
        if (!companyId || !userId) {
            return fail(res, 400, 'companyId and userId are required');
        }
        const existing = await loadOwnReminder(req, res);
        if (!existing) return;
        const id = String(existing._id);
        const patch = {};
        if (b.title !== undefined) {
            const title = String(b.title).trim();
            if (!title) return fail(res, 400, 'Reminder name is required');
            patch.title = title;
        }
        if (b.description !== undefined) patch.description = String(b.description);
        if (b.attachments !== undefined) patch.attachments = sanitizeAttachments(b.attachments);
        if (b.assignedTo) {
            if (!(await isActiveMember(companyId, b.assignedTo))) {
                return fail(res, 400, 'A reminder can only be assigned to an active member of this company');
            }
            patch.userId = String(b.assignedTo);
        }
        if (b.isDone !== undefined) {
            patch.isDone = b.isDone === true || b.isDone === 'true';
            patch.completedAt = patch.isDone ? new Date() : null;
        }
        if (b.remindAt !== undefined || b.notifyBefore !== undefined) {
            const when = b.remindAt !== undefined ? new Date(b.remindAt) : new Date(existing.remindAt);
            if (Number.isNaN(when.getTime())) {
                return fail(res, 400, 'remindAt is not a valid date');
            }
            const notifyBefore = b.notifyBefore !== undefined
                ? normalizeNotifyBefore(b.notifyBefore)
                : Number(existing.notifyBefore) || 0;
            patch.remindAt = when;
            patch.notifyBefore = notifyBefore;
            patch.notifyAt = computeNotifyAt(when, notifyBefore);
            patch.fired = false;
            patch.firedAt = null;
            // Rescheduling re-opens a reminder that was auto-completed when it fired,
            // unless the same request sets isDone explicitly.
            if (b.isDone === undefined) {
                patch.isDone = false;
                patch.completedAt = null;
            }
        }
        if (!Object.keys(patch).length) {
            return fail(res, 400, 'Nothing to update');
        }
        await helper.updateReminder(companyId, id, patch, userId);
        const fresh = await helper.findById(companyId, id, patch.userId || userId);
        const shouldQueue = fresh
            && !fresh.isDone
            && !fresh.fired
            && Number(fresh.deletedStatusKey) !== 1
            && Number(fresh.notifyBefore) !== DONT_NOTIFY
            && fresh.notifyAt;
        if (shouldQueue) {
            await queue.enqueue(companyId, id, fresh.notifyAt);
        } else {
            await queue.dequeue(id);
        }
        emitReminderChange('update', fresh && fresh.toObject ? fresh.toObject() : fresh);
        res.send({ status: true, statusText: 'Updated', data: fresh });
    } catch (error) {
        logger.error(`${LOG_PREFIX} update failed: ${error.message}`);
        fail(res, 500, error.message);
    }
};

exports.deleteReminder = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = req.uid;
        if (!companyId || !userId) {
            return fail(res, 400, 'companyId and userId are required');
        }
        const existing = await loadOwnReminder(req, res);
        if (!existing) return;
        const id = String(existing._id);
        await helper.updateReminder(companyId, id, { deletedStatusKey: 1 }, userId);
        await queue.dequeue(id);
        emitReminderChange('delete', { _id: id, userId: String(userId), deletedStatusKey: 1 });
        res.send({ status: true, statusText: 'Deleted' });
    } catch (error) {
        logger.error(`${LOG_PREFIX} delete failed: ${error.message}`);
        fail(res, 500, error.message);
    }
};

exports.runDueForCompany = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const result = await helper.processDueForCompany(companyId);
        res.send({ status: true, statusText: 'Processed due reminders', data: result });
    } catch (error) {
        logger.error(`${LOG_PREFIX} runDue failed: ${error.message}`);
        fail(res, 500, error.message);
    }
};

exports.runNow = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const reminder = await loadOwnReminder(req, res);
        if (!reminder) return;
        const out = await helper.fireOne(companyId, reminder);
        res.send({
            status: true,
            statusText: out.alreadyFired ? 'Already fired' : 'Reminder fired',
            data: out,
        });
    } catch (error) {
        logger.error(`${LOG_PREFIX} runNow failed: ${error.message}`);
        fail(res, 500, error.message);
    }
};

exports.runGeneralRemindersForAllCompanies = helper.runGeneralRemindersForAllCompanies;
