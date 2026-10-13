/* Most used first: when the bar is too narrow, the actions at the end of this list are the
 * first to go behind More. */
const KEEP_ORDER = ["status", "assignee", "due", "priority", "sprint", "tags", "convert", "ai", "archive", "delete"];

export const PHONE_INLINE_LIMIT = 3;

const rank = (key) => {
    const at = KEEP_ORDER.indexOf(key);
    return at === -1 ? KEEP_ORDER.length : at;
};

/* The keys that stay in the bar, in the order the bar shows them. Each action costs its own
 * width and the gap before it; once anything overflows, More needs its place too. */
export function fitInline(actions, { available, moreWidth, gap = 0, limit = Infinity }) {
    const cost = (action) => action.width + gap;
    const everything = actions.reduce((total, action) => total + cost(action), 0);
    if (actions.length <= limit && everything <= available) return actions.map((action) => action.key);

    const kept = new Set();
    let used = moreWidth + gap;
    for (const action of [...actions].sort((a, b) => rank(a.key) - rank(b.key))) {
        if (kept.size >= limit || used + cost(action) > available) break;
        used += cost(action);
        kept.add(action.key);
    }
    return actions.filter((action) => kept.has(action.key)).map((action) => action.key);
}
