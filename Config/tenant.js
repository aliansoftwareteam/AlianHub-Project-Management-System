const OBJECT_ID = /^[a-f0-9]{24}$/i;

class TenantError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TenantError';
        this.statusCode = 403;
    }
}

// `aud` is the comma-joined company list of a JWT, or the single company of an
// API token (see Config/jwt.js); an exact entry match is the only accepted form.
const inAudience = (aud, companyId) => {
    if (aud === undefined || aud === null || aud === '') return true;
    const list = Array.isArray(aud) ? aud : String(aud).split(',');
    return list.some((entry) => String(entry).trim() === companyId);
};

const firstOf = (...values) => values.map((v) => String(v == null ? '' : v).trim()).find(Boolean) || '';

function tenantOf(req) {
    const headers = req.headers || {};
    const candidate = firstOf(
        headers.companyid,
        req.params && req.params.companyId,
        req.query && req.query.companyId,
        req.body && (req.body.companyId || req.body.CompanyId)
    );
    if (!OBJECT_ID.test(candidate)) throw new TenantError('A valid companyid header is required.');
    if (!inAudience(req.aud, candidate)) throw new TenantError('You do not have access to this company');
    return candidate;
}

// Every company a request names, deduplicated. tenantOf and requireCompanyAud each pick one of these in a
// different order, so a handler that must not be steered between two companies refuses more than one.
function namedCompanyIds(req) {
    const headers = req.headers || {};
    const named = [
        headers.companyid,
        req.params && req.params.companyId,
        req.query && req.query.companyId,
        req.body && req.body.companyId,
        req.body && req.body.CompanyId,
    ].map((v) => String(v == null ? '' : v).trim()).filter(Boolean);
    return [...new Set(named)];
}

// A signed-in route takes its tenant from the verified companyid header. A body or query that
// names a different company is an attempt to steer the request, not a fallback for a missing
// header, so the pair is refused rather than resolved in the header's favour.
function sessionTenantOf(req) {
    if (namedCompanyIds(req).length > 1) throw new TenantError('The request names more than one company.');
    return tenantOf(req);
}

/* For a signed-in handler that reads its tenant out of the request body: answers 403 and returns
 * '' when the body names another company, and otherwise pins the body to the verified header so
 * nothing further down the handler can be steered into a company the caller is not in. */
function pinSessionTenant(req, res) {
    let companyId;
    try {
        companyId = sessionTenantOf(req);
    } catch (error) {
        if (!(error instanceof TenantError)) throw error;
        res.status(error.statusCode).send({ status: false, statusText: error.message });
        return '';
    }
    if (req.body && typeof req.body === 'object') {
        if (req.body.CompanyId !== undefined) req.body.CompanyId = companyId;
        req.body.companyId = companyId;
    }
    return companyId;
}

function tenantDb(req) {
    const companyId = tenantOf(req);
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    return (mongoObj, method) => MongoDbCrudOpration(companyId, mongoObj, method);
}

module.exports = { tenantOf, sessionTenantOf, pinSessionTenant, tenantDb, namedCompanyIds, TenantError };
