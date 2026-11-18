const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { named } = require('../Agents/connectors/flag');
const registry = require('./registry');
const connection = require('./connection');

const JOB_NAME = 'connectors.member-sweep';
const DEFAULT_INTERVAL_HOURS = 24;
const LOG = '[connectors]';

const intervalMs = () => {
    const hours = Number(process.env.CONNECTOR_SWEEP_HOURS || DEFAULT_INTERVAL_HOURS);
    return (Number.isFinite(hours) && hours >= 1 ? hours : DEFAULT_INTERVAL_HOURS) * 60 * 60 * 1000;
};

const anyNamed = () => registry.list().some((definition) => named().includes(definition.id));

/* Ends the connections of every no-longer-seated member across every company. Never throws: one company's
 * failure leaves the rest to run. Idempotent — a connection ended on an earlier pass is already closed. */
const sweepAll = async () => {
    if (!anyNamed()) return { ended: 0 };
    const companies = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{}, '_id'] }, 'find').catch(() => []);
    let ended = 0;
    for (const c of companies || []) {
        // eslint-disable-next-line no-await-in-loop
        ended += await connection.sweepCompany(String(c._id)).catch((e) => { logger.error(`${LOG} member sweep ${c._id}: ${e.message}`); return 0; });
    }
    if (ended) logger.info(`${LOG} the daily sweep ended ${ended} connection(s) of departed members`);
    return { ended };
};

module.exports = { JOB_NAME, intervalMs, anyNamed, sweepAll };
