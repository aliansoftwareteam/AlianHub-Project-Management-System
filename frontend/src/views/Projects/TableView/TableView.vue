<template>
    <div v-if="!currentCompany?.planFeature?.tableView">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('conformationmsg.unlock_table_view')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <div v-else ref="viewRoot" class="w-100 ah-page tv2">
        <ListBulkBar v-if="project" :project="project" />
        <div class="tv2__bar">
            <button
                v-if="!searchedTask && canCreate && showArchiveVar === false && createTask === false"
                type="button"
                class="tv2__add"
                @click.stop="createTask = true"
            >+ {{ $t('Projects.new_task') }}</button>
        </div>
        <div v-if="createTask" class="tv2__bar">
            <CreateTask
                :sprint="createSprint"
                :assigneeOptions="project.AssigneeUserId"
                :groupBy="grouped"
                :considerWidth="false"
                @cancel="createTask = false"
            />
        </div>

        <div class="tv2__scroll ah-scroll" id="tableview_scroll">
            <div
                v-if="hasRows"
                ref="gridRef"
                class="tv2__grid"
                role="table"
                :aria-label="$t('Projects.tasks')"
                :style="gridStyle"
                @keydown="onGridKey"
            >
                <div class="tv2__head" role="row">
                    <span role="columnheader"></span>
                    <span role="columnheader" class="tv2__head-name" :aria-sort="ariaSort('TaskName')">
                        <button
                            type="button"
                            class="tv2__sort"
                            :title="$t('List.sort_by', { column: $t('Projects.tasks') })"
                            @click="toggleSort('TaskName')"
                        >
                            {{ $t('Projects.tasks') }}<span class="tv2__sort-caret" :class="{ 'is-on': sortOf('TaskName') }" aria-hidden="true">{{ sortGlyph('TaskName') }}</span>
                        </button>
                        <ViewColumnChooser
                            class="tv2__chooser"
                            :columns="columnState.columns.value"
                            @toggle="columnState.setVisible"
                            @move="columnState.move"
                            @reset="columnState.reset"
                        />
                    </span>
                    <template v-for="column in columnState.visibleColumns.value" :key="column.id">
                        <span v-if="column.id === 'status'" role="columnheader" :aria-sort="ariaSort('statusKey')">
                            <button
                                type="button"
                                class="tv2__sort"
                                :title="$t('List.sort_by', { column: $t('Projects.status') })"
                                @click="toggleSort('statusKey')"
                            >
                                {{ $t('Projects.status') }}<span class="tv2__sort-caret" :class="{ 'is-on': sortOf('statusKey') }" aria-hidden="true">{{ sortGlyph('statusKey') }}</span>
                            </button>
                        </span>
                        <span v-else-if="column.ai" role="columnheader" :class="{ 'tv2__head-ai': column.id !== 'risk' }" :title="$t(column.id === 'risk' ? 'List.risk_formula' : 'List.ai_source_hint')">{{ column.id === 'risk' ? '' : '✦ ' }}{{ $t(column.labelKey) }}</span>
                        <span v-else-if="column.field && isAiField(column.field)" role="columnheader" class="tv2__head-col" :title="column.label">
                            <AiFieldColumnHead :field="column.field" :tasks="aiColumnTasks" :editable="rowEdit.rights.value.customField === true" />
                        </span>
                        <span v-else-if="sortFieldOf(column)" role="columnheader" class="tv2__head-col" :aria-sort="ariaSort(sortFieldOf(column))">
                            <button
                                type="button"
                                class="tv2__sort tv2__sort--col"
                                :title="$t('List.sort_by', { column: column.field ? column.label : $t(column.labelKey) })"
                                @click="toggleSort(sortFieldOf(column))"
                            >
                                <span class="tv2__sort-text">{{ column.field ? column.label : $t(column.labelKey) }}</span><span class="tv2__sort-caret" :class="{ 'is-on': sortOf(sortFieldOf(column)) }" aria-hidden="true">{{ sortGlyph(sortFieldOf(column)) }}</span>
                            </button>
                        </span>
                        <span v-else role="columnheader" class="tv2__head-col" :title="column.field ? column.label : null">{{ column.field ? column.label : $t(column.labelKey) }}</span>
                    </template>
                </div>

                <template v-for="sprint in groupedTasks" :key="sprintKey(sprint)">
                    <div class="tv2__sprint-row" role="row">
                        <span role="cell" class="tv2__sprint-cell" :aria-colspan="columnCount">
                            <button
                                type="button"
                                class="tv2__sprint-head"
                                :aria-expanded="isSprintOpen(sprint)"
                                @click="toggleSprint(sprint)"
                            >
                                <span class="tv2__caret" :class="{ 'tv2__caret--open': isSprintOpen(sprint) }" aria-hidden="true">▸</span>
                                <span class="tv2__sprint-name">{{ sprint.name }}</span>
                                <span class="tv2__sprint-meta" :title="$t('List.sprint_total_hint')">{{ sprint.tasks || 0 }}</span>
                            </button>
                        </span>
                    </div>

                    <template v-if="isSprintOpen(sprint)">
                        <TableViewTable
                            v-for="item in (sprint.items || [])"
                            :key="`${sprintKey(sprint)}_${item.key}`"
                            :data="item"
                            :sprintId="sprintKey(sprint)"
                            :group="grouped"
                            :globalSortKey="globalSortKey"
                            :keys="`${item.key}`"
                            :showPoints="columnState.isVisible('points')"
                            @open="openRow"
                        />
                    </template>
                </template>
            </div>

            <div v-else class="d-flex align-items-center justify-content-center flex-column">
                <EmptyState
                    v-if="project?.deletedStatusKey !== 2"
                    :title="$t(emptyTitleKey)"
                    :message="$t(emptyMessageKey)"
                    :actionLabel="canCreate ? $t('EmptyState.no_tasks_action') : ''"
                    helpPath="tasks"
                    @action="createTask = true"
                />
            </div>
        </div>
    </div>
