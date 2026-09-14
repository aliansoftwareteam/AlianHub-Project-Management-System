// The ground-truth gate a skill declares with `grounded`. Asking a model not to
// invent is not a boundary: a sentence naming a task key that was never gathered,
// or a count that is not one the reader measured, is dropped rather than posted.

const { readField } = require('../../Automations/engine/expression');

const KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const NUMBER_RE = /\b\d+\b/g;
const SENTENCE_RE = /(?<=[.!?])\s+/;
const MAX_DROPPED = 50;

const text = (value) => (value === null || value === undefined ? '' : String(value));

const setOf = (path, ctx) => {
    const value = path ? readField(path, ctx) : null;
    return new Set((Array.isArray(value) ? value : []).map((v) => text(v).toUpperCase()).filter(Boolean));
};

const keysIn = (value) => text(value).match(KEY_RE) || [];
const numbersIn = (value) => text(value).replace(KEY_RE, ' ').match(NUMBER_RE) || [];

/* What is wrong with one sentence or list item, or null when every key and
 * number in it was gathered. */
const faultIn = (value, known, counts) => {
    const badKey = keysIn(value).find((k) => !known.has(k.toUpperCase()));
    if (badKey) return `mentions ${badKey}, which is not in the data`;
    const badNumber = numbersIn(value).find((n) => !counts.has(n));
    if (badNumber) return `mentions ${badNumber}, which is not one of the counts`;
    return null;
};

const groundString = (value, known, counts, dropped) => {
    const kept = text(value).split(SENTENCE_RE).filter((s) => s.trim()).filter((sentence) => {
        const fault = faultIn(sentence, known, counts);
        if (fault) dropped.push({ reason: fault, text: sentence.trim() });
        return !fault;
    });
    return kept.join(' ') || null;
};

const groundList = (value, known, counts, dropped, mustNameKey) => (Array.isArray(value) ? value : []).filter((item) => {
    if (mustNameKey && !keysIn(item).some((k) => known.has(k.toUpperCase()))) {
        dropped.push({ reason: 'it names no task from the data', text: text(item) });
        return false;
    }
    const fault = faultIn(item, known, counts);
    if (fault) dropped.push({ reason: fault, text: text(item) });
    return !fault;
});

/* `spec` is the skill's `grounded` clause; `ctx` is the gathered context the
 * reader filled. A field the model did not answer is left alone. */
const ground = (spec, raw, ctx) => {
    if (!raw || typeof raw !== 'object' || !spec) return { raw, dropped: [] };
    const known = setOf(spec.keys, ctx);
    const counts = new Set([...setOf(spec.numbers, ctx), ...(spec.allow || []).map(String)]);
    const dropped = [];
    const out = { ...raw };
    (spec.fields || []).forEach((field) => {
        if (out[field] === undefined || out[field] === null) return;
        out[field] = Array.isArray(out[field])
            ? groundList(out[field], known, counts, dropped, false)
            : groundString(out[field], known, counts, dropped);
    });
    (spec.mustNameKey || []).forEach((field) => {
        if (out[field] === undefined || out[field] === null) return;
        out[field] = groundList(out[field], known, counts, dropped, true);
    });
    return { raw: out, dropped: dropped.slice(0, MAX_DROPPED) };
};

module.exports = { ground, faultIn };
