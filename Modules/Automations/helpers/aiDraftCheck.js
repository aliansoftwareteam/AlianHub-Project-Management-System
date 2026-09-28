const registry = require('../engine/registry');
const { validateRuleV2, MAX_STEPS } = require('./ruleSchemaV2');
const { statusClause } = require('./statusConditions');

const TOP_KEYS = ['trigger', 'project', 'conditions', 'actions', 'unmapped'];
const CONDITION_KEYS = ['field', 'op', 'value'];
const ACTION_KEYS = ['action', 'config'];
const UNARY_OPS = ['empty', 'notEmpty', 'changed'];
const LIST_OPS = ['in', 'notIn'];
const MAX_CONDITIONS = 10;
const MAX_TEXT = 2000;
const MAX_UNMAPPED = 10;
const MAX_NOTE = 200;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const lower = (v) => String(v == null ? '' : v).trim().toLowerCase();
const note = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);

/* What a field's value has to be checked against. A type this module cannot
 * check is never offered to the model, so a new registry type stays out of
 * AI drafts until someone teaches this file to verify it. */
const kindOf = (spec = {}) => {
    const type = lower(spec.type);
    if (Array.isArray(spec.options)) return 'option';
    if (type.startsWith('status')) return 'status';
    if (/user|person|people|assignee|member/.test(type)) return 'person';
    if (type.startsWith('project')) return 'project';
    if (type === 'task_type') return 'task_type';
    if (type === 'boolean') return 'boolean';
    if (type === 'number') return 'number';
    if (type === 'text' || type === 'textarea') return 'text';
    return null;
};

const WRITE_AS = {
    status: 'a status name exactly as the sentence says it; open, in progress or done for any status of that kind',
    person: "the person's name or email exactly as the sentence says it",
    project: 'the project name exactly as the sentence says it',
    task_type: 'the task type name exactly as the sentence says it',
};

const takesList = (spec = {}) => /_multi$/.test(lower(spec.type));

const describeSpec = (spec) => {
    const kind = kindOf(spec);
    const out = { type: spec.type, label: spec.label };
    if (spec.required) out.required = true;
    if (kind === 'option') out.options = spec.options;
    if (WRITE_AS[kind]) out.writeAs = WRITE_AS[kind];
    if (takesList(spec)) out.list = true;
    if (Array.isArray(spec.roles) && spec.roles.length) out.alsoAccepts = spec.roles;
    return out;
};

const eventTriggers = () => registry.availableTriggers().filter((t) => t.kind !== 'time');

const conditionFieldsFor = (entity) => (registry.manifest().conditionFieldsByEntity[entity] || []).filter((f) => kindOf(f));

const offeredActions = () => registry.manifest().actions
    .filter((a) => Object.values(a.schema || {}).every((spec) => kindOf(spec)));

const draftSchema = () => {
    const triggers = eventTriggers();
    const entities = [...new Set(triggers.map((t) => t.entity))];
    return {
        triggers: triggers.map((t) => ({ key: t.key, label: t.label, entity: t.entity, actsOn: t.actsOn || t.entity, carriesBeforeAndAfter: t.hasDiff })),
        conditionFields: Object.fromEntries(entities.map((entity) => [entity, conditionFieldsFor(entity).map((f) => ({ field: f.field, label: f.label, ...describeSpec(f), ops: f.ops }))])),
        operatorsWithoutValue: UNARY_OPS,
        operatorsTakingAList: LIST_OPS,
        actions: offeredActions().map((a) => ({
            key: a.key,
            label: a.label,
            appliesTo: a.appliesTo,
            config: Object.fromEntries(Object.entries(a.schema || {}).map(([field, spec]) => [field, describeSpec(spec)])),
        })),
    };
};

const findProject = (refs, wanted) => {
    const key = lower(wanted);
    if (!key) return null;
    return refs.projects.find((p) => String(p.id) === String(wanted).trim() || lower(p.name) === key) || null;
};

const findPerson = (refs, wanted) => {
    const key = lower(wanted);
    if (!key) return null;
    const exact = refs.people.find((p) => String(p.id) === String(wanted).trim() || lower(p.name) === key || (p.email && lower(p.email) === key));
    if (exact) return exact;
    if (OBJECT_ID.test(String(wanted).trim())) return null;
    const byFirstName = refs.people.filter((p) => lower(p.name).split(/\s+/)[0] === key);
    return byFirstName.length === 1 ? byFirstName[0] : null;
};

/* One value, resolved to what the engine compares: a person's id, a project's
 * id, the canonical spelling of a status, option or task type. */
