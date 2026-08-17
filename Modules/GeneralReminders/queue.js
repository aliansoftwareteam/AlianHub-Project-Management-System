// Global due-index for general reminders.
//
// WHY THIS EXISTS
// Reminders live in per-company databases. Naively, finding what is due means
// opening a connection to EVERY company database every minute. Connections are
// pooled and only closed after 30 minutes idle
// (middlewares/mongoConnector/helper.js), so a per-minute sweep pins one live
// connection per tenant forever — on a self-hosted instance with many companies
// that exhausts the connection limit and can take the database down.
//
// Instead, every pending reminder writes one tiny pointer row here, in the
// GLOBAL database. The scheduler reads this single collection and only connects
// to the companies that actually have work. With nothing due, it opens zero
// per-company connections.
//
// This is a derived cache: it holds no reminder content and can be rebuilt from
// the per-company collections at any time. A missing row only delays a reminder,
// it never loses one — reconcile() repairs drift.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');

const LOG_PREFIX = '[general-reminders]';

// Add or refresh the pointer for one reminder. Called on create and whenever the
// schedule changes. Best-effort: a failure here must not fail the HTTP request.
async function enqueue(companyId, reminderId, notifyAt) {
    if (!companyId || !reminderId || !notifyAt) return false;
    try {
        await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: SCHEMA_TYPE.GENERAL_REMINDER_QUEUE,
            data: [
                { reminderId: String(reminderId) },
                { $set: { companyId: String(companyId), reminderId: String(reminderId), notifyAt: new Date(notifyAt) } },
                { upsert: true },
            ],
        }, 'updateOne');
        return true;
    } catch (e) {
        logger.error(`${LOG_PREFIX} queue enqueue failed (${reminderId}): ${e.message}`);
        return false;
    }
}

// Drop the pointer — the reminder fired, completed, was deleted, or was set to
// "Don't notify".
async function dequeue(reminderId) {
    if (!reminderId) return false;
    try {
        await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: SCHEMA_TYPE.GENERAL_REMINDER_QUEUE,
            data: [{ reminderId: String(reminderId) }],
        }, 'deleteOne');
        return true;
    } catch (e) {
        logger.error(`${LOG_PREFIX} queue dequeue failed (${reminderId}): ${e.message}`);
        return false;
    }
}

// The distinct companies that have at least one reminder due at `now`.
// This is the whole point: it bounds per-company connections to the companies
// with actual work instead of the entire tenant list.
async function dueCompanyIds(now) {
    const ref = now ? new Date(now) : new Date();
    try {
        const rows = await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: SCHEMA_TYPE.GENERAL_REMINDER_QUEUE,
            data: [{ notifyAt: { $lte: ref } }, { companyId: 1 }],
        }, 'find');
        const ids = new Set();
        (rows || []).forEach((r) => { if (r && r.companyId) ids.add(String(r.companyId)); });
        return [...ids];
    } catch (e) {
        logger.error(`${LOG_PREFIX} queue read failed: ${e.message}`);
        return [];
    }
}

// Remove every pointer belonging to a company (used after a sweep so rows for
// reminders that no longer qualify can't strand the company in the due set).
async function dequeueManyForCompany(companyId, reminderIds) {
    if (!companyId || !Array.isArray(reminderIds) || !reminderIds.length) return;
    try {
        await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: SCHEMA_TYPE.GENERAL_REMINDER_QUEUE,
            data: [{ reminderId: { $in: reminderIds.map(String) } }],
        }, 'deleteMany');
    } catch (e) {
        logger.error(`${LOG_PREFIX} queue bulk dequeue failed (${companyId}): ${e.message}`);
    }
}

// Pointers for this company that claim to be due but whose reminder is no
// longer in the pending set (deleted, completed, rescheduled, already fired).
// Without this, one stale row would keep a company in the due set forever and
// re-open its connection every minute — exactly the leak this index prevents.
async function staleRowIdsForCompany(companyId, now, keepIds) {
    const ref = now ? new Date(now) : new Date();
    try {
        const rows = await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: SCHEMA_TYPE.GENERAL_REMINDER_QUEUE,
            data: [{ companyId: String(companyId), notifyAt: { $lte: ref } }, { reminderId: 1 }],
        }, 'find');
        return (rows || [])
            .map((r) => String(r.reminderId))
            .filter((id) => !keepIds || !keepIds.has(id));
    } catch (e) {
        logger.error(`${LOG_PREFIX} queue stale scan failed (${companyId}): ${e.message}`);
        return [];
    }
}

module.exports = {
    enqueue,
    dequeue,
    dueCompanyIds,
    dequeueManyForCompany,
    staleRowIdsForCompany,
    toObjectId: (v) => new mongoose.Types.ObjectId(String(v)),
};
