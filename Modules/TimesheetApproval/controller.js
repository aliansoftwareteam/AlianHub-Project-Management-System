const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const socketEmitter = require('../../event/socketEventEmitter');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const {
    canReview, parsePeriod, validateSubmitInput, resolveTransition, validateReason, isObjectIdString,
} = require('./helpers/approvalRules');

// TIME-01 — Timesheet approval workflow.
// One `timesheet_approval` document per (userId, periodStart, periodEnd) in the
// per-company DB. Employees submit a period for review; owners/admins approve,
// reject (with a reason) or reopen it. The raw `timesheets` entries are never
// touched — totals are snapshotted at submit time for the reviewer's context.

const actorId = (req) => String(
    req.uid || (req.body && req.body.userData && (req.body.userData.id || req.body.userData._id)) || ''
);
const companyOf = (req) => String(
    req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId) || ''
);

/* Sum logged minutes + entry count for a user over the period, by work time
 * (LogStartTime), covering whole days inclusive. */
const computePeriodTotals = async (companyId, userId, periodStart, periodEnd) => {
    const start = new Date(periodStart); start.setHours(0, 0, 0, 0);
    const end = new Date(periodEnd); end.setHours(23, 59, 59, 999);
    // LogStartTime is stored in Unix SECONDS (see manualLogtime getTimeStamp), not ms.
    const startSec = Math.floor(start.getTime() / 1000);
    const endSec = Math.floor(end.getTime() / 1000);
    const entries = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TIMESHEET,
        data: [
            { Loggeduser: String(userId), LogStartTime: { $gte: startSec, $lte: endSec } },
            { LogTimeDuration: 1 },
        ],
    }, 'find');
    const list = entries || [];
    const totalMinutes = list.reduce((sum, e) => sum + (Number(e.LogTimeDuration) || 0), 0);
    return { totalMinutes, entryCount: list.length };
};

/* Resolve whether the caller can review (owner/admin). { ok, roleType }. */
const callerCanReview = async (req) => {
    const roleType = await getRoleType(companyOf(req), actorId(req));
    return { ok: canReview({ roleType }) || isPrivileged(roleType), roleType };
};

/* POST /api/v2/timesheet-approval/submit
 * body: { periodStart, periodEnd, periodType?, note?, userId?, userData } */