const resolveOne = (kind, raw, spec, ctx) => {
    const shown = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
    if (raw === null || raw === undefined || isPlainObject(raw) || Array.isArray(raw)) return { error: `${spec.label} needs a single value, not ${shown}.` };
    switch (kind) {
        case 'option': {
            const hit = spec.options.find((o) => lower(o) === lower(raw));
            return hit !== undefined ? { value: hit } : { error: `"${shown}" is not one of ${spec.options.join(', ')} for ${spec.label}.` };
        }
        case 'boolean':
            if (raw === true || lower(raw) === 'true') return { value: true };
            if (raw === false || lower(raw) === 'false') return { value: false };
            return { error: `${spec.label} must be true or false, not "${shown}".` };
        case 'number':
            return Number.isFinite(Number(raw)) && String(raw).trim() !== '' ? { value: Number(raw) } : { error: `${spec.label} must be a number, not "${shown}".` };
        case 'text': {
            const text = String(raw).trim();
            if (!text) return { error: `${spec.label} is empty.` };
            return text.length > MAX_TEXT ? { error: `${spec.label} is longer than ${MAX_TEXT} characters.` } : { value: text };
        }
        case 'status': {
            const hit = ctx.statuses().find((s) => lower(s) === lower(raw));
            return hit ? { value: hit } : { error: `There is no status called "${shown}" in the projects you can use.` };
        }
        case 'person': {
            const hit = findPerson(ctx.refs, raw);
            return hit ? { value: hit.id } : { error: `There is no one called "${shown}" on the projects you can use.` };
        }
        case 'project': {
            const hit = findProject(ctx.refs, raw);
            return hit ? { value: hit.id } : { error: `There is no project called "${shown}" that you can use.` };
        }
        case 'task_type': {
            const hit = ctx.refs.taskTypes.find((t) => lower(t) === lower(raw));
            return hit ? { value: hit } : { error: `There is no task type called "${shown}".` };
        }
        default:
            return { error: `${spec.label} cannot be drafted.` };
    }
};

const unknownKeys = (obj, allowed) => Object.keys(obj).filter((k) => !allowed.includes(k));

const checkCondition = (raw, fields, ctx, rejected) => {
    if (!isPlainObject(raw)) { rejected.push('A condition in the draft is not an object.'); return null; }
    unknownKeys(raw, CONDITION_KEYS).forEach((k) => rejected.push(`A condition has a part the rule format does not: "${k}".`));
    const field = fields.find((f) => f.field === raw.field);
    if (!field) { rejected.push(`The draft used a condition field this trigger does not have: "${raw.field}".`); return null; }
    if (!field.ops.includes(raw.op)) { rejected.push(`${field.label} cannot be compared with "${raw.op}" (it allows ${field.ops.join(', ')}).`); return null; }
    if (UNARY_OPS.includes(raw.op)) return { op: raw.op, field: field.field };
    const kind = kindOf(field);
    if (kind === 'status') {
        const words = Array.isArray(raw.value) ? raw.value : [raw.value];
        if (!words.length || words.some((w) => typeof w !== 'string' || !w.trim())) { rejected.push(`${field.label} needs a status name.`); return null; }
        const clause = statusClause(raw.op, words.join(' or '), ctx.statusCatalogue());
        if (clause.error) { rejected.push(clause.error); return null; }
        return clause;
    }
    if (LIST_OPS.includes(raw.op)) {
        const list = Array.isArray(raw.value) ? raw.value : [raw.value];
        const values = list.map((v) => resolveOne(kind, v, field, ctx));
        const failed = values.filter((v) => v.error);
        if (failed.length || !values.length) { failed.forEach((v) => rejected.push(v.error)); return null; }
        return { op: raw.op, field: field.field, value: values.map((v) => v.value) };
    }
    const one = resolveOne(kind, raw.value, field, ctx);
    if (one.error) { rejected.push(one.error); return null; }
    return { op: raw.op, field: field.field, value: one.value };
};

const checkAction = (raw, index, entity, ctx, rejected) => {
    if (!isPlainObject(raw)) { rejected.push('An action in the draft is not an object.'); return null; }
    unknownKeys(raw, ACTION_KEYS).forEach((k) => rejected.push(`An action has a part the rule format does not: "${k}".`));
    const action = offeredActions().find((a) => a.key === raw.action);
    if (!action) { rejected.push(`The draft used an action this workspace does not have: "${raw.action}".`); return null; }
    if (!(action.appliesTo || []).includes(entity)) { rejected.push(`"${action.label}" cannot run on this trigger.`); return null; }
    const given = raw.config === undefined ? {} : raw.config;
    if (!isPlainObject(given)) { rejected.push(`"${action.label}" needs its settings as an object.`); return null; }
    const schema = action.schema || {};
    unknownKeys(given, Object.keys(schema)).forEach((k) => rejected.push(`"${action.label}" has no setting called "${k}".`));
    const config = {};
    let ok = true;
    Object.entries(schema).forEach(([field, spec]) => {
        const value = given[field];
        if (value === undefined || value === null || value === '') {
            if (spec.required) { rejected.push(`"${action.label}" needs ${spec.label}.`); ok = false; }
            return;
        }
        if (takesList(spec)) {
            const roles = Array.isArray(spec.roles) ? spec.roles : [];
            const items = (Array.isArray(value) ? value : [value])
                .map((v) => (roles.includes(v) ? { value: v } : resolveOne(kindOf(spec), v, spec, ctx)));
            items.filter((v) => v.error).forEach((v) => { rejected.push(v.error); ok = false; });
            config[field] = [...new Set(items.filter((v) => !v.error).map((v) => v.value))];
            return;
        }
        const one = resolveOne(kindOf(spec), value, spec, ctx);
        if (one.error) { rejected.push(one.error); ok = false; return; }
        config[field] = one.value;
    });
    return ok ? { id: `s${index + 1}`, type: 'action', action: action.key, config } : null;
};

