const EDGE = 8;
const GAP = 4;

/* Fixed-position coordinates for a menu hanging off a button: below it when the whole menu
 * fits there, above it when that fits, otherwise against the bottom edge of the window so no
 * item is cut off. */
export function placeMenu(anchor, size, viewport) {
    const horizontal = anchor.right - size.width < EDGE
        ? { left: `${EDGE}px` }
        : { right: `${Math.max(EDGE, viewport.width - anchor.right)}px` };
    if (anchor.bottom + GAP + size.height <= viewport.height - EDGE) return { top: `${anchor.bottom + GAP}px`, ...horizontal };
    if (anchor.top - GAP - size.height >= EDGE) return { bottom: `${viewport.height - anchor.top + GAP}px`, ...horizontal };
    return { top: `${Math.max(EDGE, viewport.height - EDGE - size.height)}px`, ...horizontal };
}

/* For a menu that stays in the flow of its row instead of being fixed to the window: below its button when the
 * whole menu fits between there and the end of `bounds`, above when only that fits, otherwise the roomier side
 * with the height that side has. */
export function menuSide(anchor, height, bounds) {
    const below = bounds.bottom - EDGE - (anchor.bottom + GAP);
    const above = anchor.top - GAP - (bounds.top + EDGE);
    if (height <= below) return { up: false, maxHeight: null };
    if (height <= above) return { up: true, maxHeight: null };
    const up = above > below;
    return { up, maxHeight: Math.max(0, Math.floor(up ? above : below)) };
}
