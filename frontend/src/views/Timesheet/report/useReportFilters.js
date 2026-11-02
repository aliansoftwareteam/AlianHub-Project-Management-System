import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { PRESETS, rangeOf, shiftRange, presetFor, localDay } from './reportRange';
import { readFilters, writeFilters, emptyFilters, activeCount, serverFilters } from './reportQuery';

const sameFilters = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* The filter bar's state, always the same as the route query: the URL says what the screen shows. */
export function useReportFilters({ defaultPreset = 'this_week', presets = PRESETS } = {}) {
    const route = useRoute();
    const router = useRouter();
    const options = { defaultPreset, presets };
    const filters = ref(readFilters(route.query, options));

    const commit = (next, drop = []) => {
        filters.value = next;
        const base = { ...route.query };
        drop.forEach((key) => { delete base[key]; });
        const query = writeFilters(next, base, options);
        if (!sameFilters(query, route.query)) router.replace({ query }).catch(() => {});
    };

    /* `drop` removes query keys the tab has just read into the filters (an old link's week=, userId=). */
    const apply = (patch, { drop = [] } = {}) => {
        const next = { ...filters.value, ...patch };
        if (patch.preset && patch.preset !== 'custom') Object.assign(next, rangeOf(patch.preset, localDay()));
        if (patch.preset === 'custom') {
            Object.assign(next, rangeOf('custom', localDay(), { start: next.start, end: next.end }));
            next.preset = presetFor(next, localDay(), presets);
        }
        commit(next, drop);
    };

    const step = (direction) => {
        const range = shiftRange({ start: filters.value.start, end: filters.value.end }, filters.value.preset, direction);
        commit({ ...filters.value, ...range, preset: presetFor(range, localDay(), presets) });
    };

    const clear = () => commit({ ...emptyFilters(filters.value.preset), start: filters.value.start, end: filters.value.end });

    watch(() => route.query, (query) => {
        const next = readFilters(query, options);
        if (!sameFilters(next, filters.value)) filters.value = next;
    });

    return {
        filters,
        range: computed(() => ({ start: filters.value.start, end: filters.value.end })),
        narrowing: computed(() => activeCount(filters.value)),
        serverFilters: computed(() => serverFilters(filters.value)),
        apply,
        step,
        clear,
    };
}
