<template>
    <div role="rowgroup">
        <div class="tv2__group" role="row">
            <span role="cell" :aria-colspan="columnCount" class="tv2__group-cell">
                <label v-if="canGroupSelect && groupTaskIds.length" class="tv2__group-select" @click.stop>
                    <input
                        type="checkbox"
                        class="ah-check"
                        :checked="groupCheckboxState === 'all'"
                        :indeterminate.prop="groupCheckboxState === 'some'"
                        :aria-label="$t('List.select_group')"
                        @click.stop
                        @change="selection.toggleGroup(groupTaskIds)"
                    />
                </label>
                <span class="ah-chip ah-status-ink" :style="chipStyle">{{ groupLabel }}</span>
                <span v-if="hasFetched || tasks.length" class="tv2__group-count">{{ tasks.length }}</span>
                <span v-if="showPoints && groupPoints" class="tv2__points-total">{{ $t('ViewColumns.points_total', { n: groupPoints }) }}</span>
            </span>
        </div>

        <template v-if="!isLoading">
            <template v-for="task in tasks" :key="task._id">
                <TableRow
                    :data="task"
                    :selected="selection.isSelected(task._id)"
                    :can-select="canGroupSelect"
                    :expanded="subtasks.isExpanded(task._id)"
                    :has-subtasks="subtasks.hasChildren(task)"
                    :progress="subtasks.progressFor(task)"
                    @open="$emit('open', $event)"
                    @select="selectRow"
                    @toggle-subtasks="subtasks.toggle(task, data)"
                />
                <TableSubtaskRows :parent="task" :depth="1" />
            </template>
        </template>
        <template v-else>
            <Skelaton v-for="i in 4" :key="i" class="tv2__skeleton" />
        </template>

        <div v-if="showTotals" role="row" class="tv2__totals" data-group-totals>
            <span role="cell" class="tv2__c-select"></span>
            <span role="cell" class="tv2__c-name tv2__totals-label">{{ $t('List.group_total') }}</span>
            <span
                v-for="column in tableColumns"
                :key="column.id"
                role="cell"
                class="tv2__totals-cell"
                :data-total="column.id"
                :title="totalOf(column) ? $t('List.group_total_of', { field: column.field ? column.label : $t(column.labelKey), value: totalOf(column) }) : null"
            >{{ totalOf(column) }}</span>
        </div>

        <div :id="`table_list_item_${sprintId}_${data.key}`" class="tv2__sentinel"></div>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, onUnmounted, provide, ref, watch } from "vue";
import { useStore } from "vuex";
import TableRow from "./TableRow.vue";
import TableSubtaskRows from "./TableSubtaskRows.vue";
import { parentIdOf } from "@/store/ProjectData/taskTree";
import { inList } from "@/store/ProjectData/listMembership";
import { useSubtaskTree } from "@/views/Projects/composables/subtaskTree";
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { taskInGroup } from "@/views/Projects/ListView/listFilter";
import { useTaskSelection } from "@/composable/useTaskSelection.js";
import { statusChipStyle } from "@/utils/statusChipColors";
import { groupTotalsOf, isPartialGroup, loadedTotals, totalCellText, totalColumnsOf } from "@/views/Projects/composables/groupTotals";
import { indexRepairBody, indexRepairRows } from "@/views/Projects/composables/taskGroupIndex";

defineOptions({ name: "TableViewTable" });

const props = defineProps({
    data: { type: Object, required: true },
    group: { type: [Number, String], default: 0 },
    sprintId: { type: String, default: "" },
    globalSortKey: { type: String, default: "" },
    keys: { type: String, default: "" },
    showPoints: { type: Boolean, default: false }
});
const emit = defineEmits(["open"]);

const { getters, dispatch } = useStore();
const { checkPermission } = useCustomComposable();
const { getUser } = useGetterFunctions();
const selection = useTaskSelection();

