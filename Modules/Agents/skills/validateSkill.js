// Validation for a data skill. Returns a list of field-level errors, like the
// automation rule validator, so the editor can mark the offending slot; `value`
// is the normalised document that gets written, and only that.

const registry = require('../registry');
const modelPin = require('../../AICore/modelPin');
const { tagsIn, structureErrors } = require('./skillTemplate');
const { SKILL_VERSION, RISKS, INPUT_CATALOGUE, READER_CATALOGUE, PROMPT_PARTIALS, EMIT_ACTIONS, EMIT_REQUIRED, TASK_FIELDS, TEMPLATE_ROOTS, MAX_EMIT_EACH } = require('./catalogues');

const KEY = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 1000;
const MAX_TEMPLATE = 20000;
const MAX_STEPS = 10;
const MAX_EMIT = 10;
const MAX_TOKENS = { min: 200, max: 8000, default: 2500 };
const MAX_GROUNDED_FIELDS = 10;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const asString = (v) => (v === undefined || v === null ? '' : String(v)).trim();

const error = (field, code, message) => ({ field, code, message });

const riskRank = (r) => RISKS.indexOf(r);
const riskOf = (actions) => actions.reduce((worst, key) => { const a = registry.get(key); return a && riskRank(a.risk) > riskRank(worst) ? a.risk : worst; }, 'low');

/* A placeholder is `task.<field>`, a bare task field, or one of the template
 * roots; each root is checked against what the skill declared. */
const checkPlaceholder = (path, field, declared, roots, errors) => {
    const parts = path.split('.');
    const [root, second] = parts[0] === 'task' && parts.length > 1 ? parts.slice(1) : parts;
    if (root === TEMPLATE_ROOTS.memory) return;
    if (root === TEMPLATE_ROOTS.fallback) {
        if (!roots.includes(root)) errors.push(error(field, 'unknown_placeholder', `"{{${path}}}" is only available in emit mappings and the summary`));
        return;
    }
    if (root === TEMPLATE_ROOTS.input) {
        if (!second) errors.push(error(field, 'unknown_placeholder', `"{{${path}}}" names no input`));
        else if (!declared.inputs.has(second)) errors.push(error(field, 'undeclared_input', `"{{${path}}}" reads input "${second}", which the skill does not declare`));
        return;
    }
    if (root === TEMPLATE_ROOTS.gather) {
        if (!second) errors.push(error(field, 'unknown_placeholder', `"{{${path}}}" names no gathered value`));
        else if (!declared.gather.has(second)) errors.push(error(field, 'undeclared_reader', `"{{${path}}}" reads "${second}", which no gather step provides`));
        return;
    }
    if (root === TEMPLATE_ROOTS.emitted) {
        const action = parts.slice(parts.indexOf(root) + 1).join('.');
        if (!roots.includes(root)) errors.push(error(field, 'unknown_placeholder', `"{{${path}}}" is only available in emit mappings and the summary`));
        else if (!EMIT_ACTIONS.includes(action)) errors.push(error(field, 'unknown_action', `"{{${path}}}" counts no action a skill can emit`));
        return;
    }
    if (root === TEMPLATE_ROOTS.answer || root === TEMPLATE_ROOTS.item) {
        if (!roots.includes(root)) errors.push(error(field, 'unknown_placeholder', `"{{${path}}}" is only available in emit mappings${root === TEMPLATE_ROOTS.item ? ' with "each"' : ''}`));
        return;
    }
    const taskPath = parts[0] === 'task' ? parts.slice(1).join('.') : parts.join('.');
    if (!TASK_FIELDS.includes(taskPath)) errors.push(error(field, 'unknown_placeholder', `"{{${path}}}" is not a task field a skill may read (have: ${TASK_FIELDS.join(', ')})`));
};

const checkTemplate = (value, field, declared, roots, errors) => {
    structureErrors(value).forEach((e) => errors.push(error(field, e.code, e.message)));
    tagsIn(value).filter((tag) => tag.sigil !== '/' && tag.path).forEach((tag) => checkPlaceholder(tag.path, field, declared, roots, errors));
};

const validateInputs = (input, errors) => {
    const list = Array.isArray(input.inputs) ? input.inputs : [];
    if (input.inputs !== undefined && !Array.isArray(input.inputs)) errors.push(error('inputs', 'invalid', 'must be a list of input keys'));
    const keys = list.map(asString);
    keys.forEach((key, i) => { if (!INPUT_CATALOGUE[key]) errors.push(error(`inputs[${i}]`, 'unknown_input', `unknown input "${key}" (have: ${Object.keys(INPUT_CATALOGUE).join(', ')})`)); });
    if (new Set(keys).size !== keys.length) errors.push(error('inputs', 'duplicate', 'each input may be declared once'));
    return keys;
};

