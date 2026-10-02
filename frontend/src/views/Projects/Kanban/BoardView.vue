<template>
    <div v-if="!currentCompany?.planFeature?.boardView">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('conformationmsg.unlock_board_view')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <div v-else class="board-view" :data-density="density">
        <template v-if="isLoading">
            <div class="kanban-board-skeleton">
                <div class="kanban-column-skeleton" v-for="j in skeletonColumns" :key="j">
                    <div class="kanban-column-skeleton__head">
                        <Skelaton class="kanban-skel kanban-skel--count" />
                        <Skelaton class="kanban-skel kanban-skel--add" />
                    </div>
                    <div class="kanban-column-skeleton__cards">
                        <div class="kanban-card-skeleton" v-for="i in SKELETON_CARDS" :key="i">
                            <Skelaton class="kanban-skel kanban-skel--title" />
                            <div class="kanban-card-skeleton__foot">
                                <Skelaton class="kanban-skel kanban-skel--avatar" />
                                <div class="kanban-card-skeleton__chips">
                                    <Skelaton class="kanban-skel kanban-skel--chip" />
                                    <Skelaton class="kanban-skel kanban-skel--chip" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template v-else>
            <template v-if="processedBoardData.length && sprints?.length">
                <ListBulkBar v-if="projectData?._id" :project="projectData" />
                <div class="board-card-fields">
                    <ListSortControl :sort="boardSort.sort.value" :options="sortOptions" :dragNote="false" @key="boardSort.setKey" @dir="boardSort.setDir" />
                    <ViewColumnChooser
                        titleKey="ViewColumns.card_fields"
                        :columns="cardFields.columns.value"
                        @toggle="cardFields.setVisible"
                        @move="cardFields.move"
                        @reset="cardFields.reset"
                    />
                    <ViewDensityControl :model-value="density" @update:model-value="setDensity" />
                </div>
                <KanbanBoard :data="processedBoardData" :group="grouped" :sprintId="sprintId" :otherRows="otherOnBoard" :otherProjects="otherRows.projects.value" :otherTruncated="otherRowsShown && otherRows.truncated.value" />
            </template>
            <template v-else>
                <div class="board-view__empty">
                    <CreateTask
                        v-if="creatingFirstTask"
                        :sprint="sprints[0]"
                        :assigneeOptions="project?.AssigneeUserId"
                        :groupBy="grouped"
                        :considerWidth="false"
                        @cancel="creatingFirstTask = false"
                        @submit="creatingFirstTask = false"
                    />
                    <EmptyState
                        v-else-if="project?.deletedStatusKey !== 2"
                        :title="$t(emptyTitleKey)"
                        :message="$t(emptyMessageKey)"
                        :actionLabel="canCreateFirstTask ? $t('EmptyState.no_tasks_action') : ''"
                        data-test="board-empty"
                        @action="creatingFirstTask = true"
                        :sentence="emptySentenceKey ? $t(emptySentenceKey) : ''"
                        helpPath="tasks"
                    />
                </div>
            </template>
        </template>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, inject, provide, defineProps, defineEmits } from 'vue';
import { useStore } from 'vuex';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import CreateTask from '@/components/atom/CreateTask/CreateTask.vue';
import { useCustomComposable } from '@/composable';
import { markFirstRunStep, FIRST_RUN_STEPS } from '@/composable/firstRunProgress';
import isEqual from 'lodash/isEqual';

// Components
import KanbanBoard from '@/views/Projects/Kanban/KanbanBoard.vue';
import ListBulkBar from '@/views/Projects/ListView/ListBulkBar.vue';
import { taskInGroup } from '@/views/Projects/ListView/listFilter';
import { inList } from '@/store/ProjectData/listMembership';
import { placeOnBoard, useOtherProjectRows } from '@/views/Projects/composables/otherProjectRows';
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';
import ViewColumnChooser from '@/views/Projects/components/columns/ViewColumnChooser.vue';
import ViewDensityControl from '@/views/Projects/components/columns/ViewDensityControl.vue';
import { useViewSettings } from '@/views/Projects/composables/viewSettingsContext';
import { columnCatalogue, useViewColumns } from '@/views/Projects/composables/viewColumns';
import ListSortControl from '@/views/Projects/ListView/ListSortControl.vue';
import { sortChoices, sortTasks, useListSort } from '@/views/Projects/composables/viewSort';
import { useProjectCustomFields } from '@/views/Projects/composables/projectCustomFields';
import { useListRowMenu } from '@/views/Projects/ListView/useListRowMenu.js';
import { useListInlineEdit } from '@/views/Projects/ListView/useListInlineEdit.js';
import { useGroupSource } from '@/views/Projects/composables/groupSource';
import { AGENT_WORK_GROUP } from '@viewSettings';

