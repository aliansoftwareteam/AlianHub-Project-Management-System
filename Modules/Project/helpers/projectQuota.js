const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { stepCompanyCounters } = require('../../Company/helpers/companyCounters');

const TRASHED = 1;

const bucketOf = (isPrivateSpace) => (isPrivateSpace === true ? 'privateCount' : 'publicCount');

const stepProjectCount = (companyId, isPrivateSpace, step) => stepCompanyCounters(companyId, {
    'projectCount.projectCount': step,
    [`projectCount.${bucketOf(isPrivateSpace)}`]: step
});

/* The quota is spent by projects that still exist for the company. Closed (2) still
   shows in the listing and still owns its work, so only the trash frees a slot. */
const quotaStatus = (updateObject, key) => {
    if (!updateObject || (key && key !== '$set')) return null;
    if (!Object.prototype.hasOwnProperty.call(updateObject, 'deletedStatusKey')) return null;
    const next = Number(updateObject.deletedStatusKey);
    return Number.isFinite(next) ? next : null;
};

/**
 * Move a project in or out of the company's project quota, exactly once.
 *
 * The conditional write is what decides: only the caller that actually carries the
 * project across the trash boundary gets a document back, so re-deleting something
 * already in the trash — or restoring what was never there — steps nothing. It also
 * returns the stored isPrivateSpace, so the public/private bucket comes from the
 * project rather than from whatever the request happened to send.
 */
const syncProjectQuota = async (companyId, projectId, nextStatus) => {
    const trashing = nextStatus === TRASHED;
    const claimed = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [
            { _id: new mongoose.Types.ObjectId(String(projectId)), deletedStatusKey: trashing ? { $ne: TRASHED } : TRASHED },
            { $set: { deletedStatusKey: nextStatus } },
            { projection: { isPrivateSpace: 1 }, returnDocument: 'after' }
        ]
    }, 'findOneAndUpdate');

    if (!claimed) return null;
    return stepProjectCount(companyId, claimed.isPrivateSpace, trashing ? -1 : 1);
};

module.exports = { TRASHED, bucketOf, quotaStatus, stepProjectCount, syncProjectQuota };
