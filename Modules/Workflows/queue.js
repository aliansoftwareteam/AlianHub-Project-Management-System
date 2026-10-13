const logger = require('../../Config/loggerConfig');

// One way to move a workflow run forward: hand it to the automation queue, the
// same durable queue a rule-started run already rides. A user-started run and a
// control on a failed step both go through here, so there is one path and one
// place a retry is scheduled.
//
// The require is lazy because the automation engine requires this module's
// package at load time; taking it at call time is what keeps the cycle from
// handing one of them a half-built module.

const LOG_PREFIX = '[workflow-queue]';

/* Falls back to ticking in process when no queue is running — a self-host
 * instance with AUTOMATION_ENGINE off still has to execute the run it was just
 * asked to start. Returns how it was dispatched, which the API reports. */
const dispatch = async (companyId, workflowRunId, opts = {}) => {
    const engine = require('../Automations/engine');
    const job = { companyId: String(companyId), workflowRunId: String(workflowRunId) };
    if (await engine.enqueueWorkflowRun(job, opts)) return 'queued';
    const { tick } = require('./engine');
    await tick(companyId, workflowRunId, {}).catch((error) => logger.error(`${LOG_PREFIX} ${workflowRunId}: inline tick failed: ${error.message}`));
    return 'inline';
};

module.exports = { dispatch };
