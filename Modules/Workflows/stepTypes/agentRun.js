const executors = require('../executors');
const { deterministic, num } = require('./graph');

// An agent run as a step — the type and its contract, not yet its wiring.
//
// Config: { agentId, skill, input, taskId, projectId, deadlineMs, budgetUsd }
// Output: { agentRunId, status, costUsd, findings }
//
// The executor is deliberately thin, and stays thin: the agent runner is reached
// through `context.runAgent`, which `Modules/Workflows/agentRun.js` supplies.
// Everything above that line — what the step is, what it must be given, what it
// hands back — is settled here, so the step type can be validated, saved in a
// definition and dry-run without knowing where the runner lives.
//
// The deadline and the budget are the run's, shrunk per hop: the engine works
// out what is left before the step is claimed and hands it down in the context,
// and the step's own config may ask for less of it but never for more. Same for
// the depth — `context.depth` is the one counter `runs.canStart` enforces.

const TYPE = 'agent_run';

const execute = async ({ companyId, run, step, context = {} }) => {
    const config = step.config || {};
    // A run a person already started arrives as `agentRunId`; the step executes
    // that run rather than starting one of its own, so an agent id is not needed.
    if (!config.agentId && !config.agentRunId) throw deterministic(`agent run ${step.stepId}: needs an "agentId"`);

    if (typeof context.runAgent !== 'function') {
        throw deterministic(`agent run ${step.stepId}: no agent runner is wired into this workflow tick`);
    }

    const result = await context.runAgent({
        companyId,
        workflowRunId: String(run._id),
        stepId: String(step.stepId),
        agentRunId: config.agentRunId ? String(config.agentRunId) : null,
        agentId: config.agentId ? String(config.agentId) : null,
        skill: config.skill || null,
        note: config.note || '',
        startedBy: run.startedBy || null,
        input: config.input || {},
        taskId: config.taskId || null,
        projectId: config.projectId || null,
        deadlineAt: context.deadlineAt || null,
        deadlineMs: num(config.deadlineMs, 0) || null,
        // What the engine granted this hop, which is already the smaller of what
        // the step asked for and what the run has left.
        budgetUsd: Number(context.budgetUsd) > 0 ? Number(context.budgetUsd) : (Number(config.budgetUsd) > 0 ? Number(config.budgetUsd) : null),
        depth: Number(context.depth) || 0,
        traceId: run.traceId || null,
        keepAlive: context.keepAlive,
        noteOutput: context.noteOutput,
    });

    return {
        agentRunId: result && result.runId ? String(result.runId) : null,
        status: (result && result.status) || 'unknown',
        costUsd: Number((result && (result.costUsd || (result.spend || {}).usd)) || 0),
        findings: (result && result.findings) || [],
    };
};

executors.register(TYPE, execute);

module.exports = { TYPE, execute };
