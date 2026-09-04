const logger = require('../../../Config/loggerConfig');
const domainEventBus = require('../../../event/domainEventBus');
const matcher = require('./matcher');
const runner = require('./runner');
const { createInlineDriver } = require('./queue');
const { createAgendaDriver } = require('./queue/agendaDriver');

// Wires the five stages together: ingest (the bus) → match → enqueue → execute → record.
//
// On unless AUTOMATION_ENGINE=false: the builder UI now saves rules, and a rule
// that silently never runs is a worse surprise than one that does.

const LOG_PREFIX = '[automation-engine]';
const JOB_NAME = 'automation.run';

let driver = null;
let started = false;

const enabled = () => String(process.env.AUTOMATION_ENGINE || 'true').toLowerCase() !== 'false';

const selectDriver = () => {
    const choice = String(process.env.AUTOMATION_QUEUE_DRIVER || 'agenda').toLowerCase();
    if (choice === 'inline') return createInlineDriver();
    return createAgendaDriver({ concurrency: Number(process.env.AUTOMATION_CONCURRENCY) || 5 });
};

const enqueueRun = (data, opts) => driver.enqueue(JOB_NAME, data, opts);

async function onEnvelope(envelope) {
    try {
        const rules = await matcher.match(envelope.companyId, envelope);
        if (!rules.length) return;

        for (const rule of rules) {
            // Sequential on purpose: matching rules for one event are few, and a
            // burst of parallel writes against one tenant's pool of 10 is how you
            // turn a working automation into a timeout.
            // eslint-disable-next-line no-await-in-loop
            const run = await runner.createRun(envelope.companyId, rule, envelope);
            if (!run) continue; // duplicate event — the unique index rejected it
            // eslint-disable-next-line no-await-in-loop
            await enqueueRun({ companyId: envelope.companyId, runId: String(run._id), ruleId: String(rule._id) });
        }
    } catch (error) {
        logger.error(`${LOG_PREFIX} dispatch failed for ${envelope.type}: ${error.message}`);
    }
}

async function start() {
    if (started) return;
    if (!enabled()) {
        logger.info(`${LOG_PREFIX} disabled (set AUTOMATION_ENGINE=true to enable)`);
        return;
    }
    driver = selectDriver();
    driver.define(JOB_NAME, async (job) => {
        const { companyId, runId, ruleId } = job.attrs.data || {};
        await runner.execute({ companyId, runId, ruleId, enqueue: enqueueRun });
    });
    await driver.start();
    domainEventBus.bus.on('domain.event', onEnvelope);
    started = true;
    logger.info(`${LOG_PREFIX} started (queue=${driver.name})`);
}

async function stop() {
    if (!started) return;
    domainEventBus.bus.removeListener('domain.event', onEnvelope);
    if (driver) await driver.stop();
    started = false;
}

module.exports = { start, stop, onEnvelope, enabled, JOB_NAME, _setDriver: (d) => { driver = d; }, _isStarted: () => started };
