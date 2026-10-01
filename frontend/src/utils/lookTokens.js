import { onBeforeUnmount, onMounted, ref } from 'vue';

// A library that lays out in pixels (a grid, a chart) cannot hold var(); a length token is resolved
// here. The fallback is the size the caller used before the looks, which a look that un-sets the token keeps.
export function readLookLength(name, fallback, element = document.documentElement) {
    const length = parseFloat(window.getComputedStyle(element).getPropertyValue(name));
    return Number.isFinite(length) ? length : fallback;
}

export function useLookLength(name, fallback) {
    const length = ref(fallback);
    let observer = null;
    onMounted(() => {
        length.value = readLookLength(name, fallback);
        observer = new MutationObserver(() => { length.value = readLookLength(name, fallback); });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-variant'] });
    });
    onBeforeUnmount(() => { if (observer) observer.disconnect(); });
    return length;
}
