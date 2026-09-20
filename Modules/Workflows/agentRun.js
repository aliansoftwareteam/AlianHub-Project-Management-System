const runs = require('../Agents/runs');
const proposals = require('../Agents/proposals');
const actions = require('../Agents/actions');
const tools = require('../Automations/engine/tools');
const store = require('./store');

// The agent runner behind the `agent_run` step type.
//
// `stepTypes/agentRun.js` settled what the step is; this is the wiring it was
// waiting for. It starts nothing of its own: it hands the existing runner an
// `agent_runs` row and lets the run's identity, its account, its spend cap, the
// policy and the proposal path apply exactly as they do for a run a person
// started from a task. What the step contributes is the scheduling around it —
// the claim, the lease, the retry decision — and the record of which run it was.
//
// Two shapes reach it:
//
//   { agentRunId } — the run already exists, because a person started it through
//     POST /api/v2/agents/runs and the flag routed it through the queue.
//   { agentId, taskId, … } — the step starts the run itself, keyed on the run
//     and the step, so a replayed or retried step finds the run its first
//     attempt made instead of billing a second one.

const TRIGGER = 'workflow';

class AgentStepError extends Error {
    constructor(message, deterministic) {
        super(message);
        this.name = deterministic ? 'DeterministicError' : 'AgentStepError';
        this.deterministic = deterministic;
    }
}

const permanent = (message) => new AgentStepError(message, true);
const transient = (message) => new AgentStepError(message, false);

const idempotencyKeyFor = (workflowRunId, stepId) => `wf:${workflowRunId}:${stepId}`;

const resultOf = (agentRun) => ({
    runId: String(agentRun._id),
    status: agentRun.status,
    outcome: agentRun.outcome || null,
    costUsd: Number((agentRun.spend && agentRun.spend.usd) || 0),
    findings: [],
});

const taskFor = async (companyId, taskId) => {
    if (!taskId) throw permanent('an agent run step needs a task to run on');
    const task = await tools.getTask(companyId, taskId).catch(() => null);
    if (!task) throw permanent(`task ${taskId} was not found`);
    return task;
};

/* The agent an agent step will run, read when the engine claims the step so the
 * step's credential can carry what that agent may do. Null for any other step. */
const agentFor = async (companyId, run, step) => {
    if (!step || String(step.type) !== 'agent_run') return null;
    const agentId = (step.config && step.config.agentId) || run.agentId;
    if (!agentId) return null;
    return runs.getAgent(companyId, agentId).catch(() => null);
};

const startFor = async (companyId, { workflowRunId, stepId, agentId, taskId, skill, note, spendCapUsd, budgetUsd, startedBy, traceId, depth }) => {
    const agent = await runs.getAgent(companyId, agentId);
    if (!agent) throw permanent(`agent ${agentId} was not found`);
    const task = await taskFor(companyId, taskId);
    if (agent.projectIds && agent.projectIds.length && !agent.projectIds.includes(String(task.ProjectID))) {
        throw permanent(`agent ${agent.name} is not scoped to project ${task.ProjectID}`);
    }
    // A paused agent, a spend cap or a daily limit will not clear inside a backoff,
    // so the step fails with the reason rather than spending its attempts on it.
    // `depth` is the workflow's own re-entry count, checked by the same guard a
    // rule-started run is checked by — one counter, not a second one.
    const check = await runs.canStart(agent, { trigger: TRIGGER, companyId, depth });
    if (!check.ok) throw permanent(check.reason);
    const { run } = await runs.start(companyId, {
        agent,
        taskId,
        projectId: task.ProjectID,
        skill: runs.skillSlugOf(agent, skill),
        trigger: TRIGGER,
        startedBy: startedBy || null,
        viaAccount: agent.account,
        note,
        spendCapUsd: Number(budgetUsd) > 0 ? Number(budgetUsd) : spendCapUsd,
        idempotencyKey: idempotencyKeyFor(workflowRunId, stepId),
        traceId: traceId || null,
        triggerDepth: depth,
    });
    return run;
};

