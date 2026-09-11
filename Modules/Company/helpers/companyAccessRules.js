const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const MEMBER_STAGES = ['$match', '$project', '$sort', '$limit', '$skip', '$addFields', '$set', '$unset', '$count'];
const FORBIDDEN_OPERATORS = ['$where', '$function', '$accumulator', '$lookup', '$graphLookup', '$unionWith', '$out', '$merge'];

const isPlainContainer = (value) => Array.isArray(value)
    || (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);

const containsForbidden = (value) => {
    if (!isPlainContainer(value)) return false;
    if (Array.isArray(value)) return value.some(containsForbidden);
    return Object.entries(value).some(([key, inner]) => FORBIDDEN_OPERATORS.includes(key) || containsForbidden(inner));
};

const ownCompanyIds = (user) => ((user && user.AssignCompany) || []).map(String).filter((id) => OBJECT_ID_PATTERN.test(id));

const allowedCompanyIds = (requested, own) => {
    const mine = (own || []).map(String);
    return [...new Set((Array.isArray(requested) ? requested : []).map(String))].filter((id) => mine.includes(id));
};

// A member may only shape documents of their own companies: the pipeline is pinned to
// those ids and may not reach other collections or run server-side JavaScript.
const scopeCompanyPipeline = (findQuery, own) => {
    const stages = Array.isArray(findQuery) ? findQuery : [findQuery];
    for (const stage of stages) {
        const keys = stage && typeof stage === 'object' ? Object.keys(stage) : [];
        if (keys.length !== 1 || !MEMBER_STAGES.includes(keys[0])) {
            return { ok: false, error: `Pipeline stage ${keys.join(',') || String(stage)} is not allowed.` };
        }
        if (containsForbidden(stage)) return { ok: false, error: 'The pipeline uses an operator that is not allowed.' };
    }
    return { ok: true, pipeline: [{ $match: { _id: { $in: own } } }, ...stages] };
};

const PROJECT_TYPE_FIELDS = ['projectCount.privateCount', 'projectCount.publicCount'];
const SEAT_FIELD = 'companyData.$[elementIndex].users';
const SEAT_ARRAY_FILTERS = JSON.stringify([{ 'elementIndex.users': { $exists: true } }]);
const COMPANY_DETAIL_FIELDS = ['Cst_profileImage', 'Cst_CompanyName', 'Cst_Phone', 'Cst_Country', 'Cst_DialCode', 'Cst_State', 'Cst_City',
    'Cst_LogTimeDays', 'Cst_countryCode', 'Cst_stateCode', 'trackerEstimateLimit', 'updatedAt'];

const isPlainObject = (value) => isPlainContainer(value) && !Array.isArray(value);
const hasNoArrayFilters = (arrayFilters) => arrayFilters === undefined || arrayFilters === null || (Array.isArray(arrayFilters) && arrayFilters.length === 0);

const isDetailsUpdate = ({ key, updateObject, arrayFilters }) => {
    const fields = Object.keys(updateObject);
    return (!key || key === '$set') && hasNoArrayFilters(arrayFilters) && fields.length > 0
        && fields.every((field) => COMPANY_DETAIL_FIELDS.includes(field));
};

const isOwnerClaim = ({ key, updateObject, arrayFilters }) => {
    const claim = updateObject.objId;
    return !key && hasNoArrayFilters(arrayFilters) && Object.keys(updateObject).join() === 'objId'
        && isPlainObject(claim) && Object.keys(claim).join() === 'userId'
        && typeof claim.userId === 'string' && OBJECT_ID_PATTERN.test(claim.userId);
};

const countUpdateKind = ({ key, updateObject, arrayFilters }) => {
    if (key !== '$inc') return null;
    const entries = Object.entries(updateObject);
    const fields = entries.map(([field]) => field).sort();
    if (hasNoArrayFilters(arrayFilters) && entries.length === 2 && fields.join() === [...PROJECT_TYPE_FIELDS].sort().join()
        && entries.every(([, step]) => step === 1 || step === -1) && entries[0][1] + entries[1][1] === 0) {
        return 'projectType';
    }
    if (entries.length !== 1 || entries[0][1] !== -1) return null;
    if (fields[0] === 'trackerUsers' && hasNoArrayFilters(arrayFilters)) return 'seatRelease';
    if (fields[0] === SEAT_FIELD && JSON.stringify(arrayFilters) === SEAT_ARRAY_FILTERS) return 'seatRelease';
    return null;
};

// Every company write a client may send, whatever its role: the Settings > Company form, the
// private/public project count swap, a seat release after removing a member, and an invited owner
// recording themselves. Plan, billing, seat, storage, usage and ownership fields stay server-side.
const companyUpdateKind = (body) => {
    if (!body || !isPlainObject(body.updateObject)) return null;
    if (isDetailsUpdate(body)) return 'details';
    if (isOwnerClaim(body)) return 'ownerClaim';
    return countUpdateKind(body);
};

const PENDING_SEAT = 1;
const ACTIVE_SEAT = 2;

// Invitation.vue records an invited owner while they accept, so only that write takes the caller's own pending row.
const seatFilter = (uid, kind) => ({
    userId: String(uid),
    isDelete: { $ne: true },
    status: { $in: kind === 'ownerClaim' ? [PENDING_SEAT, ACTIVE_SEAT] : [ACTIVE_SEAT] },
});

module.exports = { OBJECT_ID_PATTERN, ownCompanyIds, allowedCompanyIds, scopeCompanyPipeline, companyUpdateKind, seatFilter };
