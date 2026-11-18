// Turns a task document plus its custom-field definitions into the plain scope
// the sandboxed evaluator works on, then resolves every formula and rollup field
// for that task. Pure — the controller does the loading and the writing.

'use strict';

const { evaluateFormula, aggregate, computeFormulaValues } = require('./formula');
const { fieldAppliesToTask } = require('./fieldTaskTypes');

const COMPUTED_TYPES = ['formula', 'rollup'];

const slug = (value) => String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, '_');

const numeric = (raw) => {
    if (raw === undefined || raw === null || raw === '') return null;
    const parsed = Number(typeof raw === 'string' ? raw.replace(/,/g, '').trim() : raw);
    return Number.isFinite(parsed) ? parsed : null;
};

const valueOf = (task, fieldId) => {
    const entry = ((task && task.customField) || {})[String(fieldId)];
    if (entry === undefined || entry === null) return undefined;
    return typeof entry === 'object' ? entry.fieldValue : entry;
};

// Every alias a formula may use for one field: its title and the snake_case slug
// of that title, so both {Billable rate} and {billable_rate} resolve.
const aliasesOf = (definition) => {
    const title = String((definition && definition.fieldTitle) || '').trim();
    const names = [];
    if (title) names.push(title);
    const key = slug(title);
    if (key && !names.includes(key)) names.push(key);
    return names;
};

function builtinScope(task, subtasks) {
    const estimate = numeric(task && task.totalEstimatedTime);
    const remaining = numeric(task && task.remainingHours);
    const scope = { subtask_count: (subtasks || []).length };
    if (estimate !== null) scope.estimate = estimate;
    if (remaining !== null) scope.remaining_hours = remaining;
    if (estimate !== null && remaining !== null) scope.logged_hours = Math.max(estimate - remaining, 0);
    const priority = numeric(task && task.Task_Priority);
    if (priority !== null) scope.priority = priority;
    return scope;
}

/* The rows under a task on every level, each once. ParentTaskId is followed rather than the
 * stored chain, so a row written before chains existed is found and a stale chain adds nothing. */
function descendantsOf(task, rows) {
    const byParent = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (!row || !row.ParentTaskId) return;
        const parent = String(row.ParentTaskId);
        byParent.set(parent, [...(byParent.get(parent) || []), row]);
    });
    const seen = new Set([String(task && task._id)]);
    const found = [];
    let level = [...seen];
    while (level.length) {
        const below = level.flatMap((id) => byParent.get(id) || []);
        level = [];
        below.forEach((row) => {
            const id = String(row._id);
            if (seen.has(id)) return;
            seen.add(id);
            found.push(row);
            level.push(id);
        });
    }
    return found;
}

/* definitions: the company's custom-field rows (customFields collection).
 * task: the task document being computed.
 * children: the tasks a rollup aggregates over (every level of subtasks, or the sprint's tasks).
 * subtasks: the rows `subtask_count` counts; the direct subtasks, where the caller tells them apart.
 * Returns { values: { [fieldId]: number|null }, errors: { [fieldId]: message } }. */
function computeTaskFields({ definitions, task, children, subtasks }) {
    const defs = (Array.isArray(definitions) ? definitions : []).filter((definition) => definition && definition._id);
    const kids = Array.isArray(children) ? children : [];

    const scope = builtinScope(task, Array.isArray(subtasks) ? subtasks : kids);
    defs.forEach((definition) => {
        if (COMPUTED_TYPES.includes(definition.fieldType)) return;
        const value = numeric(valueOf(task, definition._id));
        if (value === null) return;
        aliasesOf(definition).forEach((alias) => { scope[alias] = value; });
    });

    const values = {};
    const errors = {};

    defs.filter((definition) => definition.fieldType === 'rollup').forEach((definition) => {
        const sourceId = definition.rollupSourceFieldId;
        const source = sourceId ? defs.find((candidate) => String(candidate._id) === String(sourceId)) : null;
        const holders = source ? kids.filter((child) => fieldAppliesToTask(source, child)) : kids;
        const raw = sourceId ? holders.map((child) => valueOf(child, sourceId)).filter((entry) => entry !== undefined && entry !== null && entry !== '') : kids;
        const outcome = aggregate(definition.rollupFunction, raw);
        values[String(definition._id)] = outcome.value;
        if (outcome.value !== null) aliasesOf(definition).forEach((alias) => { scope[alias] = outcome.value; });
    });

    const formulas = defs.filter((definition) => definition.fieldType === 'formula' && definition.formulaExpression);
    const resolved = computeFormulaValues(
        formulas.map((definition) => ({ key: aliasesOf(definition)[0], expression: definition.formulaExpression })),
        scope
    );

    formulas.forEach((definition) => {
        const [primary] = aliasesOf(definition);
        const outcome = resolved[primary] || evaluateFormula(definition.formulaExpression, scope);
        const id = String(definition._id);
        if (outcome.ok) {
            values[id] = outcome.value;
            aliasesOf(definition).forEach((alias) => { scope[alias] = outcome.value; });
        } else {
            values[id] = null;
            errors[id] = outcome.error;
        }
    });

    return { values, errors };
}

/* Refuses a formula definition that cannot be saved: a broken expression, or one
 * that closes a cycle with the formulas already stored. */
function validateFormulaDefinition({ definitions, fieldId, fieldTitle, expression }) {
    const others = (Array.isArray(definitions) ? definitions : [])
        .filter((definition) => definition && definition.fieldType === 'formula' && String(definition._id) !== String(fieldId || ''));

    const candidateKey = slug(fieldTitle) || 'this_field';
    const fields = others
        .map((definition) => ({ key: slug(definition.fieldTitle), expression: definition.formulaExpression }))
        .filter((field) => field.key && field.expression)
        .concat([{ key: candidateKey, expression }]);

    const probeScope = Object.create(null);
    fields.forEach((field) => { probeScope[field.key] = 1; });

    const resolved = computeFormulaValues(fields, probeScope);
    const outcome = resolved[candidateKey];
    if (outcome && !outcome.ok && outcome.code === 'CIRCULAR') return { valid: false, reason: outcome.error, code: outcome.code };

    const syntax = evaluateFormula(expression, probeScope);
    if (!syntax.ok && ['SYNTAX', 'EMPTY', 'TOO_LONG', 'TOO_COMPLEX', 'UNSUPPORTED', 'UNKNOWN_FUNCTION', 'BAD_ARITY'].includes(syntax.code)) {
        return { valid: false, reason: syntax.error, code: syntax.code };
    }
    return { valid: true, reason: '', code: '' };
}

module.exports = { COMPUTED_TYPES, slug, numeric, aliasesOf, builtinScope, descendantsOf, computeTaskFields, validateFormulaDefinition };
