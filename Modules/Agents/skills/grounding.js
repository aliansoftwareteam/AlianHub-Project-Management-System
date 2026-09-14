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

/* The windows the skill's own wording introduces ("in the last 24h") are not
 * claims about the board; the same number anywhere else still is. */
const windowRe = (hours) => (hours.length ? new RegExp(`\\b(?:${hours.join('|')})\\s*(?:h|hrs?|hours?)\\b`, 'gi') : null);

const numbersIn = (value, windows) => {
    const stripped = text(value).replace(KEY_RE, ' ');
    return (windows ? stripped.replace(windows, ' ') : stripped).match(NUMBER_RE) || [];
};

/* What is wrong with one sentence or list item, or null when every key and
 * number in it was gathered. */
const faultIn = (value, known, counts, windows = null) => {
    const badKey = keysIn(value).find((k) => !known.has(k.toUpperCase()));
    if (badKey) return `mentions ${badKey}, which is not in the data`;
    const badNumber = numbersIn(value, windows).find((n) => !counts.has(n));
    if (badNumber) return `mentions ${badNumber}, which is not one of the counts`;
    return null;
};

const groundString = (value, known, counts, dropped, windows) => {
    const kept = text(value).split(SENTENCE_RE).filter((s) => s.trim()).filter((sentence) => {
        const fault = faultIn(sentence, known, counts, windows);
        if (fault) dropped.push({ reason: fault, text: sentence.trim() });
        return !fault;
    });
    return kept.join(' ') || null;
};

const groundList = (value, known, counts, dropped, mustNameKey, windows) => (Array.isArray(value) ? value : []).filter((item) => {
    if (mustNameKey && !keysIn(item).some((k) => known.has(k.toUpperCase()))) {
        dropped.push({ reason: 'it names no task from the data', text: text(item) });
        return false;
    }
    const fault = faultIn(item, known, counts, windows);
    if (fault) dropped.push({ reason: fault, text: text(item) });
    return !fault;
});

/* `spec` is the skill's `grounded` clause; `ctx` is the gathered context the
 * reader filled. A field the model did not answer is left alone. */
const ground = (spec, raw, ctx) => {
    if (!raw || typeof raw !== 'object' || !spec) return { raw, dropped: [] };
    const known = setOf(spec.keys, ctx);
    const counts = setOf(spec.numbers, ctx);
    const windows = windowRe((spec.allowHours || []).map(String));
    const dropped = [];
    const out = { ...raw };
    (spec.fields || []).forEach((field) => {
        if (out[field] === undefined || out[field] === null) return;
        out[field] = Array.isArray(out[field])
            ? groundList(out[field], known, counts, dropped, false, windows)
            : groundString(out[field], known, counts, dropped, windows);
    });
    (spec.mustNameKey || []).forEach((field) => {
        if (out[field] === undefined || out[field] === null) return;
        out[field] = groundList(out[field], known, counts, dropped, true, windows);
    });
    return { raw: out, dropped: dropped.slice(0, MAX_DROPPED) };
};

module.exports = { ground, faultIn };
