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
            <div class="board-load-strip">
                <p class="board-load-strip__line">{{ $t('EmptyState.board_loading') }}</p>
            </div>
        </template>
        <template v-else-if="emptyKind === 'ready' && shownBoardCount > 0">
            <KanbanBoard :data="processedBoardData" :group="grouped" :sprintId="sprintId" />
        </template>
        <template v-else>
            <div class="d-flex align-items-center justify-content-center flex-column mt-1">
                <EmptyState
                    v-if="project?.deletedStatusKey !== 2"
                    :title="emptyKind === 'failed' ? $t('EmptyState.load_failed_title') : $t('EmptyState.no_sprint_tasks_title')"
                    :message="emptyKind === 'failed' ? $t('EmptyState.load_failed_msg', { count: boardExpectedCount }) : ''"
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
import { ref, computed, onMounted, watch, inject, provide, defineProps, defineEmits } from 'vue';
import { useStore } from 'vuex';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import { markFirstRunStep, FIRST_RUN_STEPS } from '@/composable/firstRunProgress';
import isEqual from 'lodash/isEqual';

import KanbanBoard from '@/views/Projects/Kanban/KanbanBoard.vue';
import BoardViewTaskCreate from '@/views/Projects/Kanban/BoardViewTaskCreate.vue';
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';

import { taskListHelper } from '@/views/Projects/helper.js';
import { useRoute } from 'vue-router';
import { appendUnmatchedToFirstGroup, bindSprintTaskSource, boardEmptyKind, countPaintedTaskRows, countSprintBoardTasks, firstId, sameGroupValue, sprintCountFromSprintBags, sprintExpectedCount, sprintTasksBucket, sprintTreeExpectedCount, unmatchedBoardTasks } from '@/utils/taskOpenProjectId';
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
const { getters, commit } = useStore();
const { groupBy, checkCase, refetchSprintBoardTasks } = taskListHelper();
const showArchiveVar = inject("showArchived");
const searchedTask = inject('searchedTask');
const project = inject('selectedProject');
const wantCreate = ref(false);
const isLoading = ref(true);
const retrying = ref(false);
const internalGroupedTasks = ref([]);
const sprintId = ref(null);

// --- Computed Properties ---
const currentCompany = computed(() => getters["settings/selectedCompany"]);
const allProjectTasks = computed(() => getters["projectData/tasks"] || {});
const searchedTasksData = computed(() => getters['projectData/searchedTasks'] || []);

// Determine the source task array based on whether a search is active
const taskSourceArray = computed(() => {
    const sprint = props.sprints && props.sprints[0];
    const sid = firstId(sprint && (sprint.id || sprint._id));
    const bucket = sprintTasksBucket(allProjectTasks.value, project.value && project.value._id, sid);
    return bindSprintTaskSource({
        searched: Boolean(searchedTask && searchedTask.value),
        searchRows: searchedTasksData.value,
        storedRows: (bucket && bucket.tasks) || [],
        sprintId: sid,
    });
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

    const mapped = groupDefinitions.map(group => {
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
                tasksForGroup = filteredSourceTasks.filter(task => sameGroupValue(task.statusKey, group.searchValue));
                tasksForGroup.sort((a, b) => a.groupByStatusIndex - b.groupByStatusIndex);
                break;
            case "Task_Priority":
                tasksForGroup = filteredSourceTasks.filter(task => sameGroupValue(task.Task_Priority, group.searchValue));
                tasksForGroup.sort((a, b) => a.groupByPriorityIndex - b.groupByPriorityIndex);
                break;
            default:
                tasksForGroup = filteredSourceTasks.filter(task => sameGroupValue(task[group.searchKey], group.searchValue));
                break;
        }

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

        const dataKeys = sprintTasksBucket(allProjectTasks.value, project.value._id, props.sprints[0] && (props.sprints[0].id || props.sprints[0]._id))?.found;

        return {
            ...group,
            sprintId: currentSprintId,
            tasksArray: processedTasks,
            disabled: group.searchKey === "DueDate" && ["Next", "Overdue", "No Due Date"].includes(group.name),
            totalTaskCounts: dataKeys || {},
        };
    });

    return appendUnmatchedToFirstGroup(mapped, unmatchedBoardTasks(mapped, filteredSourceTasks));
});

