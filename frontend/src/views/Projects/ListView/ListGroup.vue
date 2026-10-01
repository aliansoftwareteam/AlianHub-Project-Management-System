<template>
    <div class="lv2__group" role="rowgroup">
        <div role="row" class="lv2__aria-row"><div role="rowheader" class="lv2__group-bar">
        <label v-if="canSelect && rows.length" class="lv2__group-select" :title="left ? $t('List.select_group_loaded', { n: rows.length, total }) : null">
            <input
                type="checkbox"
                class="ah-check lv2__group-check"
                :checked="groupSelection === 'all'"
                :indeterminate.prop="groupSelection === 'some'"
                :aria-label="left ? $t('List.select_group_loaded', { n: rows.length, total }) : $t('List.select_group')"
                @change="selection.toggleGroup(rowIds)"
            />
        </label>
        <button type="button" class="lv2__group-head" :aria-expanded="!!item.isExpanded" @click="$emit('toggle')">
            <span class="lv2__group-label">
                <span class="lv2__caret" :class="{ 'lv2__caret--open': item.isExpanded }" aria-hidden="true">▸</span>
                <span class="lv2__swatch" :style="{ background: swatch }"></span>
                <span class="lv2__group-name">{{ groupName }}</span>
                <span class="lv2__group-meta">{{ headMeta }}</span>
                <span v-if="groupPoints" class="lv2__group-meta lv2__group-points">{{ $t('ViewColumns.points_total', { n: groupPoints }) }}</span>
            </span>
            <span v-if="wip" class="lv2__wip" :class="{ 'lv2__wip--over': wip.over }">{{ $t('List.wip', { used: wip.used, limit: wip.limit }) }}</span>
        </button>
        </div></div>

        <template v-if="item.isExpanded">
            <draggable
                :list="rows"
                handle=".draggable_icon"
                item-key="_id"
                tag="div"
                role="presentation"
                :group="{ name: 'lv2-task', put: putFrom('lv2-task', item) }"
                :sortable="canDrag"
                :disabled="!canDrag"
                @change="onDragChange"
            >
                <template #item="{ element: task }">
                    <div role="presentation" :data-task-type="task.TaskTypeKey">
                        <ListRow
                            :data="task"
                            :selected="selection.isSelected(task._id)"
                            :expanded="isExpanded(task._id)"
                            :progress="progressFor(task._id)"
                            :can-select="canSelect"
                            :run="agents.runFor(task._id)"
                            :proposal="agents.proposalFor(task._id)"
                            @open="$emit('open', task)"
                            @select="onSelect"
                            @toggle-subtasks="toggleSubtasks(task)"
                            @review-agent="$emit('review-agent', $event)"
                            @add-subtask="startSubtask(task)"
                        />
                        <ListSubtaskRows :parent="task" :depth="1" />
                    </div>
                </template>
            </draggable>

            <div v-if="!rows.length" role="row" class="lv2__aria-row"><div role="cell" class="lv2__aria-row">
                <p class="lv2__empty-group">{{ $t('List.group_empty') }}</p>
            </div></div>

            <div v-if="hasMore" role="row" class="lv2__aria-row"><div ref="groupEnd" role="cell" class="lv2__more">
                <button type="button" class="lv2__more-btn" :disabled="loadingMore" @click="loadMore">
                    {{ loadingMore ? $t('List.loading_more') : $t('List.load_more', { n: left }) }}
                </button>
                <span v-if="listSort.key !== 'manual'" class="lv2__more-hint">{{ $t('List.load_more_sorted', { n: rows.length }) }}</span>
            </div></div>

            <div v-if="creating" role="row" class="lv2__aria-row"><div role="cell" class="lv2__create">
                <label v-if="templates.length" class="lv2__template">
                    <span class="lv2__template-label">{{ $t('TaskTemplates.template') }}</span>
                    <select v-model="templateId" class="lv2__template-select" data-field="row-template">
                        <option value="">{{ $t('TaskTemplates.no_template') }}</option>
                        <option v-for="tpl in templates" :key="tpl._id" :value="tpl._id">{{ tpl.name }}</option>
                    </select>
                </label>
                <CreateTask
                    :sprint="sprint"
                    :assigneeOptions="project.AssigneeUserId"
                    :groupBy="groupType"
                    :groupType="groupType"
                    :considerWidth="false"
                    @cancel="creating = false"
                    @submit="onCreated"
                />
            </div></div>
            <div v-else-if="canCreate" role="row" class="lv2__aria-row"><div role="cell" class="lv2__aria-row">
                <button type="button" class="lv2__add" @click="creating = true">
                    <span class="lv2__add-plus">+</span>{{ $t('List.add_task_to', { group: groupName }) }}
                </button>
            </div></div>
        </template>
    </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, provide, ref, watch } from "vue";
