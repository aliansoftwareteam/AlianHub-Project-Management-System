// Which parts of a plan the person approving keeps. The server names each part a line stands for by a key,
// "<kind>:<its place in the stored plan>", says which part needs which (Modules/Agents/planChoice.js), which
// parts this person may not approve (Modules/Agents/planLocks.js) and which have nothing to show
// (Modules/Agents/planShown.js). What is sent back is only the places kept, so the page can leave parts out and
// never add or reword one, and a part the person was not shown is never one of them.

import { linesOf } from './intentLines';

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');
const linesIn = (preview) => (Array.isArray(preview?.lines) ? preview.lines : []).filter((line) => line && typeof line === 'object');
const picksOf = (line) => (Array.isArray(line.picks) ? line.picks : []).filter((key) => typeof key === 'string');
const namedIn = (preview) => linesIn(preview).flatMap((line) => [...picksOf(line), ...(typeof line.pick === 'string' ? [line.pick] : [])]);

/* Whether a line has words is the same in every language, so the lines are read here with their keys for words. */
const shownLines = (preview) => linesOf((key) => key, 'en', preview);
const keysIn = (preview) => shownLines(preview).flatMap((line) => [...(line.picks || []).map((pick) => pick.key), ...(typeof line.pick === 'string' ? [line.pick] : [])]);
const needsIn = (preview) => (preview?.needs && typeof preview.needs === 'object' ? preview.needs : {});
const neededBy = (preview, key) => (Array.isArray(needsIn(preview)[key]) ? needsIn(preview)[key] : []);

export const canChoose = (preview) => keysIn(preview).length > 0;

/* The parts of the plan with no line on the card: those the server says it cannot show, and any whose line has no
 * words here. They are left out whatever is ticked. */
export const hiddenParts = (preview) => {
    const shown = keysIn(preview);
    const blank = (Array.isArray(preview?.blank) ? preview.blank : []).filter((key) => typeof key === 'string');
    return [...new Set([...blank, ...namedIn(preview)])].filter((key) => !shown.includes(key));
};

/* Why a part is one this person may not approve: an owner or an admin approves it, their own role may not make
 * it, or the plan cannot make it for anyone. */
const LOCK_REASONS = Object.freeze(['owner_admin', 'own_rights', 'not_this_plan']);
export const lockReason = (preview, key) => {
    if (!Array.isArray(preview?.locked) || !preview.locked.includes(key)) return '';
    return LOCK_REASONS.includes(preview.lockedWhy?.[key]) ? preview.lockedWhy[key] : LOCK_REASONS[0];
};

/* For each part this person may not approve: the parts that cannot be made without it. */
export const heldWith = (preview) => {
    const known = keysIn(preview);
    const own = (Array.isArray(preview?.locked) ? preview.locked : []).filter((key) => known.includes(key));
    const seen = new Set(own);
    return own.map((key) => {
        const held = [];
        const hold = (needed) => known.filter((other) => !seen.has(other) && neededBy(preview, other).includes(needed)).forEach((other) => { seen.add(other); held.push(other); hold(other); });
        hold(key);
        return { key, held };
    });
};

/* The parts this person may not approve, and with them every part that cannot be made without one of those. They
 * are left out whatever is ticked. */
export const lockedParts = (preview) => {
    const locked = new Set(heldWith(preview).flatMap(({ key, held }) => [key, ...held]));
    return keysIn(preview).filter((key) => locked.has(key));
};

const leftOutOf = (preview, leftOut) => new Set([...(Array.isArray(leftOut) ? leftOut : []), ...lockedParts(preview)]);

/* The name a part goes by on the card, by key. */
export const pickNames = (preview) => new Map(linesIn(preview).flatMap((line) => {
    const names = Array.isArray(line.names) ? line.names : [];
    const listed = picksOf(line).map((key, at) => [key, textOf(names[at])]);
    return typeof line.pick === 'string' ? [...listed, [line.pick, textOf(line.name) || textOf(line.text) || textOf(line.problem)]] : listed;
}));