</template>

<script setup>
// COMPONENTS
import CreateTask from "@/components/atom/CreateTask/CreateTask.vue";
import TableViewTable from './TableViewTable.vue';
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import ListBulkBar from '@/views/Projects/ListView/ListBulkBar.vue';
import ViewColumnChooser from '@/views/Projects/components/columns/ViewColumnChooser.vue';
import AiFieldColumnHead from '@/views/Projects/components/columns/AiFieldColumnHead.vue';
import { isAiField, loadedViewTasks } from '@/views/Projects/composables/aiFields';

// UTILS
import { useCustomComposable } from "@/composable";
import isEqual from 'lodash/isEqual';
import { taskListHelper } from '@/views/Projects/helper.js';
import { useTaskEmptyState } from '@/views/Projects/composables/useTaskEmptyState.js';
import { openTask, useTaskSequenceSource } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
import { useViewSettings } from '@/views/Projects/composables/viewSettingsContext';
import { useListRowEdit } from '@/views/Projects/ListView/useListInlineEdit.js';
import { columnCatalogue, gridMinWidth, gridTracks, useViewColumns } from '@/views/Projects/composables/viewColumns';
import { handleGridKey } from './gridKeyboard';
import { valuePath } from '@/views/Projects/composables/customFieldQuery';

// PACKAGES
import { useStore } from 'vuex';
import { computed, inject, onMounted, provide, ref, watch } from "vue";

defineOptions({ name: "ProjectTableView" });

const { groupBy } = taskListHelper();
const { getters } = useStore();
const { checkApps, checkPermission } = useCustomComposable();

const props = defineProps({
    grouped: { type: [Number, String], default: 0 },
    projectData: { type: Object, default: () => ({}) },
    commonDateFormatForDate: { type: String, default: "DD/MM/YYYY" },
    sprints: { type: Array, default: () => [] },
    calendarDate: { type: [String, Number], default: "" },
    billingPeriod: { type: String, default: '' },
    data: { type: String, default: '' },
    userIds: { type: Array, default: () => [] },
    startDate: { type: Object, default: () => ({}) },
    watchers: { type: Object, default: () => ({}) },
    checklistArray: { type: Array, default: () => [] },
    isvisible: { type: Boolean, default: true },
    title: { type: String, default: '' },
    class: { type: String, default: '' }
});
defineEmits(["openSeeAllProject"]);

const viewRoot = ref(null);
useTaskSequenceSource(viewRoot);

const project = inject('selectedProject');
const tagsOn = computed(() => checkApps('tags') && checkPermission('task.task_tag', project.value?.isGlobalPermission) !== null);
const companyId = inject('$companyId');
const searchedTask = inject('searchedTask');
const showArchiveVar = inject("showArchived");
const { emptyTitleKey, emptyMessageKey } = useTaskEmptyState(project);

const rowEdit = useListRowEdit(project, showArchiveVar);
const aiColumnTasks = computed(() => loadedViewTasks(getters, project.value?._id, { table: true, searched: Boolean(searchedTask?.value) }));
provide('listRowEdit', rowEdit);

