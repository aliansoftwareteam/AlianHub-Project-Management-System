const registry = require('./registry');

const WHAT_MAX = 300;
const WHY_MAX = 2000;
const NAME_MAX = 200;
// What a missing value becomes once it has been through String() or a template.
const NOT_WORDS = ['undefined', 'null', 'nan', '[object object]'];

const words = (value, max = WHY_MAX) => {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    return NOT_WORDS.includes(text.toLowerCase()) ? '' : text.slice(0, max);
};

const joined = (parts, separator = ': ') => parts.map((part) => words(part)).filter(Boolean).join(separator).slice(0, WHAT_MAX);

const labelOf = (change) => words(change && change.label, WHAT_MAX) || String((change && change.action) || '');

const titleOf = (what, changes) => {
    const first = (Array.isArray(changes) && changes[0]) || {};
    const known = registry.get(first.action);
    return words(what, WHAT_MAX) || words(first.label, WHAT_MAX) || words(known && known.label, WHAT_MAX) || String(first.action || '');
};

const nameOf = (name) => words(name, NAME_MAX);

const reasonOf = (why) => words(why, WHY_MAX);

/* A row stored before its words were checked is read the way it would be filed now. */
const shown = (row) => ({ what: titleOf(row.what, row.changes), why: reasonOf(row.why), agentName: nameOf(row.agentName) });

module.exports = { words, joined, labelOf, titleOf, nameOf, reasonOf, shown };