import { useStore } from "vuex";
import draggable from "vuedraggable";
import ListRow from "./ListRow.vue";
import ListSubtaskRows from "./ListSubtaskRows.vue";
import { loadedChildren } from "@/store/ProjectData/taskTree";
import CreateTask from "@/components/atom/CreateTask/CreateTask.vue";
import { useCustomComposable } from "@/composable";
import { taskListHelper, useUpdateTasks } from "@/views/Projects/helper.js";
import { useTaskSelection } from "@/composable/useTaskSelection.js";
import { useListDragDrop } from "./useListDragDrop.js";
import { useProjectAgentActivity } from "./useProjectAgentActivity.js";
import { useSubtaskExpansion } from "./subtaskExpansion.js";
import { hasSubtasks, indexProgress, pendingExpandIds, progressQuery, progressSignature, treeRows as withLoadedLevels } from "./subtaskProgress";
import { groupLabel, groupRows, listSourceTasks, pagedPast, searchExpandIds } from "./listFilter";
import { apiRequest } from "@/services";
import { subtaskCreateAssignees } from "@/utils/assigneeOptions";
import * as env from "@/config/env";
import { applyContext, applyTemplate, defaultTemplateOf, listTemplates } from "@/components/molecules/TaskTemplates/taskTemplates";
import { pointsTotal } from "@/views/Projects/composables/taskPoints";
import { MANUAL, sortTasks } from "@/views/Projects/composables/viewSort";
import { groupTakesTask, putFrom } from "@/views/Projects/composables/customFieldQuery";

defineOptions({ name: "ListGroup" });

const props = defineProps({
    item: { type: Object, required: true },
    sprint: { type: Object, required: true },
    project: { type: Object, required: true },
    groupType: { type: [Number, String], default: 0 }
});
const emit = defineEmits(["toggle", "open", "review-agent"]);

const { getters } = useStore();
const { checkPermission } = useCustomComposable();
const { getSprintTasks } = taskListHelper();
const { updateTaskByGroup } = useUpdateTasks();
const selection = useTaskSelection();
const agents = useProjectAgentActivity();
const { applyDrag } = useListDragDrop();
const showArchived = inject("showArchived", ref(false));
const searchedTask = inject("searchedTask", ref(false));
const taskCollapsed = inject("taskCollapsed", ref(true));
const listSort = inject("listSort", ref(MANUAL));
const listSortContext = inject("listSortContext", ref({}));

const creating = ref(false);
const templates = ref([]);
const templateId = ref("");
const { expandedIds, autoExpandedIds } = useSubtaskExpansion();
const subtaskFor = ref("");

const sprintId = computed(() => props.sprint?.id || props.sprint?._id);
const canCreate = computed(() => !showArchived.value
    && !searchedTask.value
    && checkPermission("task.task_create", props.project?.isGlobalPermission) === true
    && checkPermission("task.task_list", props.project?.isGlobalPermission) === true);
const canSelect = computed(() => !showArchived.value && checkPermission("task.task_status", props.project?.isGlobalPermission) === true);
const canDrag = computed(() => canSelect.value && !searchedTask.value && listSort.value.key === "manual" && !props.item.dropDisabled && props.item.value !== "NO_DUE_DATE" && props.item.value !== "NEXT");

const storeTasks = computed(() => getters["projectData/tasks"]?.[props.project._id]?.[sprintId.value]?.tasks || []);
const sourceTasks = computed(() => listSourceTasks({
    searched: searchedTask.value,
    searchedTasks: getters["projectData/searchedTasks"],
    storeTasks: storeTasks.value,
    sprintId: sprintId.value
}));
const found = computed(() => (searchedTask.value
    ? null
    : getters["projectData/tasks"]?.[props.project._id]?.[sprintId.value]?.found?.[`${props.item.searchKey}_${props.item.searchValue}`] ?? null));

const groupTasks = computed(() => sortTasks(groupRows(sourceTasks.value, props.item, showArchived.value), listSort.value, {
    priorities: getters["settings/companyPriority"] || [],
    statuses: props.project?.taskStatusData || [],
    ...listSortContext.value
}));

const rows = ref([]);
watch(groupTasks, (value) => { rows.value = [...value]; }, { immediate: true, deep: true });

const groupName = computed(() => groupLabel(props.item));
const swatch = computed(() => props.item.textColor || "var(--ink-3)");

