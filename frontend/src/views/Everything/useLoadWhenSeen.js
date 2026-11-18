import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

/* Asks for a group's next page when the end of its rows scrolls into view. An observer reports a
 * change, not a state: a sentinel still on screen after a page lands would never ask for the next
 * one, so it is observed afresh whenever the group's rows change. `open` is false while the group
 * is folded away. */
export function useLoadWhenSeen(group, load, open = ref(true)) {
    const sentinel = ref(null);
    const more = computed(() => !group().loaded || Boolean(group().nextCursor));
    let observer = null;

    function watchSentinel() {
        observer?.disconnect();
        if (!sentinel.value || typeof IntersectionObserver === "undefined") return;
        observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            if (open.value && more.value && !group().loading && !group().failed) load(group().id);
        }, { rootMargin: "200px" });
        observer.observe(sentinel.value);
    }

    onMounted(watchSentinel);
    watch(() => [group().rows.length, group().loaded, group().nextCursor, open.value], () => nextTick(watchSentinel));
    onBeforeUnmount(() => observer?.disconnect());

    return { sentinel, more };
}
