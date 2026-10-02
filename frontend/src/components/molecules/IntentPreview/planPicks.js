// Which parts of a plan the person approving keeps. The server names each part a line stands for by a key,
// "<kind>:<its place in the stored plan>", and says which part needs which (Modules/Agents/planChoice.js). What is
// sent back is only those places, so the page can leave parts out and never add or reword one.

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');
const linesIn = (preview) => (Array.isArray(preview?.lines) ? preview.lines : []).filter((line) => line && typeof line === 'object');
const picksOf = (line) => (Array.isArray(line.picks) ? line.picks : []).filter((key) => typeof key === 'string');
const keysIn = (preview) => linesIn(preview).flatMap((line) => [...picksOf(line), ...(typeof line.pick === 'string' ? [line.pick] : [])]);
const needsIn = (preview) => (preview?.needs && typeof preview.needs === 'object' ? preview.needs : {});
const neededBy = (preview, key) => (Array.isArray(needsIn(preview)[key]) ? needsIn(preview)[key] : []);

export const canChoose = (preview) => keysIn(preview).length > 0;

/* The name a part goes by on the card, by key. */
export const pickNames = (preview) => new Map(linesIn(preview).flatMap((line) => {
    const names = Array.isArray(line.names) ? line.names : [];
    const listed = picksOf(line).map((key, at) => [key, textOf(names[at])]);
    return typeof line.pick === 'string' ? [...listed, [line.pick, textOf(line.name) || textOf(line.text) || textOf(line.problem)]] : listed;
}));

/* Leaving a part out leaves out every part that cannot be made without it; keeping one keeps what it needs. */
export const toggled = (preview, leftOut, key) => {
    const known = keysIn(preview);
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
    const ready = () => went.find((key) => out.has(key) && neededBy(preview, key).every((needed) => !out.has(needed)));
    for (let key = ready(); key; key = ready()) out.delete(key);
    return leftOut.filter((held) => out.has(held));
};

const KEPT_WORDS = Object.freeze({ statuses: 'kept_statuses', lists: 'kept_lists', fields: 'kept_fields', views: 'kept_views', rules: 'kept_rules', tasks: 'kept_tasks' });

/* How many parts of each kind are still ticked, for the kinds that have one left out, in the card's order. */
export const keptCounts = (preview, leftOut) => {
    const out = new Set(Array.isArray(leftOut) ? leftOut : []);
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

/* What goes with the approval: for each kind of part on the card, the places kept. Null while everything is kept. */
export const chosenParts = (preview, leftOut) => {
    const known = keysIn(preview);
    const out = new Set(Array.isArray(leftOut) ? leftOut : []);
    if (!known.some((key) => out.has(key))) return null;
    const chosen = {};
    known.forEach((key) => {
        const [part, at] = key.split(':');
        chosen[part] = chosen[part] || [];
        if (!out.has(key)) chosen[part].push(Number(at));
    });
    return chosen;
};
