// General-purpose reminders — HTTP handlers. CRUD on a user's standalone
// reminders plus a manual run-due / run-now so the firing path can be exercised
// in dev. All reminders are company-scoped (companyId from the request header),
// and every mutation is additionally scoped to the owning user.
const mongoose = require('mongoose');
const helper = require('./helper');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { normalizeNotifyBefore, computeNotifyAt, DONT_NOTIFY } = require('./generalReminderRules');
const queue = require('./queue');

const LOG_PREFIX = '[general-reminders]';

// Broadcast a reminder mutation to the owner's open tabs. Never throws — a
// socket problem must not fail the HTTP request that already succeeded.
function emitReminderChange(type, data) {
    try {
        if (!data || !data.userId) return;
        socketEmitter.emit(type, { type, data, updatedFields: {}, module: 'generalReminder' });
    } catch (e) {
        logger.error(`${LOG_PREFIX} socket emit failed: ${e.message}`);
    }
}

// Resolve the acting user id. `req.uid` is set by the JWT middleware
// (Config/setMiddleware.js lists this route under verifyJWTTokenWithCRoute), so
// it is both authoritative and available on GET/DELETE where there is no body.
// The body fallbacks only exist for parity with the other modules.
function resolveUserId(req) {
    const b = req.body || {};
    return req.uid
        || (req.user && (req.user.id || req.user._id))
        || req.headers['userid']
        || b.userId
        || (b.userData && b.userData.id)
        || '';
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
        const userId = resolveUserId(req);
        const title = typeof b.title === 'string' ? b.title.trim() : '';
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required' });
        }
        if (!title) {
            return res.send({ status: false, statusText: 'Reminder name is required' });
        }
        if (!b.remindAt) {
            return res.send({ status: false, statusText: 'remindAt is required' });
        }
        const when = new Date(b.remindAt);
        if (Number.isNaN(when.getTime())) {
            return res.send({ status: false, statusText: 'remindAt is not a valid date' });
        }
        const notifyBefore = normalizeNotifyBefore(b.notifyBefore);
        // "For me" is the default; assignedTo raises the reminder for someone
        // else while createdBy keeps the actual author.
        const targetUserId = b.assignedTo ? String(b.assignedTo) : String(userId);
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            title,
            description: typeof b.description === 'string' ? b.description : '',
            userId: targetUserId,
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
        // Point the global due-index at it so the scheduler can find it without
        // sweeping every tenant. "Don't notify" never fires, so it stays out.
        if (notifyBefore !== DONT_NOTIFY) {
            await queue.enqueue(companyId, doc._id, doc.notifyAt);
        }
        emitReminderChange('insert', saved && saved.toObject ? saved.toObject() : (saved || doc));
        res.send({ status: true, statusText: 'Reminder created', data: saved });
    } catch (error) {
        logger.error(`${LOG_PREFIX} create failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// List the caller's own reminders for the current company. `?filter=upcoming`
// hides completed ones; default returns everything not soft-deleted.
exports.listMine = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = resolveUserId(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required' });
        }
        const query = { userId: String(userId), deletedStatusKey: 0 };
        if (req.query && req.query.filter === 'upcoming') query.isDone = false;
        if (req.query && req.query.filter === 'done') query.isDone = true;
        const reminders = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.GENERAL_REMINDERS,
            data: [query, null, { sort: { remindAt: 1 } }],
        }, 'find');
        res.send({ status: true, data: reminders || [] });
    } catch (error) {
        logger.error(`${LOG_PREFIX} list failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

exports.updateReminder = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = resolveUserId(req);
        const id = req.params.id;
        const b = req.body || {};
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required' });
        }
        const patch = {};
        if (b.title !== undefined) {
            const title = String(b.title).trim();
            if (!title) return res.send({ status: false, statusText: 'Reminder name is required' });
            patch.title = title;
        }
        if (b.description !== undefined) patch.description = String(b.description);
        if (b.attachments !== undefined) patch.attachments = sanitizeAttachments(b.attachments);
        if (b.assignedTo !== undefined && b.assignedTo) patch.userId = String(b.assignedTo);
        if (b.isDone !== undefined) {
            patch.isDone = b.isDone === true || b.isDone === 'true';
            patch.completedAt = patch.isDone ? new Date() : null;
        }
        // Changing either the time or the lead time re-derives notifyAt and
        // re-arms a reminder that has already fired.
        const timeChanged = b.remindAt !== undefined || b.notifyBefore !== undefined;
        if (timeChanged) {
            const existing = await helper.findById(companyId, id, userId);
            if (!existing) return res.send({ status: false, statusText: 'Reminder not found' });
            const when = b.remindAt !== undefined ? new Date(b.remindAt) : new Date(existing.remindAt);
            if (Number.isNaN(when.getTime())) {
                return res.send({ status: false, statusText: 'remindAt is not a valid date' });
            }
            const notifyBefore = b.notifyBefore !== undefined
                ? normalizeNotifyBefore(b.notifyBefore)
                : Number(existing.notifyBefore) || 0;
            patch.remindAt = when;
            patch.notifyBefore = notifyBefore;
            patch.notifyAt = computeNotifyAt(when, notifyBefore);
            patch.fired = false;
            patch.firedAt = null;
            // Rescheduling (snooze or an edited time) re-opens a reminder that
            // was auto-completed when it fired — unless the caller explicitly
            // set isDone in the same request.
            if (b.isDone === undefined) {
                patch.isDone = false;
                patch.completedAt = null;
            }
        }
        if (!Object.keys(patch).length) {
            return res.send({ status: false, statusText: 'Nothing to update' });
        }
        await helper.updateReminder(companyId, id, patch, userId);
        // Re-read so subscribers get the full, current document.
        const fresh = await helper.findById(companyId, id, userId);
        // Keep the global due-index in step: a reminder is only queued while it
        // is pending, un-fired and actually set to notify.
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
        res.send({ status: false, statusText: error.message });
    }
};

exports.deleteReminder = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = resolveUserId(req);
        const id = req.params.id;
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required' });
        }
        await helper.updateReminder(companyId, id, { deletedStatusKey: 1 }, userId);
        await queue.dequeue(id);
        emitReminderChange('delete', { _id: id, userId: String(userId), deletedStatusKey: 1 });
        res.send({ status: true, statusText: 'Deleted' });
    } catch (error) {
        logger.error(`${LOG_PREFIX} delete failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// Process all due reminders for the caller's company (manual trigger; the cron
// does this for every company).
exports.runDueForCompany = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const result = await helper.processDueForCompany(companyId);
        res.send({ status: true, statusText: 'Processed due reminders', data: result });
    } catch (error) {
        logger.error(`${LOG_PREFIX} runDue failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// Fire one reminder right now from its id (testing / manual trigger).
exports.runNow = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = resolveUserId(req);
        const reminder = await helper.findById(companyId, req.params.id, userId);
        if (!reminder) return res.send({ status: false, statusText: 'Reminder not found' });
        const out = await helper.fireOne(companyId, reminder);
        res.send({
            status: true,
            statusText: out.alreadyFired ? 'Already fired' : 'Reminder fired',
            data: out,
        });
    } catch (error) {
        logger.error(`${LOG_PREFIX} runNow failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// Cron entry (all companies) — consumed by cron.js.
exports.runGeneralRemindersForAllCompanies = helper.runGeneralRemindersForAllCompanies;
