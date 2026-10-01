<template>
<div ref="viewRoot" class="w-100 list-view-wrapper ah-page lv2" :class="{ 'lv2--sorted': !sortState.isManual.value }" :style="listGridStyle" :data-density="density">
    <div v-if="!currentCompany?.planFeature?.listView">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('ViewList.to_unlock_list_view')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <div v-else-if="isCalendarTab && !currentCompany?.planFeature?.calenderView">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('conformationmsg.unlock_calendar_view')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <template v-else>
        <div class="lv2__scroll" v-if="isLoading || sprintLoading">
            <Skelaton v-for="i in 5" :key="i" class="lv2__skeleton" />
        </div>
        <template v-else>
            <!-- The Calendar tab is mounted through this view and keeps the
                 existing sprint list, which hosts the calendar itself. -->
            <div class="list_view style-scroll" v-if="isCalendarTab" id="list_scroll">
                <SprintListing
                    v-for="(sprint, index) in groupedTasks"
                    :key="sprint?.id"
                    :sprint="sprint"
                    :groupType="grouped"
                    :commonDateFormatForDate="commonDateFormatForDate"
                    :style="{marginBottom: index === groupedTasks.length - 1 ? '0px' : '15px', marginTop: index === 0 ? '15px' : '0px'}"
                    :calendarDate="initialDate"
                    @change="(sprintId) => {toggleSprints(sprintId)}"
                    :calendarDateChange="calendarDateChange"
                />
            </div>
            <template v-else-if="groupedTasks.length && (totalTasks || !countsSettled)">
                <ListBulkBar v-if="project" :project="project" />
                <ConvertToSubTaskSidebar
                    v-if="rowMenu.moving.value"
                    :closeSideBar="true"
                    :isMoveTask="true"
                    :isBulkMove="true"
                    :task="{}"
                    @isConvertSubtaskOPen="rowMenu.cancelMove"
                    @bulkMoveConfirm="rowMenu.confirmMove"
                />
                <TaskMenuSidebars :mode="rowMenu.sidebar.value?.mode" :task="rowMenu.sidebar.value?.task" @close="rowMenu.closeSidebar" />
                <div class="lv2__scroll ah-scroll" id="list_scroll" role="table">
                    <div class="lv2__cols" role="row">
                        <span class="lv2__c-select" role="columnheader"><span class="ah-sr-only">{{ $t('List.col_select') }}</span></span>
                        <span class="lv2__c-title lv2__head-title" role="columnheader">
                            {{ $t('List.col_task') }}
                            <ViewColumnChooser
                                class="lv2__chooser"
                                :columns="columnState.columns.value"
                                @toggle="columnState.setVisible"
                                @move="columnState.move"
                                @reset="columnState.reset"
                            />
                            <ViewDensityControl :model-value="density" @update:model-value="setDensity" />
                            <ListSortControl :sort="sortState.sort.value" :options="sortOptions" @key="sortState.setKey" @dir="sortState.setDir" />
                        </span>
                        <span
                            v-for="column in columnState.visibleColumns.value"
                            :key="column.id"
                            :class="listColumnClass(column)"
                            role="columnheader"
                            :title="column.field ? column.label : null"
                        >
                            <AiFieldColumnHead v-if="column.field && isAiField(column.field)" :field="column.field" :tasks="aiColumnTasks" :editable="rowEdit.rights.value.customField === true" />
                            <template v-else>{{ column.field ? column.label : $t(column.labelKey) }}</template>
                        </span>
                    </div>

                    <section v-for="sprint in groupedTasks" :key="sprint?.id" class="lv2__sprint" role="presentation" :id="`sprint_${sprint?.id}`">
                        <div v-if="groupedTasks.length > 1 || !sprint.isExpanded" role="row" class="lv2__aria-row"><div role="cell" class="lv2__aria-row">
                        <button type="button" class="lv2__sprint-head" :aria-expanded="!!sprint.isExpanded" @click="toggleSprints(sprint?.id)">
                            <span class="lv2__caret lv2__caret--sprint" aria-hidden="true">{{ sprint.isExpanded ? '▼' : '►' }}</span>
                            <span class="lv2__sprint-name">{{ sprint.name }}</span>
                            <span class="lv2__sprint-meta" :title="$t('List.sprint_total_hint')">{{ sprintCount(sprint) }}</span>
                        </button>
                        </div></div>

                        <template v-if="sprint.isExpanded">
                            <template v-for="item in (sprint.items || [])" :key="item.key">
                                <ListGroup
                                    v-if="isGroupOpen(sprint, item)"
                                    :item="item"
                                    :sprint="sprint"
                                    :project="project"
                                    :groupType="grouped"
                                    @toggle="toggleGroup(sprint, item)"
                                    @open="openRow"
                                    @review-agent="reviewAgent"
                                />
                                <div v-else role="row" class="lv2__aria-row"><div role="cell" class="lv2__aria-row">
                                <button
                                    type="button"
                                    class="lv2__collapsed-item"
                                    :aria-expanded="false"
                                    @click="toggleGroup(sprint, item)"
                                >
                                    <span class="lv2__caret" aria-hidden="true">▸</span>
                                    <span class="lv2__swatch" :style="{ background: item.textColor || 'var(--ink-3)' }"></span>
                                    {{ groupLabel(item) }}
                                    <span class="lv2__collapsed-count">{{ groupCount(sprint, item) }}</span>
                                </button>
                                </div></div>
                            </template>
                        </template>
                    </section>
                </div>
            </template>
            <div class="list_view d-flex align-items-center justify-content-center flex-column" v-else>
                <div v-if="creatingFirstTask" class="lv2__first-task">
                    <CreateTask
                        :sprint="groupedTasks[0]"
                        :assigneeOptions="project?.AssigneeUserId"
                        :groupBy="grouped"
                        :groupType="grouped"
                        :considerWidth="false"
                        @cancel="creatingFirstTask = false"
                        @submit="creatingFirstTask = false"
                    />
                </div>
                <EmptyState
                    v-else-if="project?.deletedStatusKey !== 2"
                    :image="noSearchResult"
                    :illustration="emptyTitleKey === 'EmptyState.no_match_title' ? 'search' : 'tasks'"
                    :title="showArchived ? $t('ProjectSlider.no_archived') : $t(emptyTitleKey)"
                    :message="showArchived ? '' : $t(emptyMessageKey)"
                    :actionLabel="emptyActionLabel"
                    :helpPath="showArchived ? '' : 'tasks'"
                    @action="onEmptyAction"
                />
            </div>
        </template>
    </template>
