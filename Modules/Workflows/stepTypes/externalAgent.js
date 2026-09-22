const executors = require('../executors');
const flag = require('../flag');
const store = require('../store');
const { waitUntil } = require('./waiting');
const { num, deterministic } = require('./graph');

const TYPE = 'external_agent';
const POLL_MS = 30 * 1000;
const DEFAULT_DEADLINE_MS = 60 * 60 * 1000;

const CONTRACT = Object.freeze({
    key: TYPE,
    label: 'Hand to an outside agent',
    config: {
        clientId: { type: 'oauth_client', label: 'Outside agent', required: true },
        taskId: { type: 'text', label: 'Task' },
        deadlineMs: { type: 'duration', label: 'Deadline' },
    },
    output: {
        sessionId: { type: 'string', label: 'Session', required: true },
        state: { type: 'string', label: 'State', required: true },
        clientId: { type: 'string', label: 'Outside agent' },
        clientName: { type: 'string', label: 'Outside agent name' },
        response: { type: 'string', label: 'Response', required: true },
        activityCount: { type: 'number', label: 'Activities' },
    },
});

// Required lazily: the sessions module reaches back into this package to wake a step when a session closes.
const sessionsApi = () => ({
    sessions: require('../../AgentSessions/store'),
    delegation: require('../../AgentSessions/delegation'),
    lifecycle: require('../../AgentSessions/lifecycle'),
    rules: require('../../AgentSessions/rules'),
});

const responseOf = (session) => {
    const last = [...(session.activities || [])].reverse().find((a) => a.type === 'response');
    return last ? String(last.text || '') : '';
};

const openSession = async ({ companyId, run, step, claim, where }) => {
    const { sessions, delegation } = sessionsApi();
    const existing = await sessions.forStep(companyId, run._id, step.stepId);
    if (existing) return existing;
    const config = step.config || {};
    const taskId = config.taskId || run.taskId;
    if (!taskId) throw deterministic(`${where}: needs a "taskId", or a run started on a task`);
    let opened;
    try {
        opened = await delegation.delegate({
            companyId,
            uid: run.startedBy || '',
            taskId: String(taskId),
            clientId: String(config.clientId),
            binding: { workflowRunId: String(run._id), workflowStepId: String(step.stepId) },
        });
    } catch (error) {
        if (error instanceof delegation.DelegationError) throw deterministic(`${where}: ${error.message}`);
        throw error;
    }
    if (claim) await store.noteStep(companyId, claim, { agentSessionId: String(opened.session._id) });
    return opened.session;
};

const execute = async ({ companyId, run, step, claim, context = {} }) => {
    const config = step.config || {};
    const where = `external agent step ${step.stepId}`;
    if (!config.clientId) throw deterministic(`${where}: needs a "clientId"`);
    const { lifecycle, rules } = sessionsApi();
    const session = await openSession({ companyId, run, step, claim, where });
    const id = String(session._id);

    if (session.state === rules.STATE.COMPLETED) {
        const response = responseOf(session);
        if (!response) throw deterministic(`${where}: session ${id} was completed without a response`);
        return {
            sessionId: id, state: session.state, clientId: session.clientId, clientName: session.clientName || '', response, activityCount: Number(session.activityCount || 0),
        };
    }
    if (session.state === rules.STATE.FAILED) throw deterministic(`${where}: the outside agent reported an error: ${session.reason || 'no reason given'}`);
    if (session.state === rules.STATE.UNRESPONSIVE) throw deterministic(`${where}: session ${id} went unresponsive: ${session.reason || 'no first activity in time'}`);
    if (session.state === rules.STATE.REVOKED) throw deterministic(`${where}: session ${id} was revoked: ${session.reason || 'no reason given'}`);

    const now = new Date();
    const own = new Date(new Date(session.createdAt || now).getTime() + num(config.deadlineMs, DEFAULT_DEADLINE_MS));
    const runs = context.deadlineAt ? new Date(context.deadlineAt) : null;
    const deadlineAt = runs && runs < own ? runs : own;
    if (deadlineAt <= now) {
        await lifecycle.close(session, rules.STATE.FAILED, 'the workflow step deadline passed before the outside agent finished');
        throw deterministic(`${where}: the step deadline passed at ${deadlineAt.toISOString()} before the outside agent finished`);
    }
    return waitUntil(`waiting for ${session.clientName || session.clientId} to finish`, deadlineAt, {
        pollMs: POLL_MS,
        set: { agentSessionId: id, ...(step.waitingSince ? {} : { waitingSince: now }) },
    });
};

const register = () => {
    if (flag.externalAgentSteps()) executors.register(TYPE, execute);
};

register();

module.exports = { TYPE, CONTRACT, execute, register };
