<template>
    <div class="ah-page evr">
        <header class="ah-toolbar evr__toolbar">
            <h1 class="ah-toolbar__title">{{ $t('Everything.title') }}</h1>
            <span v-if="status === 'ready' && showTotal" class="evr__total" data-test="evr-total">{{ $t('Everything.count', { n: total }) }}</span>
        </header>

        <div class="evr__controls" role="search">
            <label class="evr__search-wrap">
                <ShellIcon name="search" :size="14" aria-hidden="true" />
                <input
                    v-model="searchText"
                    type="search"
                    class="ah-input evr__search"
                    :placeholder="$t('Everything.search')"
                    :aria-label="$t('Everything.search')"
                    data-test="evr-search"
                    @input="onSearch"
                />
            </label>
            <button type="button" class="evr__chip" :class="{ 'is-on': onlyMe }" :aria-pressed="onlyMe ? 'true' : 'false'" data-test="evr-me" @click="toggleMe">
                {{ $t('Everything.me') }}
            </button>
            <EverythingFilterChip name="status" :label="$t('Everything.filter_status')" :options="statusOptions" :modelValue="settings.status" @update:modelValue="(value) => apply({ status: value })" />
            <EverythingFilterChip name="assignee" :label="$t('Everything.filter_assignee')" :options="assigneeOptions" :modelValue="settings.assignee" @update:modelValue="(value) => apply({ assignee: value })" />
            <EverythingFilterChip name="priority" :label="$t('Everything.filter_priority')" :options="priorityOptions" :modelValue="settings.priority" @update:modelValue="(value) => apply({ priority: value })" />
            <EverythingFilterChip name="due" single :label="$t('Everything.filter_due')" :options="dueOptions" :modelValue="settings.due ? [settings.due] : []" @update:modelValue="(value) => apply({ due: value[0] || '' })" />
            <EverythingFilterChip name="type" :label="$t('Everything.filter_type')" :options="typeOptions" :modelValue="settings.taskType" @update:modelValue="(value) => apply({ taskType: value })" />
            <EverythingFilterChip name="project" :label="$t('Everything.filter_project')" :options="projectOptions" :modelValue="settings.projectIds" @update:modelValue="(value) => apply({ projectIds: value })" />
            <button v-if="filtered" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="evr-clear-all" @click="clearFilters">{{ $t('Everything.clear_filters') }}</button>

            <div class="evr__view">
                <label class="evr__pick">
                    <span class="evr__pick-label">{{ $t('Everything.group_by') }}</span>
                    <select class="ah-input evr__select" :value="settings.group" data-test="evr-group" @change="apply({ group: $event.target.value })">
                        <option v-for="kind in GROUPS" :key="kind" :value="kind">{{ $t(`Everything.group_${kind}`) }}</option>
                    </select>
                </label>
                <label class="evr__pick">
                    <span class="evr__pick-label">{{ $t('Everything.sort_by') }}</span>
                    <select class="ah-input evr__select" :value="sortValue" data-test="evr-sort" @change="onSort($event.target.value)">
                        <option v-for="option in SORTS" :key="option.value" :value="option.value">{{ $t(option.label) }}</option>
                    </select>
                </label>
                <label class="evr__toggle"><input type="checkbox" class="ah-check" :checked="settings.showSubtasks" data-test="evr-subtasks" @change="apply({ showSubtasks: $event.target.checked })" />{{ $t('Everything.show_subtasks') }}</label>
                <label class="evr__toggle"><input type="checkbox" class="ah-check" :checked="settings.hideDone" data-test="evr-hide-done" @change="apply({ hideDone: $event.target.checked })" />{{ $t('Everything.hide_done') }}</label>
                <label class="evr__toggle"><input type="checkbox" class="ah-check" :checked="settings.includeClosed" data-test="evr-closed" @change="apply({ includeClosed: $event.target.checked })" />{{ $t('Everything.include_closed') }}</label>
            </div>
        </div>

        <div ref="body" class="evr__body ah-scroll" :aria-busy="status === 'loading' ? 'true' : 'false'">
            <div v-if="status === 'loading' || status === 'idle'" class="evr__skeleton" data-test="evr-loading" role="status" :aria-label="$t('Everything.loading')">
                <span v-for="n in 8" :key="n" class="evr__skeleton-row"></span>
            </div>
            <div v-else-if="status === 'error'" class="ah-empty evr__state" role="alert" data-test="evr-error">
                <strong>{{ $t('Everything.error_title') }}</strong>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="evr-retry" @click="reload()">{{ $t('Everything.retry') }}</button>
            </div>
            <div v-else-if="!total" class="ah-empty evr__state" data-test="evr-empty">
                <strong>{{ $t(filtered ? 'Everything.empty_title' : 'Everything.empty_none_title') }}</strong>
                <span>{{ $t(filtered ? 'Everything.empty_hint' : 'Everything.empty_none_hint') }}</span>
                <button v-if="filtered" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="clearFilters">{{ $t('Everything.clear_filters') }}</button>
            </div>
            <template v-else>
                <EverythingGroup
                    v-for="group in groups"
                    :key="group.id"
                    :group="group"
                    :label="labelOf(group)"
                    :color="colorOf(group)"
                    :showHead="settings.group !== 'none'"
                    :projects="projects"
                    @load="queueGroup"
                    @open="openRow"
                    @status="edit.setStatus"
                    @priority="edit.setPriority"
                />
            </template>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { onTaskClosed, openTask, useTaskSequenceSource } from "@/components/organisms/TaskDetailOverlay/useTaskOverlay";
