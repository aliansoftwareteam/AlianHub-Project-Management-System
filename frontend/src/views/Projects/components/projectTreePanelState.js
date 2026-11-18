import { reactive, watch } from "vue";

const COLLAPSED_KEY = "ah.projectTree.collapsed";
export const TREE_PANEL_MIN_WIDTH = 1024;

const storedCollapsed = () => {
    try {
        return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
        return false;
    }
};

/* Wide screens keep the panel beside the page and remember a collapse; narrower ones open it
   as a drawer on demand, so the width it would take stays with the board. */
export const projectTreePanelState = reactive({ collapsed: storedCollapsed(), open: false });

watch(() => projectTreePanelState.collapsed, (collapsed) => {
    try {
        localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
        /* storage may be unavailable; the choice then lasts for this page only */
    }
});

export const isWide = (width) => Number(width || 0) >= TREE_PANEL_MIN_WIDTH;

export const projectTreeShown = (width) => (isWide(width) ? !projectTreePanelState.collapsed : projectTreePanelState.open);

export function toggleProjectTree(width) {
    if (isWide(width)) projectTreePanelState.collapsed = !projectTreePanelState.collapsed;
    else projectTreePanelState.open = !projectTreePanelState.open;
}
