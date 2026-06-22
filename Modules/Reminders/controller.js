// Personal reminders (COLLAB-03) — HTTP handlers. CRUD on a user's reminders
// plus a manual run-due / run-now (the scheduled job in cron.js runs
// production-only, so these let the firing path be exercised in dev). All
// reminders are company-scoped (companyId from the request header), matching
// Modules/RecurringTasks/controller.js.
const mongoose = require('mongoose');
const helper = require('./helper');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');

// Resolve the acting user id from the request (auth context first, then body).
function resolveUserId(req) {
    const b = req.body || {};
    return (req.user && (req.user.id || req.user._id))
        || req.headers['userid']
        || b.userId
        || (b.userData && b.userData.id)
        || '';
}

exports.createReminder = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const b = req.body || {};
        const userId = resolveUserId(req);
        if (!companyId || !userId || !b.reminderAt) {
            return res.send({ status: false, statusText: 'Missing required fields (userId, reminderAt)' });
        }
        const when = new Date(b.reminderAt);
        if (Number.isNaN(when.getTime())) {
            return res.send({ status: false, statusText: 'reminderAt is not a valid date' });
        }
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            userId: String(userId),
            companyId: String(companyId),
            taskId: b.taskId ? new mongoose.Types.ObjectId(b.taskId) : undefined,
            projectId: b.projectId ? new mongoose.Types.ObjectId(b.projectId) : undefined,
            reminderText: b.reminderText || '',
            reminderAt: when,
            fired: false,
            createdBy: String(userId),
            deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.REMINDERS, data: doc }, 'save');
        res.send({ status: true, statusText: 'Reminder created', data: saved });
    } catch (error) {
        logger.error(`[reminders] create failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// List the caller's own reminders for the current company (newest scheduled first).
exports.listMine = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = resolveUserId(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required' });
        }
        const reminders = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.REMINDERS,
            data: [{ userId: String(userId), deletedStatusKey: 0 }, null, { sort: { reminderAt: -1 } }],
        }, 'find');
        res.send({ status: true, data: reminders || [] });
    } catch (error) {
        logger.error(`[reminders] list failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

exports.updateReminder = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const id = req.params.id;
        const b = req.body || {};
        const patch = {};
        if (b.reminderText !== undefined) patch.reminderText = b.reminderText;
        if (b.reminderAt !== undefined) {
            const when = new Date(b.reminderAt);
            if (Number.isNaN(when.getTime())) {
                return res.send({ status: false, statusText: 'reminderAt is not a valid date' });
            }
            patch.reminderAt = when;
            // Editing the time re-arms a reminder that has already fired.
            patch.fired = false;
            patch.firedAt = null;
        }
        await helper.updateReminder(companyId, id, patch);
        res.send({ status: true, statusText: 'Updated' });
    } catch (error) {
        logger.error(`[reminders] update failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

exports.deleteReminder = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const id = req.params.id;
        await helper.updateReminder(companyId, id, { deletedStatusKey: 1 });
        res.send({ status: true, statusText: 'Deleted' });
    } catch (error) {
        logger.error(`[reminders] delete failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// Process all due reminders for the caller's company (manual trigger; the cron
// does this for every company in production).
exports.runDueForCompany = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const result = await helper.processDueForCompany(companyId);
        res.send({ status: true, statusText: 'Processed due reminders', data: result });
    } catch (error) {
        logger.error(`[reminders] runDue failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// Fire one reminder right now from its id (testing / manual trigger).
exports.runNow = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const id = req.params.id;
        const reminder = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.REMINDERS,
            data: [{ _id: new mongoose.Types.ObjectId(id) }],
        }, 'findOne');
        if (!reminder) return res.send({ status: false, statusText: 'Reminder not found' });
        const out = await helper.fireOne(companyId, reminder);
        res.send({
            status: true,
            statusText: out.alreadyFired ? 'Already fired' : 'Reminder fired',
            data: out,
        });
    } catch (error) {
        logger.error(`[reminders] runNow failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// Cron entry (all companies) — consumed by cron.js.
exports.runRemindersForAllCompanies = helper.runRemindersForAllCompanies;
