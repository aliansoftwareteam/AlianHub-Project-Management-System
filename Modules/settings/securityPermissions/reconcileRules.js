const logger = require('../../../Config/loggerConfig');
const { removeCache } = require('../../../utils/commonFunctions');

// The permission catalogue in utils/data.js is seeded once, when a company is created, and never
// revisited. So a company drifts behind the product: a permission added to the catalogue today
// never reaches a company that already exists, and the permission screen — which renders whatever
// is stored — quietly shows a different list to every customer.
//
// Measured rather than assumed, on two live companies: `task_total_estimate` is defined in the
// current catalogue and present in neither, and both carry `export_tasks` and `import_tasks`, which
// no longer exist in the product and control nothing.
//
// Re-running importCompanyRules is what repairs it, and it is safe: it reads the existing rules
// first and copies each role's saved choices back onto the defaults before writing, so an owner's
// configuration survives. Verified with a harness — an owner who had taken task deletion away from
// Member still had it taken away afterwards.
//
// It is NOT run unconditionally, because the re-seed deletes the collection before re-inserting it
// and a permission check landing in that window would fail closed. It runs only when a sentinel is
// actually absent.
//
// MAINTENANCE: when a permission key is added to the catalogue in utils/data.js, add it here too.
// That one line is what lets existing companies pick it up.
const SENTINEL_KEYS = [
    'task_total_estimate',
];

// Once per company per process. The cache this hangs off lives a week, so this is rare; and because
// the repair is idempotent there is nothing to persist and no version number to keep in step.
const attempted = new Set();

function findMissingSentinels(rules) {
    const present = new Set(
        (Array.isArray(rules) ? rules : [])
            .filter((r) => r && r.key && r.projectId === undefined)
            .map((r) => String(r.key)),
    );
    return SENTINEL_KEYS.filter((k) => !present.has(k));
}

// Never rejects and never blocks the caller's own result. Returns the rules it was given, either
// unchanged or freshly re-read after a repair.
async function reconcileCompanyRules(companyId, rules) {
    try {
        if (!companyId || attempted.has(String(companyId))) return rules;

        // An empty collection means seeding never finished, or is running right now. Re-seeding on
        // top of that would race the original, so leave it alone.
        if (!Array.isArray(rules) || rules.length === 0) return rules;

        const missing = findMissingSentinels(rules);
        if (!missing.length) {
            attempted.add(String(companyId));
            return rules;
        }

        attempted.add(String(companyId));
        logger.info(`reconcileCompanyRules: ${companyId} is missing ${missing.join(', ')} — repairing`);

        // Required late: utils/data.js pulls in a large part of the app, and this file is loaded
        // from a request path.
        const { importCompanyRules } = require('../../../utils/data');
        const { SCHEMA_TYPE } = require('../../../Config/schemaType');
        const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

        await importCompanyRules(companyId);
        removeCache(`rules:${companyId}`);

        const repaired = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.RULES, data: [] }, 'find');
        const stillMissing = findMissingSentinels(repaired);
        if (stillMissing.length) {
            logger.error(`reconcileCompanyRules: ${companyId} still missing ${stillMissing.join(', ')} after repair`);
            return rules;
        }

        logger.info(`reconcileCompanyRules: ${companyId} repaired, ${repaired.length} rules`);
        return repaired;
    } catch (error) {
        logger.error(`reconcileCompanyRules failed for ${companyId}: ${error && error.message}`);
        return rules;
    }
}

module.exports = { reconcileCompanyRules, SENTINEL_KEYS, findMissingSentinels };