const estimateHours = computed(() => {
    const minutes = rows.value.reduce((total, task) => total + (Number(task.totalEstimatedTime) || 0), 0);
    return minutes ? Math.round(minutes / 60) : 0;
});
const listColumns = inject("listColumns", null);
const groupPoints = computed(() => (listColumns?.value?.some((column) => column.id === "points") ? pointsTotal(rows.value) : 0));
const headMeta = computed(() => {
    const count = found.value === null ? rows.value.length : found.value;
    return estimateHours.value ? `${count} · ${estimateHours.value}H` : String(count);
});

/* The header counts every task the server has in the group; `rows` are the ones loaded so far.
 * Under a filter the whole result is loaded at once, so nothing is left. */
const total = computed(() => (found.value === null ? rows.value.length : Number(found.value) || 0));
const left = computed(() => Math.max(0, total.value - rows.value.length));

const rowIds = computed(() => rows.value.map((task) => String(task._id)));
const groupSelection = computed(() => selection.groupState(rowIds.value));

const frontier = computed(() => getters["projectData/tasks"]?.[props.project._id]?.[sprintId.value]?.frontier?.[`${props.item.searchKey}_${props.item.searchValue}`] || null);
const loadingMore = ref(false);
const stalledAt = ref("");
const loadState = computed(() => `${total.value}:${rows.value.length}`);
const hasMore = computed(() => left.value > 0 && stalledAt.value !== loadState.value);

async function loadMore() {
    if (loadingMore.value || !hasMore.value) return;
    loadingMore.value = true;
    const before = loadState.value;
    try {
        await getSprintTasks({
            projectId: props.project._id,
            sprintId: sprintId.value,
            item: props.item,
            fetchNew: true,
            projectData: props.project,
            skip: pagedPast(rows.value, frontier.value, props.item.indexName) ?? undefined
        });
    } catch (error) {
        console.error("ERROR in list load more: ", error);
    }
    await nextTick();
    /* A page that brought nothing new: stop asking until the group changes. */
    if (loadState.value === before) stalledAt.value = before;
    loadingMore.value = false;
    await nextTick();
    observeGroupEnd();
}

/* Observing again after each page reports the end once more if it is still in view, so a
 * short group keeps loading until its end leaves the screen. */
const groupEnd = ref(null);
let endObserver = null;
function observeGroupEnd() {
    endObserver?.disconnect();
    endObserver = null;
    if (!groupEnd.value || typeof IntersectionObserver === "undefined") return;
    endObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root: document.getElementById("list_scroll"), rootMargin: "200px 0px" });
    endObserver.observe(groupEnd.value);
}
watch(groupEnd, observeGroupEnd, { flush: "post" });
onBeforeUnmount(() => endObserver?.disconnect());

/* WIP limits are per status and optional: the chip only exists once a status
 * carries a limit, never as a guessed number. */
const wip = computed(() => {
    if (props.item.searchKey !== "statusKey") return null;
    const limit = Number(props.item.wipLimit ?? props.project?.wipLimits?.[props.item.key]) || 0;
    if (!limit) return null;
    const used = found.value === null ? rows.value.length : found.value;
    return { used, limit, over: used > limit };
});

const isExpanded = (taskId) => expandedIds.value.includes(String(taskId));

const subtaskCounts = ref({});
const progressFor = (taskId) => subtaskCounts.value[String(taskId)] || null;

/* The group's rows with every level loaded under them: counts and the expand toggle apply to a parent on any level. */
const treeRows = computed(() => withLoadedLevels(rows.value));

function loadSubtaskCounts() {
    const ids = treeRows.value.filter(hasSubtasks).map((task) => String(task._id));
    if (!ids.length) return;
    apiRequest("post", `${env.TASK}/find`, { findQuery: progressQuery(ids) })
        .then((response) => { subtaskCounts.value = { ...subtaskCounts.value, ...indexProgress(response?.data) }; })
        .catch((error) => console.error("ERROR in list subtask progress: ", error));
}
watch(() => progressSignature(treeRows.value), loadSubtaskCounts, { immediate: true });

/* Asked every time a row opens: the store answers at once for a parent whose children it has
 * read. A row can hold a few children that arrived as events without having read them all. */
function loadSubtasks(task) {
    getSprintTasks({
        projectId: props.project._id,
        sprintId: sprintId.value,
        item: props.item,
        fetchNew: true,
        firstPageOnly: true,
        projectData: props.project,
        parentId: task._id
    });
}

