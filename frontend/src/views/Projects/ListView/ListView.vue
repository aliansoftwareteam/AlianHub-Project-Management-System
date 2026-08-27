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
        <div class="list_view style-scroll" id="list_scroll">
            <SprintListing
                v-for="(sprint, index) in headerSprints"
                :key="sprint?.id"
                :sprint="sprint"
                :groupType="grouped"
                :commonDateFormatForDate="commonDateFormatForDate"
                :style="{marginBottom: index === headerSprints.length - 1 ? '0px' : '15px',marginTop: index === 0 ? '15px' : '0px'}"
                :calendarDate="initialDate"
                @change="(sprintId) => {toggleSprints(sprintId)}"
                :calendarDateChange="calendarDateChange"
            />
        </div>
    </template>
</div>
</template>

<script setup>
// PACKAGES
import { ref, defineProps, defineEmits, nextTick, inject, watch, 
    onMounted, computed, provide
} from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';

// COMPONENTS
import SprintListing from "@/components/organisms/SprinstList/SprintsList.vue"
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import isEqual from 'lodash/isEqual';
import { taskListHelper } from '@/views/Projects/helper.js';
import { useTaskSelection } from '@/composable/useTaskSelection.js';
import { boardEmptyKind, countRenderedSprintItems, countSprintBoardTasks, firstId, sprintExpectedCount } from '@/utils/taskOpenProjectId';

// UTILS
const {getters} = useStore();
const route = useRoute()
const project = inject("selectedProject");
const clientWidth = inject("$clientWidth");
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
const isLoading = ref(true);
const searchedTasksData = computed(() => getters['projectData/searchedTasks'] || []);
const allProjectTasks = computed(() => getters['projectData/tasks'] || {});
const headerSprints = computed(() => {
    if (groupedTasks.value && groupedTasks.value.length) return groupedTasks.value;
    return (props.sprints || []).map((sprint) => ({
        ...sprint,
        isExpanded: true,
        items: Array.isArray(sprint.items) ? sprint.items : [],
    }));
});
const boardExpectedCount = computed(() => {
    const header = headerSprints.value && headerSprints.value[0];
    const listed = props.sprints && props.sprints[0];
    return Math.max(sprintExpectedCount(header), sprintExpectedCount(listed));
});
const emptyKind = computed(() => {
    const sprint = (headerSprints.value && headerSprints.value[0]) || (props.sprints && props.sprints[0]);
    const pid = firstId(project.value && project.value._id);
    const sid = firstId(sprint && (sprint.id || sprint._id));
    const groups = sprint && Array.isArray(sprint.items) ? sprint.items : [];
    const stored = countSprintBoardTasks(allProjectTasks.value, pid, sid);
    const shown = Math.max(countRenderedSprintItems(groups), stored);
    return boardEmptyKind({
        loading: isLoading.value || props.sprintLoading,
        sprintsBound: Boolean(props.sprints && props.sprints.length),
        boardCount: shown,
        expectedCount: Math.max(boardExpectedCount.value, stored),
        searchHits: Boolean(searchedTask && searchedTask.value && searchedTasksData.value.length),
        hasGroups: groups.length > 0,
    });
});
provide('boardSurfaceKind', emptyKind);
provide('boardExpectedCount', boardExpectedCount);
provide('onBoardSurfaceAction', onEmptyAction);
function onEmptyAction() {
    if (emptyKind.value === 'failed') {
        const sprint = (headerSprints.value && headerSprints.value[0]) || (props.sprints && props.sprints[0]);
        const pid = firstId(project.value && project.value._id);
        const sid = firstId(sprint && (sprint.id || sprint._id));
        const stored = countSprintBoardTasks(allProjectTasks.value, pid, sid);
        const rebind = (refetch) => {
            init(props.grouped, refetch, project.value, props.sprints, groupedTasks, false, true);
        };
        if (stored > 0) {
            rebind(false);
            return;
        }
        Promise.resolve(reloadSprintTasks())
            .then(() => {
                rebind(true);
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