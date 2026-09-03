/* Condition evaluation for automation rules.
 *
 * Conditions are a JSON AST, never a string. This is a multi-tenant system: any
 * path where a tenant-authored string reaches eval(), new Function() or vm is
 * remote code execution on the server, and "we only allow simple expressions"
 * has never once held. The operator table below is the entire vocabulary — a
 * rule cannot express anything that is not in it.
 *
 * Pure. No IO, no requires beyond this file. */

const MAX_DEPTH = 10;

/* Field reads are whitelisted by prefix, not by a generic property walk, so a
 * condition cannot reach into __proto__, constructor, or fields we never meant
 * to expose. `$sN.x` reads a previous step's output. */
const FIELD_ROOTS = Object.freeze(['task', 'previous', 'actor', 'scope', 'entity', 'changedFields']);
const STEP_REF = /^\$s[0-9a-zA-Z_-]+$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* Resolve a dotted path against the evaluation context. A bare field name with no
 * root (`statusType`) is shorthand for `task.statusType`, which is what rule
 * authors write in practice. */
const readField = (path, ctx) => {
    if (typeof path !== 'string' || !path) return undefined;
    const parts = path.split('.');
    let root = parts[0];
    let rest = parts.slice(1);

    if (STEP_REF.test(root)) {
        const stepOutputs = ctx.steps || {};
        let value = stepOutputs[root.slice(1)];
        for (const key of rest) {
            if (!isPlainObject(value) && !Array.isArray(value)) return undefined;
            if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
            value = value[key];
        }
        return value;
    }

    if (!FIELD_ROOTS.includes(root)) {
        rest = parts;
        root = 'task';
    }

    let value = ctx[root];
    for (const key of rest) {
        if (!isPlainObject(value) && !Array.isArray(value)) return undefined;
        if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
        value = value[key];
    }
    return value;
};

const asArray = (v) => (Array.isArray(v) ? v : [v]);
const norm = (v) => (v === null || v === undefined ? v : String(v));
const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/* Every operator a condition may use. Adding one here is the only way to extend
 * the language — which is the point. */
const OPERATORS = Object.freeze({
    eq: (actual, expected) => norm(actual) === norm(expected),
    neq: (actual, expected) => norm(actual) !== norm(expected),
    in: (actual, expected) => asArray(expected).map(norm).includes(norm(actual)),
    notIn: (actual, expected) => !asArray(expected).map(norm).includes(norm(actual)),
    contains: (actual, expected) => {
        if (Array.isArray(actual)) return actual.map(norm).includes(norm(expected));
        return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    },
    empty: (actual) => isEmpty(actual),
    notEmpty: (actual) => !isEmpty(actual),
    gt: (actual, expected) => Number(actual) > Number(expected),
    gte: (actual, expected) => Number(actual) >= Number(expected),
    lt: (actual, expected) => Number(actual) < Number(expected),
    lte: (actual, expected) => Number(actual) <= Number(expected),
});

const COMPARISON_OPS = Object.freeze(Object.keys(OPERATORS));
const LOGICAL_OPS = Object.freeze(['and', 'or', 'not']);
/* Change-aware operators. These are the reason the envelope carries `previous`
 * and `changedFields` at all — without them a rule cannot say "when status
 * changed TO done" as opposed to "when status IS done", and the difference is
 * every-save versus once. */
const CHANGE_OPS = Object.freeze(['changed', 'changedTo', 'changedFrom']);

const ALL_OPS = Object.freeze([...LOGICAL_OPS, ...COMPARISON_OPS, ...CHANGE_OPS]);

const changedFieldsOf = (ctx) => {
    const list = ctx.changedFields;
    return new Set(Array.isArray(list) ? list.map(String) : []);
};

function evaluateNode(node, ctx, depth) {
    if (depth > MAX_DEPTH) return false;
    if (!isPlainObject(node)) return false;

    const op = node.op;

    // A malformed and/or must NOT match. `[].every()` is true, so treating a
    // missing args list as an empty one would make a broken rule fire on every
    // single event — the loudest possible failure mode for the safest-looking bug.
    if (op === 'and') return Array.isArray(node.args) && node.args.length > 0 && node.args.every((a) => evaluateNode(a, ctx, depth + 1));
    if (op === 'or') return Array.isArray(node.args) && node.args.some((a) => evaluateNode(a, ctx, depth + 1));
    if (op === 'not') return !evaluateNode(node.args?.[0] ?? node.arg, ctx, depth + 1);

    if (CHANGE_OPS.includes(op)) {
        const changed = changedFieldsOf(ctx);
        const field = String(node.field || '');
        const rootField = field.split('.')[0];
        if (!changed.has(rootField)) return false;
        if (op === 'changed') return true;
        if (op === 'changedTo') return norm(readField(field, ctx)) === norm(node.value);
        // changedFrom: `previous` is a snapshot of the task, so read the bare field off it.
        return norm(readField(`previous.${field}`, ctx)) === norm(node.value);
    }

    if (COMPARISON_OPS.includes(op)) {
        return !!OPERATORS[op](readField(node.field, ctx), node.value);
    }

    return false;
}

/* An empty / absent condition tree matches everything — "no conditions" is a
 * valid rule meaning "every event of this type". */
const evaluate = (node, ctx = {}) => {
    if (node === null || node === undefined) return true;
    if (isPlainObject(node) && !node.op) return true;
    return evaluateNode(node, ctx, 0);
};

/* Structural validation, returned as a list so the API can surface field-level
 * errors instead of a single opaque "invalid rule". */
const validate = (node, path = 'conditions') => {
    const errors = [];
    if (node === null || node === undefined) return errors;
    if (!isPlainObject(node)) {
        errors.push(`${path}: must be an object`);
        return errors;
    }
    if (!node.op) return errors;
    if (!ALL_OPS.includes(node.op)) {
        errors.push(`${path}.op: unknown operator "${node.op}"`);
        return errors;
    }
    if (LOGICAL_OPS.includes(node.op)) {
        const args = node.op === 'not' ? [node.args?.[0] ?? node.arg] : node.args;
        if (!Array.isArray(args) && node.op !== 'not') {
            errors.push(`${path}.args: "${node.op}" requires an array`);
            return errors;
        }
        (Array.isArray(args) ? args : [args]).forEach((child, i) => {
            errors.push(...validate(child, `${path}.args[${i}]`));
        });
        return errors;
    }
    if (!node.field || typeof node.field !== 'string') {
        errors.push(`${path}.field: required for "${node.op}"`);
    }
    if (['empty', 'notEmpty', 'changed'].includes(node.op) === false
        && !Object.prototype.hasOwnProperty.call(node, 'value')) {
        errors.push(`${path}.value: required for "${node.op}"`);
    }
    return errors;
};

/* Which event types a condition tree depends on having a diff for. Lets the
 * matcher reject a rule that asks "changedTo" on a trigger that never carries
 * changed fields, at save time rather than at 3am. */
const usesChangeOps = (node) => {
    if (!isPlainObject(node) || !node.op) return false;
    if (CHANGE_OPS.includes(node.op)) return true;
    const args = Array.isArray(node.args) ? node.args : [];
    return args.some(usesChangeOps);
};

module.exports = { evaluate, validate, readField, usesChangeOps, OPERATORS, ALL_OPS, LOGICAL_OPS, COMPARISON_OPS, CHANGE_OPS, FIELD_ROOTS, MAX_DEPTH };
