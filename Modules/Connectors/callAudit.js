const { recordAudit } = require('../Audit/recorder');
const taint = require('../Agents/taint');

const PHASE = Object.freeze({ READ: 'read', PROPOSE: 'propose', SEND: 'send' });

/* A hash and counts, never what was asked or answered. */
const record = (companyId, { userId, via, callerId = '', runId = null, key, tool, phase, input, connectionId = '', state, reason = '', chars = 0 }) => {
    const provider = tool ? tool.provider : String(key).split('.')[0];
    recordAudit(companyId, {
        actorId: String(userId || 'system'), action: 'connector.call', entityType: 'connector', entityId: provider, entityName: tool ? tool.definition.name : provider,
        meta: {
            action: key, phase, via, provider, connectionId: String(connectionId), state, chars,
            inputHash: taint.hashed(`${key}:${JSON.stringify(input || {})}`),
            ...(callerId ? { callerId: String(callerId) } : {}),
            ...(via === 'agent' && callerId ? { agentId: String(callerId) } : {}),
            ...(runId ? { runId: String(runId) } : {}),
            ...(reason ? { reason } : {}),
        },
    });
};

module.exports = { PHASE, record };
