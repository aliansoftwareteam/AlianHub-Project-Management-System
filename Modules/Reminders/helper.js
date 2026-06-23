// Personal reminders (COLLAB-03) — pure logic: find due reminders, fire an
// in-app notification to the owner, and stamp them fired. HTTP handlers live in
// controller.js; the cron entry is runRemindersForAllCompanies(). Mirrors
// Modules/RecurringTasks/helper.js (processDueForCompany / all-companies fan-out).
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { updateUnReadCommentsCountFun } = require('../notification-count/controller');
const socketEmitter = require('../../event/socketEventEmitter');
const { isReminderDue, buildReminderNotification } = require('./remindersRules');
const logger = require('../../Config/loggerConfig');

const COMPANY_CONCURRENCY = 5;
const LOG_PREFIX = '[reminders]';

// updateOne $set on a reminder.
async function updateReminder(companyId, id, patch) {
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.REMINDERS,
        data: [{ _id: new mongoose.Types.ObjectId(id) }, { $set: patch }],
    }, 'updateOne');
}

// Persist + emit one in-app notification for the reminder owner, reusing the
// exact path Modules/notification/prepare-notification-data/controllerV2.js
// uses (createNotificationsBody + createCommonNotificationsBody): a per-company
// notifications doc, a copy in the global notifications collection, and the
// `globalNotification:insert` socket event. Kept isolated here — we don't touch
// the shared notification pipeline. Also bumps the recipient's notification
// counter (key 5) so the in-app bell updates live, mirroring
// updateNotificationCount(). Returns true if the notification was persisted.
async function fireReminderNotification(companyId, reminder, now) {
    const notif = buildReminderNotification(reminder, now);
    if (!notif.userId) return false;
    // 1) per-company notification doc (same as createNotificationsBody).
    const saved = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.NOTIFICATIONS,
        collection: dbCollections.NOTIFICATIONS,
        data: notif,
    }, 'save');
    // 2) global copy + live socket emit (same as createCommonNotificationsBody).
    try {
        const globalDoc = await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: dbCollections.NOTIFICATIONS,
            collection: dbCollections.NOTIFICATIONS,
            data: { ...notif, notificationId: saved && saved.id },
        }, 'save');
        socketEmitter.emit('insert', { type: 'insert', data: globalDoc, updatedFields: {}, module: 'globalNotification' });
    } catch (e) {
        logger.error(`${LOG_PREFIX} global notification emit failed (${companyId}): ${e.message}`);
    }
    // 3) bump the recipient's in-app notification counter (live bell update).
    try {
        await updateUnReadCommentsCountFun({ body: {
            companyId,
            key: 5,
            userIds: [notif.userId],
            readAll: false,
        } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} notification count bump failed (${companyId}): ${e.message}`);
    }
    return true;
}

// Process every due, un-fired reminder for one company.
async function processDueForCompany(companyId, now) {
    const ref = now ? new Date(now) : new Date();
    let reminders = [];
    try {
        reminders = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.REMINDERS,
            data: [{ fired: false, deletedStatusKey: 0, reminderAt: { $lte: ref } }],
        }, 'find');
    } catch (e) {
        logger.error(`${LOG_PREFIX} find-due failed for ${companyId}: ${e.message}`);
        return { processed: 0, fired: 0 };
    }
    let fired = 0;
    for (const reminder of (reminders || [])) {
        try {
            // Defensive: skip anything that isn't actually due (e.g. clock skew).
            if (!isReminderDue(reminder.toObject ? reminder.toObject() : reminder, ref)) continue;
            await fireReminderNotification(companyId, reminder, ref);
            await updateReminder(companyId, reminder._id, { fired: true, firedAt: ref });
            fired++;
        } catch (e) {
            logger.error(`${LOG_PREFIX} fire failed (${companyId}/${reminder._id}): ${e.message}`);
        }
    }
    return { processed: (reminders || []).length, fired };
}

// Fire a single reminder right now regardless of its scheduled time
// (testing / manual trigger). Returns { fired, alreadyFired }.
async function fireOne(companyId, reminder) {
    const ref = new Date();
    if (reminder.fired === true) return { fired: false, alreadyFired: true };
    await fireReminderNotification(companyId, reminder, ref);
    await updateReminder(companyId, reminder._id, { fired: true, firedAt: ref });
    return { fired: true, alreadyFired: false };
}

// Cron entry: scan every company for due reminders (bounded concurrency).
// Company enumeration copied verbatim from RecurringTasks.runRecurringForAllCompanies.
async function runRemindersForAllCompanies() {
    let companies = [];
    try {
        companies = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{}, '_id'],
        }, 'find');
    } catch (e) {
        logger.error(`${LOG_PREFIX} could not enumerate companies: ${e.message}`);
        return;
    }
    for (let i = 0; i < (companies || []).length; i += COMPANY_CONCURRENCY) {
        const slice = companies.slice(i, i + COMPANY_CONCURRENCY);
        await Promise.allSettled(slice.map((c) => processDueForCompany(String(c._id))));
    }
    logger.info(`${LOG_PREFIX} run complete across ${(companies || []).length} companies`);
}

module.exports = {
    updateReminder,
    fireReminderNotification,
    processDueForCompany,
    fireOne,
    runRemindersForAllCompanies,
};