function toggleSubtasks(task) {
    const id = String(task._id);
    if (isExpanded(id)) {
        expandedIds.value = expandedIds.value.filter((x) => x !== id);
        return;
    }
    expandedIds.value = [...expandedIds.value, id];
    loadSubtasks(task);
}

/* The toolbar's expand / collapse control drives every row at once, and has to keep doing
 * so for rows that arrive later -- a group opened after the toggle was flipped loads its
 * tasks only then. */
function expandArrivedRows() {
    if (searchedTask.value) {
        expandedIds.value = [...new Set([...expandedIds.value, ...searchExpandIds(treeRows.value)])];
        return;
    }
    if (taskCollapsed.value) return;
    const pending = pendingExpandIds(treeRows.value, autoExpandedIds.value);
    if (!pending.length) return;
    autoExpandedIds.value = [...autoExpandedIds.value, ...pending];
    expandedIds.value = [...new Set([...expandedIds.value, ...pending])];
    treeRows.value.filter((task) => pending.includes(String(task._id))).forEach(loadSubtasks);
}
/* Rows are replaced on every change to a task or a subtask in the group, so only the
 * toolbar switch itself may close what the user opened by hand. */
watch(rows, expandArrivedRows, { immediate: true });
watch(taskCollapsed, (collapsed) => {
    if (collapsed && !searchedTask.value) {
        expandedIds.value = [];
        autoExpandedIds.value = [];
        return;
    }
    expandArrivedRows();
});

/* A searched row carries only its matching subtasks; when none matched, expanding it shows
   the full set read into the sprint's own copy of the task. */
function subtasksOf(task) {
    if (task.subtaskArray?.length || !searchedTask.value) return task.subtaskArray || [];
    return loadedChildren(getters["projectData/tasks"]?.[props.project._id]?.[sprintId.value], task._id);
}

function visibleSubtasks(task) {
    return subtasksOf(task).filter((sub) => (showArchived.value ? sub.deletedStatusKey === 2 : !sub.deletedStatusKey));
}

const companyUsers = computed(() => (getters["settings/companyUsers"] || []).map((x) => x.userId));
const subtaskAssignees = (task) => subtaskCreateAssignees({ parent: task, project: props.project, companyUsers: companyUsers.value });

function startSubtask(task) {
    const id = String(task._id);
    if (!isExpanded(id)) toggleSubtasks(task);
    subtaskFor.value = id;
}

/* Every row is picked on its own. The server carries a task's subtasks with it, so ticking
 * them too would only add rows it then skips; and ticking a parent because its subtasks are
 * all ticked would pull it into the bulk change. */
function onSelect(task, event) {
    selection.selectFromEvent(task, event, ".lv2", { rowsAlone: true });
}

provide("listGroupTree", {
    isExpanded,
    childrenOf: visibleSubtasks,
    progressFor,
    isSelected: (taskId) => selection.isSelected(taskId),
    canSelect,
    subtaskFor,
    select: onSelect,
    toggle: toggleSubtasks,
    startSubtask,
    cancelSubtask: () => { subtaskFor.value = ""; },
    createAssignees: subtaskAssignees,
    open: (task) => emit("open", task)
});

function onDragChange(event) {
    applyDrag({ event, item: props.item, groupType: props.groupType, rows: rows.value, project: props.project });
}

watch(creating, (on) => {
    if (!on) return;
    const pid = String(props.project._id);
    listTemplates(pid)
        .then((found) => {
            if (String(props.project._id) !== pid) return;
            templates.value = found;
            if (!templateId.value) templateId.value = defaultTemplateOf(found)?._id || "";
        })
        .catch((error) => console.error("ERROR in list templates: ", error));
});

/* The add row picks its own type and priority by default, so the template chosen in the same row replaces them. */
function applyRowTemplate(created) {
    if (!templateId.value || !created._id) return;
    applyTemplate(templateId.value, { taskId: String(created._id), overwrite: ["type", "priority"], ...applyContext() })
        .catch((error) => console.error("ERROR in list template apply: ", error));
}

function onCreated(payload) {
    const created = payload?.data;
    if (!created) return;
    applyRowTemplate(created);
    if (props.groupType === 0 && created.statusKey !== props.item.key) {
        updateTaskByGroup({ ...created, _id: created._id }, props.item, 0).catch((error) => console.error("ERROR in list inline add: ", error));
    }
    if (props.item.customFieldId && !props.item.dropDisabled && props.item.searchValue !== "" && props.item.searchValue !== false && groupTakesTask(props.item, created.TaskTypeKey)) {
        updateTaskByGroup({ ...created }, props.item, props.groupType).catch((error) => console.error("ERROR in list inline add: ", error));
    }
}
</script>
