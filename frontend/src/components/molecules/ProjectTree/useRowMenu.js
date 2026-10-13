import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { menuSide } from "@/views/Projects/composables/menuPlacement";

const CLIPPING = ["auto", "scroll", "hidden", "clip"];
const BELOW = Object.freeze({ up: false, maxHeight: null });

/* What of the window the row can be seen through: a panel that scrolls or clips ends before the window does. */
function visibleBounds(el) {
    const bounds = { top: 0, bottom: window.innerHeight };
    for (let node = el.parentElement; node; node = node.parentElement) {
        if (!CLIPPING.includes(getComputedStyle(node).overflowY)) continue;
        const box = node.getBoundingClientRect();
        bounds.top = Math.max(bounds.top, box.top);
        bounds.bottom = Math.min(bounds.bottom, box.bottom);
    }
    return bounds;
}

/* The dots button of a tree row and the menu it opens. The menu sits inside the tree, whose own
   arrow keys would otherwise walk the rows behind it, so it answers its own keys. */
export function useRowMenu() {
    const shown = ref(false);
    const root = ref(null);
    const menu = ref(null);

    const menuItems = () => [...(menu.value?.querySelectorAll('[role="menuitem"]') || [])];

    const side = ref(BELOW);
    const menuClass = computed(() => ({ "pt-menu__pop--up": side.value.up }));
    const menuStyle = computed(() => (side.value.maxHeight === null ? null : { maxHeight: `${side.value.maxHeight}px` }));

    function open() {
        side.value = BELOW;
        shown.value = true;
        nextTick(() => {
            if (menu.value && root.value) side.value = menuSide(root.value.getBoundingClientRect(), menu.value.offsetHeight, visibleBounds(root.value));
            /* The menu is still drawn below its button here; focus that scrolled to it would move the panel for a menu about to flip. */
            menuItems()[0]?.focus({ preventScroll: true });
        });
    }

    function close(refocus = false) {
        if (!shown.value) return;
        shown.value = false;
        if (refocus) root.value?.closest(".pt-row")?.querySelector('[role="treeitem"]')?.focus();
    }

    function onMenuKeydown(event) {
        if (event.key === "Escape" || event.key === "Tab") {
            event.preventDefault();
            close(true);
            return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const items = menuItems();
        const at = items.indexOf(document.activeElement);
        items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }

    const closeOnOutsideClick = (event) => { if (!root.value?.contains(event.target)) close(); };
    onMounted(() => document.addEventListener("click", closeOnOutsideClick));
    onUnmounted(() => document.removeEventListener("click", closeOnOutsideClick));

    return { shown, root, menu, menuClass, menuStyle, open, close, onMenuKeydown };
}
