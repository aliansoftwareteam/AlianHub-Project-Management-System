/* {{ }} substitution for action config — "Escalated: {{task.TaskName}}".
 *
 * Resolution goes through the same whitelisted reader the condition evaluator
 * uses, so a template cannot reach a field a condition could not. An unknown or
 * unreachable path renders as empty string rather than the literal {{...}}: a
 * comment reading "Assigned to " is a cosmetic bug, whereas one reading
 * "Assigned to {{task.secretField}}" tells the reader what to probe next.
 *
 * Pure. */

const { readField } = require('./expression');

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const MAX_RENDERED_LENGTH = 20000;

const stringify = (value) => {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join(', ');
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return '';
    return String(value);
};

const renderString = (input, ctx) => {
    if (typeof input !== 'string' || input.indexOf('{{') === -1) return input;
    const out = input.replace(PLACEHOLDER, (_match, path) => stringify(readField(String(path).trim(), ctx)));
    return out.length > MAX_RENDERED_LENGTH ? out.slice(0, MAX_RENDERED_LENGTH) : out;
};

/* Walk an action's config and render every string in it. Depth-capped because
 * config is tenant-authored JSON and a pathological nesting should cost us a
 * rejected rule, not a stack overflow. */
const render = (value, ctx = {}, depth = 0) => {
    if (depth > 8) return value;
    if (typeof value === 'string') return renderString(value, ctx);
    if (Array.isArray(value)) return value.map((v) => render(v, ctx, depth + 1));
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        const out = {};
        for (const key of Object.keys(value)) {
            // Never let a template author write a key that pollutes a prototype.
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
            out[key] = render(value[key], ctx, depth + 1);
        }
        return out;
    }
    return value;
};

/* The placeholders a string/config references — used by the builder UI to show
 * which fields a rule depends on, and to warn when one cannot resolve. */
const placeholdersIn = (value, found = new Set(), depth = 0) => {
    if (depth > 8) return found;
    if (typeof value === 'string') {
        let m;
        PLACEHOLDER.lastIndex = 0;
        while ((m = PLACEHOLDER.exec(value)) !== null) found.add(m[1].trim());
        return found;
    }
    if (Array.isArray(value)) { value.forEach((v) => placeholdersIn(v, found, depth + 1)); return found; }
    if (value !== null && typeof value === 'object') {
        Object.keys(value).forEach((k) => placeholdersIn(value[k], found, depth + 1));
    }
    return found;
};

module.exports = { render, renderString, placeholdersIn, MAX_RENDERED_LENGTH };