</div>
</template>

<script setup>
// PACKAGES
import { ref, defineProps, defineEmits, nextTick, inject, watch,
    onMounted, onBeforeUnmount, computed, provide
} from 'vue';
import { useStore } from 'vuex';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

// COMPONENTS
import SprintListing from "@/components/organisms/SprinstList/SprintsList.vue"
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue"
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import ListGroup from './ListGroup.vue';
import ListBulkBar from './ListBulkBar.vue';
import CreateTask from '@/components/atom/CreateTask/CreateTask.vue';
import isEqual from 'lodash/isEqual';
import { taskListHelper } from '@/views/Projects/helper.js';
import { useCustomComposable } from '@/composable';
import { useTaskSelection } from '@/composable/useTaskSelection.js';
import { useProjectAgentActivity } from './useProjectAgentActivity.js';
import * as listGroups from './listGroups.js';
import { groupCountsFor, groupLabel, listSourceTasks } from './listFilter.js';
import { useTaskEmptyState } from '@/views/Projects/composables/useTaskEmptyState.js';
import { openTask, useTaskSequenceSource } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
import { useListRowEdit } from './useListInlineEdit.js';
import ViewColumnChooser from '@/views/Projects/components/columns/ViewColumnChooser.vue';
import ViewDensityControl from '@/views/Projects/components/columns/ViewDensityControl.vue';
import { useViewSettings } from '@/views/Projects/composables/viewSettingsContext';
import AiFieldColumnHead from '@/views/Projects/components/columns/AiFieldColumnHead.vue';
import { isAiField, loadedViewTasks } from '@/views/Projects/composables/aiFields';
import ListSortControl from './ListSortControl.vue';
import ConvertToSubTaskSidebar from '@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue';
import { useListRowMenu } from './useListRowMenu.js';
import { SUBTASK_EXPANSION, createSubtaskExpansion } from './subtaskExpansion.js';
import { eachRow } from '@/store/ProjectData/taskTree';
import TaskMenuSidebars from '@/views/Projects/components/taskMenu/TaskMenuSidebars.vue';
import { sortChoices, useListSort } from '@/views/Projects/composables/viewSort';
import { columnCatalogue, listColumnClass, listColumnsAt, listGridVars, useViewColumns } from '@/views/Projects/composables/viewColumns';

