// Sandboxed evaluator for the `formula` and `rollup` custom field types.
//
// The expression text is authored by workspace admins and therefore untrusted:
// nothing here reaches `eval`, `new Function`, `vm`, or any property lookup on a
// host object. The only things an expression can name are numeric literals,
// {field references} resolved against a caller-supplied plain scope, and the
// seven whitelisted functions below. Anything else fails to tokenise.

'use strict';

const MAX_EXPRESSION_LENGTH = 1000;
const MAX_NODES = 400;

const FUNCTIONS = ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'ROUND', 'IF'];
const ROLLUP_FUNCTIONS = ['sum', 'avg', 'count', 'min', 'max'];

const ERROR = {
    EMPTY: 'EMPTY',
    TOO_LONG: 'TOO_LONG',
    TOO_COMPLEX: 'TOO_COMPLEX',
    SYNTAX: 'SYNTAX',
    UNSUPPORTED: 'UNSUPPORTED',
    UNKNOWN_FUNCTION: 'UNKNOWN_FUNCTION',
    UNKNOWN_FIELD: 'UNKNOWN_FIELD',
    BAD_ARITY: 'BAD_ARITY',
    DIVIDE_BY_ZERO: 'DIVIDE_BY_ZERO',
    NOT_A_NUMBER: 'NOT_A_NUMBER',
    CIRCULAR: 'CIRCULAR'
};

class FormulaError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FormulaError';
        this.code = code;
    }
}

const isDigit = (c) => c >= '0' && c <= '9';
const isLetter = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';

function tokenize(source) {
    const text = String(source == null ? '' : source);
    if (!text.trim()) throw new FormulaError(ERROR.EMPTY, 'The formula is empty.');
    if (text.length > MAX_EXPRESSION_LENGTH) {
        throw new FormulaError(ERROR.TOO_LONG, `A formula may not be longer than ${MAX_EXPRESSION_LENGTH} characters.`);
    }

    const tokens = [];
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i += 1; continue; }

        if (isDigit(c) || (c === '.' && isDigit(text[i + 1]))) {
            let j = i;
            let dots = 0;
            while (j < text.length && (isDigit(text[j]) || text[j] === '.')) {
                if (text[j] === '.') dots += 1;
                if (dots > 1) throw new FormulaError(ERROR.SYNTAX, `Malformed number at position ${i + 1}.`);
                j += 1;
            }
            tokens.push({ type: 'number', value: Number(text.slice(i, j)), at: i });
            i = j;
            continue;
        }

        if (c === '{') {
            const end = text.indexOf('}', i + 1);
            if (end === -1) throw new FormulaError(ERROR.SYNTAX, 'A field reference is missing its closing brace.');
            const name = text.slice(i + 1, end).trim();
            if (!name || name.indexOf('{') !== -1) {
                throw new FormulaError(ERROR.SYNTAX, 'A field reference must name a field, like {estimate}.');
            }
            tokens.push({ type: 'ref', name, at: i });
            i = end + 1;
            continue;
        }

        if (isLetter(c)) {
            let j = i;
            while (j < text.length && (isLetter(text[j]) || isDigit(text[j]))) j += 1;
            const word = text.slice(i, j);
            if (!FUNCTIONS.includes(word.toUpperCase())) {
                throw new FormulaError(ERROR.UNKNOWN_FUNCTION, `"${word}" is not one of ${FUNCTIONS.join(', ')}.`);
            }
            tokens.push({ type: 'func', name: word.toUpperCase(), at: i });
            i = j;
            continue;
        }

        const two = text.slice(i, i + 2);
        if (two === '>=' || two === '<=' || two === '!=' || two === '==' || two === '<>') {
            tokens.push({ type: 'compare', value: two === '<>' ? '!=' : two === '==' ? '=' : two, at: i });
            i += 2;
            continue;
        }
        if (c === '>' || c === '<' || c === '=') { tokens.push({ type: 'compare', value: c, at: i }); i += 1; continue; }
        if (c === '+' || c === '-' || c === '*' || c === '/') { tokens.push({ type: 'op', value: c, at: i }); i += 1; continue; }
        if (c === '(') { tokens.push({ type: 'lparen', at: i }); i += 1; continue; }
        if (c === ')') { tokens.push({ type: 'rparen', at: i }); i += 1; continue; }
        if (c === ',') { tokens.push({ type: 'comma', at: i }); i += 1; continue; }

        throw new FormulaError(ERROR.UNSUPPORTED, `"${c}" is not allowed in a formula.`);
    }
    return tokens;
}

