/**
 * Admin script: enable/disable (revoke) a personal API token by prefix.
 *
 * Usage (from the repo root):
 *   node scripts/toggle-api-token.js <companyId> <tokenPrefix> <on|off>
 *
 * Example:
 *   node scripts/toggle-api-token.js 68c2540995e718dea76ad34f ahp_24d203ff off
 */
require('dotenv').config();

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const fail = (message) => {
    console.error(`\nERROR: ${message}\n`);
    process.exit(1);
};

const main = async () => {
    const [companyId, prefix, state] = process.argv.slice(2);
    if (!companyId || !prefix || !['on', 'off'].includes(state)) {
        fail('Usage: node scripts/toggle-api-token.js <companyId> <tokenPrefix> <on|off>');
    }
    if (!/^[a-f0-9]{24}$/i.test(companyId)) {
        fail('companyId must be a 24-char hex ObjectId.');
    }

    const active = state === 'on';
    const result = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.API_TOKENS,
        data: [{ prefix }, { $set: { active } }],
    }, 'updateOne');

    if (!result || !result.matchedCount) {
        fail(`No token found with prefix "${prefix}" in company ${companyId}.`);
    }
    console.log(`\nToken ${prefix}… is now ${active ? 'ACTIVE' : 'REVOKED (active:false)'}.\n`);
    process.exit(0);
};

main().catch((error) => fail(error.message || String(error)));