const shownBoardCount = computed(() => countPaintedTaskRows(processedBoardData.value));
const boardExpectedCount = computed(() => {
    const sprint = props.sprints && props.sprints[0];
    const grouped = internalGroupedTasks.value && internalGroupedTasks.value[0];
    const sid = firstId(sprint && (sprint.id || sprint._id), grouped && (grouped.id || grouped._id));
    return Math.max(
        sprintExpectedCount(sprint),
        sprintExpectedCount(grouped),
        sprintTreeExpectedCount(project.value, sid),
        sprintTreeExpectedCount(getters['projectData/allProjects'], sid),
        sprintCountFromSprintBags(getters['projectData/sprints'], sid),
        sprintCountFromSprintBags(getters['projectData/folders'], sid),
    );
});
const emptyKind = computed(() => {
    const sprint = props.sprints && props.sprints[0];
    const pid = firstId(project.value && project.value._id);
    const sid = firstId(sprint && (sprint.id || sprint._id));
    const groups = (internalGroupedTasks.value[0] && internalGroupedTasks.value[0].items) || [];
    const stored = countSprintBoardTasks(allProjectTasks.value, pid, sid);
    return boardEmptyKind({
        loading: retrying.value || isLoading.value || props.sprintLoading,
        sprintsBound: Boolean(props.sprints && props.sprints.length),
        boardCount: shownBoardCount.value,
        expectedCount: boardExpectedCount.value,
        storedCount: stored,
        searchHits: Boolean(searchedTask && searchedTask.value && searchedTasksData.value.length),
        hasGroups: groups.length > 0,
    });
});
provide('boardSurfaceKind', emptyKind);
provide('boardExpectedCount', boardExpectedCount);

function onEmptyAction() {
    if (retrying.value) return;
    if (emptyKind.value !== 'failed') {
        wantCreate.value = true;
        return;
    }
    const sprint = props.sprints && props.sprints[0];
    const pid = firstId(project.value && project.value._id);
    const sid = firstId(sprint && (sprint.id || sprint._id));
    retrying.value = true;
    isLoading.value = true;
    commit('projectData/resetSprintTaskBucket', { pid, sprintId: sid });
    const fallbackGroups = () => [{
        ...(sprint || {}),
        id: sid,
        items: [{ name: 'Tasks', searchKey: 'statusKey', searchValue: '', tasksArray: [] }],
    }];
    const bindGroups = () => new Promise((resolve) => {
        groupBy(props.grouped, false, project.value, props.sprints, internalGroupedTasks, true, 'board', false, true, (resp) => {
            const next = Array.isArray(resp) && resp[0] ? resp : fallbackGroups();
            if (!next[0].items || !next[0].items.length) {
                next[0].items = fallbackGroups()[0].items;
            }
            internalGroupedTasks.value = next;
            resolve();
        });
    });
    Promise.resolve(refetchSprintBoardTasks({ projectId: pid, sprintId: sid, projectData: project.value }))
        .then(() => bindGroups())
        .catch((error) => {
            console.error('ERROR retrying sprint tasks: ', error);
        })
        .finally(() => {
            retrying.value = false;
            isLoading.value = false;
        });
}

provide('onBoardSurfaceAction', onEmptyAction);

watch([() => props.grouped, () => props.sprints,() => route?.params], ([newGroup, newSprints, newRouteParams], [oldGroup, oldSprints, oldRouteParams]) => {
    if (retrying.value) return;
    if (project.value?._id && (newGroup !== oldGroup || !isEqual(newSprints, oldSprints))) {        
        if((newRouteParams?.id !== oldRouteParams?.id) || (newRouteParams?.sprintId !== oldRouteParams?.sprintId) || (newRouteParams?.folderId !== oldRouteParams?.folderId)){
            isLoading.value = true;
        }
        groupBy(props.grouped, true, project.value, props.sprints, internalGroupedTasks, true, 'board', false, true, (resp) => {
            internalGroupedTasks.value = resp;
            if (!retrying.value) isLoading.value = false;
        });
    }
}, { deep: true });

// --- Lifecycle Hooks ---
onMounted(async () => {
    markFirstRunStep(FIRST_RUN_STEPS.BOARD_VIEW);
    if (project.value?._id && props.sprints?.length) {
        isLoading.value = true;
        const pid = firstId(project.value._id);
        const sid = firstId(props.sprints[0] && (props.sprints[0].id || props.sprints[0]._id));
        try {
            const stored = countSprintBoardTasks(allProjectTasks.value, pid, sid);
            if (stored === 0) {
                await Promise.resolve(refetchSprintBoardTasks({ projectId: pid, sprintId: sid, projectData: project.value }));
            }
            await new Promise((resolve) => {
                groupBy(props.grouped, false, project.value, props.sprints, internalGroupedTasks, true, 'board', false, true, (resp) => {
                    internalGroupedTasks.value = resp;
                    resolve();
                });
            });
        } catch (error) {
            console.error("Error during initial groupBy:", error);
        } finally {
            setTimeout(() => {
                if (!retrying.value) isLoading.value = false;
            }, 500);
        }
    } else {
        isLoading.value = false;
    }
});

</script>
<style src="./new-style.css" scoped />
<style scoped>
.board-load-strip {
    background: var(--kiln-paper, #f4ead8);
    border: 1px solid var(--kiln-line, #d8cbb3);
    border-radius: var(--kiln-radius-sm, 9px);
    padding: 12px 16px;
    margin: 16px 20px;
}
.board-load-strip__line {
    margin: 0;
    font-family: var(--kiln-font-display), Georgia, serif;
    font-size: 15px;
    font-weight: 600;
    color: var(--kiln-ink, #1b2f28);
}
</style>