// Helpers
import { taskListHelper } from '@/views/Projects/helper.js';
import { useTaskEmptyState } from '@/views/Projects/composables/useTaskEmptyState.js';
import { useRoute } from 'vue-router';
const route = useRoute();

// --- Props & Emits ---
const props = defineProps({
    grouped: { type: [Number, String], default: 0 },
    commonDateFormatForDate: { type: String, default: "DD/MM/YYYY" },
    sprints: { type: Array, default: () => [] },
    projectData: { type: Object, default: () => { } },
});

defineEmits(['change']);

// --- Store & Injected State ---
const { getters } = useStore();
const { groupBy, getGroupCounts } = taskListHelper();
const showArchiveVar = inject("showArchived");
const searchedTask = inject('searchedTask');
const project = inject('selectedProject');
const { emptyTitleKey, emptyMessageKey, emptySentenceKey } = useTaskEmptyState(project);
const { checkPermission } = useCustomComposable();
const creatingFirstTask = ref(false);
const canCreateFirstTask = computed(() => Boolean(props.sprints?.length)
    && !showArchiveVar.value
    && !searchedTask.value
    && checkPermission('task.task_create', project.value?.isGlobalPermission) === true
    && checkPermission('task.task_list', project.value?.isGlobalPermission) === true);

const customFields = useProjectCustomFields(project, { archived: showArchiveVar });
const cardCatalogue = computed(() => columnCatalogue('board', { fields: customFields.defs.value }));
const cardFields = useViewColumns(computed(() => project.value?._id), 'board', cardCatalogue);
provide('boardCardFields', cardFields.visibleColumns);
provide('boardFieldTasks', customFields.allTasks);

/* The card menu's rights and the two actions it borrows from the List, built once for the
   board rather than once per card. */
const rowMenu = useListRowMenu(project, showArchiveVar);
provide('boardTaskMenu', { rights: rowMenu.rights, duplicate: rowMenu.duplicate, removeFromList: rowMenu.removeFromList, rename: useListInlineEdit(project).rename });

const boardSort = useListSort();
const { density, setDensity } = useViewSettings();
const sortOptions = computed(() => sortChoices(customFields.defs.value));
const userNames = computed(() => new Map((getters['users/users'] || []).map((user) => [user._id, user.Employee_Name])));
const sortContext = computed(() => ({
    priorities: getters['settings/companyPriority'] || [],
    statuses: project.value?.taskStatusData || [],
    fields: customFields.defs.value,
    userName: (id) => userNames.value.get(id)
}));

// --- Reactive State ---
const isLoading = ref(true);
const internalGroupedTasks = ref([]);
const sprintId = ref(null);

// A skeleton that redraws at a different size on every load reads as movement
// rather than as the shape of what is coming.
const SKELETON_CARDS = 3;
const skeletonColumns = computed(() => {
    const groups = internalGroupedTasks.value[0]?.items?.length
        || (props.grouped === 0 ? project.value?.taskStatusData?.length : 0);
    return Math.min(Math.max(Number(groups) || 3, 2), 5);
});

// --- Computed Properties ---
const currentCompany = computed(() => getters["settings/selectedCompany"]);
const allProjectTasks = computed(() => getters["projectData/tasks"] || {});
const searchedTasksData = computed(() => getters['projectData/searchedTasks'] || []);

// Determine the source task array based on whether a search is active
const taskSourceArray = computed(() => {
    if (searchedTask.value && searchedTasksData.value.length > 0) {
        const currentSprintId = props.sprints[0]?.id;
        if (!currentSprintId) return [];
        return searchedTasksData.value.filter(task => inList(task, currentSprintId));
    } else if (!searchedTask.value && project.value?._id && props.sprints[0]?.id) {
        return allProjectTasks.value[project.value._id]?.[props.sprints[0].id]?.tasks || [];
    }
    return [];
});