const validateReaderParams = (reader, given, at, errors) => {
    const spec = READER_CATALOGUE[reader].params;
    const params = isPlainObject(given) ? given : {};
    if (given !== undefined && !isPlainObject(given)) { errors.push(error(`${at}.params`, 'invalid', 'must be an object')); return {}; }
    const out = {};
    Object.entries(params).forEach(([name, value]) => {
        const rule = spec[name];
        if (!rule) { errors.push(error(`${at}.params.${name}`, 'invalid_params', `"${reader}" takes no "${name}" (have: ${Object.keys(spec).join(', ') || 'none'})`)); return; }
        if (rule.type === 'number' && !(typeof value === 'number' && Number.isFinite(value) && value >= rule.min && value <= rule.max)) {
            errors.push(error(`${at}.params.${name}`, 'invalid_params', `must be a number between ${rule.min} and ${rule.max}`)); return;
        }
        if (rule.type === 'boolean' && typeof value !== 'boolean') { errors.push(error(`${at}.params.${name}`, 'invalid_params', 'must be true or false')); return; }
        out[name] = value;
    });
    return out;
};

const validateGather = (input, errors) => {
    const steps = Array.isArray(input.gather) ? input.gather : [];
    if (input.gather !== undefined && !Array.isArray(input.gather)) errors.push(error('gather', 'invalid', 'must be a list of reader steps'));
    if (steps.length > MAX_STEPS) errors.push(error('gather', 'too_long', `at most ${MAX_STEPS} reader steps`));
    const out = [];
    steps.forEach((step, i) => {
        const at = `gather[${i}]`;
        if (!isPlainObject(step)) { errors.push(error(at, 'invalid', 'must be an object')); return; }
        const reader = asString(step.reader);
        if (!reader) { errors.push(error(`${at}.reader`, 'required', 'required')); return; }
        if (!READER_CATALOGUE[reader]) { errors.push(error(`${at}.reader`, 'unknown_reader', `unknown reader "${reader}" (have: ${Object.keys(READER_CATALOGUE).join(', ')})`)); return; }
        const as = asString(step.as) || reader;
        if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(as)) { errors.push(error(`${at}.as`, 'invalid', 'must be a short name: letters, digits and underscores')); return; }
        out.push({ reader, as, params: validateReaderParams(reader, step.params, at, errors) });
    });
    const names = out.map((s) => s.as);
    if (new Set(names).size !== names.length) errors.push(error('gather', 'duplicate', 'each gathered value needs its own name'));
    return out;
};

const validatePrompt = (input, declared, errors) => {
    const prompt = isPlainObject(input.prompt) ? input.prompt : {};
    if (input.prompt !== undefined && !isPlainObject(input.prompt)) errors.push(error('prompt', 'invalid', 'must be an object'));
    const partials = Array.isArray(prompt.partials) ? prompt.partials.map(asString) : [];
    if (prompt.partials !== undefined && !Array.isArray(prompt.partials)) errors.push(error('prompt.partials', 'invalid', 'must be a list of partial names'));
    partials.forEach((name, i) => { if (!PROMPT_PARTIALS[name]) errors.push(error(`prompt.partials[${i}]`, 'unknown_partial', `unknown partial "${name}" (have: ${Object.keys(PROMPT_PARTIALS).join(', ')})`)); });
    const instructions = asString(prompt.instructions);
    const template = asString(prompt.template);
    const output = asString(prompt.output);
    if (!template) errors.push(error('prompt.template', 'required', 'required: the message the model is asked'));
    if (!output) errors.push(error('prompt.output', 'required', 'required: the JSON shape the model must return'));
    [['prompt.instructions', instructions], ['prompt.template', template], ['prompt.output', output]].forEach(([field, text]) => {
        if (text.length > MAX_TEMPLATE) errors.push(error(field, 'too_long', `must be ${MAX_TEMPLATE} characters or fewer`));
    });
    checkTemplate(template, 'prompt.template', declared, [], errors);
    checkTemplate(instructions, 'prompt.instructions', declared, [], errors);
    let maxTokens = MAX_TOKENS.default;
    if (prompt.maxTokens !== undefined) {
        const n = Number(prompt.maxTokens);
        if (!(Number.isInteger(n) && n >= MAX_TOKENS.min && n <= MAX_TOKENS.max)) errors.push(error('prompt.maxTokens', 'invalid', `must be a whole number between ${MAX_TOKENS.min} and ${MAX_TOKENS.max}`));
        else maxTokens = n;
    }
    return { partials, instructions, template, output, maxTokens };
};