const statusesOf = (projects) => {
    const seen = new Map();
    projects.forEach((p) => (p.statuses || []).forEach((name) => { if (!seen.has(lower(name))) seen.set(lower(name), name); }));
    return [...seen.values()];
};

/* The model's JSON → a v2 rule, or null with the reasons. Any part that is not
 * in the registry, or any reference outside `refs`, rejects the whole draft:
 * dropping a condition would quietly widen the rule. `refs` holds only what
 * the caller may use: { projects: [{ id, name, statuses }], people: [{ id, name, email }], taskTypes,
 * statusCatalogue } (statusCatalogue from statusConditions.catalogueOf, so a condition resolves a status to its keys). */
const checkDraft = (raw, refs) => {
    const rejected = [];
    if (!isPlainObject(raw)) return { rule: null, unmapped: [], rejected: ['The draft was not a rule.'] };
    unknownKeys(raw, TOP_KEYS).forEach((k) => rejected.push(`The draft has a part the rule format does not: "${k}".`));

    const unmapped = (Array.isArray(raw.unmapped) ? raw.unmapped : [])
        .filter(isPlainObject)
        .map((u) => ({ text: note(u.text), reason: note(u.reason) }))
        .filter((u) => u.text)
        .slice(0, MAX_UNMAPPED);

    let scopeProject = null;
    if (raw.project !== undefined && raw.project !== null && raw.project !== '') {
        scopeProject = typeof raw.project === 'string' ? findProject(refs, raw.project) : null;
        if (!scopeProject) rejected.push(`There is no project called "${String(raw.project)}" that you can use.`);
    }
    const ctx = {
        refs,
        statuses: () => statusesOf(scopeProject ? [scopeProject] : refs.projects),
        statusCatalogue: () => (refs.statusCatalogue || []).filter((s) => !scopeProject || s.projectId === String(scopeProject.id)),
    };

    const hasTrigger = raw.trigger !== undefined && raw.trigger !== null && raw.trigger !== '';
    const trigger = hasTrigger ? eventTriggers().find((t) => t.key === raw.trigger) : null;
    if (hasTrigger && !trigger) rejected.push(`There is no "${raw.trigger}" trigger.`);
    if (!hasTrigger && !unmapped.length) rejected.push('The draft does not say what starts the rule.');

    const conditionList = raw.conditions === undefined || raw.conditions === null ? [] : raw.conditions;
    const actionList = raw.actions === undefined || raw.actions === null ? [] : raw.actions;
    if (!Array.isArray(conditionList)) rejected.push('The draft\'s conditions are not a list.');
    if (!Array.isArray(actionList)) rejected.push('The draft\'s actions are not a list.');
    if (Array.isArray(conditionList) && conditionList.length > MAX_CONDITIONS) rejected.push(`A drafted rule may have at most ${MAX_CONDITIONS} conditions.`);
    if (Array.isArray(actionList) && actionList.length > MAX_STEPS) rejected.push(`A drafted rule may have at most ${MAX_STEPS} actions.`);
    if (Array.isArray(actionList) && !actionList.length && hasTrigger) rejected.push('The draft has no action.');

    if (!trigger || rejected.length) return { rule: null, unmapped, rejected };

    const fields = conditionFieldsFor(trigger.entity);
    const conditions = conditionList.map((c) => checkCondition(c, fields, ctx, rejected));
    const steps = actionList.map((a, i) => checkAction(a, i, trigger.actsOn || trigger.entity, ctx, rejected));
    if (rejected.length) return { rule: null, unmapped, rejected };

    const rule = {
        version: 2,
        trigger: { type: 'event', event: trigger.key },
        scope: scopeProject ? { allProjects: false, projectIds: [scopeProject.id] } : { allProjects: true, projectIds: [] },
        conditions: conditions.length === 1 ? conditions[0] : (conditions.length ? { op: 'and', args: conditions } : {}),
        steps,
    };
    const check = validateRuleV2(rule);
    if (!check.valid) return { rule: null, unmapped, rejected: check.errors };
    return { rule, unmapped, rejected: [] };
};

module.exports = { draftSchema, checkDraft, kindOf };