/* Who the run acts as. The step's credential rides on the actor, which is what
 * every action is performed as, and is read each time it is presented: a heartbeat
 * re-mints it while the run is still going. Enumerable, so a copy of the actor
 * carries the credential it was copied with rather than none, and is still checked. */
const actorFor = (agentRun, agent, stepCredential = null) => {
    const actor = {
        kind: 'agent',
        userId: agentRun.startedBy || '',
        agentId: String(agent._id),
        agentName: agent.name,
        runId: String(agentRun._id),
        viaAccount: agentRun.viaAccount,
        tokenId: null,
    };
    if (typeof stepCredential === 'function') Object.defineProperty(actor, 'stepCredential', { enumerable: true, get: stepCredential });
    return actor;
};

/* The run itself, through the same graph a person's run executes on. */
const executeAgentRun = async (companyId, agentRun, { stepCredential = null } = {}) => {
    const agent = await runs.getAgent(companyId, agentRun.agentId);
    if (!agent) throw permanent(`agent ${agentRun.agentId} was not found`);
    const task = await taskFor(companyId, agentRun.taskId);
    const actor = actorFor(agentRun, agent, stepCredential);
    const state = await runs.executeSkill(companyId, agentRun, agent, task, { proposals, actions, actor });
    const finished = (await runs.get(companyId, agentRun._id)) || agentRun;
    if (state.status === runs.STATUS.FAILED) throw permanent(`agent run ${agentRun._id} failed: ${state.error || state.outcome || 'no reason given'}`);
    if (state.status === runs.STATUS.STOPPED || state.status === 'abandoned') throw permanent(`agent run ${agentRun._id} was stopped`);
    // A run waiting on a person is not finished and not failed. It comes back as a
    // transient failure so the step waits with it; once the attempts are spent the
    // step fails visibly, and resuming it after the decision settles the run picks
    // the same run up again. An approval as a step of its own is `human_approval`.
    if (state.status === runs.STATUS.WAITING) throw transient(`agent run ${agentRun._id} is waiting for approval`);
    return resultOf(finished);
};

/* What `context.runAgent` is. The step type calls this and nothing else. */
const runAgent = async ({ companyId, workflowRunId, stepId, agentRunId, agentId, taskId, skill, note, spendCapUsd, budgetUsd, startedBy, traceId, depth, noteOutput, stepCredential = null }) => {
    const existing = agentRunId ? await runs.get(companyId, agentRunId) : null;
    if (agentRunId && !existing) throw permanent(`agent run ${agentRunId} no longer exists`);
    if (!existing && !agentId) throw permanent('an agent run step needs an agentId or an agentRunId');

    const agentRun = existing || await startFor(companyId, { workflowRunId, stepId, agentId, taskId, skill, note, spendCapUsd, budgetUsd, startedBy, traceId, depth });
    // Written before the run executes, so a step that ends up failing still says
    // which run it was — the first thing anyone reading a failed step asks.
    if (typeof noteOutput === 'function') await noteOutput({ agentRunId: String(agentRun._id), status: agentRun.status });
    if (runs.TERMINAL.includes(agentRun.status)) return resultOf(agentRun);
    if (agentRun.status === runs.STATUS.WAITING) throw transient(`agent run ${agentRun._id} is waiting for approval`);
    return executeAgentRun(companyId, agentRun, { stepCredential });
};

/* The context every tick hands the executors, so a step type never has to know
 * where the runner lives. */
const contextFor = (companyId, claim) => ({
    runAgent,
    noteOutput: claim ? (output) => store.noteStep(companyId, claim, { output }) : null,
});

module.exports = { TRIGGER, runAgent, executeAgentRun, actorFor, agentFor, contextFor, idempotencyKeyFor, AgentStepError };
