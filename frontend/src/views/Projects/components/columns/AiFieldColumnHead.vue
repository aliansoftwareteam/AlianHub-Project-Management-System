<template>
    <span class="afh">
        <button
            v-if="sortable"
            type="button"
            class="tv2__sort tv2__sort--col afh__sort"
            data-ai-column-sort
            :title="$t('List.sort_by', { column: field.fieldTitle })"
            @click="$emit('sort')"
        >
            <span class="tv2__sort-text"><span class="afh__mark" aria-hidden="true">✦</span> {{ field.fieldTitle }}</span><span class="tv2__sort-caret" :class="{ 'is-on': sortDir !== 0 }" aria-hidden="true">{{ sortDir === -1 ? '▼' : '▲' }}</span>
        </button>
        <span v-else class="afh__label" :title="field.fieldTitle"><span class="afh__mark" aria-hidden="true">✦</span> {{ field.fieldTitle }}</span>
        <span v-if="editable && aiOn" ref="wrapEl" class="afh__wrap">
            <button
                ref="triggerEl"
                type="button"
                class="afh__btn"
                data-ai-column-menu
                aria-haspopup="menu"
                :aria-expanded="open ? 'true' : 'false'"
                :aria-label="$t('AiFields.column_menu', { field: field.fieldTitle })"
                :title="$t('AiFields.column_menu', { field: field.fieldTitle })"
                @click.stop="toggle"
                @keydown.down.prevent="openAndFocus(0)"
            >
                <ShellIcon name="dots" :size="12" aria-hidden="true" />
            </button>
            <span v-if="open" class="afh__menu" role="menu" :aria-label="$t('AiFields.column_menu', { field: field.fieldTitle })" @keydown="onMenuKey" @click.stop>
                <button
                    v-for="(item, index) in items"
                    :key="item.key"
                    :ref="(el) => { itemEls[index] = el; }"
                    type="button"
                    role="menuitem"
                    class="afh__item"
                    :disabled="!item.ids.length"
                    @click="pick(item)"
                >{{ $t(item.label, { n: item.ids.length }) }}</button>
            </span>
        </span>
    </span>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { canUseAi } from "@/composable/aiAvailability";
import { openAiFill } from "@/composable/aiFieldFill";
import { storedEntry } from "@/views/Projects/composables/projectCustomFields";

defineOptions({ name: "AiFieldColumnHead" });

const props = defineProps({
    field: { type: Object, required: true },
    tasks: { type: Array, default: () => [] },
    editable: { type: Boolean, default: false },
    sortable: { type: Boolean, default: false },
    sortDir: { type: Number, default: 0 }
});
defineEmits(["sort"]);

const project = inject("selectedProject", null);
const aiOn = computed(() => canUseAi(project?.value ? { project: project.value } : {}));

const open = ref(false);
const triggerEl = ref(null);
const wrapEl = ref(null);
const itemEls = ref([]);

const isBlank = (value) => value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
const ids = (tasks) => tasks.map((task) => String(task._id)).filter(Boolean);

const items = computed(() => [
    { key: "all", label: "AiFields.fill_all", ids: ids(props.tasks) },
    { key: "empty", label: "AiFields.fill_empty", ids: ids(props.tasks.filter((task) => isBlank(storedEntry(task, props.field)?.fieldValue))) }
]);

function onOutside(event) {
    if (wrapEl.value && !wrapEl.value.contains(event.target)) close();
}

function close({ focus = false } = {}) {
    open.value = false;
    document.removeEventListener("mousedown", onOutside);
    if (focus) triggerEl.value?.focus();
}

async function openAndFocus(index) {
    open.value = true;
    document.addEventListener("mousedown", onOutside);
    await nextTick();
    itemEls.value[index]?.focus();
}

function toggle() {
    if (open.value) close();
    else openAndFocus(0);
}

function onMenuKey(event) {
    const current = itemEls.value.indexOf(document.activeElement);
    if (event.key === "Escape") {
        event.preventDefault();
        close({ focus: true });
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        itemEls.value[(current + step + items.value.length) % items.value.length]?.focus();
    } else if (event.key === "Tab") {
        close();
    }
}

function pick(item) {
    if (!item.ids.length) return;
    close();
    openAiFill(props.field, item.ids);
}

onBeforeUnmount(() => document.removeEventListener("mousedown", onOutside));
</script>

<style>
.afh { display: inline-flex; align-items: center; gap: 2px; min-width: 0; max-width: 100%; }
.afh__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.afh__sort { flex: 0 1 auto; }
.afh__mark { color: var(--brand); }
.afh__wrap { position: relative; display: inline-flex; flex: 0 0 auto; }
.afh__btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; padding: 0;
    border: 0; border-radius: 6px; background: none; color: var(--ink-2); cursor: pointer;
}
.afh__btn:hover { background: var(--surface-hover); color: var(--ink); }
.afh__btn:focus-visible, .afh__item:focus-visible { outline: none; box-shadow: var(--focus); }
.afh__menu {
    position: absolute; top: calc(100% + 4px); right: 0; z-index: 30;
    display: flex; flex-direction: column; min-width: 200px; max-width: min(280px, calc(100vw - 32px)); padding: 4px;
    border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow-pop, var(--shadow-modal));
    text-transform: none; letter-spacing: normal; font-weight: 400;
}
.afh__item {
    padding: 7px 10px; border: 0; border-radius: 6px; background: none; color: var(--ink);
    font: 400 12.5px/1.3 var(--font-ui); text-align: left; white-space: normal; cursor: pointer;
}
.afh__item:hover:not(:disabled) { background: var(--surface-hover); }
.afh__item:disabled { color: var(--ink-2); cursor: not-allowed; }
</style>
