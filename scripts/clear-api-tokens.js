/**
 * Admin script: delete ALL personal API tokens (and their activity logs)
 * for a company — a clean slate for re-testing the MCP auth flow.
 *
 * Usage (from the repo root):
 *   node scripts/clear-api-tokens.js <companyId>
 *   node scripts/clear-api-tokens.js <companyId> --yes   (skip confirmation)
 */
require('dotenv').config();

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const fail = (message) => { console.error(`\nERROR: ${message}\n`); process.exit(1); };

const main = async () => {
    const [companyId, flag] = process.argv.slice(2);
    if (!companyId || !/^[a-f0-9]{24}$/i.test(companyId)) {
        fail('Usage: node scripts/clear-api-tokens.js <companyId> [--yes]');
    }
    if (flag !== '--yes') {
        console.log(`\nThis will DELETE ALL api tokens + activity logs for company ${companyId}.`);
        console.log('Re-run with --yes to confirm:\n  node scripts/clear-api-tokens.js ' + companyId + ' --yes\n');
        process.exit(0);
    }

    const tokens = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.API_TOKENS, data: [{}] }, 'deleteMany');
    const logs = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.API_ACTIVITY_LOGS, data: [{}] }, 'deleteMany').catch(() => ({ deletedCount: 0 }));

    console.log(`\nDeleted ${tokens?.deletedCount ?? 0} api token(s) and ${logs?.deletedCount ?? 0} activity log(s) for company ${companyId}.\n`);
    process.exit(0);
};

main().catch((error) => fail(error.message || String(error)));