function parse(tokens) {
    let pos = 0;
    let nodes = 0;

    const peek = () => tokens[pos];
    const take = () => tokens[pos++];
    const count = () => {
        nodes += 1;
        if (nodes > MAX_NODES) throw new FormulaError(ERROR.TOO_COMPLEX, 'This formula has too many parts.');
    };

    function parseComparison() {
        const left = parseAdditive();
        const t = peek();
        if (t && t.type === 'compare') {
            take();
            count();
            return { kind: 'compare', op: t.value, left, right: parseAdditive() };
        }
        return left;
    }

    function parseAdditive() {
        let left = parseMultiplicative();
        while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
            const op = take().value;
            count();
            left = { kind: 'binary', op, left, right: parseMultiplicative() };
        }
        return left;
    }

    function parseMultiplicative() {
        let left = parseUnary();
        while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
            const op = take().value;
            count();
            left = { kind: 'binary', op, left, right: parseUnary() };
        }
        return left;
    }

    function parseUnary() {
        const t = peek();
        if (t && t.type === 'op' && (t.value === '-' || t.value === '+')) {
            take();
            count();
            return { kind: 'unary', op: t.value, operand: parseUnary() };
        }
        return parsePrimary();
    }

    function parsePrimary() {
        const t = take();
        if (!t) throw new FormulaError(ERROR.SYNTAX, 'The formula ends unexpectedly.');
        count();
        if (t.type === 'number') return { kind: 'number', value: t.value };
        if (t.type === 'ref') return { kind: 'ref', name: t.name };
        if (t.type === 'lparen') {
            const inner = parseComparison();
            const close = take();
            if (!close || close.type !== 'rparen') throw new FormulaError(ERROR.SYNTAX, 'A bracket is not closed.');
            return inner;
        }
        if (t.type === 'func') {
            const open = take();
            if (!open || open.type !== 'lparen') throw new FormulaError(ERROR.SYNTAX, `${t.name} must be followed by a bracket.`);
            const args = [];
            if (peek() && peek().type === 'rparen') {
                take();
            } else {
                for (;;) {
                    args.push(parseComparison());
                    const nextToken = take();
                    if (!nextToken) throw new FormulaError(ERROR.SYNTAX, `${t.name} is missing its closing bracket.`);
                    if (nextToken.type === 'rparen') break;
                    if (nextToken.type !== 'comma') throw new FormulaError(ERROR.SYNTAX, `${t.name} arguments must be separated by commas.`);
                }
            }
            return { kind: 'call', name: t.name, args };
        }
        throw new FormulaError(ERROR.SYNTAX, 'The formula is malformed.');
    }

    const ast = parseComparison();
    if (pos !== tokens.length) throw new FormulaError(ERROR.SYNTAX, 'The formula has trailing characters.');
    return ast;
}

function parseExpression(source) {
    return parse(tokenize(source));
}

function walk(node, visit) {
    if (!node) return;
    visit(node);
    if (node.kind === 'binary' || node.kind === 'compare') { walk(node.left, visit); walk(node.right, visit); }
    else if (node.kind === 'unary') walk(node.operand, visit);
    else if (node.kind === 'call') node.args.forEach((arg) => walk(arg, visit));
}