const catalogue = computed(() => columnCatalogue('table', {
    tagsOn: tagsOn.value,
    priorityOn: rowEdit.showPriority.value,
    estimateOn: checkApps('TimeEstimates') && checkPermission('task.task_estimated_hours', project.value?.isGlobalPermission) !== null,
    startOn: checkPermission('task.task_start_date', project.value?.isGlobalPermission) !== null,
    fields: rowEdit.fields.defs.value
}));
const columnState = useViewColumns(computed(() => project.value?._id), 'table', catalogue);
provide('tableColumns', columnState.visibleColumns);
const columnCount = computed(() => columnState.visibleColumns.value.length + 2);
const gridStyle = computed(() => {
    const tracks = gridTracks('table', columnState.visibleColumns.value);
    return { '--tv2-cols': tracks, minWidth: `${gridMinWidth(tracks)}px` };
});

const gridRef = ref(null);
function onGridKey(event) {
    handleGridKey(event, gridRef.value);
}

const createTask = ref(false);
const viewSettings = useViewSettings();
const globalSortKey = computed(() => (viewSettings.sort.value ? `${viewSettings.sort.value.field}: ${viewSettings.sort.value.dir}` : ''));
const groupedTasks = ref([]);
const expandedSprints = ref([]);

const taskData = computed(() => getters["projectData/tableTasks"]);
const currentCompany = computed(() => getters["settings/selectedCompany"]);
const canCreate = computed(() => checkPermission('task.task_create', project.value?.isGlobalPermission) === true
    && checkPermission('task.task_list', project.value?.isGlobalPermission) === true);

const sprintKey = (sprint) => String(sprint?.id || sprint?._id || "");
const isSprintOpen = (sprint) => expandedSprints.value.includes(sprintKey(sprint));

const createSprint = computed(() => groupedTasks.value.find((sprint) => isSprintOpen(sprint)) || props.sprints[0]);

/* Collapsed sprints are never fetched, so the store can only answer for what is
   open; the sprint counters cover the rest. */
const visibleTaskCount = computed(() => {
    if (searchedTask?.value) return (getters['projectData/searchedTasks'] || []).length;
    const store = taskData.value?.[props.projectData?._id];
    const loaded = (store?.sprints || []).reduce((total, id) => total + (store?.[id]?.tasks?.length || 0), 0);
    return loaded || groupedTasks.value.reduce((total, sprint) => total
        + (showArchiveVar?.value ? (sprint.archiveTaskCount || 0) : (sprint.tasks || 0)), 0);
});
const hasRows = computed(() => Boolean(groupedTasks.value.length && visibleTaskCount.value));

function syncExpandedSprints(sprints) {
    const ids = sprints.map(sprintKey).filter(Boolean);
    const kept = expandedSprints.value.filter((id) => ids.includes(id));
    expandedSprints.value = kept.length ? kept : ids.slice(0, 1);
}

function toggleSprint(sprint) {
    const id = sprintKey(sprint);
    if (!id) return;
    expandedSprints.value = isSprintOpen(sprint)
        ? expandedSprints.value.filter((open) => open !== id)
        : [...expandedSprints.value, id];
}

function load(refetch) {
    if (!project.value || !Object.keys(project.value).length) return;
    groupBy(props.grouped, refetch, project.value, props.sprints, groupedTasks, true, 'table', null, true, (resp) => {
        groupedTasks.value = resp;
        syncExpandedSprints(resp);
    });
}

watch([() => props.grouped, () => props.sprints, taskData], ([newGroup, newSprints], [oldGroup, oldSprints]) => {
    load(!isEqual(newGroup, oldGroup) || JSON.stringify(newSprints) !== JSON.stringify(oldSprints));
});

/* Projects.vue mounts the legacy bottom bulk bar for every view; the redesigned
   views carry their own, so the old one is hidden while they are on screen. */
onMounted(() => {
    load(true);
});

function openRow(task) {
    openTask({
        companyId: companyId.value,
        projectId: project.value?._id,
        sprintId: task.sprintId,
        folderId: task.folderObjId || '',
        taskId: task._id
    });
}

const sortOf = (field) => (viewSettings.sort.value?.field === field ? viewSettings.sort.value.dir : 0);
const sortGlyph = (field) => (sortOf(field) === -1 ? '▼' : '▲');
const ariaSort = (field) => {
    const direction = sortOf(field);
    if (!direction) return 'none';
    return direction === -1 ? 'descending' : 'ascending';
};
const COLUMN_SORT_FIELDS = { estimate: 'totalEstimatedTime', points: 'points' };
const sortFieldOf = (column) => (column.field ? valuePath(column.field._id) : COLUMN_SORT_FIELDS[column.id] || null);
const toggleSort = (field) => {
    viewSettings.setSort({ field, dir: sortOf(field) === 1 ? -1 : 1 });
};
</script>
<style>
@import './style.css';
</style>
