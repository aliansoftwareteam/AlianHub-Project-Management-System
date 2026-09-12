const logger = require('../../../Config/loggerConfig');
const domainEventBus = require('../../../event/domainEventBus');
const matcher = require('./matcher');
const runner = require('./runner');
const { createInlineDriver } = require('./queue');
const { createAgendaDriver } = require('./queue/agendaDriver');
const workflows = require('../../Workflows');

// Wires the five stages together: ingest (the bus) → match → enqueue → execute → record.
//
// On unless AUTOMATION_ENGINE=false: the builder UI now saves rules, and a rule
// that silently never runs is a worse surprise than one that does.

const LOG_PREFIX = '[automation-engine]';
const JOB_NAME = 'automation.run';

let driver = null;
let started = false;
const recurring = new Map();

const enabled = () => String(process.env.AUTOMATION_ENGINE || 'true').toLowerCase() !== 'false';

const selectDriver = () => {
    const choice = String(process.env.AUTOMATION_QUEUE_DRIVER || 'agenda').toLowerCase();
    if (choice === 'inline') return createInlineDriver();
    return createAgendaDriver({ concurrency: Number(process.env.AUTOMATION_CONCURRENCY) || 5 });
};

const enqueueRun = (data, opts) => driver.enqueue(JOB_NAME, data, opts);

const scheduleRecurring = async (name, intervalMs, handler) => {
    driver.define(name, async (job) => {
        try { await handler(job); } catch (error) { logger.error(`${LOG_PREFIX} ${name} failed: ${error.message}`); }
    });
    await driver.every(intervalMs, name);
    logger.info(`${LOG_PREFIX} ${name} every ${Math.round(intervalMs / 1000)}s`);
};

/* Other modules hang their periodic jobs on the same queue; registered before
 * start() they are defined and scheduled once the driver is up. */
const defineRecurring = (name, intervalMs, handler) => {
    recurring.set(name, { intervalMs, handler });
    if (started) return scheduleRecurring(name, intervalMs, handler);
    return Promise.resolve();
};

const logDispatchFailure = (envelope, error, rule) => {
    const ruleLabel = rule ? ` rule ${rule._id}` : '';
    logger.error(`${LOG_PREFIX} dispatch failed for ${domainEventBus.eventLabel(envelope)}${ruleLabel}: ${domainEventBus.failureText(error)}`);
};

/* With WORKFLOW_ENGINE on the rule becomes a one-node workflow run and the job
 * carries its id; the automation run is created and executed exactly as before
 * either way, so the rule's own behaviour and log do not change. A workflow run
 * that could not be created (a redelivered event loses the dedupe key) falls
 * back to the direct path, where the automation run's own unique index has
 * already dropped the duplicate. */
async function dispatchRule(envelope, rule) {
    const run = await runner.createRun(envelope.companyId, rule, envelope);
    if (!run) return;
    const job = { companyId: envelope.companyId, runId: String(run._id), ruleId: String(rule._id) };
    if (workflows.enabled()) {
        const workflowRun = await workflows.startForRule(envelope.companyId, rule, envelope, run);
        if (workflowRun) {
            await enqueueRun({ ...job, workflowRunId: String(workflowRun._id) });
            return;
        }
    }
    await enqueueRun(job);
}

async function onEnvelope(envelope) {
    let rules;
    try {
        rules = await matcher.match(envelope.companyId, envelope);
    } catch (error) {
        logDispatchFailure(envelope, error);
        return;
    }
    // Sequential on purpose: matching rules for one event are few, and a burst of
    // parallel writes against one tenant's pool of 10 is how you turn a working
    // automation into a timeout.
    for (const rule of rules) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await dispatchRule(envelope, rule);
        } catch (error) {
            logDispatchFailure(envelope, error, rule);
        }
    }
}

// The bus drops whatever a listener returns, so the run starts after the write has answered and its promise needs its own handler.
const dispatch = (envelope) => onEnvelope(envelope).catch((error) => logDispatchFailure(envelope, error));

async function start() {
    if (started) return;
    if (!enabled()) {
        logger.info(`${LOG_PREFIX} disabled (set AUTOMATION_ENGINE=true to enable)`);
        return;
    }
    driver = selectDriver();
    driver.define(JOB_NAME, async (job) => {
        const { companyId, runId, ruleId, workflowRunId } = job.attrs.data || {};
        const keepAlive = typeof job.touch === 'function' ? () => job.touch() : null;
        if (workflowRunId && workflows.enabled()) {
            await workflows.tick(companyId, workflowRunId, { enqueue: enqueueRun, context: { keepAlive } });
            return;
        }
        await runner.execute({ companyId, runId, ruleId, enqueue: enqueueRun, keepAlive });
    });
    await driver.start();
    domainEventBus.bus.on('domain.event', dispatch);
    started = true;
    logger.info(`${LOG_PREFIX} started (queue=${driver.name})`);
    for (const [name, { intervalMs, handler }] of recurring) {
        // eslint-disable-next-line no-await-in-loop
        await scheduleRecurring(name, intervalMs, handler).catch((error) => logger.error(`${LOG_PREFIX} could not schedule ${name}: ${error.message}`));
    }
}

async function stop() {
    if (!started) return;
    domainEventBus.bus.removeListener('domain.event', dispatch);
    if (driver) await driver.stop();
    started = false;
}

module.exports = { start, stop, onEnvelope, enabled, defineRecurring, JOB_NAME, _setDriver: (d) => { driver = d; }, _isStarted: () => started };
