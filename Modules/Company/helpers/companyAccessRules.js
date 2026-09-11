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

module.exports = { OBJECT_ID_PATTERN, ownCompanyIds, allowedCompanyIds, scopeCompanyPipeline };
