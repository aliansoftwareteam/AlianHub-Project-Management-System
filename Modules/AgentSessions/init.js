const routes = require('./routes');
const config = require('./config');
const lifecycle = require('./lifecycle');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');

/* A restart loses every ten-second timer, so each workspace is swept once on boot; after that only the workspaces
 * holding open sessions are. */
const sweepAll = async (now = new Date()) => {
    const companies = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{}, '_id'] }, 'find');
    let closed = 0;
    for (const company of companies || []) {
        // eslint-disable-next-line no-await-in-loop
        closed += (await lifecycle.sweepCompany(String(company._id), now).catch((error) => {
            logger.error(`agent sessions: boot sweep of ${company._id} failed: ${error.message}`);
            return { closed: 0 };
        })).closed;
    }
    if (closed) logger.info(`[agent-sessions] closed ${closed} session(s) left open by a previous process`);
    return { closed };
};

let interval = null;

exports.init = (app, env = process.env) => {
    routes.init(app, env);
    if (!config.isOn(env)) return;
    sweepAll().catch((error) => logger.error(`agent sessions: boot sweep failed: ${error.message}`));
    interval = setInterval(() => {
        lifecycle.sweepTracked().catch((error) => logger.error(`agent sessions: sweep failed: ${error.message}`));
    }, config.LIMITS.sweepMs);
    if (interval.unref) interval.unref();
};

exports.sweepAll = sweepAll;
exports.stop = () => { clearInterval(interval); interval = null; };
