const logger = require('../../Config/loggerConfig');
const engine = require('../Automations/engine');
const events = require('./ingest/events');
const backfill = require('./ingest/backfill');
const reindex = require('./reindex');

exports.init = () => {
    if (!events.start()) return;
    engine.defineRecurring(backfill.JOB_NAME, backfill.INTERVAL_MS, async () => {
        const result = await backfill.backfillAll();
        await reindex.runAll();
        return result;
    })
        .catch((error) => logger.error(`[knowledge-indexer] ${backfill.JOB_NAME}: ${error.message}`));
};
