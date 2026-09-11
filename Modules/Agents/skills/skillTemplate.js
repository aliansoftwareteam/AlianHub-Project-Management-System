// The template language of a data skill: the Automations placeholder reader,
// plus catalogue filters ({{item.hours | int:1:40}}) and sections that render
// only when a value is present ({{#item.why}}…{{/item.why}}, {{^x}}…{{/x}}).
// Parsed once into tokens and evaluated in a single pass, so a value the model
// returned is never itself read as a template.

const { readField } = require('../../Automations/engine/expression');
const { FILTERS, text } = require('./catalogues');

const TAG = /\{\{\s*([^{}]+?)\s*\}\}/g;
const NUMBER = /^-?\d+(\.\d+)?$/;
const MAX_RENDERED_LENGTH = 20000;
const MAX_DEPTH = 8;

const parseFilter = (raw) => {
    const [name, ...args] = raw.split(':').map((s) => s.trim());
    return { name, args, raw };
};

const parseTag = (inner) => {
    const sigil = /^[#^/]/.test(inner) ? inner[0] : '';
    const [path, ...filters] = inner.slice(sigil.length).split('|').map((s) => s.trim());
    return { sigil, path, filters: filters.map(parseFilter), raw: inner };
};

const tokenize = (input) => {
    const tokens = [];
    let last = 0;
    TAG.lastIndex = 0;
    let m;
    while ((m = TAG.exec(input)) !== null) {
        if (m.index > last) tokens.push({ text: input.slice(last, m.index) });
        tokens.push({ tag: parseTag(m[1]) });
        last = TAG.lastIndex;
    }
    if (last < input.length) tokens.push({ text: input.slice(last) });
    return tokens;
};

/* A close tag without an open one is dropped and an unclosed section runs to
 * the end; the validator refuses both, this only keeps rendering total. */
const treeOf = (tokens) => {
    const root = { children: [] };
    const stack = [root];
    tokens.forEach((token) => {
        const top = stack[stack.length - 1];
        const tag = token.tag;
        if (!tag || !tag.sigil) { top.children.push(token); return; }
        if (tag.sigil === '/') {
            if (stack.length > 1 && top.tag.path === tag.path) stack.pop();
            return;
        }
        const section = { tag, children: [] };
        top.children.push(section);
        stack.push(section);
    });
    return root;
};

const applyFilters = (value, filters) => filters.reduce((v, f) => {
    const filter = FILTERS[f.name];
    return filter ? filter.apply(v, ...f.args.map(Number)) : v;
}, value);

const present = (value) => (Array.isArray(value) ? value.some(Boolean) : Boolean(value));

const evaluate = (node, ctx) => node.children.map((child) => {
    if (child.text !== undefined) return child.text;
    const value = applyFilters(readField(child.tag.path, ctx), child.tag.filters);
    if (!child.tag.sigil) return text(value);
    const shown = child.tag.sigil === '#' ? present(value) : !present(value);
    return shown ? evaluate(child, ctx) : '';
}).join('');

const renderString = (input, ctx) => {
    if (typeof input !== 'string' || input.indexOf('{{') === -1) return input;
    const out = evaluate(treeOf(tokenize(input)), ctx);
    return out.length > MAX_RENDERED_LENGTH ? out.slice(0, MAX_RENDERED_LENGTH) : out;
};

const render = (value, ctx = {}, depth = 0) => {
    if (depth > MAX_DEPTH) return value;
    if (typeof value === 'string') return renderString(value, ctx);
    if (Array.isArray(value)) return value.map((v) => render(v, ctx, depth + 1));
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        const out = {};
        Object.keys(value).forEach((key) => {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
            out[key] = render(value[key], ctx, depth + 1);
        });
        return out;
    }
    return value;
};

const tagsIn = (value, found = [], depth = 0) => {
    if (depth > MAX_DEPTH) return found;
    if (typeof value === 'string') { tokenize(value).forEach((t) => { if (t.tag) found.push(t.tag); }); return found; }
    if (Array.isArray(value)) { value.forEach((v) => tagsIn(v, found, depth + 1)); return found; }
    if (value !== null && typeof value === 'object') Object.keys(value).forEach((k) => tagsIn(value[k], found, depth + 1));
    return found;
};

/* Field-level problems with filters and section nesting; paths are the caller's to check. */
const structureErrors = (input) => {
    const errors = [];
    const open = [];
    tagsIn(input).forEach((tag) => {
        if (!tag.path) { errors.push({ code: 'unknown_placeholder', message: `"{{${tag.raw}}}" names nothing` }); return; }
        if (tag.sigil === '/') {
            if (tag.filters.length) errors.push({ code: 'invalid_filter', message: `"{{${tag.raw}}}" closes a section and takes no filters` });
            if (open[open.length - 1] === tag.path) open.pop();
            else errors.push({ code: 'unbalanced_section', message: `"{{${tag.raw}}}" closes a section that is not open` });
            return;
        }
        if (tag.sigil) open.push(tag.path);
        tag.filters.forEach((f) => {
            const filter = FILTERS[f.name];
            if (!filter) { errors.push({ code: 'unknown_filter', message: `unknown filter "${f.name}" (have: ${Object.keys(FILTERS).join(', ')})` }); return; }
            const bad = f.args.length !== filter.args.length || f.args.some((a, i) => !NUMBER.test(a) || Number(a) < filter.args[i].min || Number(a) > filter.args[i].max);
            if (bad) errors.push({ code: 'invalid_filter', message: `"${f.raw}" takes ${filter.args.length ? filter.args.map((a) => `${a.name} (${a.min} to ${a.max})`).join(', ') : 'no arguments'}` });
            else if (filter.check && !filter.check(...f.args.map(Number))) errors.push({ code: 'invalid_filter', message: `"${f.raw}": ${filter.checkMessage}` });
        });
    });
    open.forEach((path) => errors.push({ code: 'unbalanced_section', message: `section "${path}" is never closed` }));
    return errors;
};

module.exports = { render, renderString, tagsIn, structureErrors, MAX_RENDERED_LENGTH };
