const grants = require('../OAuthServer/grants');
const store = require('../OAuthServer/store');
const tokenHash = require('../OAuthServer/tokenHash');
const mcpOAuth = require('../../Config/mcpOAuth');
const { verifyCompanyMembership } = require('../../Config/jwt');
const { externalClientActor } = require('../Agents/actor');
const taint = require('../Agents/taint');
const approvalsHook = require('./approvalsHook');
const logger = require('../../Config/loggerConfig');

const isAccessToken = (raw) => typeof raw === 'string' && raw.startsWith(tokenHash.PREFIX.access);

const OAUTH_PREFIXES = [tokenHash.PREFIX.access, tokenHash.PREFIX.refresh, tokenHash.PREFIX.code];
const looksLikeOAuthSecret = (value) => OAUTH_PREFIXES.some((prefix) => String(value).startsWith(prefix));

const nameOfDocumentClient = (clientId) => {
    try { return new URL(clientId).hostname; } catch (error) { return String(clientId); }
};

/* A client ID metadata document client has no row to revoke; its grants are still revoked one by one,
 * and slice S3's workspace approval covers it. */
const clientStanding = async (clientId) => {
    if (!tokenHash.CLIENT_ID.test(String(clientId))) return { ok: true, name: nameOfDocumentClient(clientId) };
    const row = await store.clients.find(clientId);
    if (!row || row.revokedAt) return { ok: false };
    return { ok: true, name: row.name || String(clientId) };
};

const refuseApproval = (clientId, why) => {
    logger.error(`mcp oauth: refusing client ${clientId}, its workspace approval could not be checked: ${why}`);
    return false;
};

/* Slice S3's per-workspace client approval: Modules/OAuthServer/approvals.js exporting
 * isClientApproved(companyId, clientId). Until that file exists every client with a live grant passes;
 * once it exists, anything short of a plain true refuses. */
const clientApprovedInWorkspace = async (companyId, clientId) => {
    let approvals;
    try {
        approvals = approvalsHook.load();
    } catch (error) {
        return refuseApproval(clientId, `the approval module failed to load (${error.message})`);
    }
    if (!approvals) return true;
    if (typeof approvals.isClientApproved !== 'function') return refuseApproval(clientId, 'the approval module has no isClientApproved');
    try {
        return (await approvals.isClientApproved(companyId, clientId)) === true;
    } catch (error) {
        return refuseApproval(clientId, `isClientApproved failed (${error.message})`);
    }
};

const taintOf = (clientId, at = new Date()) => ({ tainted: true, taintSources: [{ kind: taint.KINDS.CLIENT, ref: String(clientId).slice(0, 200), at }] });

/* The audience must be exactly this server's canonical /mcp resource (MCP 2025-11-25 "Token Audience
 * Binding and Validation"): no normalising, so a trailing slash or other case is another resource. */
const authenticate = async (req, raw, { namedCompanies = [], now = new Date() } = {}) => {
    const token = await grants.introspect(raw, now);
    if (!token.active || token.aud !== mcpOAuth.resource()) return null;
    const client = await clientStanding(token.clientId);
    if (!client.ok) return null;
    if (!(await clientApprovedInWorkspace(token.companyId, token.clientId))) return null;

    if (namedCompanies.some((asked) => asked !== String(token.companyId))) return { wrongWorkspace: true };
    const userId = String(token.userId || '');
    if (!(await verifyCompanyMembership(userId, String(token.companyId)))) return { forbidden: true };

    const scopes = mcpOAuth.SCOPES.filter((scope) => (token.scopes || []).includes(scope));
    req.uid = userId;
    req.mcp = true;
    return {
        companyId: String(token.companyId),
        userId,
        actor: await externalClientActor({ userId, clientId: token.clientId, clientName: client.name, grantId: token.grantId }),
        token: { oauth: true, scopes },
        oauth: { clientId: token.clientId, grantId: token.grantId, scopes },
        canWrite: scopes.some((scope) => mcpOAuth.WRITE_SCOPES.includes(scope)),
        projectIds: [],
        allowedActions: undefined,
        taint: taintOf(token.clientId, now),
    };
};

module.exports = { isAccessToken, looksLikeOAuthSecret, authenticate, clientStanding, clientApprovedInWorkspace };
