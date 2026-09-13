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
    <div v-else class="w-100 ah-page tv2">
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
            <div v-if="hasRows" class="tv2__grid" role="table" :aria-label="$t('Projects.tasks')">
                <div class="tv2__head" role="row">
                    <span role="columnheader"></span>
                    <span role="columnheader" :aria-sort="ariaSort('TaskName')">
                        <button
                            type="button"
                            class="tv2__sort"
                            :title="$t('List.sort_by', { column: $t('Projects.tasks') })"
                            @click="toggleSort('TaskName')"
                        >
                            {{ $t('Projects.tasks') }}<span class="tv2__sort-caret" :class="{ 'is-on': sortOf('TaskName') }" aria-hidden="true">{{ sortGlyph('TaskName') }}</span>
                        </button>
                    </span>
                    <span role="columnheader" :aria-sort="ariaSort('statusKey')">
                        <button
                            type="button"
                            class="tv2__sort"
                            :title="$t('List.sort_by', { column: $t('Projects.status') })"
                            @click="toggleSort('statusKey')"
                        >
                            {{ $t('Projects.status') }}<span class="tv2__sort-caret" :class="{ 'is-on': sortOf('statusKey') }" aria-hidden="true">{{ sortGlyph('statusKey') }}</span>
                        </button>
                    </span>
                    <span role="columnheader">{{ $t('List.col_owner') }}</span>
                    <span role="columnheader" class="tv2__head-ai" :title="$t('List.ai_source_hint')">✦ {{ $t('List.col_summary') }}</span>
                    <span role="columnheader" class="tv2__head-ai" :title="$t('List.risk_formula')">✦ {{ $t('List.col_risk') }}</span>
                    <span role="columnheader" class="tv2__head-ai" :title="$t('List.ai_source_hint')">✦ {{ $t('List.col_area') }}</span>
                </div>

                <template v-for="sprint in groupedTasks" :key="sprintKey(sprint)">
                    <div class="tv2__sprint-row" role="row">
                        <span role="cell" class="tv2__sprint-cell" :aria-colspan="7">
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

// UTILS
import { useCustomComposable } from "@/composable";
import isEqual from 'lodash/isEqual';
import { taskListHelper } from '@/views/Projects/helper.js';
import { useTaskEmptyState } from '@/views/Projects/composables/useTaskEmptyState.js';
import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';

// PACKAGES
import { useStore } from 'vuex';
import { computed, inject, onMounted, ref, watch } from "vue";

defineOptions({ name: "ProjectTableView" });

const { groupBy } = taskListHelper();
const { getters } = useStore();
const { checkPermission } = useCustomComposable();

const props = defineProps({
    grouped: { type: Number, default: 0 },
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

const project = inject('selectedProject');
const companyId = inject('$companyId');
const searchedTask = inject('searchedTask');
const showArchiveVar = inject("showArchived");
const { emptyTitleKey, emptyMessageKey } = useTaskEmptyState(project);

const createTask = ref(false);
const globalSortKey = ref('');
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

const sortOf = (field) => {
    const [key, direction] = globalSortKey.value.split(':');
    return key === field ? Number(direction) : 0;
};
const sortGlyph = (field) => (sortOf(field) === -1 ? '▼' : '▲');
const ariaSort = (field) => {
    const direction = sortOf(field);
    if (!direction) return 'none';
    return direction === -1 ? 'descending' : 'ascending';
};
const toggleSort = (field) => {
    globalSortKey.value = `${field}: ${sortOf(field) === 1 ? -1 : 1}`;
};
</script>
<style>
@import './style.css';
</style>
