import { nextTick, onMounted, onUnmounted, ref } from "vue";

/* The dots button of a tree row and the menu it opens. The menu sits inside the tree, whose own
   arrow keys would otherwise walk the rows behind it, so it answers its own keys. */
export function useRowMenu() {
    const shown = ref(false);
    const root = ref(null);
    const menu = ref(null);

    const menuItems = () => [...(menu.value?.querySelectorAll('[role="menuitem"]') || [])];

    function open() {
        shown.value = true;
        nextTick(() => menuItems()[0]?.focus());
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

    return { shown, root, menu, open, close, onMenuKeydown };
}
