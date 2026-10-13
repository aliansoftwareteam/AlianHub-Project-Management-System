const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { updateCompanyFun } = require('../controller/updateCompany');

/**
 * Step one or more `projectCount.*` quota counters by a signed amount.
 *
 * These fields are a live tally of what a company currently owns, not a history of
 * everything it ever created, so every increment needs a matching decrement. They are
 * also spent against the plan limits, which makes a negative value unrecoverable: it
 * can never be spent back down, and the company stays locked out of creating forever.
 * The pipeline form applies the step and pins the floor at zero in the same atomic
 * write ($inc and $max cannot touch the same field in one update). The floor only ever
 * changes a value that is already impossible — it does not recompute a drifted one.
 */
const stepCompanyCounters = (companyId, steps) => {
    const fields = {};
    for (const [field, step] of Object.entries(steps)) {
        fields[field] = { $max: [0, { $add: [{ $ifNull: [`$${field}`, 0] }, step] }] };
    }

    const query = {
        type: SCHEMA_TYPE.COMPANIES,
        data: [
            { _id: new mongoose.Types.ObjectId(String(companyId)) },
            [{ $set: fields }],
            { returnDocument: 'after' }
        ]
    };

    return updateCompanyFun(SCHEMA_TYPE.GOLBAL, query, 'findOneAndUpdate', String(companyId), true);
};

/* The seat count is taken when an invitation goes out; removing the member or cancelling the invitation gives it back. */
const releaseMemberSeat = async (companyId, { tracker = false } = {}) => {
    await updateCompanyFun(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.COMPANIES,
        data: [
            { _id: new mongoose.Types.ObjectId(String(companyId)) },
            { $inc: { 'companyData.$[elementIndex].users': -1 } },
            { arrayFilters: [{ 'elementIndex.users': { $gt: 0 } }], returnDocument: 'after' }
        ]
    }, 'findOneAndUpdate', String(companyId), true);
    if (tracker) await stepCompanyCounters(companyId, { trackerUsers: -1 });
};

module.exports = { stepCompanyCounters, releaseMemberSeat };
