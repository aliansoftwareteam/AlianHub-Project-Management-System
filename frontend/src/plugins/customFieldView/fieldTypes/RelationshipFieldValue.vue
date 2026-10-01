<template>
    <span ref="root" class="ftrl" :class="{ 'ftrl--compact': compact }">
        <button
            v-for="link in shown"
            :key="link.id"
            type="button"
            class="ftrl__chip"
            data-link
            :title="$t('FieldTypes.relationship_open', { task: nameOf(link) })"
            @click.stop="open(link)"
        >
            <span v-if="link.key" class="ftrl__key">{{ link.key }}</span> <span class="ftrl__title">{{ link.title }}</span>
        </button>
        <span v-if="hidden" class="ftrl__more" aria-hidden="true">+{{ hidden }}</span>
        <button
            v-if="editable"
            ref="trigger"
            type="button"
            class="ftrl__add"
            :class="{ 'is-empty': !links.length }"
            data-link-add
            data-cell-edit
            aria-haspopup="dialog"
            :aria-expanded="picking ? 'true' : 'false'"
            :aria-label="$t('FieldTypes.relationship_edit', { field: label })"
            :title="$t('FieldTypes.relationship_edit', { field: label })"
            @click.stop="toggle"
        >
            <ShellIcon :name="links.length ? 'edit' : 'plus'" :size="12" />
        </button>
        <div
            v-if="picking"
            class="ftrl__picker"
            :class="{ 'ftrl__picker--pop': compact }"
            :style="compact ? popStyle : null"
            role="dialog"
            :aria-label="$t('FieldTypes.relationship_picker', { field: label })"
            @keydown.esc.stop="close({ focus: true })"
            @click.stop
        >
            <div v-for="link in links" :key="link.id" class="ftrl__row">
                <span class="ftrl__name"><span v-if="link.key" class="ftrl__key">{{ link.key }}</span> {{ link.title }}</span>
                <button
                    type="button"
                    class="ftrl__remove"
                    data-link-remove
                    :aria-label="$t('FieldTypes.relationship_remove', { task: nameOf(link) })"
                    :title="$t('FieldTypes.relationship_remove', { task: nameOf(link) })"
                    @click="remove(link)"
                >
                    <ShellIcon name="x" :size="12" />
                </button>
            </div>
            <p v-if="full" class="ftrl__note">{{ $t('FieldTypes.relationship_full', { max }) }}</p>
            <template v-else>
                <input
                    v-model="query"
                    type="text"
                    class="ah-input ftrl__search"
                    data-link-search
                    :aria-label="$t('Projects.search_task')"
                    :placeholder="$t('Projects.search_task')"
                    @input="onSearch"
                />
                <p v-if="searching" class="ftrl__note">{{ $t('Projects.searching') }}</p>
                <template v-else-if="results.length">
                    <button v-for="result in results" :key="result.id" type="button" class="ftrl__result" data-link-result @click="add(result)">
                        <span v-if="result.key" class="ftrl__key">{{ result.key }}</span> <span class="ftrl__title">{{ result.title }}</span>
                    </button>
                </template>
                <p v-else-if="query.trim()" class="ftrl__note">{{ $t('Projects.no_tasks_found') }}</p>
            </template>
        </div>
    </span>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, unref, watch } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { openTask } from "@/components/organisms/TaskDetailOverlay/useTaskOverlay";
import { linksOf, maxOf } from "@fieldTypes/relationship";
import { linkedValue } from "./fieldLinks";
import { useTaskSearch } from "./taskSearch";

defineOptions({ name: "RelationshipFieldValue" });

const props = defineProps({
    def: { type: Object, required: true },
    value: { type: [Array, String, Number], default: null },
    task: { type: Object, default: () => ({}) },
    editable: { type: Boolean, default: false },
    compact: { type: Boolean, default: false },
    label: { type: String, default: "" }
});
const emit = defineEmits(["change"]);

const POP_WIDTH = 320;
const GUTTER = 8;

const companyId = inject("$companyId", "");

const root = ref(null);
const trigger = ref(null);
const picking = ref(false);
const popStyle = ref({});
/* What the person just chose, shown until the server's answer for the new marker arrives. */
const chosen = ref(null);

const revision = computed(() => props.task?.customField?.[props.def._id]?.revision);
const links = computed(() => chosen.value || linksOf(linkedValue(props.task, props.def._id)));
const max = computed(() => maxOf(props.def));
const full = computed(() => links.value.length >= max.value);
const shown = computed(() => (props.compact ? links.value.slice(0, 1) : links.value));
const hidden = computed(() => links.value.length - shown.value.length);

