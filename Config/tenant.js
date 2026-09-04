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

function tenantDb(req) {
    const companyId = tenantOf(req);
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    return (mongoObj, method) => MongoDbCrudOpration(companyId, mongoObj, method);
}

module.exports = { tenantOf, tenantDb, TenantError };
