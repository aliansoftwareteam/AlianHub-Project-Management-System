const store = require('./store');
const engine = require('./engine');
const executors = require('./executors');
const scheduler = require('./scheduler');
const retry = require('./retry');
const concurrency = require('./concurrency');
const idempotency = require('./idempotency');
const flag = require('./flag');
const queue = require('./queue');
const automationRule = require('./automationRule');
const agentRunner = require('./agentRun');
const stepTypes = require('./stepTypes');
const approvals = require('./approvals');
const timeTrigger = require('./timeTrigger');

// Workflow runs and step runs (task 028, sprint 5 step 1).
//
// Behind WORKFLOW_ENGINE, which is off by default. See flag.js for what off
// means and Modules/Workflows/README.md for the lease, the claim and the retry
// rules.

/* An automation rule as a one-node workflow. The node carries no rule steps of
 * its own: the automation runner still executes those, against the run row this
 * workflow points at, so the rule's own log is unchanged. */
const startForRule = (companyId, rule, envelope, automationRun) => store.createRun(companyId, {
    workflowId: `rule:${rule._id}`,
    name: rule.name || '',
    source: 'automation_rule',
    dedupeKey: `rule:${rule._id}:${envelope.id}`,
    ruleId: String(rule._id),
    ruleName: rule.name || '',
    automationRunId: String(automationRun._id),
    eventId: envelope.id,
    eventType: envelope.type,
    entity: envelope.entity || {},
    traceId: automationRun.traceId || envelope.traceId || null,
    steps: [{ id: 'rule', type: automationRule.TYPE, dependsOn: [], maxAttempts: flag.maxAttempts() }],
});

// A step id beginning with "s" is what lets a later step read this one's output
// as "$sAgent.agentRunId"; the expression language recognises no other form.
const STEP_ID = 'sAgent';

/* A run a person started from a task, as a one-node workflow.
 *
 * The agent run row already exists and is already this person's run; the
 * workflow wraps it so that it is claimed, leased and retried on the queue
 * instead of executed on the web request's own event loop. Dedupe on the agent
 * run means a retried request wraps the run it already made.
 */
const startForAgentRun = (companyId, run, { note } = {}) => store.createRun(companyId, {
    workflowId: `agent:${run.agentId}`,
    name: run.agentName || '',
    source: 'agent_run',
    dedupeKey: `agentrun:${run._id}`,
    agentId: String(run.agentId),
    taskId: run.taskId ? String(run.taskId) : null,
    projectId: run.projectId ? String(run.projectId) : null,
    startedBy: run.startedBy || null,
    traceId: run.traceId || null,
    steps: [{
        id: STEP_ID,
        type: stepTypes.AGENT_RUN,
        dependsOn: [],
        config: { agentRunId: String(run._id), agentId: String(run.agentId), taskId: run.taskId ? String(run.taskId) : null, note: note || '' },
        maxAttempts: flag.maxAttempts(),
    }],
});

/* Puts a run on the queue and hands the agent run back, so a caller that used to
 * execute in process swaps one line. Null when the workflow could not be created,
 * which is the caller's signal to fall back to the path it had. */
const enqueueForAgentRun = async (companyId, run, options) => {
    const workflowRun = await startForAgentRun(companyId, run, options);
    if (!workflowRun) return null;
    await queue.dispatch(companyId, workflowRun._id);
    return workflowRun;
};

module.exports = {
    enabled: flag.enabled,
    startForRule,
    startForAgentRun,
    enqueueForAgentRun,
    dispatch: queue.dispatch,
    tick: engine.tick,
    runStep: engine.runStep,
    store,
    engine,
    executors,
    scheduler,
    retry,
    concurrency,
    idempotency,
    flag,
    queue,
    agentRunner,
    stepTypes,
    approvals,
    timeTrigger,
    blockedReason: stepTypes.blockedReason,
    AUTOMATION_RULE: automationRule.TYPE,
    AGENT_RUN: stepTypes.AGENT_RUN,
};
