// Personal reminders (COLLAB-03) — HTTP handlers. CRUD on a user's reminders
// plus a manual run-due / run-now (the scheduled job in cron.js runs
// production-only, so these let the firing path be exercised in dev).
const mongoose = require('mongoose');
const helper = require('./helper');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const logger = require('../../Config/loggerConfig');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const isObjectId = (value) => OBJECT_ID_PATTERN.test(String(value || ''));

const fail = (res, code, statusText) => res.status(code).send({ status: false, statusText });

// Only the author, the assignee, or a company owner/admin may touch a reminder.
async function loadManageableReminder(req, res) {
    const companyId = req.headers['companyid'];
    const id = req.params.id;
    if (!isObjectId(id)) {
        fail(res, 400, 'Invalid reminder id');
        return null;
    }
    const reminder = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.REMINDERS,
        data: [{ _id: new mongoose.Types.ObjectId(id), deletedStatusKey: 0 }],
    }, 'findOne');
    if (!reminder) {
        fail(res, 404, 'Reminder not found');
        return null;
    }
    const uid = String(req.uid);
    const involved = String(reminder.userId) === uid || String(reminder.createdBy) === uid;
    if (!involved && !isPrivileged(await getRoleType(companyId, uid))) {
        fail(res, 403, 'You cannot manage this reminder');
        return null;
    }
    return reminder;
}

exports.createReminder = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const b = req.body || {};
        const userId = req.uid;
        if (!companyId || !userId || !b.reminderAt) {
            return fail(res, 400, 'Missing required fields (reminderAt)');
        }
        const when = new Date(b.reminderAt);
        if (Number.isNaN(when.getTime())) {
            return fail(res, 400, 'reminderAt is not a valid date');
        }
        if ((b.taskId && !isObjectId(b.taskId)) || (b.projectId && !isObjectId(b.projectId))) {
            return fail(res, 400, 'Invalid task or project id');
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
        const reminders = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.REMINDERS,
            data: [{ userId: String(userId), deletedStatusKey: 0 }, null, { sort: { reminderAt: -1 } }],
        }, 'find');
        res.send({ status: true, data: reminders || [] });
    } catch (error) {
        logger.error(`[reminders] list failed: ${error.message}`);
        fail(res, 500, error.message);
    }
};

exports.updateReminder = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const b = req.body || {};
        const patch = {};
        if (b.reminderText !== undefined) patch.reminderText = b.reminderText;
        if (b.reminderAt !== undefined) {
            const when = new Date(b.reminderAt);
            if (Number.isNaN(when.getTime())) {
                return fail(res, 400, 'reminderAt is not a valid date');
            }
            patch.reminderAt = when;
            patch.fired = false;
            patch.firedAt = null;
        }
        const reminder = await loadManageableReminder(req, res);
        if (!reminder) return;
        if (!Object.keys(patch).length) {
            return fail(res, 400, 'Nothing to update');
        }
        await helper.updateReminder(companyId, reminder._id, patch);
        res.send({ status: true, statusText: 'Updated' });
    } catch (error) {
        logger.error(`[reminders] update failed: ${error.message}`);
        fail(res, 500, error.message);
    }
};

exports.deleteReminder = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const reminder = await loadManageableReminder(req, res);
        if (!reminder) return;
        await helper.updateReminder(companyId, reminder._id, { deletedStatusKey: 1 });
        res.send({ status: true, statusText: 'Deleted' });
    } catch (error) {
        logger.error(`[reminders] delete failed: ${error.message}`);
        fail(res, 500, error.message);
    }
};

// Fires every due reminder in the company, so it is limited to owners and admins.
exports.runDueForCompany = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        if (!isPrivileged(await getRoleType(companyId, req.uid))) {
            return fail(res, 403, 'Only an owner or admin can run due reminders');
        }
        const result = await helper.processDueForCompany(companyId);
        res.send({ status: true, statusText: 'Processed due reminders', data: result });
    } catch (error) {
        logger.error(`[reminders] runDue failed: ${error.message}`);
        fail(res, 500, error.message);
    }
};

exports.runNow = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const reminder = await loadManageableReminder(req, res);
        if (!reminder) return;
        const out = await helper.fireOne(companyId, reminder);
        res.send({
            status: true,
            statusText: out.alreadyFired ? 'Already fired' : 'Reminder fired',
            data: out,
        });
    } catch (error) {
        logger.error(`[reminders] runNow failed: ${error.message}`);
        fail(res, 500, error.message);
    }
};

exports.runRemindersForAllCompanies = helper.runRemindersForAllCompanies;
