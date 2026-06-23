const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { startOfDay } = require("./approvalRules");

// TIME-03 — period locking. Returns true when the given user's `date` falls in
// an APPROVED (locked) timesheet period, so callers can block edits/deletes of
// time entries server-side (tamper-proof). Approved periods are the lock unit
// (see TIME-01). periodStart/periodEnd are stored at local midnight.
const isPeriodLocked = async ({ companyId, userId, date } = {}) => {
    if (!companyId || !userId) return false;
    const day = startOfDay(date);
    if (!day) return false;
    const doc = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TIMESHEET_APPROVAL,
        data: [{
            userId: String(userId),
            status: 'approved',
            deletedStatusKey: 0,
            periodStart: { $lte: day },
            periodEnd: { $gte: day },
        }],
    }, 'findOne');
    return !!doc;
};

module.exports = { isPeriodLocked };