// The core logic: Computed property that processes tasks based on grouping
const processedBoardData = computed(() => {

    if (!internalGroupedTasks.value[0]?.items || !taskSourceArray.value) {
        return [];
    }

    const groupDefinitions = internalGroupedTasks.value[0].items;
    const sourceTasks = taskSourceArray.value;
    const currentSprintId = internalGroupedTasks.value[0].id;
    const filteredSourceTasks = sourceTasks.filter(task => (showArchiveVar.value ? task?.deletedStatusKey : !task?.deletedStatusKey));

    return groupDefinitions.map(group => {
        let tasksForGroup = [];

        switch (group.searchKey) {
            case "DueDate":
                tasksForGroup = filteredSourceTasks.filter(task => taskInGroup(task, group));
                tasksForGroup.sort((a, b) => a.groupByDueDateIndex - b.groupByDueDateIndex);
                break;
            case "AssigneeUserId":
                tasksForGroup = filteredSourceTasks.filter(task => taskInGroup(task, group));
                tasksForGroup.sort((a, b) => a.groupByAssigneeIndex - b.groupByAssigneeIndex);
                break;
            case "statusKey":
                tasksForGroup = filteredSourceTasks.filter(task => task.statusKey === group.searchValue);
                tasksForGroup.sort((a, b) => a.groupByStatusIndex - b.groupByStatusIndex);
                break;
            case "Task_Priority":
                tasksForGroup = filteredSourceTasks.filter(task => task.Task_Priority === group.searchValue);
                tasksForGroup.sort((a, b) => a.groupByPriorityIndex - b.groupByPriorityIndex);
                break;
            default:
                tasksForGroup = filteredSourceTasks.filter(task => (group.customFieldId || group.agentWork ? taskInGroup(task, group) : task[group.searchKey] === group.searchValue));
                break;
        }
        tasksForGroup = sortTasks(tasksForGroup, boardSort.sort.value, sortContext.value);

        // If subtasks don't need filtering here, remove this map.
        const processedTasks = tasksForGroup.map(task => {
            if (task?.subtaskArray) {
                return {
                    ...task,
                    subtaskArray: task.subtaskArray.filter(sub => !sub?.deletedStatusKey)
                };
            }
            return task;
        });

        sprintId.value = currentSprintId;

        const dataKeys = allProjectTasks.value[project.value._id]?.[props.sprints[0].id]?.found;

        return {
            ...group,
            sprintId: currentSprintId,
            tasksArray: processedTasks,
            disabled: group.dropDisabled || (group.searchKey === "DueDate" && ["Next", "Overdue", "No Due Date"].includes(group.name)),
            totalTaskCounts: dataKeys || {},
        };
    });
});

/* A search or a filter is matched against this project's own data, which says nothing of a task that lives elsewhere. */
const otherRows = useOtherProjectRows(project, computed(() => props.sprints[0]?.id || ''));
const otherRowsShown = computed(() => !searchedTask.value && !showArchiveVar.value);
const otherOnBoard = computed(() => placeOnBoard(otherRowsShown.value ? otherRows.rows.value : [], processedBoardData.value));

// Watch for changes in grouping type or sprints to regenerate the group structure
watch([() => props.grouped, () => props.sprints,() => route?.params], ([newGroup, newSprints, newRouteParams], [oldGroup, oldSprints, oldRouteParams]) => {
    if (project.value?._id && (newGroup !== oldGroup || !isEqual(newSprints, oldSprints))) {        
        if((newRouteParams?.id !== oldRouteParams?.id) || (newRouteParams?.sprintId !== oldRouteParams?.sprintId) || (newRouteParams?.folderId !== oldRouteParams?.folderId)){
            isLoading.value = true;
        }
        groupBy(props.grouped, true, project.value, props.sprints, internalGroupedTasks, true, 'board', false, true, (resp) => {
            internalGroupedTasks.value = resp;
            isLoading.value = false;
        });
    }
}, { deep: true });

/* Columns the board already read answer at once (`firstPageOnly`), so only a new one is asked for, and the board stays drawn. */
useGroupSource(project, () => props.grouped, () => {
    if (!props.sprints?.length) return;
    groupBy(props.grouped, true, project.value, props.sprints, internalGroupedTasks, true, 'board', false, true, (resp) => {
        internalGroupedTasks.value = resp;
        /* A task an agent took or let go moved between columns the board had already counted. */
        if (props.grouped === AGENT_WORK_GROUP && resp[0]?.items?.length) {
            getGroupCounts({ projectId: project.value._id, sprintId: resp[0].id, items: resp[0].items, projectData: project.value })
                .catch((error) => console.error("ERROR in board column counts: ", error));
        }
    }, { firstPageOnly: true });
});

onMounted(async () => {
    markFirstRunStep(FIRST_RUN_STEPS.BOARD_VIEW);
    if (project.value?._id && props.sprints?.length) {
        isLoading.value = true;

        try {
            /* The sprint being in the store does not say its columns were read: the Table reads a
               row's subtasks into it. Each column asks, and one that was read answers at once. */
            await new Promise((resolve) => {
                groupBy(props.grouped, true, project.value, props.sprints, internalGroupedTasks, true, 'board', false, true, (resp) => {
                    internalGroupedTasks.value = resp;
                    resolve();
                }, { firstPageOnly: true });
            });

        } catch (error) {
            console.error("Error during initial groupBy:", error);
        } finally {
            setTimeout(() => {
                isLoading.value = false;
            }, 500);
        }
    }
});

</script>
<style src="./new-style.css" />

<style>
.board-card-fields { display: flex; justify-content: flex-end; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--page-pad-x, 20px) 0; }
@media (max-width: 767px) { .board-card-fields { padding: var(--sp-2) 16px 0; } }
</style>