const validateEmit = (input, declared, errors) => {
    const list = Array.isArray(input.emit) ? input.emit : [];
    if (input.emit !== undefined && !Array.isArray(input.emit)) errors.push(error('emit', 'invalid', 'must be a list of action mappings'));
    if (!list.length) errors.push(error('emit', 'required', 'at least one emitted action is required'));
    if (list.length > MAX_EMIT) errors.push(error('emit', 'too_long', `at most ${MAX_EMIT} emitted actions`));
    const out = [];
    list.forEach((mapping, i) => {
        const at = `emit[${i}]`;
        if (!isPlainObject(mapping)) { errors.push(error(at, 'invalid', 'must be an object')); return; }
        const action = asString(mapping.action);
        if (!action) { errors.push(error(`${at}.action`, 'required', 'required')); return; }
        if (registry.isNever(action)) { errors.push(error(`${at}.action`, 'never_listed', `Agents cannot perform ${action} (never_listed)`)); return; }
        if (!registry.has(action)) { errors.push(error(`${at}.action`, 'unknown_action', `unknown action "${action}" (have: ${EMIT_ACTIONS.join(', ')})`)); return; }
        if (!EMIT_ACTIONS.includes(action)) { errors.push(error(`${at}.action`, 'not_a_write', `"${action}" reads; only a write can be emitted as a change`)); return; }
        const each = mapping.each === undefined ? null : asString(mapping.each);
        if (each !== null && !/^answer\.[a-zA-Z0-9_.]+$/.test(each)) errors.push(error(`${at}.each`, 'invalid', 'must be a path under "answer", e.g. answer.subtasks'));
        let max = each ? Math.min(MAX_EMIT_EACH, 10) : 1;
        if (mapping.max !== undefined) {
            const n = Number(mapping.max);
            if (!(Number.isInteger(n) && n >= 1 && n <= MAX_EMIT_EACH)) errors.push(error(`${at}.max`, 'invalid', `must be a whole number between 1 and ${MAX_EMIT_EACH}`));
            else max = n;
        }
        const params = isPlainObject(mapping.params) ? mapping.params : {};
        if (mapping.params !== undefined && !isPlainObject(mapping.params)) errors.push(error(`${at}.params`, 'invalid', 'must be an object'));
        const roots = each
            ? [TEMPLATE_ROOTS.answer, TEMPLATE_ROOTS.item, TEMPLATE_ROOTS.emitted, TEMPLATE_ROOTS.fallback]
            : [TEMPLATE_ROOTS.answer, TEMPLATE_ROOTS.emitted, TEMPLATE_ROOTS.fallback];
        (EMIT_REQUIRED[action] || []).forEach((name) => {
            if (params[name] === undefined || params[name] === null || params[name] === '') errors.push(error(`${at}.params.${name}`, 'required', `required by "${action}"`));
        });
        Object.entries(params).forEach(([name, value]) => checkTemplate(value, `${at}.params.${name}`, declared, roots, errors));
        const label = asString(mapping.label);
        if (label.length > 200) errors.push(error(`${at}.label`, 'too_long', 'must be 200 characters or fewer'));
        checkTemplate(label, `${at}.label`, declared, roots, errors);
        out.push({ action, ...(each ? { each, max } : {}), ...(label ? { label } : {}), params });
    });
    return out;
};

/* How the run's summary reads; without one the answer's own summary is used. */
const validateSummary = (input, declared, errors) => {
    if (input.summary !== undefined && input.summary !== null && typeof input.summary !== 'string') { errors.push(error('summary', 'invalid', 'must be a template string')); return ''; }
    const summary = asString(input.summary);
    if (summary.length > MAX_TEMPLATE) errors.push(error('summary', 'too_long', `must be ${MAX_TEMPLATE} characters or fewer`));
    checkTemplate(summary, 'summary', declared, [TEMPLATE_ROOTS.answer, TEMPLATE_ROOTS.emitted, TEMPLATE_ROOTS.fallback], errors);
    return summary;
};

/* What the run posts when the model answered nothing: rendered from gathered
 * data alone, so it may not read the answer, an item or a count of emitted
 * changes. Without one, a skill whose provider is down proposes nothing. */
const validateFallback = (input, declared, errors) => {
    if (input.fallback !== undefined && input.fallback !== null && typeof input.fallback !== 'string') { errors.push(error('fallback', 'invalid', 'must be a template string')); return ''; }
    const fallback = asString(input.fallback);
    if (fallback.length > MAX_TEMPLATE) errors.push(error('fallback', 'too_long', `must be ${MAX_TEMPLATE} characters or fewer`));
    checkTemplate(fallback, 'fallback', declared, [], errors);
    return fallback;
};

