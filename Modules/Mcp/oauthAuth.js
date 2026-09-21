const grants = require('../OAuthServer/grants');
const store = require('../OAuthServer/store');
const tokenHash = require('../OAuthServer/tokenHash');
const mcpOAuth = require('../../Config/mcpOAuth');
const { verifyCompanyMembership } = require('../../Config/jwt');
const { externalClientActor } = require('../Agents/actor');
const taint = require('../Agents/taint');

const APPROVALS_MODULE = '../OAuthServer/approvals';

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

const approvalsModule = () => {
    try {
        return require(APPROVALS_MODULE);
    } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('OAuthServer/approvals')) return null;
        throw error;
    }
};

/* Slice S3's per-workspace client approval plugs in here: Modules/OAuthServer/approvals.js exporting
 * isClientApproved(companyId, clientId). Until it exists every client that holds a live grant passes. */
const clientApprovedInWorkspace = async (companyId, clientId) => {
    const approvals = approvalsModule();
    if (!approvals || typeof approvals.isClientApproved !== 'function') return true;
    return Boolean(await approvals.isClientApproved(companyId, clientId));
};

const taintOf = (clientId, at = new Date()) => ({ tainted: true, taintSources: [{ kind: taint.KINDS.CLIENT, ref: String(clientId).slice(0, 200), at }] });

/* MCP 2025-11-25 "Token Audience Binding and Validation" and RFC 8707: the token must name this server's
 * /mcp resource. Answers null for any token that is not good here (the caller sends 401 invalid_token),
 * { wrongWorkspace } when the request names a workspace other than the token's, { forbidden } when the
 * person who granted it has left the workspace, and otherwise the calling context. */
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

module.exports = { isAccessToken, looksLikeOAuthSecret, authenticate, clientApprovedInWorkspace };
