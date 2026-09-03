const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const { evaluate } = require('./expression');

// Which rules care about this event.
//
// Cache-then-walk, never query-per-event: a burst of task updates must not become
// a burst of database round trips. Same shape as the webhook dispatcher's
// hookCache, invalidated on rule CRUD so a save takes effect immediately rather
// than up to a TTL later.

const LOG_PREFIX = '[automation-matcher]';
const CACHE_TTL_MS = 60000;

// companyId -> { at, byTrigger: Map<eventType, rule[]> }
const ruleCache = new Map();

const indexRules = (rules) => {
    const byTrigger = new Map();
    (rules || []).forEach((rule) => {
        const type = rule?.trigger?.event || rule?.trigger;
        if (!type) return;
        if (!byTrigger.has(type)) byTrigger.set(type, []);
        byTrigger.get(type).push(rule);
    });
    return byTrigger;
};

async function loadRules(companyId) {
    const cached = ruleCache.get(companyId);
    if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) return cached.byTrigger;
    try {
        // Disabled and soft-deleted rules are filtered at cache-build time so the
        // per-event walk never sees them.
        const rules = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RULES,
            data: [{ enabled: true, deletedStatusKey: 0 }],
        }, 'find');
        const byTrigger = indexRules(rules);
        ruleCache.set(companyId, { at: Date.now(), byTrigger });
        return byTrigger;
    } catch (error) {
        logger.error(`${LOG_PREFIX} could not load rules for ${companyId}: ${error.message}`);
        return new Map();
    }
}

const invalidate = (companyId) => { ruleCache.delete(String(companyId)); };
const invalidateAll = () => { ruleCache.clear(); };

/* The context a condition is evaluated against. Deliberately the envelope and
 * nothing more — a condition cannot reach the database, so evaluating one is
 * always cheap and always side-effect free. */
const contextFor = (envelope, outputs = {}) => ({
    task: envelope.data || {},
    previous: envelope.previous || {},
    actor: envelope.actor || {},
    scope: envelope.scope || {},
    entity: envelope.entity || {},
    changedFields: envelope.changedFields || [],
    steps: outputs,
});

/* A rule only sees events from projects it is scoped to. `allProjects` is the
 * default because that is what the v1 rules meant. */
const inScope = (rule, envelope) => {
    const scope = rule.scope || {};
    if (scope.allProjects !== false) return true;
    const ids = (scope.projectIds || []).map(String);
    if (!ids.length) return true;
    return ids.includes(String(envelope.scope?.projectId || ''));
};

/* Automation-authored events are ignored unless a rule opts in. Without this a
 * rule that sets priority on status change, plus a rule that sets status on
 * priority change, is an infinite loop that costs one tenant their database. */
const acceptsActor = (rule, envelope) => {
    const kind = envelope.actor?.kind;
    if (kind !== 'automation' && kind !== 'agent') return true;
    return rule.reactToAutomation === true;
};

async function match(companyId, envelope) {
    const byTrigger = await loadRules(companyId);
    const candidates = byTrigger.get(envelope.type) || [];
    if (!candidates.length) return [];

    const ctx = contextFor(envelope);
    return candidates.filter((rule) => {
        if (!inScope(rule, envelope)) return false;
        if (!acceptsActor(rule, envelope)) return false;
        try {
            return evaluate(rule.conditions, ctx);
        } catch (error) {
            // A rule whose conditions throw is a broken rule, not a broken engine.
            logger.error(`${LOG_PREFIX} rule ${rule._id} conditions threw: ${error.message}`);
            return false;
        }
    });
}

module.exports = { match, invalidate, invalidateAll, contextFor, inScope, acceptsActor, indexRules, CACHE_TTL_MS };
