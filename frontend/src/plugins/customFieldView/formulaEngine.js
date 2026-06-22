// Read-only compute engine for the "formula" and "rollup" custom field types.
//
// Dependency-free and SAFE: no eval / new Function. Formulas are parsed by a tiny
// tokenizer + recursive-descent evaluator over numbers, the operators + - * / %,
// parentheses, and {Field Title} references. Rollups aggregate one numeric field
// across a task's subtasks. Everything is computed client-side at display time from
// the live task store, so there is no backend write-path, no schema change on tasks,
// and the values stay live as the store updates over the socket.

export const ROLLUP_FUNCTIONS = ['sum', 'avg', 'count', 'min', 'max'];

// ---- tokenizer -------------------------------------------------------------
function tokenize(expr) {
    const s = String(expr == null ? '' : expr);
    const tokens = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
        if ((c >= '0' && c <= '9') || c === '.') {
            let j = i + 1;
            while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) j++;
            const num = parseFloat(s.slice(i, j));
            if (Number.isNaN(num)) return null;
            tokens.push({ type: 'num', value: num });
            i = j; continue;
        }
        if (c === '{') {
            const end = s.indexOf('}', i + 1);
            if (end === -1) return null;
            tokens.push({ type: 'ref', name: s.slice(i + 1, end).trim() });
            i = end + 1; continue;
        }
        if (c === '+' || c === '-' || c === '*' || c === '/' || c === '%') { tokens.push({ type: 'op', value: c }); i++; continue; }
        if (c === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
        if (c === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
        return null; // unknown character
    }
    return tokens;
}

// ---- recursive-descent evaluator (handles precedence + unary minus) --------
// Returns a finite Number, or null if the expression is malformed / a referenced
// value is missing or non-numeric / division by zero.
export function evaluateExpression(expr, vars) {
    const tokens = tokenize(expr);
    if (!tokens || !tokens.length) return null;
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    function parseExpr() {
        let left = parseTerm();
        if (left === null) return null;
        while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
            const op = next().value;
            const right = parseTerm();
            if (right === null) return null;
            left = op === '+' ? left + right : left - right;
        }
        return left;
    }
    function parseTerm() {
        let left = parseFactor();
        if (left === null) return null;
        while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
            const op = next().value;
            const right = parseFactor();
            if (right === null) return null;
            if ((op === '/' || op === '%') && right === 0) return null; // div by zero
            left = op === '*' ? left * right : op === '/' ? left / right : left % right;
        }
        return left;
    }
    function parseFactor() {
        const t = peek();
        if (!t) return null;
        if (t.type === 'op' && (t.value === '-' || t.value === '+')) {
            next();
            const f = parseFactor();
            if (f === null) return null;
            return t.value === '-' ? -f : f;
        }
        if (t.type === 'num') { next(); return t.value; }
        if (t.type === 'ref') {
            next();
            const v = vars ? vars[t.name] : undefined;
            const n = typeof v === 'number' ? v : parseFloat(v);
            if (v === undefined || v === null || v === '' || Number.isNaN(n)) return null;
            return n;
        }
        if (t.type === 'lparen') {
            next();
            const e = parseExpr();
            if (e === null) return null;
            if (!peek() || peek().type !== 'rparen') return null;
            next();
            return e;
        }
        return null;
    }

    const result = parseExpr();
    if (result === null || pos !== tokens.length || !Number.isFinite(result)) return null;
    return result;
}

// ---- value helpers ---------------------------------------------------------
function numericValue(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''));
    return Number.isNaN(n) ? null : n;
}

function roundNice(n) {
    if (!Number.isFinite(n)) return '';
    return Math.round(n * 1e6) / 1e6; // strip float artifacts like 0.30000000000000004
}

// task.customField is an object keyed by fieldId -> { fieldValue, fieldTitle, fieldType }.
// Build a { 'Field Title': value } map so a formula can reference sibling fields by name.
function buildVars(task, defs) {
    const vars = {};
    const cf = (task && task.customField) || {};
    const list = Array.isArray(defs) ? defs : [];
    Object.keys(cf).forEach((fid) => {
        const entry = cf[fid] || {};
        const title = entry.fieldTitle || (list.find((d) => String(d && d._id) === String(fid)) || {}).fieldTitle;
        if (title) {
            const n = numericValue(entry.fieldValue);
            vars[title] = n === null ? entry.fieldValue : n;
        }
    });
    return vars;
}

function subtasksOf(task, allTasks) {
    const id = String(task && task._id);
    if (!id) return [];
    return (Array.isArray(allTasks) ? allTasks : []).filter(
        (t) => t && String(t.ParentTaskId) === id && [0, 2, undefined, null].includes(t.deletedStatusKey)
    );
}

function computeFormula(fieldDef, task, defs) {
    const expr = fieldDef && fieldDef.formulaExpression;
    if (!expr) return '';
    const r = evaluateExpression(expr, buildVars(task, defs));
    return r === null ? '' : roundNice(r);
}

function computeRollup(fieldDef, task, allTasks) {
    const srcId = fieldDef && fieldDef.rollupSourceFieldId;
    const fn = (fieldDef && fieldDef.rollupFunction) || 'sum';
    const kids = subtasksOf(task, allTasks);
    if (fn === 'count') return kids.length;
    if (!srcId) return '';
    const values = [];
    kids.forEach((k) => {
        const entry = (k.customField || {})[srcId];
        const n = numericValue(entry && entry.fieldValue);
        if (n !== null) values.push(n);
    });
    if (!values.length) return fn === 'sum' ? 0 : '';
    if (fn === 'sum') return roundNice(values.reduce((a, b) => a + b, 0));
    if (fn === 'avg') return roundNice(values.reduce((a, b) => a + b, 0) / values.length);
    if (fn === 'min') return roundNice(Math.min(...values));
    if (fn === 'max') return roundNice(Math.max(...values));
    return '';
}

// Single entry point. Returns a display value (Number) or '' when not computable.
export function computeCustomFieldValue(fieldDef, task, allTasks, defs) {
    if (!fieldDef) return '';
    if (fieldDef.fieldType === 'formula') return computeFormula(fieldDef, task, defs);
    if (fieldDef.fieldType === 'rollup') return computeRollup(fieldDef, task, allTasks);
    return '';
}
