/* The list route's page sizes (Modules/Inbox/helpers/inboxRules.js). */
const PAGE_ROWS = 10;
export const MAX_REFRESH_ROWS = 50;

/* A refresh reads again as many rows as are on screen, so the pages a person loaded stay loaded. */
export const refreshLimit = (held) => Math.min(Math.max(held, PAGE_ROWS), MAX_REFRESH_ROWS);

/* More rows can be on screen than one read may bring. Those past the read stay, after the last row both lists hold. */
export function stitchRows(held, fresh, keyOf, moreOnServer) {
    if (!moreOnServer) return fresh;
    const freshKeys = new Set(fresh.map(keyOf));
    let lastShared = -1;
    held.forEach((row, at) => { if (freshKeys.has(keyOf(row))) lastShared = at; });
    return lastShared === -1 ? fresh : [...fresh, ...held.slice(lastShared + 1)];
}

/* The first row in view, and how far the list was scrolled when it was there. */
export function rowInView(list, selector) {
    if (!list || list.scrollTop <= 0) return null;
    const el = [...list.querySelectorAll(selector)].find((row) => row.offsetTop + row.offsetHeight > list.scrollTop);
    return el ? { el, top: el.offsetTop, scrollTop: list.scrollTop } : null;
}

/* Set from where the list was scrolled before, not from where it is now: a browser that anchors the scroll itself has already moved it. */
export function holdInView(list, anchor) {
    if (list && anchor?.el.isConnected) list.scrollTop = anchor.scrollTop + (anchor.el.offsetTop - anchor.top);
}
