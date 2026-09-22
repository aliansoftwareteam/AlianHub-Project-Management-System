const logger = require('../../Config/loggerConfig');
const store = require('./store');
const flag = require('./flag');

// The step credential needs a running step with a live lease, and a step waiting on an outside agent is pending
// with neither, so a session bound to a waiting step is held to this check instead. The credential itself never
// leaves the server: the outside agent holds only its own OAuth token.

const TYPE = 'external_agent';
const WAITING_STATUSES = Object.freeze(['pending', 'running']);
const REFUSAL_PREFIX = 'external agent step refused';

const REFUSAL = Object.freeze({
    SESSION_CLOSED: 'session_closed',
    RUN_NOT_RUNNING: 'run_not_running',
    STEP_NOT_WAITING: 'step_not_waiting',
    GRANT_NOT_LIVE: 'grant_not_live',
    CLIENT_NOT_APPROVED: 'client_not_approved',
});

const sessionsApi = () => ({
    sessions: require('../AgentSessions/store'),
    clients: require('../AgentSessions/clients'),
    lifecycle: require('../AgentSessions/lifecycle'),
    rules: require('../AgentSessions/rules'),
});

const refusal = (code, detail, closeAs) => ({ ok: false, code, closeAs, reason: `${REFUSAL_PREFIX}: ${code} (${detail})` });

const BOUND = Object.freeze({ $gt: '' });

const liveCheck = async (companyId, session, now = new Date()) => {
    const { clients, rules } = sessionsApi();
    const id = String(session._id);
    const where = `session ${id} on ${session.workflowRunId}/${session.workflowStepId}`;
    if (!rules.isOpen(session)) return refusal(REFUSAL.SESSION_CLOSED, `${where} is ${session.state}`, null);
    const run = await store.getRun(String(companyId), session.workflowRunId);
    if (!run || run.status !== 'running') return refusal(REFUSAL.RUN_NOT_RUNNING, `run ${session.workflowRunId} is ${run ? run.status : 'gone'}`, rules.STATE.FAILED);
    const step = await store.getStep(String(companyId), session.workflowRunId, session.workflowStepId);
    const waiting = step && step.type === TYPE && WAITING_STATUSES.includes(step.status) && (!step.agentSessionId || String(step.agentSessionId) === id);
    if (!waiting) return refusal(REFUSAL.STEP_NOT_WAITING, `${where}: the step is ${step ? step.status : 'gone'}`, rules.STATE.FAILED);
    if (!(await clients.grantStanding(session.grantId, now))) return refusal(REFUSAL.GRANT_NOT_LIVE, `${where}: the grant was revoked or has expired`, rules.STATE.REVOKED);
    if (!(await clients.clientStanding(String(companyId), session.clientId)).ok) return refusal(REFUSAL.CLIENT_NOT_APPROVED, `${where}: the client is no longer approved`, rules.STATE.REVOKED);
    return { ok: true, run, step };
};

/* A refused session is closed as well, so the outside agent learns it has lost the step on this call. */
const enforce = async (companyId, session, now = new Date()) => {
    const live = await liveCheck(companyId, session, now);
    if (!live.ok && live.closeAs) await sessionsApi().lifecycle.close(session, live.closeAs, live.reason, { now });
    return live;
};

/* A closed session wakes the step waiting on it, so its outcome is read on the next tick rather than the next poll. */
const wake = (session) => {
    const { rules } = sessionsApi();
    if (!session || !session.workflowRunId || rules.isOpen(session)) return;
    const companyId = String(session.companyId);
    const runId = String(session.workflowRunId);
    Promise.resolve()
        .then(async () => {
            if (await store.wakeStep(companyId, runId, session.workflowStepId)) await require('./queue').dispatch(companyId, runId);
        })
        .catch((error) => logger.error(`[workflow-external-agent] waking ${runId}/${session.workflowStepId} failed: ${error.message}`));
};

const auditRefusal = async (companyId, actor, { action, session, reason, ip, taint }) => require('../Agents/agentAudit').recordRefusal(String(companyId), actor, {
    action: String(action || 'mcp'),
    reason,
    params: { sessionId: String(session._id), workflowRunId: String(session.workflowRunId), stepId: String(session.workflowStepId) },
    entityType: 'agent_session',
    entityId: String(session._id),
    ip,
    taint,
});

/* Each tool call from a grant with a session bound to a waiting step is held to the live check. */
const checkToolCall = async (ctx, action) => {
    if (!flag.externalAgentSteps() || !ctx || !ctx.oauth) return;
    const { sessions } = sessionsApi();
    const open = await sessions.openRows(ctx.companyId, { grantId: String(ctx.oauth.grantId), workflowRunId: BOUND });
    for (const session of open) {
        // eslint-disable-next-line no-await-in-loop
        const live = await enforce(ctx.companyId, session);
        if (!live.ok) {
            const { refusal: refuse } = require('../Agents/actions');
            // eslint-disable-next-line no-await-in-loop
            throw await refuse(ctx.companyId, ctx.actor, {
                action: String(action), params: { sessionId: String(session._id) }, reason: live.reason, ip: ctx.ip, taint: ctx.taint, entityType: 'agent_session', entityId: String(session._id),
            });
        }
    }
};

/* The MCP server answers a dead token with 401 before any tool runs, so a grant revoked mid-step is noticed here:
 * the sessions it held on waiting steps are revoked and the refusal is recorded as the agent acting for the person
 * who delegated, which is the only record of that call. Answers the ids of the sessions it closed. */
const refuseRevokedToken = async (raw, { action = 'mcp', ip = '', now = new Date() } = {}) => {
    if (!flag.externalAgentSteps()) return [];
    const tokenHash = require('../OAuthServer/tokenHash');
    if (!tokenHash.looksLike('access', raw)) return [];
    const oauthStore = require('../OAuthServer/store');
    const row = await oauthStore.tokens.find(tokenHash.hashOf(raw), 'access');
    if (!row || !row.grantId || !row.companyId) return [];
    const { sessions, clients, lifecycle, rules } = sessionsApi();
    if (await clients.grantStanding(row.grantId, now)) return [];
    const grant = await oauthStore.grants.find(row.grantId);
    const reason = `the grant behind this session ${grant && grant.revokedAt ? 'was revoked' : 'has expired'}${grant && grant.revokedReason ? ` (${grant.revokedReason})` : ''}`;
    const companyId = String(row.companyId);
    const open = await sessions.openRows(companyId, { grantId: String(row.grantId), workflowRunId: BOUND });
    const { externalClientActor } = require('../Agents/actor');
    const closed = [];
    for (const session of open) {
        // eslint-disable-next-line no-await-in-loop
        const done = await lifecycle.close(session, rules.STATE.REVOKED, reason, { now });
        if (!done) continue;
        closed.push(String(session._id));
        // eslint-disable-next-line no-await-in-loop
        const actor = await externalClientActor({ userId: session.delegatedBy, clientId: session.clientId, clientName: session.clientName, grantId: session.grantId });
        // eslint-disable-next-line no-await-in-loop
        await auditRefusal(companyId, actor, {
            action, session, ip, reason: `${REFUSAL_PREFIX}: ${REFUSAL.GRANT_NOT_LIVE} (${reason})`, taint: { tainted: true, taintSources: [{ kind: 'client', ref: String(session.clientId).slice(0, 200), at: now }] },
        });
    }
    return closed;
};

module.exports = { REFUSAL, REFUSAL_PREFIX, liveCheck, enforce, wake, checkToolCall, refuseRevokedToken };
