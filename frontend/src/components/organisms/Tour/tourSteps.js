/* CommonJS on purpose: webpack consumes it in the app and root Jest checks every selector against source.
   Each stop lists selectors in preference order; with none on screen the card docks in a corner.
   Copy lives at Auth.tour_first_<key>_title|body|key, and `shortcut` is an id in composable/shortcuts.js. */
const TOUR = 'first';

const STOPS = [
    { key: 'rail', els: ['.ah-rail', '.ah-tabbar'], side: 'right', shortcut: 'palette' },
    { key: 'tree', els: ['.pt', '.ph2__tree'], side: 'right', shortcut: 'go-projects' },
    { key: 'views', els: ['.ph2__viewrow', '.lm'], side: 'bottom', shortcut: 'create-task' },
    { key: 'panel', els: ['.ah-detail__panel-inner'], side: 'left', shortcut: 'task-close' }
];

/* A person who finished the old shell tour, or closed the setup card, is not on a first visit. */
function mayAutoStart({ seen, skipped, legacyDone, dismissed, blocked }) {
    return !seen && !skipped && !legacyDone && !dismissed && !blocked;
}

const GAP = 12;
const EDGE = 12;
const SIDES = ['right', 'bottom', 'left', 'top'];

/* Where the card goes so it stays on screen and off the thing it describes. An anchor that leaves
   no room on any side (a full-screen panel on a phone) gets the corner farthest from its centre. */
function placePopover(anchor, size, viewport, side = 'right') {
    const maxLeft = Math.max(EDGE, viewport.width - size.width - EDGE);
    const maxTop = Math.max(EDGE, viewport.height - size.height - EDGE);
    const clampX = (x) => Math.min(Math.max(EDGE, x), maxLeft);
    const clampY = (y) => Math.min(Math.max(EDGE, y), maxTop);
    if (!anchor) return { left: maxLeft, top: maxTop, side: 'none' };

    const spots = {
        right: { left: anchor.right + GAP, top: clampY(anchor.top) },
        left: { left: anchor.left - GAP - size.width, top: clampY(anchor.top) },
        bottom: { left: clampX(anchor.left), top: anchor.bottom + GAP },
        top: { left: clampX(anchor.left), top: anchor.top - GAP - size.height }
    };
    const fits = (spot) => spot.left >= EDGE && spot.top >= EDGE && spot.left <= maxLeft && spot.top <= maxTop;
    const chosen = [side, ...SIDES.filter((s) => s !== side)].find((s) => fits(spots[s]));
    if (chosen) return { ...spots[chosen], side: chosen };

    const centreX = (anchor.left + anchor.right) / 2;
    const centreY = (anchor.top + anchor.bottom) / 2;
    return { left: centreX > viewport.width / 2 ? EDGE : maxLeft, top: centreY > viewport.height / 2 ? EDGE : maxTop, side: 'none' };
}

module.exports = { TOUR, STOPS, mayAutoStart, placePopover };
