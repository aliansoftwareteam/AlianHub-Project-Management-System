const { getRoleType } = require('../../Config/permissionGuard');
const { isPrivileged } = require('../../Config/roleTypes');
const { recordAudit } = require('../Audit/recorder');
const { webhookAllowlist } = require('../Webhooks/helpers/privateHostAllowlist');
const { storeSigningSecret, revokeSigningSecret } = require('../Webhooks/helpers/signingSecret');
const { generateSecret } = require('../Webhooks/helpers/webhookRules');
const egressContext = require('../Agents/engine/egressContext');
const store = require('./store');
const clients = require('./clients');
const { deliveryUrlProblem } = require('./rules');
const { DelegationError } = require('./delegation');

const refuse = (statusCode, message) => { throw new DelegationError(statusCode, message); };

const requireManager = async (companyId, uid) => {
    if (!isPrivileged(await getRoleType(String(companyId), String(uid)))) refuse(403, 'Only an owner or admin can manage where outside agents hear of delegations.');
};

const view = (row) => ({ clientId: row.clientId, url: row.url, updatedBy: row.updatedBy || '', updatedAt: row.updatedAt || null });

const list = async ({ companyId, uid }) => {
    await requireManager(companyId, uid);
    return (await store.listEndpoints(companyId)).map(view);
};

/* The secret is answered once, here, and never again; saving a URL again issues a new one. */
const save = async ({ companyId, uid, clientId, url, ip = '', now = new Date() }) => {
    await requireManager(companyId, uid);
    const client = await clients.clientStanding(companyId, clientId);
    if (!client.ok) refuse(403, 'This outside agent is not approved in this workspace.');
    const egressHosts = egressContext.isOn() ? await require('../Agents/engine/egressAllowlist').hostsFor(String(companyId)) : [];
    const problem = deliveryUrlProblem(url, { allowlist: webhookAllowlist(), egressHosts });
    if (problem) refuse(400, `${problem.charAt(0).toUpperCase()}${problem.slice(1)}.`);

    const previous = await store.endpointFor(companyId, clientId);
    const secret = generateSecret();
    const held = await storeSigningSecret({ companyId, name: `Agent sessions: ${client.name || clientId}`, secret, actor: { id: String(uid) } });
    const saved = await store.saveEndpoint(companyId, clientId, {
        url: String(url).trim(), secret: held.secret || '', secretHandle: held.secretHandle || '', updatedBy: String(uid), updatedAt: now,
    });
    if (previous && previous.secretHandle) await revokeSigningSecret({ companyId, hook: previous, actor: { id: String(uid) } }).catch(() => {});
    recordAudit(companyId, {
        actorId: String(uid), actorName: '', ip, action: 'agent_session.endpoint_saved',
        entityType: 'oauth_client', entityId: String(clientId), entityName: client.name || '',
        meta: { host: new URL(String(url).trim()).host },
    });
    return { ...view(saved), secret };
};

module.exports = { list, save };