import { useGetterFunctions } from "@/composable";
import { projectColor } from "@/components/molecules/Home/homeFormat";
import EverythingFilterChip from "./EverythingFilterChip.vue";
import EverythingGroup from "./EverythingGroup.vue";
import { DEFAULT_SETTINGS, DUE_BUCKETS, GROUPS, UNASSIGNED, dueWindows } from "./everythingRequest";
import { readSettings, writeSettings } from "./everythingSettings";
import { useEverythingEdit } from "./useEverythingEdit";
import "@/views/Projects/ListView/style.css";
import "./style.css";

defineOptions({ name: "EverythingPage" });

const SEARCH_DELAY_MS = 300;
const GROUPS_AT_ONCE = 3;
const RETURN_GAP_MS = 1000;
const SORTS = [
    { value: "updatedAt:desc", label: "Everything.sort_updated_desc" },
    { value: "updatedAt:asc", label: "Everything.sort_updated_asc" },
    { value: "DueDate:asc", label: "Everything.sort_due_asc" },
    { value: "DueDate:desc", label: "Everything.sort_due_desc" }
];
const DUE_LABELS = { overdue: "List.due_group_overdue", today: "List.due_group_today", week: "List.due_group_this_week", later: "List.due_group_later", none: "List.due_group_none" };
const FILTER_KEYS = ["search", "status", "assignee", "priority", "taskType", "projectIds", "due"];

const store = useStore();
const { t } = useI18n();
const { getUser } = useGetterFunctions();
const companyId = inject("$companyId", ref(""));
const userId = inject("$userId", ref(""));

const settings = computed(() => store.getters["everything/settings"]);
const status = computed(() => store.getters["everything/status"]);
const groups = computed(() => store.getters["everything/groups"]);
const projects = computed(() => store.getters["everything/projects"]);
const total = computed(() => store.getters["everything/total"]);
/* A task counts under each of its assignees, so those counts do not add up to a number of tasks. */
const showTotal = computed(() => settings.value.group !== "assignee");

const body = ref(null);
const searchText = ref("");
let searchTimer = null;

const allProjects = computed(() => (store.getters["projectData/allProjects"]?.data || []).filter((project) => !project.deletedStatusKey));
const uniqueBy = (list, keyOf) => [...new Map(list.map((item) => [keyOf(item), item])).values()];
const byLabel = (a, b) => String(a.label).localeCompare(String(b.label));

const statusOptions = computed(() => uniqueBy(allProjects.value.flatMap((project) => project.taskStatusData || []).filter((s) => s?.name), (s) => s.name)
    .map((s) => ({ value: s.name, label: s.name, color: s.textColor || "" })).sort(byLabel));
const typeOptions = computed(() => uniqueBy(allProjects.value.flatMap((project) => project.taskTypeCounts || []).filter((type) => type?.value), (type) => type.value)
    .map((type) => ({ value: type.value, label: type.name || type.value })).sort(byLabel));
const projectOptions = computed(() => allProjects.value
    .filter((project) => settings.value.includeClosed || project.statusType !== "close")
    .map((project) => ({ value: String(project._id), label: project.ProjectName, color: projectColor(project) })).sort(byLabel));
const priorityOptions = computed(() => (store.getters["settings/companyPriority"] || [])
    .filter((priority) => priority?.value && priority.name && priority.name !== "N/A")
    .map((priority) => ({ value: priority.value, label: priority.name })));