const project = inject("selectedProject");
provide("viewedList", computed(() => ({ sprintId: props.sprintId, projectId: project?.value?._id })));
const companyId = inject("$companyId");
const userId = inject("$userId");
const searchedTask = inject("searchedTask");
const showArchivedInj = inject("showArchived", null);

const permit = checkPermission("task.show_tasks", project?.value?.isGlobalPermission);
const isLoading = ref(false);
const observerRef = ref(null);
/* An unfetched group and an empty one both hold zero tasks; only print the count
   once this group's own query has answered. */
const hasFetched = ref(false);

selection.setActiveView("table");
watch(() => project.value?._id, (newId) => {
    if (newId) selection.setActiveProject(String(newId));
}, { immediate: true });

const canGroupSelect = computed(() => checkPermission("task.task_status", project.value?.isGlobalPermission) === true && !showArchivedInj?.value);


const storeTasks = computed(() => {
    if (searchedTask?.value) {
        return (getters["projectData/searchedTasks"] || []).filter((task) => inList(task, props.sprintId));
    }
    return getters["projectData/tableTasks"]?.[project.value?._id]?.[props.sprintId]?.tasks || [];
});

/* The rows of the group are its tasks. A subtask is shown under its parent, whatever group it
   would fall in itself, and an event can put one in the Table's store. */
const tasks = computed(() => storeTasks.value
    .filter((task) => !task?.deletedStatusKey && !parentIdOf(task) && taskInGroup(task, props.data))
    .sort((a, b) => (props.globalSortKey ? 0 : a[props.data.indexName] - b[props.data.indexName])));

const subtasks = useSubtaskTree({
    project,
    sprintId: computed(() => props.sprintId),
    rows: tasks,
    showArchived: showArchivedInj || ref(false),
    searched: searchedTask || ref(false)
});

/* Every row is ticked alone, as in the List: the server carries a task's subtasks with it. */
function selectRow(row, event) {
    selection.selectFromEvent(row, event, ".tv2", { rowsAlone: true });
}

const tableColumnsRef = inject("tableColumns", null);
const tableColumns = computed(() => tableColumnsRef?.value || []);
const columnCount = computed(() => tableColumns.value.length + 2);

const tableTotals = inject("tableTotals", null);
const rowEdit = inject("listRowEdit", null);
const totalColumns = computed(() => tableTotals?.columns.value || totalColumnsOf(tableColumns.value));
const counts = computed(() => getters["projectData/tableGroupCounts"]?.[project.value?._id]?.[props.sprintId] || null);
const found = computed(() => (searchedTask?.value ? null : counts.value?.found?.[`${props.data.searchKey}_${props.data.searchValue}`] ?? null));
const awaitingCounts = computed(() => !searchedTask?.value && found.value === null);
const groupTotals = computed(() => (awaitingCounts.value ? null : groupTotalsOf({
    rows: tasks.value,
    count: found.value,
    server: counts.value?.totals?.[`${props.data.searchKey}_${props.data.searchValue}`] || null,
    totals: totalColumns.value,
    allTasks: rowEdit?.fields?.allTasks.value || [],
    defs: rowEdit?.fields?.defs.value || []
})));
const groupPoints = computed(() => groupTotals.value?.points || 0);
const showTotals = computed(() => totalColumns.value.length > 0 && tasks.value.length > 0 && !isLoading.value);
const totalOf = (column) => totalCellText(totalColumns.value, groupTotals.value, column.id);

/* A partly loaded group cannot add up an edit itself, so the server is asked again when the sum of its loaded rows moves. */
const loadedSum = computed(() => JSON.stringify(loadedTotals(tasks.value, totalColumns.value, {
    allTasks: rowEdit?.fields?.allTasks.value || [],
    defs: rowEdit?.fields?.defs.value || []
})));
watch(loadedSum, () => {
    if (totalColumns.value.length && isPartialGroup(tasks.value, found.value) > 0) tableTotals?.refresh();
});

const groupTaskIds = computed(() => tasks.value.map((task) => String(task._id)).filter(Boolean));
const groupCheckboxState = computed(() => selection.groupState(groupTaskIds.value));

