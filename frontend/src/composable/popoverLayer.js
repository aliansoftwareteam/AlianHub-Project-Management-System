import { computed, inject, provide, ref } from "vue";

/* The teleport hosts in main.js sit at z-index 100, so a picker opened from a dialog stacked above
 * them (Create Project is 1050) renders behind it. Such a dialog provides an element inside its own
 * stacking context, and the pickers below it teleport there while that element is mounted. */
const POPOVER_LAYER = Symbol("popoverLayer");

export function providePopoverLayer() {
    const layer = ref(null);
    provide(POPOVER_LAYER, layer);
    return layer;
}

export function usePopoverLayer(fallback) {
    const layer = inject(POPOVER_LAYER, null);
    return computed(() => layer?.value || fallback);
}