exports.submitTimesheet = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const uid = actorId(req);
        if (!companyId || !uid) {
            return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });
        }
        const { periodStart, periodEnd, periodType, note } = req.body || {};
        // A member submits their own timesheet; only owner/admin may submit for someone else.
        const targetUserId = req.body && req.body.userId ? String(req.body.userId) : uid;
        if (targetUserId !== uid) {
            const { ok } = await callerCanReview(req);
            if (!ok) return res.send({ status: false, statusText: 'You can only submit your own timesheet.' });
        }
        const check = validateSubmitInput({ userId: targetUserId, periodStart, periodEnd, note });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        // An already-approved period is locked — block re-submission.
        const existing = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET_APPROVAL,
            data: [{ userId: targetUserId, periodStart: check.periodStart, periodEnd: check.periodEnd, deletedStatusKey: 0 }],
        }, 'findOne');
        if (existing && existing.status === 'approved') {
            return res.send({ status: false, statusText: 'This period is already approved and locked.' });
        }

        const { totalMinutes, entryCount } = await computePeriodTotals(companyId, targetUserId, check.periodStart, check.periodEnd);
        const set = {
            userId: targetUserId,
            periodType: periodType ? String(periodType) : 'week',
            periodStart: check.periodStart,
            periodEnd: check.periodEnd,
            status: 'submitted',
            totalMinutes,
            entryCount,
            note: note ? String(note) : '',
            submittedAt: new Date(),
            submittedBy: uid,
            reviewedAt: null,
            reviewedBy: '',
            reviewerName: '',
            rejectionReason: '',
            deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET_APPROVAL,
            data: [
                { userId: targetUserId, periodStart: check.periodStart, periodEnd: check.periodEnd, deletedStatusKey: 0 },
                { $set: set, $setOnInsert: { createdBy: uid } },
                { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
            ],
        }, 'findOneAndUpdate');
        socketEmitter.emit('update', { type: 'update', data: saved, module: 'timesheetApproval' });
        return res.send({ status: true, statusText: 'Timesheet submitted for approval.', data: saved });
    } catch (error) {
        logger.error(`ERROR in submit timesheet: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/timesheet-approval/status?userId=&periodStart=&periodEnd= */
exports.getStatus = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const userId = req.query && req.query.userId ? String(req.query.userId) : actorId(req);
        const period = parsePeriod({ periodStart: req.query && req.query.periodStart, periodEnd: req.query && req.query.periodEnd });
        if (!period.valid) return res.send({ status: false, statusText: period.reason });
        const doc = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET_APPROVAL,
            data: [{ userId, periodStart: period.periodStart, periodEnd: period.periodEnd, deletedStatusKey: 0 }],
        }, 'findOne');
        return res.send({ status: true, statusText: 'OK', data: doc || null });
    } catch (error) {
        logger.error(`ERROR in timesheet status: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/timesheet-approval/mine?userId= — a user's submission history. */
exports.listMine = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const userId = req.query && req.query.userId ? String(req.query.userId) : actorId(req);
        const docs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET_APPROVAL,
            data: [{ userId, deletedStatusKey: 0 }, null, { sort: { periodStart: -1 } }],
        }, 'find');
        return res.send({ status: true, statusText: 'OK', data: docs || [] });
    } catch (error) {
        logger.error(`ERROR in timesheet mine: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/timesheet-approval/pending — owner/admin queue of submitted periods. */
exports.listPending = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const { ok } = await callerCanReview(req);
        if (!ok) return res.send({ status: false, statusText: 'Only an owner or admin can review timesheets.' });
        const docs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET_APPROVAL,
            data: [{ status: 'submitted', deletedStatusKey: 0 }, null, { sort: { submittedAt: 1 } }],
        }, 'find');
        return res.send({ status: true, statusText: 'OK', data: docs || [] });
    } catch (error) {
        logger.error(`ERROR in timesheet pending: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/timesheet-approval/:id/review  body: { action, reason?, userData } */
exports.reviewTimesheet = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const uid = actorId(req);
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid id are required.' });
        }
        const { ok } = await callerCanReview(req);
        if (!ok) return res.send({ status: false, statusText: 'Only an owner or admin can review timesheets.' });

        const { action, reason, userData } = req.body || {};
        const doc = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET_APPROVAL,
            data: [{ _id: new mongoose.Types.ObjectId(id), deletedStatusKey: 0 }],
        }, 'findOne');
        if (!doc) return res.send({ status: false, statusText: 'Timesheet submission not found.' });

        const transition = resolveTransition({ from: doc.status, action });
        if (!transition.valid) return res.send({ status: false, statusText: transition.reason });

        const reviewerName = userData && userData.name ? String(userData.name) : '';
        const update = { status: transition.to };
        if (action === 'reject') {
            const reasonCheck = validateReason(reason);
            if (!reasonCheck.valid) return res.send({ status: false, statusText: reasonCheck.reason });
            update.rejectionReason = String(reason).trim();
            update.reviewedAt = new Date();
            update.reviewedBy = uid;
            update.reviewerName = reviewerName;
        } else if (action === 'approve') {
            update.rejectionReason = '';
            update.reviewedAt = new Date();
            update.reviewedBy = uid;
            update.reviewerName = reviewerName;
        } else { // reopen — clear the review trail so it can be resubmitted/re-reviewed
            update.rejectionReason = '';
            update.reviewedAt = null;
            update.reviewedBy = '';
            update.reviewerName = '';
        }
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET_APPROVAL,
            data: [{ _id: new mongoose.Types.ObjectId(id) }, { $set: update }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        socketEmitter.emit('update', { type: 'update', data: updated, module: 'timesheetApproval' });
        return res.send({ status: true, statusText: `Timesheet ${transition.to}.`, data: updated });
    } catch (error) {
        logger.error(`ERROR in review timesheet: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
