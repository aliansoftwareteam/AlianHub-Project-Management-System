<template>
    <span class="ftr" :class="density">
        <span
            v-if="editable"
            ref="group"
            class="ftr__stars"
            role="radiogroup"
            tabindex="-1"
            data-cell-edit
            :aria-label="label"
            @keydown="onKey"
            @click.self="focusActive"
        >
            <button
                v-for="n in max"
                :key="n"
                type="button"
                role="radio"
                class="ftr__btn"
                :aria-checked="n === rating"
                :aria-label="$t('FieldTypes.rating_of', { value: n, max })"
                :tabindex="n === active ? 0 : -1"
                @click="set(n === rating ? '' : n)"
            >
                <svg class="ftr__star" :class="{ 'is-on': n <= filled }" viewBox="0 0 24 24" aria-hidden="true"><path :d="STAR" /></svg>
            </button>
        </span>
        <span v-else-if="rating" class="ftr__stars" role="img" :aria-label="$t('FieldTypes.rating_value', { field: label, value: rating, max })">
            <svg v-for="n in max" :key="n" class="ftr__star" :class="{ 'is-on': n <= filled }" viewBox="0 0 24 24" aria-hidden="true"><path :d="STAR" /></svg>
        </span>
        <button
            v-if="editable && rating && !compact"
            type="button"
            class="ftr__clear"
            data-rating-clear
            :aria-label="$t('FieldTypes.rating_clear')"
            :title="$t('FieldTypes.rating_clear')"
            @click="set('')"
        >
            <ShellIcon name="x" :size="12" />
        </button>
    </span>
</template>

<script setup>
import { computed, nextTick, ref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { maxOf, shownOf } from "@fieldTypes/rating";

defineOptions({ name: "RatingFieldValue" });

const props = defineProps({
    def: { type: Object, required: true },
    value: { type: [Number, String, Array, Object], default: "" },
    editable: { type: Boolean, default: false },
    compact: { type: Boolean, default: false },
    label: { type: String, default: "" }
});
const emit = defineEmits(["change"]);

const STAR = "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.6 9.5l6.1-.9z";

const group = ref(null);
const max = computed(() => maxOf(props.def));
const rating = computed(() => shownOf(props.value, props.def));
const filled = computed(() => rating.value || 0);
const active = computed(() => rating.value || 1);

/* A List column is 112px wide, so a longer scale gets smaller stars there. */
const density = computed(() => {
    if (!props.compact) return "";
    if (max.value > 7) return "ftr--compact ftr--dense";
    return max.value > 5 ? "ftr--compact ftr--tight" : "ftr--compact";
});

const focusActive = () => nextTick(() => group.value?.querySelector('[tabindex="0"]')?.focus());

function set(next) {
    if (next === (rating.value ?? "")) return;
    emit("change", next);
    focusActive();
}

const KEYS = {
    ArrowRight: () => Math.min(max.value, filled.value + 1),
    ArrowLeft: () => Math.max(1, filled.value - 1),
    Home: () => 1,
    End: () => max.value,
    Delete: () => "",
    Backspace: () => ""
};

/* Up and Down are left alone, so in a Table they still move between rows. */
function onKey(event) {
    const next = KEYS[event.key];
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    set(next());
}
</script>

<style>
.ftr { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; }
.ftr__stars { display: inline-flex; align-items: center; border-radius: 6px; }
.ftr__stars:focus-visible, .ftr__btn:focus-visible, .ftr__clear:focus-visible { outline: none; box-shadow: var(--focus); }
.ftr__btn { display: inline-flex; padding: 3px 1px; border: 0; border-radius: 4px; background: none; cursor: pointer; }
.ftr__star { width: 16px; height: 16px; flex: none; fill: none; stroke: var(--ink-2); stroke-width: 1.75; stroke-linejoin: round; }
.ftr__star.is-on { fill: var(--brand); stroke: var(--brand); }
.ftr__btn:hover .ftr__star { stroke: var(--brand); }
.ftr--compact .ftr__star { width: 14px; height: 14px; }
.ftr--tight .ftr__star { width: 12px; height: 12px; }
.ftr--dense .ftr__star { width: 9px; height: 9px; }
.ftr--tight .ftr__btn, .ftr--dense .ftr__btn { padding: 3px 0; }
.ftr__clear {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0; flex: none;
    border: 0; border-radius: 6px;
    background: none; color: var(--ink-2); cursor: pointer;
}
.ftr__clear:hover { background: var(--surface-hover); color: var(--ink); }
</style>
