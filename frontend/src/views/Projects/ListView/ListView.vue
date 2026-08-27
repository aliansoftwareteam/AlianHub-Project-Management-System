<template>
<div class="w-100 list-view-wrapper">
    <div v-if="!currentCompany?.planFeature?.listView">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('ViewList.to_unlock_list_view')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <div v-else-if="$route?.query?.tab == 'Calendar' && !currentCompany?.planFeature?.calenderView">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('conformationmsg.unlock_calendar_view')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <template v-else>
        <div class="w-100 pr-20px pl-20px mt-20px" v-if="emptyKind === 'loading'">
            <div class="bg-white border-radius-8-px p-10px mb-15px">
                <div class="d-flex align-items-center mb-20px">
                    <img :src="triangleBlack" alt="triangleBlack">
                    <Skelaton class="border-radius-5-px ml-10px" style="height: 20px; width: 150px;"/>
                </div>
                <div v-for="i in 5" :key="i" class="sprint" style="background-color: var(--kiln-paper, #f4ead8)" :style="`${i == 5 ? 'margin-bottom: 0px !important;' : ''}`">
                    <div class="d-flex align-items-center">
                        <Skelaton class="border-radius-5-px status-sprint" style="width: 80px;"/>
                        <Skelaton class="border-radius-5-px status-sprint ml-6px" style="width: 50px; height: 20px;"/>
                    </div>
                </div>
            </div>
            <div v-for="i in 5" :key="i" class="bg-white border-radius-8-px p-10px mb-15px">
                <div class="d-flex align-items-center">
                    <img :src="triangleBlack" alt="triangleBlack">
                    <Skelaton class="border-radius-5-px ml-10px" style="height: 20px; width: 150px;"/>
                </div>
            </div>
        </div>
        <template v-else>
            <div class="list_view style-scroll" v-if="emptyKind === 'ready'" id="list_scroll">
                <SprintListing
                    v-for="(sprint, index) in groupedTasks"
                    :key="sprint?.id"
                    :sprint="sprint"
                    :groupType="grouped"
                    :commonDateFormatForDate="commonDateFormatForDate"
                    :style="{marginBottom: index === groupedTasks.length - 1 ? '0px' : '15px',marginTop: index === 0 ? '15px' : '0px'}"
                    :calendarDate="initialDate"
                    @change="(sprintId) => {toggleSprints(sprintId)}"
                    :calendarDateChange="calendarDateChange"
                />
            </div>
            <div class="list_view d-flex align-items-center justify-content-center flex-column" v-else>
                <EmptyState
                    v-if="project?.deletedStatusKey !== 2"
                    :title="showArchived ? $t('ProjectSlider.no_archived') : (emptyKind === 'failed' ? $t('EmptyState.load_failed_title') : $t('EmptyState.no_sprint_tasks_title'))"
                    :message="showArchived ? '' : (emptyKind === 'failed' ? $t('EmptyState.load_failed_msg') : $t('EmptyState.no_sprint_tasks_msg'))"
                    :actionLabel="showArchived ? '' : (emptyKind === 'failed' ? $t('EmptyState.load_failed_action') : $t('EmptyState.no_sprint_tasks_action'))"
                    :tone="showArchived ? '' : (emptyKind === 'failed' ? 'copper' : 'pine')"
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
    onMounted, computed
} from 'vue';
import { useStore } from 'vuex';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import { useRoute } from 'vue-router';

// COMPONENTS
import SprintListing from "@/components/organisms/SprinstList/SprintsList.vue"
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue"
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import isEqual from 'lodash/isEqual';
import { taskListHelper } from '@/views/Projects/helper.js';
import { useTaskSelection } from '@/composable/useTaskSelection.js';
import { boardEmptyKind, countSprintBoardTasks, firstId } from '@/utils/taskOpenProjectId';

const triangleBlack = require('@/assets/images/svg/triangleBlack.svg');

// UTILS
const {getters} = useStore();
const route = useRoute()
const project = inject("selectedProject");
const clientWidth = inject("$clientWidth");
const showArchived = inject("showArchived");
const searchedTask = inject('searchedTask', ref(false));
const reloadSprintTasks = inject('reloadSprintTasks', () => Promise.resolve());
const {
    groupBy,
    getSprintTasks,
    getMongoDBUpdate
} = taskListHelper();

// EMITS
const emit = defineEmits(['change', 'create']);

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

const groupedTasks = ref([]);
const expandedSprint = ref("");
const initialDate = ref(0);
const isLoading = ref(false);
const searchedTasksData = computed(() => getters['projectData/searchedTasks'] || []);
const allProjectTasks = computed(() => getters['projectData/tasks'] || {});
const emptyKind = computed(() => {
    const sprint = props.sprints && props.sprints[0];
    const expected = Number((sprint && (sprint.tasks || sprint.taskCount || sprint.archiveTaskCount)) || 0);
    const pid = firstId(project.value && project.value._id);
    const sid = firstId(sprint && (sprint.id || sprint._id));
    return boardEmptyKind({
        loading: isLoading.value || props.sprintLoading,
        sprintsBound: Boolean(props.sprints && props.sprints.length),
        boardCount: countSprintBoardTasks(allProjectTasks.value, pid, sid),
        expectedCount: expected,
        searchHits: Boolean(searchedTask && searchedTask.value && searchedTasksData.value.length),
    });
});
function onEmptyAction() {
    if (emptyKind.value === 'failed') {
        Promise.resolve(reloadSprintTasks())
            .then(() => {
                init(props.grouped, true, project.value, props.sprints, groupedTasks, false, true);
            })
            .catch((error) => {
                console.error('ERROR retrying sprint tasks: ', error);
            });
        return;
    }
    emit('create');
}

const currentCompany = computed(() => getters["settings/selectedCompany"])

const { setActiveView, setActiveProject } = useTaskSelection();
setActiveView('list');
watch(() => project.value?._id, (newId) => {
    if (newId) setActiveProject(String(newId));
}, { immediate: true });

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
                        getSprintTasks({ projectId: firstId(project.value._id), sprintId: firstId(SprintId), item, projectData: project.value, groupType: props.grouped })
                    )
                })
                Promise.allSettled(promises)
                    .then(() => {
                        nextTick(() => {
                            document.getElementById(`sprint_${SprintId}`).scrollIntoView({
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