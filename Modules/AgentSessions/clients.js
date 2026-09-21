const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const oauthAuth = require('../Mcp/oauthAuth');
const oauthStore = require('../OAuthServer/store');
const logger = require('../../Config/loggerConfig');

const APPROVED = 'approved';

const isLive = (grant, now) => Boolean(grant) && !grant.revokedAt && new Date(grant.expiresAt).getTime() > now.getTime();

/* The delegating person's newest live grant to this client in this workspace: the session acts under it, so the
 * outside agent works as that person and loses the session when the grant goes. */
const liveGrantFor = async (companyId, userId, clientId, now = new Date()) => {
    const rows = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
        type: SCHEMA_TYPE.OAUTH_GRANTS,
        data: [{ clientId: String(clientId), companyId: String(companyId), userId: String(userId) }, null, { sort: { createdAt: -1 } }],
    }, 'find');
    return (rows || []).find((grant) => isLive(grant, now)) || null;
};

const grantStanding = async (grantId, now = new Date()) => isLive(await oauthStore.grants.find(grantId), now);

/* Slice S3's per-workspace approval row, read only. Absent module or row answers null, which refuses the opt-in. */
const approvalRow = async (companyId, clientId) => {
    const approvals = oauthStore.approvals;
    if (!approvals || typeof approvals.find !== 'function') return null;
    try {
        return (await approvals.find(String(companyId), String(clientId))) || null;
    } catch (error) {
        logger.error(`agent sessions: the approval of ${clientId} in ${companyId} could not be read: ${error.message}`);
        return null;
    }
};

const privateSprintsOptIn = async (companyId, clientId) => {
    const row = await approvalRow(companyId, clientId);
    return Boolean(row && row.status === APPROVED && row.privateSprints === true);
};

/* The client is registered and unrevoked, and approved in this workspace. */
const clientStanding = async (companyId, clientId) => {
    const standing = await oauthAuth.clientStanding(clientId);
    if (!standing.ok) return { ok: false, name: '' };
    if (!(await oauthAuth.clientApprovedInWorkspace(companyId, clientId))) return { ok: false, name: standing.name };
    return standing;
};

module.exports = { liveGrantFor, grantStanding, approvalRow, privateSprintsOptIn, clientStanding };