// Names referenced by an expression, in first-seen order. Throws on a malformed
// expression, so callers that only want the names should guard with try/catch.
function extractReferences(source) {
    const names = [];
    walk(parseExpression(source), (node) => {
        if (node.kind === 'ref' && !names.includes(node.name)) names.push(node.name);
    });
    return names;
}

function toNumber(raw, label) {
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) throw new FormulaError(ERROR.NOT_A_NUMBER, `${label} is not a number.`);
        return raw;
    }
    if (typeof raw === 'boolean') return raw ? 1 : 0;
    const parsed = Number(String(raw).replace(/,/g, '').trim());
    if (!Number.isFinite(parsed)) throw new FormulaError(ERROR.NOT_A_NUMBER, `${label} is not a number.`);
    return parsed;
}

function flatten(values) {
    const out = [];
    values.forEach((value) => {
        if (Array.isArray(value)) value.forEach((entry) => out.push(entry));
        else out.push(value);
    });
    return out;
}

function round(value, digits) {
    const places = Math.min(Math.max(Math.trunc(digits), 0), 10);
    const factor = 10 ** places;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

// A scope value may be a scalar or an array (a rollup source across subtasks);
// arrays stay boxed until an aggregate function flattens them.
function resolve(name, scope) {
    const has = scope && Object.prototype.hasOwnProperty.call(scope, name);
    const raw = has ? scope[name] : undefined;
    if (!has || raw === undefined || raw === null || raw === '') {
        throw new FormulaError(ERROR.UNKNOWN_FIELD, `{${name}} has no value on this task.`);
    }
    if (Array.isArray(raw)) return raw.map((entry) => toNumber(entry, `{${name}}`));
    return toNumber(raw, `{${name}}`);
}

function evaluateNode(node, scope) {
    switch (node.kind) {
    case 'number':
        return node.value;
    case 'ref':
        return resolve(node.name, scope);
    case 'unary': {
        const operand = scalar(evaluateNode(node.operand, scope));
        return node.op === '-' ? -operand : operand;
    }
    case 'binary': {
        const left = scalar(evaluateNode(node.left, scope));
        const right = scalar(evaluateNode(node.right, scope));
        if (node.op === '+') return left + right;
        if (node.op === '-') return left - right;
        if (node.op === '*') return left * right;
        if (right === 0) throw new FormulaError(ERROR.DIVIDE_BY_ZERO, 'This formula divides by zero.');
        return left / right;
    }
    case 'compare': {
        const left = scalar(evaluateNode(node.left, scope));
        const right = scalar(evaluateNode(node.right, scope));
        if (node.op === '>') return left > right ? 1 : 0;
        if (node.op === '<') return left < right ? 1 : 0;
        if (node.op === '>=') return left >= right ? 1 : 0;
        if (node.op === '<=') return left <= right ? 1 : 0;
        if (node.op === '=') return left === right ? 1 : 0;
        return left !== right ? 1 : 0;
    }
    case 'call':
        return evaluateCall(node, scope);
    default:
        throw new FormulaError(ERROR.SYNTAX, 'The formula is malformed.');
    }
}

function scalar(value) {
    if (!Array.isArray(value)) return value;
    if (value.length === 1) return value[0];
    throw new FormulaError(ERROR.NOT_A_NUMBER, 'A list of values needs SUM, AVG, MIN, MAX or COUNT around it.');
}

function evaluateCall(node, scope) {
    const { name, args } = node;

    if (name === 'IF') {
        if (args.length !== 3) throw new FormulaError(ERROR.BAD_ARITY, 'IF takes a condition and two results.');
        const condition = scalar(evaluateNode(args[0], scope));
        return scalar(evaluateNode(condition !== 0 ? args[1] : args[2], scope));
    }
    if (name === 'ROUND') {
        if (args.length < 1 || args.length > 2) throw new FormulaError(ERROR.BAD_ARITY, 'ROUND takes a number and an optional number of decimals.');
        const value = scalar(evaluateNode(args[0], scope));
        const digits = args.length === 2 ? scalar(evaluateNode(args[1], scope)) : 0;
        return round(value, digits);
    }

    if (!args.length) throw new FormulaError(ERROR.BAD_ARITY, `${name} needs at least one value.`);
    const values = flatten(args.map((arg) => evaluateNode(arg, scope)));
    if (name === 'COUNT') return values.length;
    if (!values.length) throw new FormulaError(ERROR.NOT_A_NUMBER, `${name} has nothing to work on.`);
    if (name === 'SUM') return values.reduce((total, value) => total + value, 0);
    if (name === 'AVG') return values.reduce((total, value) => total + value, 0) / values.length;
    if (name === 'MIN') return Math.min(...values);
    return Math.max(...values);
}

// Never throws. `{ ok: true, value }` or `{ ok: false, code, error }`.
function evaluateFormula(expression, scope) {
    try {
        const value = scalar(evaluateNode(parseExpression(expression), scope || {}));
        if (!Number.isFinite(value)) throw new FormulaError(ERROR.NOT_A_NUMBER, 'The result is not a number.');
        return { ok: true, value: round(value, 6) };
    } catch (error) {
        if (error instanceof FormulaError) return { ok: false, code: error.code, error: error.message };
        return { ok: false, code: ERROR.SYNTAX, error: error.message };
    }
}

function aggregate(fn, rawValues) {
    const values = (Array.isArray(rawValues) ? rawValues : [])
        .map((raw) => Number(typeof raw === 'string' ? raw.replace(/,/g, '').trim() : raw))
        .filter((value) => Number.isFinite(value));
    const name = ROLLUP_FUNCTIONS.includes(fn) ? fn : 'sum';
    if (name === 'count') return { ok: true, value: Array.isArray(rawValues) ? rawValues.length : 0 };
    if (!values.length) return { ok: true, value: name === 'sum' ? 0 : null };
    if (name === 'sum') return { ok: true, value: round(values.reduce((total, value) => total + value, 0), 6) };
    if (name === 'avg') return { ok: true, value: round(values.reduce((total, value) => total + value, 0) / values.length, 6) };
    if (name === 'min') return { ok: true, value: round(Math.min(...values), 6) };
    return { ok: true, value: round(Math.max(...values), 6) };
}

// Resolves every formula field in dependency order over a scope of plain values.
// `fields` are `{ key, expression }`; a key that two formulas reach through each
// other is reported as CIRCULAR rather than evaluated.
function computeFormulaValues(fields, baseScope) {
    const defs = (Array.isArray(fields) ? fields : []).filter((field) => field && field.key);
    const byKey = new Map(defs.map((field) => [String(field.key), field]));
    const scope = Object.assign(Object.create(null), baseScope || {});
    const results = {};
    const state = new Map();

    const dependenciesOf = (field) => {
        try {
            return extractReferences(field.expression);
        } catch (error) {
            return [];
        }
    };

    function settle(key, trail) {
        if (state.get(key) === 'done') return;
        if (state.get(key) === 'busy') {
            trail.forEach((name) => {
                results[name] = { ok: false, code: ERROR.CIRCULAR, error: `{${name}} and {${key}} depend on each other.` };
                state.set(name, 'done');
            });
            return;
        }
        state.set(key, 'busy');
        const field = byKey.get(key);
        dependenciesOf(field).forEach((dependency) => {
            if (byKey.has(dependency)) settle(dependency, trail.concat(key));
        });
        if (state.get(key) === 'done') return;
        const outcome = evaluateFormula(field.expression, scope);
        results[key] = outcome;
        if (outcome.ok) scope[key] = outcome.value;
        state.set(key, 'done');
    }

    byKey.forEach((_field, key) => settle(key, []));
    return results;
}

module.exports = {
    ERROR,
    FUNCTIONS,
    ROLLUP_FUNCTIONS,
    MAX_EXPRESSION_LENGTH,
    FormulaError,
    tokenize,
    parseExpression,
    extractReferences,
    evaluateFormula,
    aggregate,
    computeFormulaValues
};
