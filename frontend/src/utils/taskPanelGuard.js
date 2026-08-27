export const tabPointerAt = { ms: 0 };
export const searchClosedAt = { ms: 0 };

export function markTabPointer() {
    tabPointerAt.ms = Date.now();
}

export function wasRecentTabPointer(windowMs = 1200) {
    return Date.now() - tabPointerAt.ms < windowMs;
}

export function markSearchClosed() {
    searchClosedAt.ms = Date.now();
}

export function ignoreTaskBackdrop(windowMs = 900) {
    return Date.now() - searchClosedAt.ms < windowMs;
}

export function clickFromTab(event) {
    if (!event) return false;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.some((node) => node && node.getAttribute && node.getAttribute('data-tab') != null)) return true;
    const target = event.target;
    if (target && typeof target.closest === 'function') {
        return Boolean(target.closest('[data-tab], .tab-list-header'));
    }
    return false;
}
