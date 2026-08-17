// General-purpose reminders — DB access, firing and notification delivery.
// HTTP handlers live in controller.js; the cron entry is
// runGeneralRemindersForAllCompanies(). Mirrors Modules/Reminders/helper.js in
// shape, but operates on its own `general_reminders` collection so the
// task-scoped reminder flow is completely unaffected.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { updateUnReadCommentsCountFun } = require('../notification-count/controller');
const socketEmitter = require('../../event/socketEventEmitter');
const {
    isReminderDue,
    buildReminderNotification,
    reminderEmailSubject,
    reminderEmailHtml,
} = require('./generalReminderRules');
const { buildMailAttachments } = require('./attachmentResolver');
const queue = require('./queue');
const { sendAttachMail } = require('../service.js');
const logger = require('../../Config/loggerConfig');

const COMPANY_CONCURRENCY = 5;
const LOG_PREFIX = '[general-reminders]';

// updateOne $set on a reminder, scoped to its owner so one user can never
// mutate another user's reminder by guessing an id.
async function updateReminder(companyId, id, patch, userId) {
    const filter = { _id: new mongoose.Types.ObjectId(id) };
    if (userId) filter.userId = String(userId);
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.GENERAL_REMINDERS,
        data: [filter, { $set: patch }],
    }, 'updateOne');
}

async function findById(companyId, id, userId) {
    const filter = { _id: new mongoose.Types.ObjectId(id) };
    if (userId) filter.userId = String(userId);
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.GENERAL_REMINDERS,
        data: [filter],
    }, 'findOne');
}

// Persist + emit one in-app notification for the reminder owner, reusing the
// same path Modules/Reminders/helper.js uses: a per-company notifications doc,
// a copy in the global notifications collection with the `globalNotification:insert`
// socket event, and a bump of the recipient's bell counter (key 5). We don't
// modify the shared notification pipeline — only call into it.
async function fireReminderNotification(companyId, reminder, now) {
    const notif = buildReminderNotification(reminder, now);
    if (!notif.userId) return false;
    // 1) per-company notification doc.
    const saved = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.NOTIFICATIONS,
        collection: dbCollections.NOTIFICATIONS,
        data: notif,
    }, 'save');
    // 2) global copy + live socket emit.
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

// Push the fired state to the owner's open tabs so the list updates live.
// Never throws — a socket problem must not affect the firing loop.
function emitFired(reminder, firedAt) {
    try {
        const plain = reminder && reminder.toObject ? reminder.toObject() : reminder;
        if (!plain || !plain.userId) return;
        socketEmitter.emit('update', {
            type: 'update',
            data: { ...plain, fired: true, firedAt, isDone: true, completedAt: firedAt },
            updatedFields: { fired: true, isDone: true },
            module: 'generalReminder',
        });
    } catch (e) {
        logger.error(`${LOG_PREFIX} fired emit failed: ${e.message}`);
    }
}

// Promise adapter over the callback-style sendAttachMail, mirroring the one in
// Modules/TimeSheet/controller/timeReminders.js. Never rejects — a mail failure
// must not stop the in-app notification or the fired stamp.
function sendMailWithFiles(subject, html, email, attachments) {
    return new Promise((resolve) => {
        try {
            sendAttachMail(subject, html, email, attachments || [], (r) => {
                // sendAttachMail reports failure as { status:false, statusText } —
                // surface it, otherwise an SMTP problem is invisible.
                if (!(r && r.status)) {
                    logger.error(`${LOG_PREFIX} SMTP send failed: ${(r && (r.statusText || r.error)) || 'no response from mailer'}`);
                }
                resolve(!!(r && r.status));
            });
        } catch (e) {
            logger.error(`${LOG_PREFIX} SMTP threw: ${e.message}`);
            resolve(false);
        }
    });
}

// Look up the recipient's email. Users live in the GLOBAL db, not the tenant db
// (same lookup Modules/Pto and Modules/CapacityPlanning use).
async function findRecipient(userId) {
    if (!userId) return null;
    if (!mongoose.Types.ObjectId.isValid(String(userId))) {
        logger.error(`${LOG_PREFIX} recipient id is not a valid ObjectId: ${userId}`);
        return null;
    }
    try {
        // Shape matches Modules/Pto/controller.js#notifyPtoDecision exactly —
        // users live in the global DB and no explicit `collection` key is passed.
        return await MongoDbCrudOpration('global', {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: new mongoose.Types.ObjectId(String(userId)) }, { Employee_Email: 1, Employee_Name: 1 }],
        }, 'findOne');
    } catch (e) {
        logger.error(`${LOG_PREFIX} recipient lookup failed (${userId}): ${e.message}`);
        return null;
    }
}

