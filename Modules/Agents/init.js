const routes = require('./routes');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const runs = require('./runs');
const proposals = require('./proposals');
const engine = require('../Automations/engine');

const REAP_PROPOSALS_JOB = 'agent.reap-stuck-proposals';
const REAP_PROPOSALS_EVERY_MS = 5 * 60 * 1000;

const forEachCompany = async (label, fn) => {
    const companies = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{}, '_id'] }, 'find');
    let total = 0;
    for (const c of companies || []) {
        // eslint-disable-next-line no-await-in-loop
        total += await fn(String(c._id)).catch((e) => { logger.error(`[agents] ${label} ${c._id}: ${e.message}`); return 0; });
    }
    return total;
};

/* A restart kills every in-flight run with the process; without this they stay
 * "running" in every counter until someone stops them by hand. */
const reapStaleRuns = async () => {
    const reaped = await forEachCompany('reap runs', async (companyId) => (await runs.reapStale(companyId)).reaped);
    if (reaped) logger.info(`[agents] marked ${reaped} run(s) from a previous process as failed`);
    return { reaped };
};

const reapStuckProposals = async () => {
    const reaped = await forEachCompany('reap proposals', async (companyId) => (await proposals.reapStuck(companyId)).reaped);
    if (reaped) logger.info(`[agents] failed ${reaped} proposal(s) stuck in applying`);
    return { reaped };
};

exports.init = (app) => {
    routes.init(app);
    reapStaleRuns().catch((e) => logger.error(`[agents] reap failed: ${e.message}`));
    engine.defineRecurring(REAP_PROPOSALS_JOB, REAP_PROPOSALS_EVERY_MS, reapStuckProposals).catch((e) => logger.error(`[agents] ${REAP_PROPOSALS_JOB}: ${e.message}`));
};

exports.reapStaleRuns = reapStaleRuns;
exports.reapStuckProposals = reapStuckProposals;
exports.REAP_PROPOSALS_JOB = REAP_PROPOSALS_JOB;
exports.REAP_PROPOSALS_EVERY_MS = REAP_PROPOSALS_EVERY_MS;
