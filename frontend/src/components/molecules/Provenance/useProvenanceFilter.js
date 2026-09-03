import { computed, ref, toValue, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { BADGES, PATTERNS, badgeOf, isDone } from "./provenance";

// "Done by" (29b). One filter is live at a time per view, so the selection is
// shared module state and mirrored in the url — a filtered Done column is a
// link someone can send.

export const FILTER_PARAM = "doneBy";
export const ALL = "all";
export const OPTIONS = Object.freeze([ALL, ...PATTERNS.map((p) => p.toLowerCase())]);

const selection = ref(ALL);

const clean = (raw) => {
    const value = String(raw || "").toLowerCase();
    return OPTIONS.includes(value) ? value : ALL;
};

export function useProvenanceFilter(tasks) {
    const route = useRoute();
    const router = useRouter();

    selection.value = clean(route.query[FILTER_PARAM]);
    watch(() => route.query[FILTER_PARAM], (next) => { selection.value = clean(next); });

    const set = (next) => {
        const value = clean(next);
        selection.value = value;
        const query = { ...route.query };
        if (value === ALL) delete query[FILTER_PARAM];
        else query[FILTER_PARAM] = value;
        router.replace({ query }).catch(() => {});
    };

    /* The predicate a list, board or table filters with. An open task has no
     * pattern, so it drops out of every filter but "all". */
    const matches = (task) => {
        if (selection.value === ALL) return true;
        return badgeOf(task) === selection.value.toUpperCase();
    };

    const counts = computed(() => {
        const rows = toValue(tasks) || [];
        const out = { [ALL]: 0 };
        PATTERNS.forEach((pattern) => { out[pattern.toLowerCase()] = 0; });
        rows.forEach((task) => {
            if (!isDone(task)) return;
            out[ALL] += 1;
            const badge = badgeOf(task);
            if (badge) out[badge.toLowerCase()] += 1;
        });
        return out;
    });

    const filtered = computed(() => (toValue(tasks) || []).filter(matches));
    const unchecked = computed(() => counts.value[BADGES.UNCHECKED.toLowerCase()] || 0);

    return { selection, set, matches, counts, filtered, unchecked, options: OPTIONS, param: FILTER_PARAM };
}
