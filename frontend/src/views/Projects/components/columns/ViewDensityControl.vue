<template>
    <span ref="root" class="vdc" @click.stop>
        <button
            ref="trigger"
            type="button"
            class="vdc__trigger"
            :class="{ 'is-on': modelValue !== densities[0] }"
            :aria-label="$t('ViewDensity.title')"
            :title="$t('ViewDensity.title')"
            aria-haspopup="dialog"
            :aria-expanded="open ? 'true' : 'false'"
            @click="toggle"
        ><ShellIcon name="menu" :size="14" /></button>
        <div v-if="open" ref="panel" class="vdc__panel" role="dialog" :aria-label="$t('ViewDensity.title')" @keydown.esc.stop.prevent="close(true)">
            <fieldset class="vdc__set">
                <legend class="vdc__legend">{{ $t('ViewDensity.title') }}</legend>
                <label v-for="density in densities" :key="density" class="vdc__option">
                    <input type="radio" name="vdc-density" :value="density" :checked="modelValue === density" @change="$emit('update:modelValue', density)" />
                    <span>{{ $t(`ViewDensity.${density}`) }}</span>
                </label>
            </fieldset>
        </div>
    </span>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { VIEW_DENSITIES } from "@/views/Projects/composables/savedViewSettings";

defineOptions({ name: "ViewDensityControl" });

defineProps({
    modelValue: { type: String, default: VIEW_DENSITIES[0] }
});
defineEmits(["update:modelValue"]);

const densities = VIEW_DENSITIES;
const open = ref(false);
const root = ref(null);
const trigger = ref(null);
const panel = ref(null);

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
.vdc { position: relative; display: inline-flex; text-transform: none; letter-spacing: normal; }
.vdc__trigger {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0;
    border: 0; border-radius: 6px;
    background: none; color: var(--ink-2); cursor: pointer;
}
.vdc__trigger:hover, .vdc__trigger[aria-expanded="true"] { background: var(--surface-hover); color: var(--ink); }
.vdc__trigger.is-on { color: var(--brand); }
.vdc__trigger:focus-visible { outline: none; box-shadow: var(--focus); }
.vdc__panel {
    position: absolute; top: 28px; right: 0; z-index: 20;
    width: 200px; max-width: calc(100vw - 32px);
    padding: 10px;
    background: var(--surface); color: var(--ink);
    border: 1px solid var(--border); border-radius: var(--r-card);
    box-shadow: var(--shadow-pop);
    font: var(--text-small); text-align: left;
}
.vdc__set { border: 0; margin: 0; padding: 0; min-width: 0; }
.vdc__legend { margin: 0 0 4px; padding: 0; font: var(--text-label); color: var(--ink-label); text-transform: uppercase; letter-spacing: .06em; }
.vdc__option { display: flex; align-items: center; gap: 8px; min-height: var(--hit-min); margin: 0; padding: 0 2px; border-radius: 6px; cursor: pointer; }
.vdc__option:hover { background: var(--surface-hover); }
.vdc__option input { accent-color: var(--brand); margin: 0; flex: none; }
.vdc__option input:focus-visible { outline: none; box-shadow: var(--focus); }

/* A phone keeps the comfortable rows whatever the view says, so the choice would do nothing there. */
@media (max-width: 767px) {
    .vdc { display: none; }
}
</style>
