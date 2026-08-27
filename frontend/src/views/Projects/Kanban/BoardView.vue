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
    <div v-else>
        <template v-if="emptyKind === 'loading'">
            <div class="kanban-board-skeleton">
                <div class="kanban-column-skeleton" v-for="j in 3" :key="j">
                    <div class="d-flex justify-content-between w-100 mb-15px">
                        <Skelaton class="border-radius-5-px" style="height: 25px; width: 70px;" />
                        <span>
                            <Skelaton class="border-radius-5-px" style="height: 25px; width: 24px;" />
                        </span>
                    </div>
                    <div class="">
                        <div class="kanban-card-wrapper-skeleton">
                            <div class="kanban-card-skeleton pt-10px pl-10px pr-10px pb-5px w-100 mb-10px" v-for="i in 3" :key="i">
                                <Skelaton class="border-radius-5-px mt-5px" style="height: 22px; width: 278px;" />
                                <div class="d-flex align-items-center mt-5px justify-content-between">
                                    <div class="d-flex align-items-center">
                                        <Skelaton class="mr-8px border-radius-50-per" style="height: 21px; width: 21px;" />
                                    </div>
                                    <div class="d-flex align-items-center justify-content-between">
                                        <Skelaton class="mr-8px border-radius-50-per" style="height: 21px; width: 21px;" />
                                        <Skelaton class="mr-8px border-radius-50-per" style="height: 21px; width: 21px;" />
                                        <Skelaton class="mr-8px border-radius-5-px" style="height: 21px; width: 30px;" />
                                        <Skelaton class="border-radius-50-per" style="height: 21px; width: 21px;" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template v-else-if="emptyKind === 'ready'">
            <KanbanBoard :data="processedBoardData" :group="grouped" :sprintId="sprintId" />
        </template>
        <template v-else>
            <div class="d-flex align-items-center justify-content-center flex-column mt-1">
                <EmptyState
                    v-if="project?.deletedStatusKey !== 2"
                    :title="emptyKind === 'failed' ? $t('EmptyState.load_failed_title') : $t('EmptyState.no_sprint_tasks_title')"
                    :message="emptyKind === 'failed' ? $t('EmptyState.load_failed_msg') : $t('EmptyState.no_sprint_tasks_msg')"
                    :actionLabel="emptyKind === 'failed' ? $t('EmptyState.load_failed_action') : $t('EmptyState.no_sprint_tasks_action')"
                    :tone="emptyKind === 'failed' ? 'copper' : 'pine'"
                    @action="onEmptyAction"
                />
                <BoardViewTaskCreate
                    v-if="wantCreate && sprints && sprints[0]"
                    :data="{}"
                    :sprintData="sprints[0]"
                    :groupValue="grouped"
                    :sprintId="sprints[0].id || sprints[0]._id"
                    @toggle="wantCreate = false"
                />
            </div>
        </template>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, inject, defineProps, defineEmits } from 'vue';
import { useStore } from 'vuex';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import { markFirstRunStep, FIRST_RUN_STEPS } from '@/composable/firstRunProgress';
import isEqual from 'lodash/isEqual';

import KanbanBoard from '@/views/Projects/Kanban/KanbanBoard.vue';
import BoardViewTaskCreate from '@/views/Projects/Kanban/BoardViewTaskCreate.vue';
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';

import { taskListHelper } from '@/views/Projects/helper.js';
import { useRoute } from 'vue-router';
import { boardEmptyKind } from '@/utils/taskOpenProjectId';
const route = useRoute();

// --- Props & Emits ---
const props = defineProps({
    grouped: { type: Number, default: 0 },
    commonDateFormatForDate: { type: String, default: "DD/MM/YYYY" },
    sprints: { type: Array, default: () => [] },
    projectData: { type: Object, default: () => { } },
    sprintLoading: { type: Boolean, default: false },
});

defineEmits(['change']);

// --- Store & Injected State ---
const { getters } = useStore();
const { groupBy, checkCase } = taskListHelper();
const showArchiveVar = inject("showArchived");
const searchedTask = inject('searchedTask');
const project = inject('selectedProject');
const reloadSprintTasks = inject('reloadSprintTasks', () => Promise.resolve());
const wantCreate = ref(false);

// --- Reactive State ---
const isLoading = ref(true);
const internalGroupedTasks = ref([]);
const sprintId = ref(null);

// --- Computed Properties ---
const currentCompany = computed(() => getters["settings/selectedCompany"]);
const allProjectTasks = computed(() => getters["projectData/tasks"] || {});
const searchedTasksData = computed(() => getters['projectData/searchedTasks'] || []);

// Determine the source task array based on whether a search is active
const taskSourceArray = computed(() => {
    if (searchedTask.value && searchedTasksData.value.length > 0) {
        const currentSprintId = props.sprints[0]?.id;
        if (!currentSprintId) return [];
        return searchedTasksData.value.filter(task => task.sprintId === currentSprintId);
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
                tasksForGroup = filteredSourceTasks.filter(task =>
                    task.DueDate ? checkCase(group.operation, group.searchValue, (new Date(task.DueDate).getTime() / 1000)) : group.operation === "non"
                );
                tasksForGroup.sort((a, b) => a.groupByDueDateIndex - b.groupByDueDateIndex);
                break;
            case "AssigneeUserId":
                tasksForGroup = filteredSourceTasks.filter(task =>
                    (Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId.slice().sort().join("_") : task.AssigneeUserId || "") === group.value
                );
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
                tasksForGroup = filteredSourceTasks.filter(task => task[group.searchKey] === group.searchValue);
                break;
        }

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
            disabled: group.searchKey === "DueDate" && ["Next", "Overdue", "No Due Date"].includes(group.name),
            totalTaskCounts: dataKeys || {},
        };
    });
});

const shownBoardCount = computed(() => processedBoardData.value.reduce((n, group) => n + ((group && group.tasksArray) || []).length, 0));
const emptyKind = computed(() => {
    const sprint = props.sprints && props.sprints[0];
    const expected = Number((sprint && (sprint.tasks || sprint.taskCount || sprint.archiveTaskCount)) || 0);
    return boardEmptyKind({
        loading: isLoading.value || props.sprintLoading,
        sprintsBound: Boolean(props.sprints && props.sprints.length),
        boardCount: shownBoardCount.value,
        expectedCount: expected,
        searchHits: Boolean(searchedTask && searchedTask.value && searchedTasksData.value.length),
    });
});

function onEmptyAction() {
    if (emptyKind.value === 'failed') {
        Promise.resolve(reloadSprintTasks()).catch((error) => {
            console.error('ERROR retrying sprint tasks: ', error);
        });
        return;
    }
    wantCreate.value = true;
}

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

// --- Lifecycle Hooks ---
onMounted(async () => {
    markFirstRunStep(FIRST_RUN_STEPS.BOARD_VIEW);
    if (project.value?._id && props.sprints?.length) {
        isLoading.value = true;

        try {
            const needsInitialGrouping = !allProjectTasks.value[project.value._id]?.[props.sprints[0].id];
            await new Promise((resolve) => {
                groupBy(props.grouped, needsInitialGrouping, project.value, props.sprints, internalGroupedTasks, true, 'board', false, true, (resp) => {
                    internalGroupedTasks.value = resp;
                    resolve(); 
                });
            });

        } catch (error) {
            console.error("Error during initial groupBy:", error);
        } finally {
            setTimeout(() => {
                isLoading.value = false;
            }, 500);
        }
    } else {
        isLoading.value = false;
    }
});

</script>
<style src="./new-style.css" scoped />