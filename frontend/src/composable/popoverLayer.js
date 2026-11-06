import { computed, inject, provide, ref } from "vue";

/* The teleport hosts in main.js sit at z-index 100, so a picker opened from a dialog stacked above
 * them (Create Project is 1050) renders behind it. Such a dialog provides an element inside its own
 * stacking context, and the pickers below it teleport there while that element is mounted. */
const POPOVER_LAYER = Symbol("popoverLayer");

/**
 * Lets a dialog in its own stacking context (e.g. teleported to body at a high z-index)
 * give descendant DropDown/Sidebar pickers a teleport target so they render above it.
 * @returns {import('vue').Ref} ref to bind to the element pickers should teleport into
 */
export function providePopoverLayer() {
    const layer = ref(null);
    provide(POPOVER_LAYER, layer);
    return layer;
}

/**
 * Resolves the teleport target for a picker: the layer provided by an ancestor dialog,
 * or `fallback` (e.g. '#my-dropdown') when none is provided or its layer ref is null.
 * @param {string} fallback - default teleport target selector
 * @returns {import('vue').ComputedRef<string>}
 */
export function usePopoverLayer(fallback) {
    const layer = inject(POPOVER_LAYER, null);
    return computed(() => layer?.value || fallback);
}