const groupLabel = computed(() => {
    if (props.data.searchKey === "AssigneeUserId") {
        const users = (props.data.users || []).map((user) => user?.Employee_Name || getUser(user)?.Employee_Name).filter(Boolean);
        return users.length ? users.join(", ") : props.data.name;
    }
    return props.data.name;
});
const chipStyle = computed(() => (props.data.bgColor ? statusChipStyle(props.data) : {}));

provide("tableGroupTree", {
    isExpanded: subtasks.isExpanded,
    childrenOf: subtasks.childrenOf,
    hasChildren: subtasks.hasChildren,
    progressFor: subtasks.progressFor,
    isSelected: (taskId) => selection.isSelected(taskId),
    canSelect: canGroupSelect,
    select: selectRow,
    toggle: (task) => subtasks.toggle(task, props.data),
    open: (task) => emit("open", task)
});

function addIntersections() {
    setTimeout(() => {
        const options = { root: document.getElementById("tableview_scroll"), rootMargin: "0px", threshold: 0 };
        const obs = new IntersectionObserver((entries) => {
            if (!entries[0].isIntersecting) return;
            dispatch("projectData/setTableTasksFromTypesense", {
                cid: companyId.value,
                pid: project.value._id,
                sprintId: props.sprintId,
                item: JSON.parse(JSON.stringify(props.data)),
                userId: userId.value,
                fetchNew: true,
                resetTable: null,
                sortKey: props.globalSortKey,
                isFirst: false,
                showAllTasks: project.value.isGlobalPermission === false ? permit : true
            }).catch(() => {}).finally(() => {
                hasFetched.value = true;
            });
        }, options);
        const target = document.getElementById(`table_list_item_${props.sprintId}_${props.data.key}`);
        if (target) obs.observe(target);
        observerRef.value = obs;
    });
}

watch(() => props.globalSortKey, () => {
    if (observerRef.value) observerRef.value.disconnect();
    dispatch("projectData/setTableTasksFromTypesense", {
        cid: companyId.value,
        pid: project.value._id,
        sprintId: props.sprintId,
        item: props.data,
        fetchNew: true,
        resetTable: null,
        userId: userId.value,
        sortKey: props.globalSortKey,
        isFirst: true,
        showAllTasks: project.value.isGlobalPermission === false ? permit : true
    }).catch(() => {}).finally(() => {
        hasFetched.value = true;
        addIntersections();
    });
});

/* A row loses its group index when its group value changes elsewhere, and a row made
 * outside a view may never have had one; the server gives it one so ordering stays stable.
 * Each row is asked for once, so a refused request is not repeated every time the rows change. */
const askedFor = new Set();
let lastRequest = Promise.resolve();

function repairIndexes({ hideRows = false } = {}) {
    const rows = indexRepairRows(tasks.value, props.data, checkPermission("task.task_list", project.value?.isGlobalPermission))
        .filter((row) => !askedFor.has(`${row.item.indexName}:${row.data}`));
    if (!rows.length) return;

    rows.forEach((row) => askedFor.add(`${row.item.indexName}:${row.data}`));
    if (hideRows && rows.length > 1) isLoading.value = true;
    rows.forEach((row) => {
        lastRequest = lastRequest
            .then(() => apiRequest("post", env.ONLOAD_UPDATE_TASK_INDEX, indexRepairBody(row, companyId.value)))
            .catch((error) => console.error("ERROR in update task index: ", error));
    });
    if (hideRows) lastRequest = lastRequest.then(() => { isLoading.value = false; });
}

/* Rows fetched after the view opened are already on screen, so they are repaired in place. */
watch(tasks, () => repairIndexes());

onMounted(() => {
    if (totalColumns.value.length) tableTotals?.refresh();
    if (observerRef.value) observerRef.value.disconnect();
    addIntersections();
    repairIndexes({ hideRows: true });
});
onUnmounted(() => {
    if (observerRef.value) observerRef.value.disconnect();
});
</script>
