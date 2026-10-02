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