// Email the reminder to its owner, attaching any files stored on it. Best
// effort: every failure path is logged and swallowed. Returns true if sent.
async function sendReminderEmail(companyId, reminder) {
    const user = await findRecipient(reminder && reminder.userId);
    const email = user && user.Employee_Email ? String(user.Employee_Email).trim() : '';
    if (!email) {
        // Logged at error level on purpose: silently skipping the mail is the
        // hardest failure to diagnose from the outside.
        logger.error(`${LOG_PREFIX} no email address resolved for user ${reminder && reminder.userId} (user found: ${!!user}); skipping mail`);
        return false;
    }
    logger.info(`${LOG_PREFIX} sending reminder email to ${email}`);
    const plain = reminder && reminder.toObject ? reminder.toObject() : reminder;
    // Stored attachments are storage keys — resolve each to a disk path
    // (server storage) or a presigned URL (wasabi) before handing to nodemailer.
    let files = [];
    try {
        files = await buildMailAttachments(companyId, plain.attachments);
    } catch (e) {
        logger.error(`${LOG_PREFIX} attachment build failed: ${e.message}`);
    }
    const sent = await sendMailWithFiles(
        reminderEmailSubject(plain),
        reminderEmailHtml(plain, user.Employee_Name),
        email,
        files,
    );
    if (!sent) logger.error(`${LOG_PREFIX} email send failed for reminder ${reminder && reminder._id}`);
    return sent;
}

// Process every due, un-fired reminder for one company. The query uses the
// denormalised notifyAt (falling back to remindAt for safety); isReminderDue()
// re-checks each row so "Don't notify" / done / soft-deleted rows never fire.
async function processDueForCompany(companyId, now) {
    const ref = now ? new Date(now) : new Date();
    let reminders = [];
    try {
        reminders = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.GENERAL_REMINDERS,
            data: [{
                fired: false,
                isDone: false,
                deletedStatusKey: 0,
                $or: [
                    { notifyAt: { $lte: ref } },
                    { notifyAt: null, remindAt: { $lte: ref } },
                ],
            }],
        }, 'find');
    } catch (e) {
        logger.error(`${LOG_PREFIX} find-due failed for ${companyId}: ${e.message}`);
        return { processed: 0, fired: 0 };
    }
    let fired = 0;
    const keepIds = new Set((reminders || []).map((r) => String(r._id)));
    const processedIds = [];
    for (const reminder of (reminders || [])) {
        try {
            // Defensive: skip anything that isn't actually due (e.g. clock skew).
            if (!isReminderDue(reminder.toObject ? reminder.toObject() : reminder, ref)) continue;
            await fireReminderNotification(companyId, reminder, ref);
            // Email is best-effort and deliberately after the in-app notification,
            // so a mail outage can never cost the user their reminder.
            await sendReminderEmail(companyId, reminder).catch(() => false);
            // Delivering the reminder completes it — it drops out of "Upcoming"
            // and into "Completed". Snoozing or editing the time re-opens it.
            await updateReminder(companyId, reminder._id, {
                fired: true, firedAt: ref, isDone: true, completedAt: ref,
            });
            emitFired(reminder, ref);
            processedIds.push(String(reminder._id));
            fired++;
        } catch (e) {
            logger.error(`${LOG_PREFIX} fire failed (${companyId}/${reminder._id}): ${e.message}`);
        }
    }
    // Keep the global due-index truthful: drop pointers for what we just fired,
    // plus any stale pointer whose reminder is no longer pending. A stale row
    // would otherwise keep this company in the due set and re-open its
    // connection every minute.
    try {
        const staleIds = await queue.staleRowIdsForCompany(companyId, ref, keepIds);
        const toDrop = [...new Set([...processedIds, ...staleIds])];
        if (toDrop.length) await queue.dequeueManyForCompany(companyId, toDrop);
    } catch (e) {
        logger.error(`${LOG_PREFIX} queue reconcile failed (${companyId}): ${e.message}`);
    }
    return { processed: (reminders || []).length, fired };
}

// Fire a single reminder right now regardless of its scheduled time
// (testing / manual trigger). Returns { fired, alreadyFired }.
async function fireOne(companyId, reminder) {
    const ref = new Date();
    if (reminder.fired === true) return { fired: false, alreadyFired: true };
    await fireReminderNotification(companyId, reminder, ref);
    const emailed = await sendReminderEmail(companyId, reminder).catch(() => false);
    // Same stamp as the scheduled path: delivering completes the reminder.
    await updateReminder(companyId, reminder._id, {
        fired: true, firedAt: ref, isDone: true, completedAt: ref,
    });
    emitFired(reminder, ref);
    await queue.dequeue(reminder._id);
    return { fired: true, alreadyFired: false, emailed };
}

// Cron entry — walk every company and process its due reminders, in small
// concurrent slices so a large tenant list can't swamp the connection pool.
async function runGeneralRemindersForAllCompanies(now) {
    // Read the GLOBAL due-index instead of enumerating every company. This is
    // what keeps the per-company connection count bounded: with nothing due we
    // touch zero tenant databases, so idle connections can age out normally.
    // (Previously this swept all companies every minute, which pinned one live
    // connection per tenant forever — see Modules/GeneralReminders/queue.js.)
    const list = await queue.dueCompanyIds(now);
    if (!list.length) return { companies: 0, fired: 0 };
    let totalFired = 0;
    for (let i = 0; i < list.length; i += COMPANY_CONCURRENCY) {
        const slice = list.slice(i, i + COMPANY_CONCURRENCY);
        const results = await Promise.allSettled(slice.map((cid) => processDueForCompany(cid, now)));
        results.forEach((r) => {
            if (r.status === 'fulfilled' && r.value) totalFired += r.value.fired || 0;
        });
    }
    return { companies: list.length, fired: totalFired };
}

module.exports = {
    updateReminder,
    findById,
    fireReminderNotification,
    sendReminderEmail,
    processDueForCompany,
    fireOne,
    runGeneralRemindersForAllCompanies,
};
