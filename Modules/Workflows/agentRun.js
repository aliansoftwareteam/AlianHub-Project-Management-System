const runs = require('../Agents/runs');
const proposals = require('../Agents/proposals');
const actions = require('../Agents/actions');
const tools = require('../Automations/engine/tools');
const executors = require('./executors');
const store = require('./store');

// An agent run as a workflow step.
//
// The step starts nothing of its own: it hands the existing runner an
// agent_runs row and lets the run's identity, its account, its spend cap, the
// policy and the proposal path apply exactly as they do for a run a person
// started from a task. The step contributes the scheduling around it — the
// claim, the lease, the retry decision — and records which run it was.
//
// Two shapes reach it:
//
//   { agentRunId } — the run already exists, because a person started it through
//     POST /api/v2/agents/runs and the flag routed it through the queue.
//   { agentId, taskId, … } — the step starts the run itself, keyed on the run
//     and the step, so a replayed or retried step finds the run its first
//     attempt made instead of billing a second one.

const TYPE = 'agent_run';
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

const idempotencyKeyFor = (run, step) => `wf:${run._id}:${step.stepId}`;

const outputOf = (agentRun) => ({
    agentRunId: String(agentRun._id),
    agentId: String(agentRun.agentId),
    taskId: agentRun.taskId || null,
    status: agentRun.status,
    outcome: agentRun.outcome || null,
    spendUsd: Number((agentRun.spend && agentRun.spend.usd) || 0),
});

const taskFor = async (companyId, taskId) => {
    if (!taskId) throw permanent('an agent run step needs a task to run on');
    const task = await tools.getTask(companyId, taskId).catch(() => null);
    if (!task) throw permanent(`task ${taskId} was not found`);
    return task;
};

const startFor = async (companyId, run, step, config) => {
    const agent = await runs.getAgent(companyId, config.agentId);
    if (!agent) throw permanent(`agent ${config.agentId} was not found`);
    const task = await taskFor(companyId, config.taskId);
    if (agent.projectIds && agent.projectIds.length && !agent.projectIds.includes(String(task.ProjectID))) {
        throw permanent(`agent ${agent.name} is not scoped to project ${task.ProjectID}`);
    }
    // A paused agent, a spend cap or a daily limit will not clear inside a backoff,
    // so the step fails with the reason rather than spending its attempts on it.
    const check = await runs.canStart(agent, { trigger: TRIGGER, companyId });
    if (!check.ok) throw permanent(check.reason);
    const { run: agentRun } = await runs.start(companyId, {
        agent,
        taskId: config.taskId,
        projectId: task.ProjectID,
        skill: runs.skillSlugOf(agent, config.skill),
        trigger: TRIGGER,
        startedBy: run.startedBy || null,
        viaAccount: agent.account,
        note: config.note,
        spendCapUsd: config.spendCapUsd,
        notifyMe: Boolean(config.notifyMe),
        idempotencyKey: idempotencyKeyFor(run, step),
        traceId: run.traceId || null,
    });
    return agentRun;
};

/* The run itself, through the same graph a person's run executes on. */
const executeAgentRun = async (companyId, agentRun) => {
    const agent = await runs.getAgent(companyId, agentRun.agentId);
    if (!agent) throw permanent(`agent ${agentRun.agentId} was not found`);
    const task = await taskFor(companyId, agentRun.taskId);
    const actor = {
        kind: 'agent',
        userId: agentRun.startedBy || '',
        agentId: String(agent._id),
        agentName: agent.name,
        runId: String(agentRun._id),
        viaAccount: agentRun.viaAccount,
        tokenId: null,
    };
    const state = await runs.executeSkill(companyId, agentRun, agent, task, { proposals, actions, actor });
    const finished = (await runs.get(companyId, agentRun._id)) || agentRun;
    if (state.status === runs.STATUS.FAILED) throw permanent(`agent run ${agentRun._id} failed: ${state.error || state.outcome || 'no reason given'}`);
    if (state.status === runs.STATUS.STOPPED || state.status === 'abandoned') throw permanent(`agent run ${agentRun._id} was stopped`);
    // A run waiting on a person is not finished and not failed. It comes back as a
    // transient failure so the step waits with it; once the attempts are spent the
    // step fails visibly, and resuming it after the decision settles the run picks
    // the same run up again. Approval as a step type of its own is step 2.
    if (state.status === runs.STATUS.WAITING) throw transient(`agent run ${agentRun._id} is waiting for approval`);
    return outputOf(finished);
};

const execute = async ({ companyId, run, step, claim }) => {
    const config = step.config || {};
    const existing = config.agentRunId ? await runs.get(companyId, config.agentRunId) : null;
    if (config.agentRunId && !existing) throw permanent(`agent run ${config.agentRunId} no longer exists`);
    if (!existing && !config.agentId) throw permanent('an agent run step needs an agentId or an agentRunId');

    const agentRun = existing || await startFor(companyId, run, step, config);
    // Written before the run executes, so a step that ends up failing still says
    // which run it was — the first thing anyone reading a failed step asks.
    if (claim) await store.noteStep(companyId, claim, { output: outputOf(agentRun) });
    if (runs.TERMINAL.includes(agentRun.status)) return outputOf(agentRun);
    if (agentRun.status === runs.STATUS.WAITING) throw transient(`agent run ${agentRun._id} is waiting for approval`);
    return executeAgentRun(companyId, agentRun);
};

executors.register(TYPE, execute);

module.exports = { TYPE, TRIGGER, execute, executeAgentRun, idempotencyKeyFor, AgentStepError };
