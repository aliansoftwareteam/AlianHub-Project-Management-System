const store = require('./store');
const engine = require('./engine');
const executors = require('./executors');
const scheduler = require('./scheduler');
const retry = require('./retry');
const concurrency = require('./concurrency');
const idempotency = require('./idempotency');
const flag = require('./flag');
const automationRule = require('./automationRule');

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

module.exports = {
    enabled: flag.enabled,
    startForRule,
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
    AUTOMATION_RULE: automationRule.TYPE,
};