// UTILS
const {getters} = useStore();
const { t } = useI18n();
const route = useRoute()
const router = useRouter()
const project = inject("selectedProject");
const clientWidth = inject("$clientWidth");
const companyId = inject("$companyId");
const showArchived = inject("showArchived");
const searchedTask = inject("searchedTask", ref(false));
const clearTaskFilters = inject("clearTaskFilters", () => {});
const {
    groupBy,
    getSprintTasks,
    getGroupCounts,
    getMongoDBUpdate
} = taskListHelper();
const { checkApps, checkPermission } = useCustomComposable();
const tagsOn = computed(() => checkApps("tags") && checkPermission("task.task_tag", project.value?.isGlobalPermission) !== null);
const agents = useProjectAgentActivity();
const { emptyTitleKey, emptyMessageKey } = useTaskEmptyState(project);
const rowEdit = useListRowEdit(project, showArchived);
provide('listRowEdit', rowEdit);
const aiColumnTasks = computed(() => loadedViewTasks(getters, project.value?._id, { searched: Boolean(searchedTask?.value) }));
const rowMenu = useListRowMenu(project, showArchived);
provide('listRowMenu', rowMenu);
const subtaskExpansion = createSubtaskExpansion();
provide(SUBTASK_EXPANSION, subtaskExpansion);
const sortState = useListSort();
const { density, setDensity } = useViewSettings();
provide('listSort', sortState.sort);
const sortOptions = computed(() => sortChoices(rowEdit.fields.defs.value));
const userNames = computed(() => new Map((getters['users/users'] || []).map((user) => [user._id, user.Employee_Name])));
provide('listSortContext', computed(() => ({ fields: rowEdit.fields.defs.value, userName: (id) => userNames.value.get(id) })));

const listCatalogue = computed(() => columnCatalogue('list', {
    tagsOn: tagsOn.value,
    priorityOn: rowEdit.showPriority.value,
    estimateOn: checkPermission('task.task_estimated_hours', project.value?.isGlobalPermission) !== null,
    startOn: checkPermission('task.task_start_date', project.value?.isGlobalPermission) !== null,
    fields: rowEdit.fields.defs.value
}));
const columnState = useViewColumns(computed(() => project.value?._id), 'list', listCatalogue);
provide('listColumns', columnState.visibleColumns);
/* Tags is the one column that shares the free width with the task name. While no row the List
 * holds has a tag it keeps only the room of its header and the add button. */
const EMPTY_TAGS_TRACK = '56px';
const anyTagged = computed(() => {
    const held = getters['projectData/tasks']?.[project.value?._id] || {};
    const lists = searchedTask.value
        ? [getters['projectData/searchedTasks'] || []]
        : (held.sprints || []).map((sprintId) => held[sprintId]?.tasks || []);
    return lists.some((rows) => [...eachRow(rows)].some((row) => row.tagsArray?.length));
});
const gridColumns = computed(() => listColumnsAt(columnState.visibleColumns.value, clientWidth?.value || 1280)
    .map((column) => (column.id === 'tags' && !anyTagged.value ? { ...column, track: EMPTY_TAGS_TRACK } : column)));
/* Phone width keeps the stylesheet's two-line row; wider, the tracks follow the chosen columns. */
const listGridStyle = computed(() => ((clientWidth?.value || 1280) <= 767 ? {} : listGridVars(gridColumns.value)));

// EMITS
defineEmits(['change'])

// PROPS
const props = defineProps({
    grouped: {
        type: [Number, String],
        default: 0
    },
    commonDateFormatForDate: {
        type: String,
        default: "DD/MM/YYYY"
    },
    sprints: {
        type: Array,
        default: () => []
    },
    calendarDate: {
        type: [String,Number],
        default: ""
    },
    calendarDateChange: {
        type: Function,
        default: () => false
    },
    sprintLoading: {
        type: Boolean,
        default:false
    }
})

// IMAGES
const noSearchResult = require("@/assets/images/svg/No-Search-Result.svg");

const groupedTasks = ref([]);
const expandedSprint = ref("");
const initialDate = ref(0);
const isLoading = ref(false);
const creatingFirstTask = ref(false);
const openedEmptyGroups = ref(new Set());
const viewRoot = ref(null);
useTaskSequenceSource(viewRoot);

const currentCompany = computed(() => getters["settings/selectedCompany"])
const isCalendarTab = computed(() => route?.query?.tab === 'Calendar');

const { setActiveView, setActiveProject } = useTaskSelection();
setActiveView('list');
watch(() => project.value?._id, (newId) => {
    creatingFirstTask.value = false;
    openedEmptyGroups.value.clear();
    subtaskExpansion.expandedIds.value = [];
    subtaskExpansion.autoExpandedIds.value = [];
    if (newId) {
        setActiveProject(String(newId));
        agents.load(newId);
    }
}, { immediate: true });

function searchedRows(sprint) {
    return listSourceTasks({ searched: true, searchedTasks: getters['projectData/searchedTasks'], sprintId: sprint?.id });
}

