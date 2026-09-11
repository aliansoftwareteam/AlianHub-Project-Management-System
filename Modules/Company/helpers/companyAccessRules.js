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

// The only company writes the app sends for someone who is not an owner or admin: moving a
// project between the private and public counts, and releasing a seat after removing a member.
const memberCompanyUpdate = (body) => {
    const { key, updateObject, arrayFilters } = body || {};
    if (key !== '$inc' || !isPlainContainer(updateObject) || Array.isArray(updateObject)) return null;
    const entries = Object.entries(updateObject);
    const hasArrayFilters = Array.isArray(arrayFilters) && arrayFilters.length > 0;
    const fields = entries.map(([field]) => field).sort();
    if (!hasArrayFilters && entries.length === 2 && fields.join() === [...PROJECT_TYPE_FIELDS].sort().join()
        && entries.every(([, step]) => step === 1 || step === -1) && entries[0][1] + entries[1][1] === 0) {
        return 'projectType';
    }
    if (entries.length !== 1 || entries[0][1] !== -1) return null;
    if (fields[0] === 'trackerUsers' && !hasArrayFilters) return 'seatRelease';
    if (fields[0] === SEAT_FIELD && JSON.stringify(arrayFilters) === SEAT_ARRAY_FILTERS) return 'seatRelease';
    return null;
};

module.exports = { OBJECT_ID_PATTERN, ownCompanyIds, allowedCompanyIds, scopeCompanyPipeline, memberCompanyUpdate };