const gatherPath = (value, field, declared, errors) => {
    const path = asString(value);
    if (!path) return '';
    const parts = path.replace(/^task\./, '').split('.');
    if (parts[0] !== TEMPLATE_ROOTS.gather || !parts[1]) { errors.push(error(field, 'invalid', 'must name a gathered value, as "gather.<step>.<field>"')); return ''; }
    if (!declared.gather.has(parts[1])) errors.push(error(field, 'undeclared_reader', `reads "${parts[1]}", which no gather step provides`));
    return path;
};

const answerFields = (value, field, errors) => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) { errors.push(error(field, 'invalid', 'must be a list of answer field names')); return []; }
    if (value.length > MAX_GROUNDED_FIELDS) errors.push(error(field, 'too_many', `at most ${MAX_GROUNDED_FIELDS}`));
    return value.slice(0, MAX_GROUNDED_FIELDS).map(asString).filter(Boolean);
};

/* The ground-truth gate: which gathered values hold the task keys and the
 * counts the answer is allowed to name, and which answer fields to hold to them. */
const validateGrounded = (input, declared, errors) => {
    if (input.grounded === undefined || input.grounded === null) return null;
    if (!isPlainObject(input.grounded)) { errors.push(error('grounded', 'invalid', 'must be an object')); return null; }
    const spec = input.grounded;
    const keys = gatherPath(spec.keys, 'grounded.keys', declared, errors);
    const numbers = gatherPath(spec.numbers, 'grounded.numbers', declared, errors);
    const fields = answerFields(spec.fields, 'grounded.fields', errors);
    const mustNameKey = answerFields(spec.mustNameKey, 'grounded.mustNameKey', errors);
    if (!fields.length && !mustNameKey.length) errors.push(error('grounded.fields', 'required', 'name at least one answer field to hold to the data'));
    if (!keys && !numbers) errors.push(error('grounded.keys', 'required', 'name the gathered keys or counts the answer is checked against'));
    let allowHours = [];
    if (spec.allowHours !== undefined) {
        if (!Array.isArray(spec.allowHours) || spec.allowHours.some((n) => !Number.isInteger(Number(n)) || Number(n) < 1)) errors.push(error('grounded.allowHours', 'invalid', 'must be a list of whole hour windows the skill itself names'));
        else allowHours = spec.allowHours.slice(0, MAX_GROUNDED_FIELDS).map(Number);
    }
    return { ...(keys ? { keys } : {}), ...(numbers ? { numbers } : {}), fields, mustNameKey, allowHours };
};

const validateSkill = (input = {}) => {
    const errors = [];
    const doc = isPlainObject(input) ? input : {};

    const key = asString(doc.key).toLowerCase();
    if (!key) errors.push(error('key', 'required', 'required'));
    else if (!KEY.test(key)) errors.push(error('key', 'invalid', 'lowercase letters, digits, dots, dashes and underscores; 2 to 80 characters'));

    const name = asString(doc.name);
    if (!name) errors.push(error('name', 'required', 'required'));
    if (name.length > MAX_NAME) errors.push(error('name', 'too_long', `must be ${MAX_NAME} characters or fewer`));

    const description = asString(doc.description);
    if (description.length > MAX_DESCRIPTION) errors.push(error('description', 'too_long', `must be ${MAX_DESCRIPTION} characters or fewer`));

    if (doc.enabled !== undefined && typeof doc.enabled !== 'boolean') errors.push(error('enabled', 'invalid', 'must be true or false'));

    const inputs = validateInputs(doc, errors);
    const gather = validateGather(doc, errors);
    const declared = { inputs: new Set(inputs), gather: new Set(gather.map((s) => s.as)) };
    const prompt = validatePrompt(doc, declared, errors);
    const emit = validateEmit(doc, declared, errors);
    const summary = validateSummary(doc, declared, errors);
    const fallback = validateFallback(doc, declared, errors);
    const grounded = validateGrounded(doc, declared, errors);

    if (doc.risk !== undefined && !RISKS.includes(doc.risk)) errors.push(error('risk', 'invalid', `must be one of ${RISKS.join(', ')}`));

    const pin = modelPin.validatePin(doc.model);
    if (!pin.ok) errors.push(error('model', pin.code, pin.message));

    if (errors.length) return { ok: false, errors, value: null };

    const emits = [...new Set(emit.map((m) => m.action))];
    const computed = riskOf(emits);
    return {
        ok: true,
        errors: [],
        value: {
            key, name, description,
            version: SKILL_VERSION,
            enabled: doc.enabled !== false,
            inputs, gather, prompt, emit, emits,
            ...(summary ? { summary } : {}),
            ...(fallback ? { fallback } : {}),
            ...(grounded ? { grounded } : {}),
            model: pin.model,
            risk: doc.risk && riskRank(doc.risk) > riskRank(computed) ? doc.risk : computed,
        },
    };
};

module.exports = { validateSkill, riskOf, KEY };