function groupCounts(sprint) {
    if (searchedTask.value) return groupCountsFor(searchedRows(sprint), sprint?.items, showArchived.value);
    return getters['projectData/tasks']?.[project.value?._id]?.[sprint?.id]?.found;
}

function sprintCount(sprint) {
    return searchedTask.value ? searchedRows(sprint).length : (sprint.tasks || 0);
}

function groupCount(sprint, item) {
    return listGroups.groupCount(groupCounts(sprint), item);
}

function isGroupOpen(sprint, item) {
    return listGroups.isGroupOpen(groupCounts(sprint), item, openedEmptyGroups.value, listGroups.groupRef(sprint, item));
}

function toggleGroup(sprint, item) {
    const key = listGroups.groupRef(sprint, item);
    if (isGroupOpen(sprint, item)) {
        item.isExpanded = false;
        openedEmptyGroups.value.delete(key);
        return;
    }
    item.isExpanded = true;
    openedEmptyGroups.value.add(key);
}

const totalTasks = computed(() => groupedTasks.value.reduce((sum, sprint) => sum + listGroups.sprintTotal(sprint, groupCounts(sprint)), 0));
const countsSettled = computed(() => groupedTasks.value.every((sprint) => Boolean(groupCounts(sprint))));

const canCreateFirstTask = computed(() => Boolean(groupedTasks.value.length)
    && !showArchived.value
    && checkPermission('task.task_create', project.value?.isGlobalPermission) === true
    && checkPermission('task.task_list', project.value?.isGlobalPermission) === true);

const emptyActionLabel = computed(() => {
    if (searchedTask.value && !showArchived.value) return t('EmptyState.no_match_action');
    return canCreateFirstTask.value ? t('EmptyState.no_tasks_action') : '';
});

function onEmptyAction() {
    if (searchedTask.value && !showArchived.value) {
        clearTaskFilters();
        return;
    }
    creatingFirstTask.value = true;
}

function openRow(task) {
    openTask({
        companyId: companyId.value,
        projectId: project.value?._id,
        sprintId: task.sprintId,
        folderId: task.folderObjId || '',
        taskId: task._id
    });
}

function reviewAgent() {
    if (router.hasRoute('AiInbox')) router.push({ name: 'AiInbox', params: { cid: companyId.value } }).catch(() => {});
}

const INIT_SETTLE_MS = 150;
let initTimer = null;
let initStarted = false;
let refetchWanted = false;
let fetchedFor = '';

/* The first call, and the first one that has sprints to fetch, load at once. The page then
 * calls again several times while the sprint list and the props settle, so later calls wait
 * for the last of a burst, and a fetch is skipped when the same project, grouping and sprints
 * were fetched already. */
function init (group,refetch,projects,sprints,groupedTasksData,isBoard,isInitial) {
    if(isInitial == true){
        isLoading.value = true;
    }
    refetchWanted = refetchWanted || refetch === true;
    const run = () => {
        const signature = JSON.stringify([projects?._id, group, (sprints || []).map((sprint) => sprint?.id)]);
        const fetch = refetchWanted && signature !== fetchedFor;
        refetchWanted = false;
        if(fetch && sprints?.length) fetchedFor = signature;
        const heldBefore = Boolean(getters['projectData/tasks']?.[projects?._id]);
        groupBy(group,fetch,projects,sprints,groupedTasksData,isBoard,'list',false,true,(resp)=>{
            groupedTasks.value = resp;
            if(!props.sprintLoading){
                isLoading.value = false;
            }
            adjustListViewHeight();
            /* Groups the store already held are not fetched again, so their counts are. */
            if(fetch && heldBefore) refreshGroupCounts();
        }, { firstPageOnly: true });
    };
    clearTimeout(initTimer);
    const atOnce = !initStarted || (refetchWanted && !fetchedFor);
    initStarted = true;
    if(atOnce) {
        run();
        return;
    }
    initTimer = setTimeout(run, INIT_SETTLE_MS);
}

const COUNT_SETTLE_MS = 400;
let countTimer = null;
const openSprint = computed(() => groupedTasks.value.find((sprint) => sprint?.isExpanded));

function refreshGroupCounts() {
    const sprint = openSprint.value;
    if(!sprint || !project.value?._id) return;
    getGroupCounts({ projectId: project.value._id, sprintId: sprint.id, items: sprint.items || [], projectData: project.value })
        .catch((error) => console.error("ERROR in list group counts: ", error));
}

/* The store raises the marker when a change from the server may have moved a task it cannot
 * place. Only a rise while the same sprint is open counts: opening a sprint reads an old one. */
