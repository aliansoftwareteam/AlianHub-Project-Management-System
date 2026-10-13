const logger = require('../../../Config/loggerConfig');
const { removeCache } = require('../../../utils/commonFunctions');

// The permission catalogue in utils/data.js is seeded when a company is created and never
// revisited, so a company drifts behind the product. importCompanyRules repairs it and keeps
// each role's saved choices, but it deletes the collection before re-inserting, so it may only
// run while nobody is served: migrations/003-permission-catalogue.js calls this before the
// server listens.
//
// MAINTENANCE: when a permission key is added to the catalogue in utils/data.js, add it here too.
const SENTINEL_KEYS = [
    'task_total_estimate',
];

function findMissingSentinels(rules) {
    const present = new Set(
        (Array.isArray(rules) ? rules : [])
            .filter((r) => r && r.key && r.projectId === undefined)
            .map((r) => String(r.key)),
    );
    return SENTINEL_KEYS.filter((k) => !present.has(k));
}

async function repairCompanyRules(companyId) {
    // Required late: utils/data.js pulls in a large part of the app.
    const { importCompanyRules } = require('../../../utils/data');
    const { SCHEMA_TYPE } = require('../../../Config/schemaType');
    const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

    const rules = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.RULES, data: [] }, 'find');
    // An empty collection means seeding never finished; re-seeding on top would race it.
    if (!Array.isArray(rules) || rules.length === 0) return { repaired: false, skipped: 'unseeded' };
    const missing = findMissingSentinels(rules);
    if (!missing.length) return { repaired: false };

    logger.info(`repairCompanyRules: ${companyId} is missing ${missing.join(', ')} — repairing`);
    await importCompanyRules(companyId);
    removeCache(`rules:${companyId}`);
    const repaired = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.RULES, data: [] }, 'find');
    const stillMissing = findMissingSentinels(repaired);
    if (stillMissing.length) throw new Error(`still missing ${stillMissing.join(', ')} after repair`);
    return { repaired: true, missing, rules: repaired.length };
}

module.exports = { SENTINEL_KEYS, findMissingSentinels, repairCompanyRules };
