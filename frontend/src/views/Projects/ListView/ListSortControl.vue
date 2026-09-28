<template>
    <span ref="root" class="lvs" @click.stop>
        <span v-if="sorted" class="lvs__hint">{{ $t('List.sort_drag_off') }}</span>
        <button
            ref="trigger"
            type="button"
            class="lvs__trigger"
            :class="{ 'is-on': sorted }"
            :title="sorted ? $t('List.sort_drag_off') : $t('List.sort_title')"
            aria-haspopup="dialog"
            :aria-expanded="open ? 'true' : 'false'"
            @click="toggle"
        >
            <span class="lvs__glyph" aria-hidden="true">⇅</span>
            <span>{{ sorted ? `${$t(`List.sort_${sort.key}`)} ${sort.dir === 'desc' ? '↓' : '↑'}` : $t('List.sort') }}</span>
        </button>
        <div v-if="open" ref="panel" class="lvs__panel" role="dialog" :aria-label="$t('List.sort_title')" @keydown.esc.stop.prevent="close(true)">
            <fieldset class="lvs__set">
                <legend class="lvs__legend">{{ $t('List.sort_title') }}</legend>
                <label v-for="key in SORT_KEYS" :key="key" class="lvs__option">
                    <input type="radio" name="lvs-key" :value="key" :checked="sort.key === key" @change="$emit('key', key)" />
                    <span>{{ $t(`List.sort_${key}`) }}</span>
                </label>
            </fieldset>
            <fieldset v-if="sorted" class="lvs__set">
                <legend class="lvs__legend">{{ $t('List.sort_order') }}</legend>
                <label v-for="dir in ['asc', 'desc']" :key="dir" class="lvs__option">
                    <input type="radio" name="lvs-dir" :value="dir" :checked="sort.dir === dir" @change="$emit('dir', dir)" />
                    <span>{{ $t(`List.sort_${dir}`) }}</span>
                </label>
            </fieldset>
        </div>
    </span>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { SORT_KEYS } from "@/views/Projects/composables/viewSort";

defineOptions({ name: "ListSortControl" });

const props = defineProps({
    sort: { type: Object, required: true }
});
defineEmits(["key", "dir"]);

const open = ref(false);
const root = ref(null);
const trigger = ref(null);
const panel = ref(null);
const sorted = computed(() => props.sort.key !== "manual");

function onOutside(event) {
    if (root.value && !root.value.contains(event.target)) close(false);
}

function close(refocus) {
    if (!open.value) return;
    open.value = false;
    document.removeEventListener("mousedown", onOutside, true);
    if (refocus) nextTick(() => trigger.value?.focus());
}

function toggle() {
    if (open.value) {
        close(true);
        return;
    }
    open.value = true;
    document.addEventListener("mousedown", onOutside, true);
    nextTick(() => (panel.value?.querySelector("input:checked") || panel.value?.querySelector("input"))?.focus());
}

onBeforeUnmount(() => document.removeEventListener("mousedown", onOutside, true));
</script>

<style>
.lvs { position: relative; display: inline-flex; align-items: center; gap: 8px; text-transform: none; letter-spacing: normal; }
.lvs__hint { font: var(--text-small); color: var(--ink-2); white-space: nowrap; }
.lvs__trigger {
    display: inline-flex; align-items: center; gap: 4px;
    height: 24px; padding: 0 6px;
    border: 0; border-radius: 6px;
    background: none; color: var(--ink-2); cursor: pointer;
    font: var(--text-small); white-space: nowrap;
}
.lvs__trigger:hover, .lvs__trigger[aria-expanded="true"] { background: var(--surface-hover); color: var(--ink); }
.lvs__trigger.is-on { color: var(--brand); }
.lvs__trigger:focus-visible { outline: none; box-shadow: var(--focus); }
.lvs__panel {
    position: absolute; top: 28px; right: 0; z-index: 20;
    width: 220px; max-width: calc(100vw - 32px); max-height: 360px; overflow-y: auto;
    padding: 10px;
    background: var(--surface); color: var(--ink);
    border: 1px solid var(--border); border-radius: var(--r-card);
    box-shadow: var(--shadow-pop, 0 8px 24px rgba(0, 0, 0, .16));
    font: var(--text-small); text-align: left;
}
.lvs__set { border: 0; margin: 0 0 8px; padding: 0; min-width: 0; }
.lvs__set:last-child { margin-bottom: 0; }
.lvs__legend { margin: 0 0 4px; padding: 0; font: var(--text-label); color: var(--ink-label); text-transform: uppercase; letter-spacing: .06em; }
.lvs__option { display: flex; align-items: center; gap: 8px; margin: 0; padding: 4px 2px; border-radius: 6px; cursor: pointer; }
.lvs__option:hover { background: var(--surface-hover); }
.lvs__option input { accent-color: var(--brand); margin: 0; }
.lvs__option input:focus-visible { outline: none; box-shadow: var(--focus); }
.lv2--sorted .lv2__grip { visibility: hidden; }

@media (max-width: 767px) {
    .lvs__hint { display: none; }
    .lvs__panel { position: fixed; top: auto; left: 16px; right: 16px; bottom: calc(var(--tabbar-h, 0px) + env(safe-area-inset-bottom, 0px) + 16px); width: auto; }
}
</style>
