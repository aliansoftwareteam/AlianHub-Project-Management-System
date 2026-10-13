const { ACTIVE_SEAT, INVITED_SEAT } = require('../../../Config/seatStatus');
const { OBJECT_ID_PATTERN, isPlainObject, queryRefusal, withPlainSearchText, SearchTextRefused } = require('./callerQueryRules');

const MEMBER_STAGES = ['$match', '$project', '$sort', '$limit', '$skip', '$addFields', '$set', '$unset', '$count'];

/* What the web app and the desktop tracker read from a company row. Everything else on the row
 * (plan and billing records, agent and AI settings, key handles) is for its owners and admins. */
const COMPANY_MEMBER_FIELDS = Object.freeze(['_id', 'Cst_CompanyName', 'Cst_profileImage', 'Cst_Phone', 'Cst_DialCode', 'Cst_Country', 'Cst_countryCode',
    'Cst_State', 'Cst_stateCode', 'Cst_City', 'Cst_LogTimeDays', 'trackerEstimateLimit', 'workingDays', 'teamFocus', 'planFeature', 'projectCount',
    'bucketSize', 'aiTotalRequestedCount', 'isDisable', 'userId', 'legacyId', 'createdAt', 'updatedAt']);

const memberCompanyView = (row) => {
    const plain = row && typeof row.toJSON === 'function' ? row.toJSON() : row;
    return Object.fromEntries(COMPANY_MEMBER_FIELDS.filter((field) => plain[field] !== undefined).map((field) => [field, plain[field]]));
};

/* A field the row does not have is left out of the new root, as in a $project. */
const memberCompanyStage = (limitedIds) => ({
    $replaceWith: {
        $cond: [{ $in: ['$_id', limitedIds] }, Object.fromEntries(COMPANY_MEMBER_FIELDS.map((field) => [field, `$${field}`])), '$$ROOT'],
    },
});

const ownCompanyIds = (user) => ((user && user.AssignCompany) || []).map(String).filter((id) => OBJECT_ID_PATTERN.test(id));

const allowedCompanyIds = (requested, own) => {
    const mine = (own || []).map(String);
    return [...new Set((Array.isArray(requested) ? requested : []).map(String))].filter((id) => mine.includes(id));
};

/* A member may only shape documents of their own companies: the pipeline is pinned to those ids,
 * may not reach other collections or run server-side JavaScript, and starts from the member fields
 * of each company in `limited`, the ones where the caller is neither owner nor admin. */
const scopeCompanyPipeline = (findQuery, own, limited = []) => {
    const stages = Array.isArray(findQuery) ? findQuery : [findQuery];
    for (const stage of stages) {
        const keys = stage && typeof stage === 'object' ? Object.keys(stage) : [];
        if (keys.length !== 1 || !MEMBER_STAGES.includes(keys[0])) {
            return { ok: false, error: `Pipeline stage ${keys.join(',') || String(stage)} is not allowed.` };
        }
        if (queryRefusal(stage)) return { ok: false, error: 'The pipeline uses an operator that is not allowed.' };
    }
    let plain;
    try {
        plain = withPlainSearchText(stages);
    } catch (error) {
        if (!(error instanceof SearchTextRefused)) throw error;
        return { ok: false, error: error.message };
    }
    return { ok: true, pipeline: [{ $match: { _id: { $in: own } } }, ...(limited.length ? [memberCompanyStage(limited)] : []), ...plain] };
};

const COMPANY_DETAIL_FIELDS = ['Cst_profileImage', 'Cst_CompanyName', 'Cst_Phone', 'Cst_Country', 'Cst_DialCode', 'Cst_State', 'Cst_City',
    'Cst_LogTimeDays', 'Cst_countryCode', 'Cst_stateCode', 'trackerEstimateLimit', 'workingDays', 'updatedAt'];

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

// Every company write a client may send: the Settings > Company form and an invited owner recording
// themselves. Plan, billing, seat, project count, storage, usage and ownership fields stay server-side.
const companyUpdateKind = (body) => {
    if (!body || !isPlainObject(body.updateObject)) return null;
    if (isDetailsUpdate(body)) return 'details';
    if (isOwnerClaim(body)) return 'ownerClaim';
    return null;
};

// Invitation.vue records an invited owner while they accept, so only that write takes the caller's own pending row.
const seatFilter = (uid, kind) => ({ userId: String(uid), ...(kind === 'ownerClaim' ? INVITED_SEAT : ACTIVE_SEAT) });

module.exports = { OBJECT_ID_PATTERN, COMPANY_MEMBER_FIELDS, ownCompanyIds, allowedCompanyIds, scopeCompanyPipeline, memberCompanyView, companyUpdateKind, seatFilter };
