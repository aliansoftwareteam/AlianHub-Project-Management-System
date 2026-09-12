const runner = require('../Automations/engine/runner');
const executors = require('./executors');

// The compatibility wrapper the decision asks for: an existing automation rule
// is a one-node workflow, and this is that node.
//
// It executes nothing itself. The rule's steps are still run by the automation
// runner, against the same automation_runs row, writing the same cursor and the
// same run log the Automations page reads — so a rule behaves identically with
// the flag on. What moves out of the runner is the scheduling: the node is
// called with no `enqueue`, so a transient failure comes back as `retrying`
// instead of the runner booking its own retry, and the step row's lease, claim
// and backoff take that decision instead.

const TYPE = 'automation_rule';

class AutomationRunFailed extends Error {
    constructor(message, deterministic) {
        super(message);
        this.name = deterministic ? 'DeterministicError' : 'AutomationRunFailed';
        this.deterministic = deterministic;
    }
}

const execute = async ({ companyId, run, context = {} }) => {
    const result = await runner.execute({
        companyId,
        runId: run.automationRunId,
        ruleId: run.ruleId,
        keepAlive: context.keepAlive,
    });

    // The runner has already spent its own attempt budget and decided whether the
    // failure was deterministic; `failed` is its terminal verdict either way.
    if (result.status === 'failed') throw new AutomationRunFailed(result.error || 'the automation run failed', true);
    if (result.status === 'retrying') throw new AutomationRunFailed(result.error || 'the automation run is retrying', false);
    return { status: result.status, automationRunId: run.automationRunId };
};

executors.register(TYPE, execute);

module.exports = { TYPE, execute, AutomationRunFailed };
