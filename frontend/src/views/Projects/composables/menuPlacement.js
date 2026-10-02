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
