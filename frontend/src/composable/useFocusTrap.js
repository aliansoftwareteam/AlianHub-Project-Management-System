import { nextTick, onBeforeUnmount, unref, watch } from "vue";

const FOCUSABLE = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type=\"hidden\"])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[contenteditable=\"true\"]",
    "[tabindex]"
].join(",");

export function focusableIn(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => {
        if (el.tabIndex < 0 || el.closest("[inert], [aria-hidden=\"true\"]")) return false;
        return el.getClientRects().length > 0;
    });
}

/* Wraps Tab at either end of `root`. Focus that has already left `root` (a teleported
 * date picker or dropdown) is left alone, so those layers keep their own keyboard handling. */
export function wrapTab(event, root) {
    if (event.key !== "Tab" || event.defaultPrevented || !root) return false;
    const target = event.target;
    if (target !== root && !root.contains(target)) return false;
    const items = focusableIn(root);
    if (!items.length) {
        event.preventDefault();
        root.focus();
        return true;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (target === first || target === root)) {
        event.preventDefault();
        last.focus();
        return true;
    }
    if (!event.shiftKey && target === last) {
        event.preventDefault();
        first.focus();
        return true;
    }
    return false;
}

export function useFocusTrap(containerRef, activeRef, { returnFocus = true } = {}) {
    let previous = null;
    let listening = false;

    const onKeydown = (event) => wrapTab(event, unref(containerRef));

    const stop = () => {
        if (listening) document.removeEventListener("keydown", onKeydown);
        listening = false;
    };

    const activate = async () => {
        previous = document.activeElement;
        await nextTick();
        const root = unref(containerRef);
        if (!root) return;
        if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
        if (!listening) document.addEventListener("keydown", onKeydown);
        listening = true;
    };

    const deactivate = () => {
        stop();
        const target = previous;
        previous = null;
        if (!returnFocus || !target || !target.isConnected || typeof target.focus !== "function") return;
        const root = unref(containerRef);
        const focusIsLost = !document.activeElement || document.activeElement === document.body || (root && root.contains(document.activeElement));
        if (focusIsLost) target.focus({ preventScroll: true });
    };

    watch(() => Boolean(unref(activeRef)), (on, was) => {
        if (on) activate();
        else if (was) deactivate();
    }, { immediate: true });

    onBeforeUnmount(() => {
        if (listening) deactivate();
    });

    return { activate, deactivate };
}