const assigneeOptions = computed(() => [
    { value: UNASSIGNED, label: t("Everything.unassigned") },
    ...(store.getters["settings/companyUsers"] || [])
        .filter((seat) => seat?.userId && seat.isDelete !== true)
        .map((seat) => ({ value: String(seat.userId), label: getUser(seat.userId)?.Employee_Name || "" }))
        .filter((option) => option.label)
        .sort(byLabel)
]);
const dueOptions = computed(() => {
    const available = dueWindows(new Date(), timeZone()).filters;
    return DUE_BUCKETS.filter((id) => available[id]).map((id) => ({ value: id, label: t(DUE_LABELS[id]) }));
});

const onlyMe = computed(() => settings.value.assignee.length === 1 && settings.value.assignee[0] === userId.value);
const filtered = computed(() => FILTER_KEYS.some((key) => (Array.isArray(settings.value[key]) ? settings.value[key].length : Boolean(settings.value[key]))));
const sortValue = computed(() => `${settings.value.sortBy}:${settings.value.sortDir}`);

function timeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function labelOf(group) {
    const kind = settings.value.group;
    if (kind === "assignee") return group.key === null ? t("Everything.unassigned") : (getUser(group.key)?.Employee_Name || t("Everything.someone"));
    if (kind === "project") return projects.value[group.key]?.ProjectName || allProjects.value.find((project) => String(project._id) === group.key)?.ProjectName || "";
    if (kind === "priority") return (store.getters["settings/companyPriority"] || []).find((priority) => priority.value === group.key)?.name || group.key;
    if (kind === "dueDate") return t(DUE_LABELS[group.key]);
    return group.key || "";
}

function colorOf(group) {
    if (settings.value.group === "project") return projectColor(projects.value[group.key]);
    if (settings.value.group === "status") return statusOptions.value.find((option) => option.value === group.key)?.color || "";
    return "";
}

function apply(patch) {
    const next = { ...settings.value, ...patch };
    writeSettings(companyId.value, userId.value, next);
    return store.dispatch("everything/applySettings", { settings: patch });
}

function onSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => apply({ search: searchText.value }), SEARCH_DELAY_MS);
}

function onSort(value) {
    const [sortBy, sortDir] = value.split(":");
    apply({ sortBy, sortDir });
}

const toggleMe = () => apply({ assignee: onlyMe.value ? [] : [userId.value] });

function clearFilters() {
    clearTimeout(searchTimer);
    searchText.value = "";
    apply(Object.fromEntries(FILTER_KEYS.map((key) => [key, DEFAULT_SETTINGS[key]])));
}

const reload = (options = {}) => store.dispatch("everything/load", options);
const refresh = () => { if (status.value === "ready") reload({ quiet: true }); };
/* Coming back to the tab fires both a focus and a visibility change. */
let returnedAt = 0;
function refreshOnReturn() {
    if (Date.now() - returnedAt < RETURN_GAP_MS) return;
    returnedAt = Date.now();
    refresh();
}

/* Each group on screen asks for its rows as it scrolls into view; with fifty projects in view that
 * is fifty requests at once, so they wait their turn. */
const waiting = [];
let running = 0;
function queueGroup(id) {
    if (!waiting.includes(id)) waiting.push(id);
    pump();
}
function pump() {
    while (running < GROUPS_AT_ONCE && waiting.length) {
        running += 1;
        store.dispatch("everything/loadGroup", { id: waiting.shift() }).finally(() => {
            running -= 1;
            pump();
        });
    }
}

function openRow(task) {
    openTask({
        companyId: companyId.value,
        projectId: task.ProjectID,
        sprintId: task.sprintId,
        folderId: task.folderObjId || "",
        taskId: task._id
    });
}

const edit = useEverythingEdit({ onChanged: refresh });
useTaskSequenceSource(body);
const stopOnTaskClosed = onTaskClosed(refresh);
const onVisible = () => { if (document.visibilityState === "visible") refreshOnReturn(); };

onMounted(() => {
    const saved = readSettings(companyId.value, userId.value);
    const available = dueWindows(new Date(), timeZone()).filters;
    store.commit("everything/setSettings", { ...saved, search: "", due: available[saved.due] ? saved.due : "" });
    reload();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refreshOnReturn);
});
onUnmounted(() => {
    clearTimeout(searchTimer);
    stopOnTaskClosed();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", refreshOnReturn);
});
</script>
