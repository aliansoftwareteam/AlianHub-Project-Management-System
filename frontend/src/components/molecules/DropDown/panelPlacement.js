const EDGE_MARGIN = 8;

function clampAxis(start, size, limit, margin) {
    return Math.max(margin, Math.min(start, limit - margin - size));
}

export function placePanel({ trigger, panel, viewport, margin = EDGE_MARGIN }) {
    let left = trigger.left;
    if (left + panel.width > viewport.width - margin) left = trigger.right - panel.width;
    left = clampAxis(left, panel.width, viewport.width, margin);

    let top = trigger.bottom;
    if (top + panel.height > viewport.height - margin) {
        const above = trigger.top - panel.height;
        top = above >= margin ? above : clampAxis(top, panel.height, viewport.height, margin);
    }
    return { left, top };
}

// A fixed panel with no left yet is measured shrink-to-fit against the room right of its static position, so it is pinned to the origin before measuring.
export function positionPanel(panelEl, triggerRect, { belowOffset } = {}) {
    panelEl.style.left = '0px';
    panelEl.style.top = '0px';
    const { width, height } = panelEl.getBoundingClientRect();
    const { left, top } = placePanel({
        trigger: {
            left: triggerRect.left,
            right: triggerRect.right,
            top: triggerRect.top,
            bottom: belowOffset ?? triggerRect.bottom
        },
        panel: { width, height },
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
    });
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
}

// A panel is measured the moment it opens, before content that arrives later (a catalogue fetched on mount) has given it its real size, so it is placed again whenever that size changes.
export function followPanelSize(panelEl, locate) {
    if (typeof ResizeObserver === 'undefined') return () => {};
    const sizeOf = () => {
        const { width, height } = panelEl.getBoundingClientRect();
        return `${width}x${height}`;
    };
    let placedSize = sizeOf();
    const observer = new ResizeObserver(() => {
        if (sizeOf() === placedSize) return;
        const { rect, options } = locate();
        positionPanel(panelEl, rect, options);
        placedSize = sizeOf();
    });
    observer.observe(panelEl);
    return () => observer.disconnect();
}