/* Leaving a part out leaves out every part that cannot be made without it; keeping one keeps what it needs. A part
 * this person may not approve is out already and is never one of the parts a tick moves. */
export const toggled = (preview, leftOut, key) => {
    const locked = lockedParts(preview);
    const known = keysIn(preview).filter((held) => !locked.includes(held));
    const out = new Set((Array.isArray(leftOut) ? leftOut : []).filter((held) => known.includes(held)));
    if (!known.includes(key)) return [...out];
    const keep = (kept) => {
        if (!out.delete(kept)) return;
        neededBy(preview, kept).forEach(keep);
    };
    const leave = (left) => {
        if (out.has(left)) return;
        out.add(left);
        known.filter((other) => neededBy(preview, other).includes(left)).forEach(leave);
    };
    if (out.has(key)) keep(key);
    else leave(key);
    return known.filter((held) => out.has(held));
};

/* Ticking a part back also brings back the parts that left only because it did (`went`), each one only where
 * everything it needs is kept, so a part the person unticked by hand stays out. */
export const broughtBack = (preview, leftOut, went) => {
    const out = new Set(leftOut);
    const locked = lockedParts(preview);
    const ready = () => went.find((key) => out.has(key) && !locked.includes(key) && neededBy(preview, key).every((needed) => !out.has(needed) && !locked.includes(needed)));
    for (let key = ready(); key; key = ready()) out.delete(key);
    return leftOut.filter((held) => out.has(held));
};

const KEPT_WORDS = Object.freeze({ statuses: 'kept_statuses', lists: 'kept_lists', fields: 'kept_fields', views: 'kept_views', rules: 'kept_rules', tasks: 'kept_tasks' });

/* How many parts of each kind are still ticked, for the kinds that have one left out, in the card's order. */
export const keptCounts = (preview, leftOut) => {
    const out = leftOutOf(preview, leftOut);
    const counts = new Map();
    keysIn(preview).forEach((key) => {
        const [part] = key.split(':');
        const count = counts.get(part) || { part, kept: 0, of: 0 };
        counts.set(part, { part, kept: count.kept + (out.has(key) ? 0 : 1), of: count.of + 1 });
    });
    return [...counts.values()].filter((count) => count.kept < count.of);
};

/* "3 of 4 lists, 2 of 3 first tasks", or '' while everything is ticked. */
export const keptText = (t, preview, leftOut) => keptCounts(preview, leftOut)
    .filter((count) => Object.hasOwn(KEPT_WORDS, count.part))
    .map((count) => t(`IntentPreview.${KEPT_WORDS[count.part]}`, { kept: count.kept, total: count.of }, count.of))
    .join(', ');

/* What goes with the approval: for each kind of part of the plan, the places kept. Null while everything is kept
 * and every part has a line on the card. */
export const chosenParts = (preview, leftOut) => {
    const known = keysIn(preview);
    const hidden = hiddenParts(preview);
    const out = leftOutOf(preview, leftOut);
    if (!known.some((key) => out.has(key)) && !hidden.length) return null;
    const chosen = {};
    [...known, ...hidden].forEach((key) => {
        const [part, at] = key.split(':');
        chosen[part] = chosen[part] || [];
        if (known.includes(key) && !out.has(key)) chosen[part].push(Number(at));
    });
    return chosen;
};

/* What goes with the approval of a proposal: the chosen parts of each of its changes, by the change's place.
 * `leftOutAt(i)` is what the person unticked on the card of change i. Null while every change is kept whole. */
export const partsChoice = (changes, leftOutAt) => {
    const parts = {};
    (Array.isArray(changes) ? changes : []).forEach((change, i) => {
        const chosen = chosenParts(change?.preview, leftOutAt(i));
        if (chosen) parts[i] = chosen;
    });
    return Object.keys(parts).length ? { parts } : null;
};

export const keptSummary = (t, changes, leftOutAt) => (Array.isArray(changes) ? changes : [])
    .map((change, i) => keptText(t, change?.preview, leftOutAt(i)))
    .filter(Boolean)
    .join(', ');
