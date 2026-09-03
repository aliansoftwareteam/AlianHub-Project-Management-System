<template>
<div class="w-100 list-view-wrapper ah-page lv2">
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
            <template v-else-if="groupedTasks.length">
                <ListBulkBar v-if="project" :project="project" />
                <div class="lv2__scroll ah-scroll" id="list_scroll">
                    <div class="lv2__cols">
                        <span></span>
                        <span>{{ $t('ListV2.col_task') }}</span>
                        <span class="lv2__c-assignee">{{ $t('ListV2.col_assignee') }}</span>
                        <span class="lv2__c-due">{{ $t('ListV2.col_due') }}</span>
                        <span class="lv2__c-prio">{{ $t('ListV2.col_priority') }}</span>
                        <span>{{ $t('ListV2.col_est') }}</span>
                        <span>✦ {{ $t('ListV2.col_risk') }}</span>
                    </div>

                    <section v-for="sprint in groupedTasks" :key="sprint?.id" class="lv2__sprint" :id="`sprint_${sprint?.id}`">
                        <button v-if="groupedTasks.length > 1 || !sprint.isExpanded" type="button" class="lv2__sprint-head" @click="toggleSprints(sprint?.id)">
                            <span class="lv2__caret" :class="{ 'lv2__caret--open': sprint.isExpanded }">▸</span>
                            <span class="lv2__sprint-name">{{ sprint.name }}</span>
                            <span class="lv2__sprint-meta">{{ sprint.tasks || 0 }}</span>
                        </button>

                        <template v-if="sprint.isExpanded">
                            <ListGroup
                                v-for="item in expandedGroups(sprint)"
                                :key="item.key"
                                :item="item"
                                :sprint="sprint"
                                :project="project"
                                :groupType="grouped"
                                @toggle="item.isExpanded = false"
                                @open="openRow"
                                @review-agent="reviewAgent"
                            />
                            <div v-if="collapsedGroups(sprint).length" class="lv2__collapsed">
                                <button
                                    v-for="item in collapsedGroups(sprint)"
                                    :key="item.key"
                                    type="button"
                                    class="lv2__collapsed-item"
                                    @click="item.isExpanded = true"
                                >
                                    <span class="lv2__caret">▸</span>
                                    <span class="lv2__swatch" :style="{ background: item.textColor || 'var(--ink-3)' }"></span>
                                    {{ item.name }}
                                    <span class="lv2__collapsed-count">{{ groupCount(sprint, item) }}</span>
                                </button>
                            </div>
                        </template>
                    </section>
                </div>
            </template>
            <div class="list_view d-flex align-items-center justify-content-center flex-column" v-else>
                <!-- lastTaskId is 0 until the project's first task is ever created, which is what
                     separates "nothing here yet" from "a filter is hiding the work". -->
                <EmptyState
                    v-if="project?.deletedStatusKey !== 2"
                    :image="noSearchResult"
                    :title="showArchived ? $t('ProjectSlider.no_archived') : (!project?.lastTaskId ? $t('EmptyState.no_tasks_title') : $t('EmptyState.no_match_title'))"
                    :message="showArchived ? '' : (!project?.lastTaskId ? $t('EmptyState.no_tasks_msg') : $t('EmptyState.no_match_msg'))"
                    :helpPath="showArchived ? '' : 'tasks'"
                />
            </div>
        </template>
    </template>
</div>
</template>

<script setup>
// PACKAGES
import { ref, defineProps, defineEmits, nextTick, inject, watch,
    onMounted, computed
} from 'vue';
import { useStore } from 'vuex';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import { useRoute, useRouter } from 'vue-router';

// COMPONENTS
import SprintListing from "@/components/organisms/SprinstList/SprintsList.vue"
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue"
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import ListGroup from './ListGroup.vue';
import ListBulkBar from './ListBulkBar.vue';
import isEqual from 'lodash/isEqual';
import { taskListHelper } from '@/views/Projects/helper.js';
import { useTaskSelection } from '@/composable/useTaskSelection.js';
import { useProjectAgentActivity } from './useProjectAgentActivity.js';
import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';

// UTILS
const {getters} = useStore();
const route = useRoute()
const router = useRouter()
const project = inject("selectedProject");
const clientWidth = inject("$clientWidth");
const companyId = inject("$companyId");
const showArchived = inject("showArchived");
const {
    groupBy,
    getSprintTasks,
    getMongoDBUpdate
} = taskListHelper();
const agents = useProjectAgentActivity();

// EMITS
defineEmits(['change'])

// PROPS
const props = defineProps({
    grouped: {
        type: Number,
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

const currentCompany = computed(() => getters["settings/selectedCompany"])
const isCalendarTab = computed(() => route?.query?.tab === 'Calendar');

const { setActiveView, setActiveProject } = useTaskSelection();
setActiveView('list');
watch(() => project.value?._id, (newId) => {
    if (newId) {
        setActiveProject(String(newId));
        agents.load(newId);
    }
}, { immediate: true });

const expandedGroups = (sprint) => (sprint.items || []).filter((item) => item.isExpanded);
const collapsedGroups = (sprint) => (sprint.items || []).filter((item) => !item.isExpanded);

function groupCount(sprint, item) {
    const store = getters['projectData/tasks']?.[project.value?._id]?.[sprint?.id];
    return store?.found?.[`${item.searchKey}_${item.searchValue}`] ?? 0;
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

const timer = ref(null);
function debouncer(timeout = 1000) {
    return new Promise((resolve) => {
        if(timer.value) {
            clearTimeout(timer.value);
        }
        timer.value = setTimeout(() => {
            resolve();
        }, timeout);
    })
}

function init (group,refetch,projects,sprints,groupedTasksData,isBoard,isInitial) {
    if(isInitial == true){
        isLoading.value = true;
    }
    debouncer(1000).then(() => {
        groupBy(group,refetch,projects,sprints,groupedTasksData,isBoard,'list',false,true,(resp)=>{
            groupedTasks.value = resp;
            if(!props.sprintLoading){
                isLoading.value = false;
            }
            adjustListViewHeight();
        });
    })
}

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

/* Projects.vue mounts the legacy bottom bulk bar for every view; the redesigned
   views carry their own, so the old one is hidden while they are on screen. */

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
                            document.getElementById(`sprint_${SprintId}`)?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                                inline: "nearest"
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
