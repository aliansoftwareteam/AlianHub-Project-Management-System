const agentFetch = require('../Agents/engine/agentFetch');
const egressContext = require('../Agents/engine/egressContext');
const { webhookAllowlist } = require('../Webhooks/helpers/privateHostAllowlist');
const { signingSecretOf } = require('../Webhooks/helpers/signingSecret');
const { signPayload } = require('../Webhooks/helpers/webhookRules');
const mcpOAuth = require('../../Config/mcpOAuth');
const store = require('./store');
const events = require('./events');
const lifecycle = require('./lifecycle');
const { STATE, announcement, deliveryUrlProblem } = require('./rules');
const { LIMITS } = require('./config');

const EVENT = 'agent_session.offered';

const egressHostsFor = async (companyId) => (egressContext.isOn()
    ? require('../Agents/engine/egressAllowlist').hostsFor(String(companyId))
    : []);

const issuerOrEmpty = () => {
    try { return mcpOAuth.issuer(); } catch (error) { return ''; }
};

const deliver = ({ companyId, actor, url, body, headers, allowlist }) => egressContext.run(
    { companyId: String(companyId), actor: String(actor) },
    () => agentFetch.postJson(url, { body, allowlist, headers, timeoutMs: LIMITS.deliveryTimeoutMs, maxBytes: LIMITS.deliveryResponseBytes }),
);

const fail = (session, reason) => lifecycle.close(session, STATE.FAILED, reason, { from: [STATE.OFFERED] });

/* Signed like an outgoing webhook, sent through the workspace egress gateway, and the ten-second clock starts only
 * once the client has answered 2xx. */
const announce = async (session, handle) => {
    const endpoint = await store.endpointFor(session.companyId, session.clientId);
    if (!endpoint) return { session: await fail(session, 'the outside client has no delivery URL in this workspace'), delivered: false };
    const allowlist = webhookAllowlist();
    const problem = deliveryUrlProblem(endpoint.url, { allowlist, egressHosts: await egressHostsFor(session.companyId) });
    if (problem) return { session: await fail(session, problem), delivered: false };
    const secret = await signingSecretOf(session.companyId, endpoint);
    if (!secret) return { session: await fail(session, 'the signing secret of the delivery URL is unavailable'), delivered: false };

    const body = JSON.stringify(announcement({ session, handle, issuer: issuerOrEmpty() }));
    let response;
    try {
        response = await deliver({
            companyId: session.companyId,
            actor: session.delegatedBy,
            url: endpoint.url,
            body,
            allowlist,
            headers: {
                'User-Agent': 'AlianHub-AgentSessions/1.0',
                'X-AlianHub-Event': EVENT,
                'X-AlianHub-Session': String(session._id),
                'X-AlianHub-Signature': signPayload(secret, body),
            },
        });
    } catch (error) {
        return { session: await fail(session, `the announcement could not be delivered: ${String(error.message).slice(0, 200)}`), delivered: false };
    }
    if (!(response.status >= 200 && response.status < 300)) {
        return { session: await fail(session, `the delivery URL answered ${response.status}`), delivered: false };
    }
    const delivered = await store.markDelivered(session.companyId, session._id, new Date());
    if (!delivered) return { session: await store.find(session.companyId, session._id), delivered: true };
    lifecycle.arm(delivered);
    events.emitSession(delivered);
    return { session: delivered, delivered: true };
};

module.exports = { EVENT, announce, deliver };
