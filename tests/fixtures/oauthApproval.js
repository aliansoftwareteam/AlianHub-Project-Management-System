const { SCHEMA_TYPE } = require('../../Config/schemaType');

const ALL_SCOPES = ['tasks:read', 'tasks:write', 'projects:read', 'docs:read', 'time:read', 'time:write'];

/* A workspace owner approved the client for every scope, as slice S3 requires before a grant is exchanged or used.
 * Seeding the same client and workspace again leaves the row that is there. */
const approveInWorkspace = (db, companyId, clientId, over = {}) => {
    const existing = (db.store[SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS] || []).find((row) => row.companyId === String(companyId) && row.clientId === String(clientId));
    if (existing) return existing;
    return db.seed(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, {
        companyId: String(companyId), clientId: String(clientId), clientName: 'approved in test', clientKind: 'dynamic',
        status: 'approved', scopes: [...ALL_SCOPES], privateSprints: false, decidedAt: new Date(), updatedAt: new Date(), ...over,
    });
};

module.exports = { ALL_SCOPES, approveInWorkspace };
