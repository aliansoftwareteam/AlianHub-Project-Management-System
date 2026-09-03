const { validate: validateConditions, usesChangeOps } = require('../engine/expression');
const registry = require('../engine/registry');

// Validation for v2 (event-triggered, multi-step) rules.
//
// Returns a LIST of field-level errors, not a single boolean, so the builder can
// mark the offending slot instead of showing "invalid rule" over a form with
// nine inputs in it.
//
// v1 rules keep their own validator in automationRules.js — both shapes coexist
// until the last v1 rule is migrated.

const MAX_STEPS = 25;
const MAX_NAME = 120;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const validateStep = (step, index, errors) => {
    const at = `steps[${index}]`;
    if (!isPlainObject(step)) { errors.push(`${at}: must be an object`); return; }
    if (!step.id || typeof step.id !== 'string') errors.push(`${at}.id: required`);

    if (step.type === 'condition') {
        errors.push(...validateConditions(step.condition, `${at}.condition`));
        return;
    }
    if (step.type !== 'action') { errors.push(`${at}.type: must be "action" or "condition"`); return; }

    const action = registry.getAction(step.action);
    if (!action) {
        errors.push(`${at}.action: unknown action "${step.action}" (have: ${registry.actionKeys().join(', ')})`);
        return;
    }
    // Required config comes from the action's own schema — the same object the
    // builder renders its form from, so the form and the validator can never
    // disagree about what a field is called.
    const config = isPlainObject(step.config) ? step.config : {};
    Object.entries(action.schema || {}).forEach(([field, spec]) => {
        if (spec.required && (config[field] === undefined || config[field] === null || config[field] === '')) {
            errors.push(`${at}.config.${field}: required by "${action.key}"`);
        }
        if (spec.options && config[field] && !spec.options.includes(config[field])) {
            errors.push(`${at}.config.${field}: must be one of ${spec.options.join(', ')}`);
        }
    });
};

const validateRuleV2 = (input = {}) => {
    const errors = [];

    const name = String(input.name || '').trim();
    if (!name) errors.push('name: required');
    if (name.length > MAX_NAME) errors.push(`name: must be ${MAX_NAME} characters or fewer`);

    const trigger = isPlainObject(input.trigger) ? input.trigger : {};
    const triggerDef = registry.getTrigger(trigger.event);
    if (!triggerDef) {
        errors.push(`trigger.event: unknown event "${trigger.event}"`);
    }

    errors.push(...validateConditions(input.conditions, 'conditions'));

    // A "changed to" condition on a trigger that carries no diff can never match.
    // Catching it here means the user learns at save time, not by wondering for a
    // week why their automation never fires.
    if (triggerDef && !triggerDef.hasDiff && usesChangeOps(input.conditions)) {
        errors.push(`conditions: "${triggerDef.label}" carries no before/after, so a "changed" condition can never match`);
    }

    const steps = Array.isArray(input.steps) ? input.steps : [];
    if (!steps.length) errors.push('steps: at least one action is required');
    if (steps.length > MAX_STEPS) errors.push(`steps: at most ${MAX_STEPS} allowed`);
    steps.forEach((step, i) => validateStep(step, i, errors));

    const ids = steps.map((s) => s && s.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) errors.push('steps: step ids must be unique');

    if (errors.length) return { valid: false, errors, value: null };

    const scope = isPlainObject(input.scope) ? input.scope : {};
    return {
        valid: true,
        errors: [],
        value: {
            name,
            version: 2,
            trigger: { type: 'event', event: trigger.event },
            scope: {
                allProjects: scope.allProjects !== false,
                projectIds: Array.isArray(scope.projectIds) ? scope.projectIds.map(String) : [],
            },
            conditions: isPlainObject(input.conditions) ? input.conditions : {},
            steps: steps.map((s) => (s.type === 'condition'
                ? { id: s.id, type: 'condition', condition: s.condition }
                : { id: s.id, type: 'action', action: s.action, config: isPlainObject(s.config) ? s.config : {} })),
            reactToAutomation: input.reactToAutomation === true,
            limits: { maxRunsPerHour: Number(input.limits?.maxRunsPerHour) > 0 ? Number(input.limits.maxRunsPerHour) : 500 },
        },
    };
};

/* One-line human summary for the rule list — the same sentence the builder shows,
 * so a rule reads identically wherever it appears. */
const describeV2 = (rule = {}) => {
    const trigger = registry.getTrigger(rule.trigger?.event);
    const when = trigger ? trigger.label : (rule.trigger?.event || 'unknown trigger');
    const actions = (rule.steps || [])
        .filter((s) => s.type === 'action')
        .map((s) => (registry.getAction(s.action)?.label || s.action));
    return `${when} → ${actions.join(', ') || 'no actions'}`;
};

module.exports = { validateRuleV2, describeV2, validateStep, MAX_STEPS };
