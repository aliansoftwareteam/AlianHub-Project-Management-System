import { onMounted, onUnmounted, ref } from "vue";

export const BLOCKING_SELECTORS = [
    ".ah-detail",
    ".lv2-bulk",
    ".bulk-action-bar",
    '[role="dialog"][aria-modal="true"]'
];

const shown = (el) => !el.closest('[hidden], [aria-hidden="true"], [style*="display: none"]');

export const isBlockingSurfaceOpen = (root = document) => BLOCKING_SELECTORS.some((selector) => Array.from(root.querySelectorAll(selector)).some(shown));

/* True while a task panel, bulk bar or modal dialog is on screen, wherever it was mounted:
   the task overlay and most dialogs live outside the view that asks. */
export function useBlockingSurface() {
    const blocked = ref(false);
    let observer = null;
    const check = () => { blocked.value = isBlockingSurfaceOpen(document); };

    onMounted(() => {
        check();
        observer = new MutationObserver(check);
        observer.observe(document.body, { childList: true, subtree: true });
    });
    onUnmounted(() => observer?.disconnect());

    return blocked;
}
