const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const flag = require('./flag');
const { syncCompany } = require('./runner');

const COMPANY_CONCURRENCY = 5;
const LOG = '[appConnections]';

async function runForAllCompanies() {
    if (!flag.enabled()) return;
    let companies;
    try {
        companies = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{}, '_id'] }, 'find');
    } catch (e) {
        logger.error(`${LOG} could not enumerate companies: ${e.message}`);
        return;
    }
    for (let i = 0; i < (companies || []).length; i += COMPANY_CONCURRENCY) {
        const slice = companies.slice(i, i + COMPANY_CONCURRENCY);
        await Promise.allSettled(slice.map((c) => syncCompany(String(c._id)).catch((e) => logger.error(`${LOG} ${c._id}: ${e.message}`))));
    }
}

module.exports = { runForAllCompanies };