watch(() => [
    `${project.value?._id}|${openSprint.value?.id}`,
    getters['projectData/tasks']?.[project.value?._id]?.[openSprint.value?.id]?.countsStale || 0
], ([sprintKey, stale], [previousKey, previousStale]) => {
    if(sprintKey !== previousKey || stale <= previousStale) return;
    clearTimeout(countTimer);
    countTimer = setTimeout(refreshGroupCounts, COUNT_SETTLE_MS);
});
onBeforeUnmount(() => {
    clearTimeout(initTimer);
    clearTimeout(countTimer);
});

watch(clientWidth, () => {
    adjustListViewHeight();
});

function adjustListViewHeight() {
    const listViewHeader = document.querySelector(".task-assigneesearch-groupbywrapper");
    const listViewWrapper = document.querySelector(".list-view-wrapper");

    if(listViewWrapper) {
        listViewWrapper.style.height = `calc(100% - ${listViewHeader?.clientHeight}px)`;
    }
}

onMounted(() => {
    if(!currentCompany.value?.planFeature?.listView){
        return;
    }
    if(project.value && Object.keys(project.value).length && !props.sprintLoading) {
        init(props.grouped,true,project.value,props.sprints,groupedTasks,false,true);
    }
})
watch(route , (to, from) => {
    if (from?.query?.tab === "Calendar") {
        props.calendarDateChange(true, "calendar");
    }
})
const taskGetter = computed(() => JSON.parse(JSON.stringify(getters["projectData/tasks"])))
watch(taskGetter , () => {
    if(props.grouped === 1) {
        setTimeout(() => {
            init(props.grouped, false, project.value, props.sprints, groupedTasks, false,false);
        }, 500)
    }
})

watch([() => props.grouped, () => props.sprints, () => props.sprintLoading], ([newGroup, newSprints, newSprintLoading], [oldGroup, oldSprints, oldSprintLoading]) => {
    if (project.value && Object.keys(project.value).length) {
        let groupValue = groupedTasks.value && groupedTasks.value.length === 0;
        let isInitialValue = groupValue ? true : checkProjectIds(newSprints, oldSprints) === true ? false : true
        const refetch = (!newSprintLoading && newSprintLoading !== oldSprintLoading) || (!isEqual(newGroup, oldGroup) || JSON.stringify(newSprints) !== JSON.stringify(oldSprints))
        init(props.grouped, refetch, project.value, props.sprints, groupedTasks, false, isInitialValue);
    }
}, { deep: true })

function checkProjectIds(newSprints, oldSprints) {
    return newSprints.some(newSprint =>
        oldSprints.some(oldSprint => newSprint.projectId === oldSprint.projectId)
    );
}

watch([() => props.calendarDate], (data) => {
    if (data && data.length) {
        const selectedDate = data[0];
        if (selectedDate) {
            initialDate.value = new Date(selectedDate).getTime()
        } else {
            initialDate.value = new Date().getTime()
        }
    } else {
        initialDate.value = new Date().getTime()
    }
})

function toggleSprints(sprintId) {
    groupedTasks.value.forEach((sprint) => {
        let SprintId = sprint?.id;
        if (SprintId === sprintId) {
            sprint.isExpanded = !sprint.isExpanded;
            if (sprint.isExpanded) {
                let promises = [];
                sprint.items.forEach((item) => {
                    promises.push(
                        getSprintTasks({ projectId: project.value._id, sprintId: SprintId, item, projectData: project.value, groupType: props.grouped })
                    )
                })
                Promise.allSettled(promises)
                    .then(() => {
                        nextTick(() => {
                            const section = document.getElementById(`sprint_${SprintId}`);
                            const scroller = document.getElementById("list_scroll");
                            if (!section || !scroller) return;
                            // scrollIntoView walks every scrollable ancestor, including the
                            // overflow:hidden box holding the project header, and nothing can
                            // scroll that one back.
                            scroller.scrollTo({
                                top: scroller.scrollTop + section.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
                                behavior: "smooth"
                            });
                        })

                        getMongoDBUpdate({
                            projectId: project.value._id,
                            sprintId: sprint.id,
                            projectData: project.value,
                            groupBy: { type: props.grouped, items: sprint.items?.map((x) => ({ key: `${x.searchKey}_${x.searchValue}`, value: x.searchValue, name: x.name })) }
                        });
                    })
                    .catch((error) => {
                        console.error("ERROR in toggleSprints > Promise.allSettled: ", error);
                    })
                expandedSprint.value = SprintId
            }
        } else {
            sprint.isExpanded = false;
        }
    })
}
</script>

<style>
@import "./style.css";
</style>
