<template>
    <span ref="root" class="vcc" @click.stop>
        <button
            ref="trigger"
            type="button"
            class="vcc__trigger"
            :aria-label="$t(titleKey)"
            :title="$t(titleKey)"
            aria-haspopup="dialog"
            :aria-expanded="open ? 'true' : 'false'"
            @click="toggle"
        ><ShellIcon name="layout" :size="14" /></button>
        <div
            v-if="open"
            ref="panel"
            class="vcc__panel"
            role="dialog"
            :aria-label="$t(titleKey)"
            @keydown.esc.stop.prevent="close(true)"
        >
            <p class="vcc__title">{{ $t(titleKey) }}</p>
            <p v-if="!columns.length" class="vcc__empty">{{ $t('ViewColumns.none') }}</p>
            <ul class="vcc__list">
                <li v-for="(column, index) in columns" :key="column.id" class="vcc__item" :data-column="column.id">
                    <label class="vcc__label">
                        <input
                            type="checkbox"
                            class="ah-check"
                            :checked="column.visible"
                            @change="$emit('toggle', column.id, $event.target.checked)"
                        />
                        <span class="vcc__name">{{ nameOf(column) }}</span>
                        <span v-if="column.field" class="vcc__kind">{{ $t('ViewColumns.field_badge') }}</span>
                    </label>
                    <button
                        type="button"
                        class="vcc__move"
                        :disabled="index === 0"
                        :aria-label="$t('ViewColumns.move_up', { name: nameOf(column) })"
                        :title="$t('ViewColumns.move_up', { name: nameOf(column) })"
                        @click="move(column.id, -1)"
                    >↑</button>
                    <button
                        type="button"
                        class="vcc__move"
                        :disabled="index === columns.length - 1"
                        :aria-label="$t('ViewColumns.move_down', { name: nameOf(column) })"
                        :title="$t('ViewColumns.move_down', { name: nameOf(column) })"
                        @click="move(column.id, 1)"
                    >↓</button>
                </li>
            </ul>
            <button type="button" class="vcc__reset" @click="$emit('reset')">{{ $t('ViewColumns.reset') }}</button>
        </div>
    </span>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

defineOptions({ name: "ViewColumnChooser" });

defineProps({
    columns: { type: Array, default: () => [] },
    titleKey: { type: String, default: "ViewColumns.title" }
});
const emit = defineEmits(["toggle", "move", "reset"]);

const { t } = useI18n();
const open = ref(false);
const root = ref(null);
const trigger = ref(null);
const panel = ref(null);

const nameOf = (column) => column.label || t(column.labelKey);

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
    nextTick(() => panel.value?.querySelector("input")?.focus());
}

/* The row moves under the pointer, so focus follows the moved column's button. */
function move(id, delta) {
    emit("move", id, delta);
    nextTick(() => {
        const item = [...(panel.value?.querySelectorAll(".vcc__item") || [])].find((node) => node.dataset.column === id);
        const buttons = item ? [...item.querySelectorAll(".vcc__move")] : [];
        const target = buttons[delta < 0 ? 0 : 1];
        (target && !target.disabled ? target : buttons.find((button) => !button.disabled))?.focus();
    });
}

onBeforeUnmount(() => document.removeEventListener("mousedown", onOutside, true));
</script>

<style>
.vcc { position: relative; display: inline-flex; text-transform: none; letter-spacing: normal; }
.vcc__trigger {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0;
    border: 0; border-radius: 6px;
    background: none; color: var(--ink-2); cursor: pointer;
}
.vcc__trigger:hover, .vcc__trigger[aria-expanded="true"] { background: var(--surface-hover); color: var(--ink); }
.vcc__trigger:focus-visible { outline: none; box-shadow: var(--focus); }
.vcc__panel {
    position: absolute; top: 28px; right: 0; z-index: 20;
    width: 260px; max-width: calc(100vw - 32px); max-height: 360px; overflow-y: auto;
    padding: 10px;
    background: var(--surface); color: var(--ink);
    border: 1px solid var(--border); border-radius: var(--r-card);
    box-shadow: var(--shadow-pop, 0 8px 24px rgba(0, 0, 0, .16));
    font: var(--text-small); text-align: left;
}
.vcc__title { margin: 0 0 6px; font: var(--text-label); color: var(--ink-label); text-transform: uppercase; letter-spacing: .06em; }
.vcc__empty { margin: 0 0 6px; color: var(--ink-2); }
.vcc__list { list-style: none; margin: 0; padding: 0; }
.vcc__item { display: flex; align-items: center; gap: 4px; padding: 2px 0; }
.vcc__label { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; cursor: pointer; margin: 0; }
.vcc__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vcc__kind { font: 500 10px/1 var(--font-mono); color: var(--ink-label); }
.vcc__move {
    width: 24px; height: 24px; padding: 0;
    border: 0; border-radius: 6px; background: none; color: var(--ink-2); cursor: pointer;
}
.vcc__move:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
.vcc__move:disabled { opacity: .35; cursor: default; }
.vcc__move:focus-visible, .vcc__reset:focus-visible { outline: none; box-shadow: var(--focus); }
.vcc__reset {
    margin-top: 8px; padding: 4px 8px;
    border: 1px solid var(--border); border-radius: var(--r-input);
    background: var(--surface); color: var(--ink); cursor: pointer; font: inherit;
}
.vcc__reset:hover { background: var(--surface-hover); }
</style>
