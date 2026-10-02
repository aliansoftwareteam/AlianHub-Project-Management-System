const { validate: validateConditions, usesChangeOps } = require('../engine/expression');
const registry = require('../engine/registry');
const timeTrigger = require('../../Workflows/timeTrigger');
const { describeRule } = require('./sentenceRules');

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

/* The one composer of a rule's own words: `sentence` on every read and `name` on
 * every save come from here, so the two can never describe different rules. */
const composedName = (rule, people) => describeRule(rule, { people }).slice(0, MAX_NAME);

const validateStep = (step, index, errors, { trigger } = {}) => {
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
    if (typeof action.validate === 'function') action.validate(config, { trigger }).forEach((error) => errors.push(`${at}.config.${error}`));
};

const STEP_CONFIG_ERROR = /^steps\[(\d+)\]\.config\.(\w+): (.+)$/;
const NO_STEPS = 'steps: at least one action is required';
const NAME_REQUIRED = 'name: required';

const issueCode = (text) => {
    if (/^required\b/.test(text) || /^name at least one\b/.test(text)) return 'required';
    return text.startsWith('must be one of') ? 'not_an_option' : 'other';
};

const issueOf = (error, steps) => {
    const at = STEP_CONFIG_ERROR.exec(error);
    if (!at) return { code: error === NO_STEPS ? 'no_steps' : 'other', text: error.replace(/^[\w.[\]]+: /, '') };
    const [, index, field, text] = at;
    return { step: Number(index), action: steps[Number(index)].action, field, code: issueCode(text), text };
};

/* The same failures as `errors`, in parts: the builder words each one with the step's number, the action's name and
 * the field's label, in the reader's language. `text` is the reason without its path. A field its schema and its
 * action both call missing is one issue. The builder never asks for a name, so the name an unusable rule lacks is
 * not one of them. */
const issuesOf = (errors, steps) => {
    const seen = new Set();
    return errors.filter((error) => error !== NAME_REQUIRED).map((error) => issueOf(error, steps)).filter((issue) => {
        const key = issue.code === 'other' ? JSON.stringify(issue) : `${issue.step}.${issue.field}.${issue.code}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const validateRuleV2 = (input = {}, { people = [] } = {}) => {
    const errors = [];

    const name = String(input.name || '').trim();
    if (name.length > MAX_NAME) errors.push(`name: must be ${MAX_NAME} characters or fewer`);

    const trigger = isPlainObject(input.trigger) ? input.trigger : {};
    const triggerDef = registry.getTrigger(trigger.event);
    if (!triggerDef) {
        errors.push(`trigger.event: unknown event "${trigger.event}"`);
    }
    // A schedule carries its own shape, and it is the only trigger that does:
    // every other one is named by an event the bus publishes.
    if (triggerDef && triggerDef.kind === 'time') errors.push(...timeTrigger.validateSchedule(trigger.schedule));

    errors.push(...validateConditions(input.conditions, 'conditions'));

    // A "changed to" condition on a trigger that carries no diff can never match.
    // Catching it here means the user learns at save time, not by wondering for a
    // week why their automation never fires.
    if (triggerDef && !triggerDef.hasDiff && usesChangeOps(input.conditions)) {
        errors.push(`conditions: "${triggerDef.label}" carries no before/after, so a "changed" condition can never match`);
    }

    const steps = Array.isArray(input.steps) ? input.steps : [];
    if (!steps.length) errors.push(NO_STEPS);
    if (steps.length > MAX_STEPS) errors.push(`steps: at most ${MAX_STEPS} allowed`);
    steps.forEach((step, i) => validateStep(step, i, errors, { trigger: trigger.event }));

    const ids = steps.map((s) => s && s.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) errors.push('steps: step ids must be unique');

    // Composing the name needs a rule that parses, so an unusable one still has to
    // carry its own.
    if (errors.length) {
        if (!name) errors.push(NAME_REQUIRED);
        return { valid: false, errors, issues: issuesOf(errors, steps), value: null };
    }

    const scope = isPlainObject(input.scope) ? input.scope : {};
    const value = {
        name,
        version: 2,
        trigger: triggerDef.kind === 'time'
            ? { type: 'time', event: trigger.event, schedule: { ...trigger.schedule, timezone: 'UTC' } }
            : { type: 'event', event: trigger.event },
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
    };

    // An unnamed rule is named by the sentence that describes the rule being saved,
    // composed here rather than by the caller: a name the client derived from an
    // earlier compile can be a step behind the rule it is attached to, and then the
    // list, the audit trail and the run log all quote a rule that was never saved.
    if (!value.name) value.name = composedName(value, people);

    return { valid: true, errors: [], issues: [], value };
};

/* One-line human summary for the rule list — the same sentence the builder shows,
 * so a rule reads identically wherever it appears. */
const describeV2 = (rule = {}) => {
    const trigger = registry.getTrigger(rule.trigger?.event);
    const schedule = rule.trigger?.type === 'time' ? timeTrigger.describe(rule.trigger.schedule) : null;
    const when = schedule || (trigger ? trigger.label : (rule.trigger?.event || 'unknown trigger'));
    const actions = (rule.steps || [])
        .filter((s) => s.type === 'action')
        .map((s) => (registry.getAction(s.action)?.label || s.action));
    return `${when} → ${actions.join(', ') || 'no actions'}`;
};

module.exports = { validateRuleV2, describeV2, validateStep, composedName, MAX_STEPS, MAX_NAME };
