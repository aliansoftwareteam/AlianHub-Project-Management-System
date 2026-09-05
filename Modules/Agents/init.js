const routes = require('./routes');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const runs = require('./runs');

/* A restart kills every in-flight run with the process; without this they stay
 * "running" in every counter until someone stops them by hand. */
const reapStaleRuns = async () => {
    const companies = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{}, '_id'] }, 'find');
    let reaped = 0;
    for (const c of companies || []) {
        // eslint-disable-next-line no-await-in-loop
        const out = await runs.reapStale(String(c._id)).catch((e) => { logger.error(`[agents] reap ${c._id}: ${e.message}`); return { reaped: 0 }; });
        reaped += out.reaped;
    }
    if (reaped) logger.info(`[agents] marked ${reaped} run(s) from a previous process as failed`);
    return { reaped };
};

exports.init = (app) => {
    routes.init(app);
    reapStaleRuns().catch((e) => logger.error(`[agents] reap failed: ${e.message}`));
};

exports.reapStaleRuns = reapStaleRuns;