const { query, results, searching, onSearch, clear } = useTaskSearch({
    definition: () => props.def,
    held: () => [props.task?._id || "", ...links.value.map((link) => link.id)]
});

const nameOf = (link) => [link.key, link.title].filter(Boolean).join(" ");

watch(revision, (now) => {
    if (typeof now === "number") chosen.value = null;
});

function open(link) {
    openTask({ companyId: unref(companyId), projectId: link.projectId, sprintId: link.sprintId, folderId: link.folderId, taskId: link.id });
}

function write(next) {
    chosen.value = next;
    emit("change", next.map((link) => link.id));
}

function remove(link) {
    write(links.value.filter((held) => held.id !== link.id));
}

function add(result) {
    if (full.value) return;
    write([...links.value, result]);
    clear();
}

function onOutside(event) {
    if (root.value && !root.value.contains(event.target)) close();
}

/* A cell clips what overflows it, so the picker is placed on the viewport under its button. */
function place() {
    const rect = trigger.value.getBoundingClientRect();
    const width = Math.min(POP_WIDTH, window.innerWidth - GUTTER * 2);
    const left = Math.max(GUTTER, Math.min(rect.left, window.innerWidth - width - GUTTER));
    popStyle.value = { top: `${rect.bottom + 4}px`, left: `${left}px`, width: `${width}px` };
}

function close({ focus = false } = {}) {
    if (!picking.value) return;
    picking.value = false;
    clear();
    document.removeEventListener("mousedown", onOutside);
    if (focus) nextTick(() => trigger.value?.focus());
}

function toggle() {
    if (picking.value) return close();
    if (props.compact) place();
    picking.value = true;
    document.addEventListener("mousedown", onOutside);
    return nextTick(() => root.value?.querySelector("[data-link-search], [data-link-remove]")?.focus());
}

onBeforeUnmount(() => document.removeEventListener("mousedown", onOutside));
</script>

<style>
.ftrl { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; min-width: 0; max-width: 100%; }
.ftrl--compact { flex-wrap: nowrap; }
.ftrl__chip {
    display: inline-flex; align-items: center; gap: 4px;
    min-width: 0; max-width: 100%; min-height: 24px; padding: 1px 8px;
    border: 1px solid var(--border); border-radius: 999px;
    background: var(--surface); color: var(--ink); font: var(--text-small); text-align: left; cursor: pointer;
}
.ftrl__chip:hover { background: var(--surface-hover); border-color: var(--brand); }
.ftrl__chip:focus-visible, .ftrl__add:focus-visible, .ftrl__remove:focus-visible, .ftrl__result:focus-visible { outline: none; box-shadow: var(--focus); }
.ftrl__key { flex: none; color: var(--ink-2); font: var(--text-data); }
.ftrl__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ftrl__more { flex: none; color: var(--ink-2); font: var(--text-small); }
.ftrl__add, .ftrl__remove {
    flex: none; display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0;
    border: 0; border-radius: 6px;
    background: none; color: var(--ink-2); cursor: pointer;
}
.ftrl__add:hover, .ftrl__remove:hover { background: var(--surface-hover); color: var(--ink); }
.ftrl--compact .ftrl__add { opacity: 0; transition: opacity var(--t-state) var(--ease); }
[role="row"]:hover .ftrl__add, [role="row"]:focus-within .ftrl__add, .ftrl__add:focus-visible, .ftrl__add[aria-expanded="true"] { opacity: 1; }
.ftrl__picker { flex: 1 1 100%; display: flex; flex-direction: column; gap: 4px; min-width: 0; border-radius: 8px; }
.ftrl__picker--pop {
    position: fixed; z-index: 40;
    max-height: min(360px, 60vh); overflow-y: auto; padding: 8px;
    border: 1px solid var(--border);
    background: var(--surface); box-shadow: var(--shadow-pop, var(--shadow-modal));
}
.ftrl__row { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 28px; }
.ftrl__name { flex: 1 1 auto; min-width: 0; color: var(--ink); font: var(--text-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ah-input.ftrl__search { width: 100%; min-width: 0; height: 32px; }
.ftrl__result {
    display: flex; align-items: center; gap: 8px;
    min-width: 0; min-height: 32px; padding: 4px 8px;
    border: 0; border-radius: 6px;
    background: none; color: var(--ink); font: var(--text-body); text-align: left; cursor: pointer;
}
.ftrl__result:hover { background: var(--surface-hover); }
.ftrl__note { margin: 0; color: var(--ink-2); font: var(--text-small); }
@media (max-width: 767px) {
    .ftrl--compact .ftrl__add { opacity: 1; }
    .ah-input.ftrl__search { height: 40px; font-size: 16px; }
    .ftrl__result { min-height: 40px; }
}
</style>
