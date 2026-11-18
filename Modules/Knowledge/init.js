const logger = require('../../Config/loggerConfig');
const engine = require('../Automations/engine');
const events = require('./ingest/events');
const backfill = require('./ingest/backfill');
const reindex = require('./reindex');
const memoryEvents = require('./memory/events');
const memoryBackfill = require('./memory/backfill');

exports.init = () => {
    if (!events.start()) return;
    engine.defineRecurring(backfill.JOB_NAME, backfill.INTERVAL_MS, async () => {
        const result = await backfill.backfillAll();
        await reindex.runAll();
        return result;
    })
        .catch((error) => logger.error(`[knowledge-indexer] ${backfill.JOB_NAME}: ${error.message}`));
    if (!memoryEvents.start()) return;
    engine.defineRecurring(memoryBackfill.JOB_NAME, memoryBackfill.INTERVAL_MS, () => memoryBackfill.backfillAll())
        .catch((error) => logger.error(`[knowledge-memory] ${memoryBackfill.JOB_NAME}: ${error.message}`));
};
