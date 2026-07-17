<template>
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
        <div class="w-100 pr-20px pl-20px mt-20px list_view_dashboard style-scroll" v-if="isLoading || sprintLoading">
            <div class="bg-white border-radius-8-px p-10px mb-15px">
                <div class="d-flex align-items-center mb-20px">
                    <img :src="triangleBlack" alt="triangleBlack">
                    <Skelaton class="border-radius-5-px ml-10px" style="height: 20px; width: 150px;"/>
                </div>
                <!-- <Skelaton v-for="i in 5" :key="i" class="border-radius-5-px skelaton__option mb-5px"/> -->
                <div v-for="i in 5" :key="i" class="sprint" style="background-color: #f4f5f7" :style="`${i == 5 ? 'margin-bottom: 0px !important;' : ''}`">
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
            <div class="d-flex align-items-center justify-content-between overflow-y-auto">
                <div class="d-flex align-items-center justify-content-start filter-list">
                    <div class="position-re task-fitler-search" id="projectviewfiltersearch_driver">
                        <input type="text" :placeHolder="$t('PlaceHolder.search')" class="form-control search-datas-das" v-model="taskSearch">
                        <DropDown :id="cardUID" title="Search In" class="position-ab dropdown-image-horizontal" :bodyClass="{'search__in-dropdown' : true}">
                        <template #head>
                            <h4 class="black font-size-13 font-weight-500 p-10px m-0 search__in" :class="{'border-bottom': containerWidth > 767}">
                                {{$t('Projects.search_in')}}
                            </h4>
                        </template>
                        <template #button>
                            <img :ref="cardUID" :src="horizontalDots" alt="horizontalDots" class="vertical-middle" id="searchfilterdropdown_driver">
                        </template>
                        <template #options>
                            <DropDownOption @click="taskDescriptionSearch || taskKeySearch ? taskNameSearch = !taskNameSearch : ''" class="task-serachstatus-dropdown border-radius-4-px">
                                <span class="project-mobile-desc mr-10px">{{$t('Projects.task_name')}}</span>
                                <Toggle  width="20" v-model="taskNameSearch" :disabled="taskNameSearch && !taskDescriptionSearch && !taskKeySearch" @change="searchMongoDB()"/>
                            </DropDownOption>
                            <DropDownOption @click="taskKeySearch = !taskKeySearch" class="task-serachstatus-dropdown border-radius-4-px">
                                <span class="project-mobile-desc mr-10px">{{$t('Projects.task_key')}}</span>
                                <Toggle width="20" v-model="taskKeySearch" @change="toggleSearch(),searchMongoDB()"/>
                            </DropDownOption>
                            <DropDownOption @click="taskDescriptionSearch = !taskDescriptionSearch" class="task-serachstatus-dropdown border-radius-4-px">
                                <span class="project-mobile-desc mr-10px">{{$t('ProjectDetails.description')}}</span>
                                <Toggle width="20" v-model="taskDescriptionSearch" @change="toggleSearch(),searchMongoDB()"/>
                            </DropDownOption>
                        </template>
                    </DropDown>
                    </div>
                    <div v-if="dateRangeEnabled" class="d-flex align-items-center tasklist-range ml-10px">
                        <span class="tasklist-range-label">{{ $t('dashboardCard.tasklist_date_range') }}</span>
                        <select v-model="dateRangeField" class="form-control tasklist-range-field">
                            <option value="DueDate">{{ $t('Header.DueDate') }}</option>
                            <option value="createdAt">{{ $t('Header.created_date') }}</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="list_view_dashboard style-scroll" v-if="groupedTasks.length || (!searchTask ? allTaskGetters.length : searchTaskData.length)" id="list_scroll"  @scroll="scrollFunction">
                <template v-if="groupById !== 4">
                    <SprintListing
                        v-for="(sprint, index) in groupedTasks"
                        :key="sprint?.id"
                        :sprint="sprint"
                        :groupType="groupById"
                        :commonDateFormatForDate="commonDateFormatForDate"
                        :style="{marginBottom: index === groupedTasks.length - 1 ? '0px' : '15px',marginTop: index === 0 ? '10px' : '0px'}"
                        :calendarDate="initialDate"
                        @change="(sprintId,projectId) => {toggleSprints(sprintId,projectId)}"
                        :calendarDateChange="calendarDateChange"
                        :filteredProjects="filteredProjects"
                        :searchTaskData="searchTaskData"
                        :cardUID="cardUID"
                        :cardData="cardData.fields"
                    />
                </template>
                <div v-else> 
                    <div class="item_wrapper">
                        <div class="new-row item_head">
                            <div class="new-col1 colum-1-calss" :style="`${containerWidth > sideScrollWidth ? 'border:0px' : ''};`" :class="[{'new-col-mobile' : containerWidth < 768}]">
                                <div class="common-section head heading">
                                    <span class="font-size-12 dark-gray font-weight-500">Title</span>
                                </div>
                            </div>
                            <div class="new-col2" v-if="containerWidth > 768">
                                <div class="common-section head">
                                    <div  v-for="(head,i) in filteredHeaders" :key="i">
                                    <span
                                        :title="head.label"
                                        class="task_right dark-gray font-weight-500 font-size-12 text-ellipse"
                                        :class="{
                                            'item-head-draggable-div' : false,
                                            'custom__field_list_view':head.key !== 'AssigneeUserId' && head.key !== 'commentCounts' && head.key !== 'DueDate' && head.key !== 'Task_Priority' && head.key !== 'TaskKey' && head.key !== 'created_date' && head.key !== 'created_by'
                                        }"
                                        v-if="(head.funcPermission ? checkPermission(head.funcPermission,true) !== null : true )"
                                    >
                                    {{languageCheckHeaders.includes(head.key) ? $t(`Header.${head.key}`) : head.label}}
                                    </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div v-for="(task,index) in !searchTask ? allTaskGetters : searchTaskData" :key="index">
                            <Task
                                :data="task"
                                :key="task._id" 
                                @toggle="(e)=>(toggleTask(task,e))"
                                @createTask="createTask = task._id"
                                class="Task"
                                :projectObject="filteredProjects.find((x) => x._id === task.ProjectID) || {}"
                                :sprintObject="sprintsData"
                                :cardData="cardData.fields"
                            />
                            <div class="subtask-wrapper position-re" @scroll="checkSubTaskScroll($event, task)">
                                <template v-if="task.isExpanded && (showArchived ? task.deletedStatusKey !== 2 : true)">
                                    <div v-for="(subTask,index) in task?.subtaskArray" :key="index">
                                        <Task
                                            :data="subTask"
                                            :key="subTask._id"
                                            :lastChild="(task.subtaskArray.length - 1) === index"
                                            :parentAssignee="task.AssigneeUserId"
                                            @toggle="toggleTask(subTask)"
                                            @createTask="createTask = subTask._id"
                                            class="Task sub-task"
                                            :projectObject="filteredProjects.find((x) => x._id === task.ProjectID) || {}"
                                            :sprintObject="sprintsData"
                                            :cardData="cardData.fields"
                                        />
                                    </div>
                                    <div :id="`listItem_${task.sprintId}_${task._id}`" class="table__list-id w-100"></div>
                                </template>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="list_view_dashboard d-flex align-items-center justify-content-center flex-column" v-else>
                <img :src="noSearchResult" alt="noSearchResult" v-if="project?.deletedStatusKey !== 2">
                <h3 class="mt-1" v-if="project?.deletedStatusKey !== 2">{{showArchived ? $t('ProjectSlider.no_archived') : $t('Header.no_data_found')}}</h3>
            </div>
        </template>
    </template>
</template>

<script setup>
// PACKAGES
import { ref, defineProps, defineEmits, nextTick, inject, watch, 
    onMounted, computed,provide
} from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';

// COMPONENTS
import SprintListing from "../../components/organisms/SprintListing/SprintListing.vue"
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue"
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import Toggle from '@/components/atom/Toggle/Toggle.vue'
import Task from '../../components/organisms/Task/Task.vue';
// import isEqual from 'lodash/isEqual';
import { taskListHelper } from '@/views/Projects/helper.js';
import { useCustomComposable, useGetterFunctions } from '../../../../composable';
import { apiRequest } from '../../../../services';
import * as env from '@/config/env';
import { buildFilterQuery, teamIdToUserId } from "@/composable/commonFunction";
import { resolveCardRange } from "@/composable/useResourceWorkload";

const triangleBlack = require('@/assets/images/svg/triangleBlack.svg');
const horizontalDots = require("@/assets/images/svg/horizontalDots.svg");

// UTILS
const {getters,dispatch} = useStore();
const route = useRoute()
const project = inject("selectedProject");
const showArchived = inject("showArchived");
const userId = inject("$userId");
const containerWidth = inject("$containerWidth");
const taskDetail = inject("taskDetail");

const {
    groupBy,
    getSprintTasks,
    getMongoDBUpdate
} = taskListHelper();

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
    calendarDate: {
        type: [String,Number],
        default: ""
    },
    calendarDateChange: {
        type: Function,
        default: () => false
    },
    allProjectsArrayFilter: {
        type: Array,
        default: () => ([])
    },
    cardData: {
        type: Object,
        default: () => { }
    },
    filterData: {
        type: Array,
        default: () => { }
    },
    cardUID : {
        type: String,
        default: ""
    },
    componentId:{
        type: String,
        default: ""
    },
    taskStatusArray: {
        type: [Object,Array],
    },
    companyUserDetail: {
        type: Object,
        default: () => {}
    }
})

// IMAGES
const noSearchResult = require("@/assets/images/svg/No-Search-Result.svg");

const groupedTasks = ref([]);
const expandedSprint = ref("");
const initialDate = ref(0);
const isLoading = ref(false);
const sprintLoading = ref(false);
const sprintsData = ref({});
const allSprintsFlat  = ref([]);
const filterUsers = ref([])
const assigneeFilterOptions = ref([]);
const groupById = ref(0);
// cardData.groupBy may arrive as a plain number, a numeric string, or a stale
// Mongo extended-JSON object ({ $numberLong: "0" }). Coerce to a number so the
// `=== 4` grouping checks work and the list loads.
const normalizeGroupId = (g) => Number(g && typeof g === 'object' ? g.$numberLong : g) || 0;
const searchTask = ref(false);
const taskNameSearch = ref(true)
const taskKeySearch = ref(false)
const taskDescriptionSearch = ref(false)
const taskSearch = ref("");
const filterQuery = ref([]);
const searchTaskData = ref([]);
const allTaskGetters = ref([])
const timer = ref(null);
const filteredProjects = ref([]);
const taskCollapsed = ref(true);
const skip = ref(0);
const subtaskPagination = ref({});
let subObserver = {};
const sideScrollWidth= 765;
const languageCheckHeaders = ["commentCounts","AssigneeUserId","DueDate","Task_Priority","TaskKey","created_date","created_by"];
const headers = ref([
    {
        label: "Chat",
        key: "commentCounts",
        id:1
    },
    {
        label: "Assignee",
        key: "AssigneeUserId",
        funcPermission: 'task.task_assignee',
        id: 2
    },
    {
        label: "Due Date",
        key: "DueDate",
        funcPermission: 'task.task_due_date',
        id: 3
    },
    {
        label: "Priority",
        key: "Task_Priority",
        funcPermission: 'task.task_priority',
        appPermission: 'Priority',
        id: 4
    },
    {
        label: "Key",
        key: "TaskKey",
        id: 5
    },
    {
        label: "Created Date",
        key: "created_date",
        id: 6
    },
    {
        label: "Created By",
        key: "created_by",
        id: 7
    }
])
const filteredHeaders = ref([]);

// ── Optional card-level date filter (config toggle: enableDateRange).
// When enabled, the card header shows the standard period dropdown (Auto/Today/
// This Week/… — same as sibling cards) and a Due/Created field selector here.
// The resolved window becomes a dbDate clause merged into filterQuery, so it
// rides the exact "Add filter" rails: the short-circuit in searchMongoDB, the
// grouped-view reroute, and both query push-sites all apply it unchanged.
const dateRangeEnabled = computed(() => !!props.cardData?.enableDateRange);
const dateRangeField = ref('DueDate');   // 'DueDate' | 'createdAt'
// Period lives in the card-header dropdown; 0 = Auto → dashboard global range.
const globalRange = inject('dashboardGlobalRange', null);
const timerange = computed(() => {
    const v = Number(props.cardData?.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : 0;
});
const dateRangeClause = computed(() => {
    if (!dateRangeEnabled.value) return null;
    const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
    if (!dateFrom || !dateTo) return null;
    return { [dateRangeField.value]: { dbDate: { $gte: new Date(dateFrom), $lte: new Date(dateTo) } } };
});
// Single source of truth for filterQuery: filterData rows + the date clause.
function syncFilterQuery() {
    const rows = Array.isArray(props.filterData)
        ? props.filterData
        : (props.filterData ? Object.values(props.filterData) : []);
    const base = rows.length ? buildFilterQuery(rows, userId.value) : {};
    if (dateRangeClause.value) {
        base.$and = Array.isArray(base.$and) ? base.$and : [];
        base.$and.push(dateRangeClause.value);
    }
    filterQuery.value = base;
}
// Re-run the active load path after a date-filter change (mirrors filterData watcher).
function applyDateRange() {
    if (!currentCompany.value?.planFeature?.listView) return;
    syncFilterQuery();
    isLoading.value = true;
    skip.value = 0;
    const hasFilter = Object.keys(filterQuery.value).length > 0;
    if (groupById.value === 4) {
        hasFilter ? searchMongoDB() : fetchTasks(15, '');
    } else if (hasFilter) {
        searchMongoDB();
    } else {
        processProjects(groupById.value, true, groupedTasks, false, true);
    }
}
watch(dateRangeField, () => { if (dateRangeEnabled.value) applyDateRange(); });
// Period dropdown change (persists to cardData.timerange) and enable/disable toggle.
watch(timerange, () => { if (dateRangeEnabled.value) applyDateRange(); });
watch(dateRangeEnabled, () => applyDateRange());
// Auto (0) follows the dashboard global range.
watch(() => globalRange && globalRange.value, () => {
    if (dateRangeEnabled.value && timerange.value === 0) applyDateRange();
}, { deep: true });

watch(() => taskDetail.value, (newVal,oldVal) => {
    if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
        let taskArray = !searchTask.value ? allTaskGetters.value : searchTaskData.value;
        let index = taskArray.findIndex((x) => x._id === newVal._id);
        if(index !== -1) {
            taskArray[index] = newVal; 
        }
    }
})

watch(() => props.cardData.projectId, async(newIds,oldIds) => {
    if(oldIds === undefined || JSON.stringify(newIds) === JSON.stringify(oldIds)) {
        return;
    }
    filteredProjects.value = filterProjectsByIds(props.allProjectsArrayFilter, newIds);
    await getAllSprints();
    syncFilterQuery();
    const hasFilter = Object.keys(filterQuery.value).length > 0;
    if(groupById.value === 4) {
        skip.value = 0;
        hasFilter ? searchMongoDB() : fetchTasks(15,"");
    }
    else {
        await processProjects(groupById.value, true, groupedTasks, false, true);
        if(hasFilter) searchMongoDB();
    }
}, { immediate: true });

function filterProjectsByIds(projectArray, idsArray) {
    if(!idsArray || idsArray.length === 0) {
        return projectArray;
    }
    return projectArray.filter(project => idsArray.includes(project._id));
}

provide("taskListProjects",filteredProjects.value);
provide("taskCollapsed", true)
provide("searchedTask", searchTask)

const {getUser} = useGetterFunctions();
const {debounce,checkPermission} = useCustomComposable()

const currentCompany = computed(() => getters["settings/selectedCompany"])
const users = computed(() => getters["users/users"]);
const teamsArr = getters["settings/teams"];

onMounted(() => {
    if(props.allProjectsArrayFilter.length){
        handleInit();
    }
})

function init(group, refetch, projects, sprints, groupedTasksData, isBoard, isInitial,fetchTask) {
    return new Promise((resolve) => {
        if (isInitial == true) {
            isLoading.value = true;
        }
        groupBy(group, refetch, projects, sprints, groupedTasksData, isBoard, 'list', false, fetchTask, (resp) => {
            setTimeout(() => {
                resolve(resp);
                if(props.filterData && props.filterData.length > 0){
                    return;
                }
                isLoading.value = false;
            }, 1000);
        });
    });
}


watch(() => props.allProjectsArrayFilter,(newVal, oldVal) => {
    const isSame = JSON.stringify(newVal) === JSON.stringify(oldVal);
    if (newVal && newVal.length && !isSame) {
        handleInit();
    }
});

async function handleInit () {
    if (!currentCompany.value?.planFeature?.listView) {
        return;
    }
    let fields = props.cardData?.fields || []
    filteredHeaders.value = fields.length === 0 ? [] : headers.value.filter(item => fields.includes(item.id));
    groupById.value = normalizeGroupId(props.cardData.groupBy);
    filteredProjects.value = filterProjectsByIds(props.allProjectsArrayFilter, props.cardData.projectId);
    if(filteredProjects.value.length === 0) return;
    isLoading.value = true;
    await getAllSprints()

    syncFilterQuery();
    const hasFilter = Object.keys(filterQuery.value).length > 0;
    if(groupById.value === 4) {
        if(hasFilter) {
            skip.value = 0;
            await searchMongoDB();
            isLoading.value = false;
        }
        else{
            await fetchTasks(15,'');
            isLoading.value = false;
        }
    }
    else {
        await processProjects(groupById.value, true, groupedTasks, false, true);
        if(hasFilter) {
            await searchMongoDB();
        }
        assigneeFilterOptions.value = [];
        let usersArr = users.value.map((x) => x._id);
        usersArr.forEach((x) => {
            if(x !== userId.value) {
                let user = getUser(x);
                if(!user.ghostUser) {
                    assigneeFilterOptions.value.push({
                        value: x,
                        label: user.Employee_Name,
                        image: user.Employee_profileImageURL
                    })
                }
            }
        })
    }
}


watch(route , (to, from) => {
    if (from?.query?.tab === "Calendar") {
        props.calendarDateChange(true, "calendar");
    }
})
const taskGetter = computed(() => JSON.parse(JSON.stringify(getters["projectData/tasks"])))
watch(taskGetter , () => {
    if(groupById.value === 1) {
        setTimeout(() => {
            processProjects(groupById.value, false, groupedTasks, false,false);
        }, 500)
    }
})


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

watch(() => searchTaskData.value, (newValue,oldValue) => {
    if(newValue.length !== 0 &&newValue.length === (oldValue && oldValue.length)) {
        return;
    }
    assigneeFilterOptions.value = [];
    let usersArr = users.value.map((x) => x._id);

    usersArr.forEach((x) => {
        if(x !== userId.value) {
            let user = getUser(x);
            if(!user.ghostUser) {
                assigneeFilterOptions.value.push({
                    value: x,
                    label: user.Employee_Name,
                    image: user.Employee_profileImageURL
                })
            }
        }
    })
    if(!isLoading.value){
        if(groupById.value !== 4) {
            processProjects(groupById.value, false, groupedTasks, false,false,true);
        }
    }
})

watch(taskSearch, debounce(() => {
    skip.value = 0;
    searchMongoDB()
},1000))
watch(() => props.filterData, (newValue,oldVal) => {
    if(oldVal === undefined) return;
    if ((newValue && newValue.length > 0) || (oldVal && oldVal.length > 0 && (!newValue || newValue.length === 0))) {
        isLoading.value = true;
        syncFilterQuery();
        setTimeout(() => {
            skip.value = 0;
            searchMongoDB();
        }, 1000);
    }
    if((oldVal && oldVal.length > 0 && (!newValue || newValue.length === 0))) {
        skip.value = 0;
        fetchTasks(15);
    }
}, { immediate: true });

watch(() => props.cardData.groupBy, async(newVal,oldVal) => {
    if(oldVal === newVal) return;
    isLoading.value = true;
    groupById.value = normalizeGroupId(newVal);
    syncFilterQuery();
    const hasFilter = Object.keys(filterQuery.value).length > 0;
    if(groupById.value === 4) {
        if(hasFilter) {
            skip.value = 0;
            await searchMongoDB();
            isLoading.value = false;
        }
        else{
            await fetchTasks(15,'');
            isLoading.value = false;
        }
    }
    else {
        await processProjects(groupById.value, true, groupedTasks, false, true);
        if(hasFilter) {
            searchMongoDB();
        }
    }
})

watch(() => props.cardData.fields, async(newVal) => {
    let fields = newVal || [];
    filteredHeaders.value = fields.length === 0 ? [] : headers.value.filter(item => fields.includes(item.id));
})

async function processProjects (groupById, refetch, groupedTasksData, isBoard, isInitial) {
    const allGroupedTasks = [];
    let firstProjectTasks = [];
    groupedTasks.value = [];
    await Promise.allSettled(
        filteredProjects.value?.map(async (project,index) => {
            if (project && Object.keys(project).length) {
                let sprints = sprintsData.value[project._id].map((x) => ({ ...x, projectName: project.ProjectName }));
                if(searchTask.value) {
                    sprints = sprints?.filter((x) => searchTaskData.value.filter((y) => y.sprintId === x._id).length) || [];
                }
                const resp = await init(groupById, refetch, project, sprints, groupedTasksData, isBoard, isInitial,index === 0);
                resp.forEach((item) => {
                    groupedTasks.value = groupedTasks.value.filter(task => task._id !== item._id);
                });
                if (index === 0) {
                    firstProjectTasks.push(...resp);
                } else {
                    allGroupedTasks.push(...resp);
                }
            }
        })
    );
    groupedTasks.value = [
        ...firstProjectTasks,
        ...groupedTasks.value, 
        ...allGroupedTasks 
    ];
    }

function toggleSprints(sprintId,projectId) {
    const projects = filteredProjects.value.find((x) => x._id === projectId) || {};
    groupedTasks.value.forEach((sprint) => {
        let SprintId = sprint?._id;
        if(SprintId === sprintId) {
            sprint.isExpanded = !sprint.isExpanded;
            if(sprint.isExpanded) {
                if(taskSearch.value.trim().length || Object.keys(filterQuery.value).length){
                    searchMongoDB();
                    expandedSprint.value = SprintId
                    return;
                }
                let promises = [];
                sprint.items.forEach((item) => {
                    promises.push(
                        getSprintTasks({projectId: projectId, sprintId: SprintId, item, projectData: projects, groupType: groupById.value})
                    )
                })
                Promise.allSettled(promises)
                .then(() => {
                    nextTick(() => {
                        document.getElementById(`sprint_${SprintId}_${props.cardUID}`).scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                            inline: "nearest"
                        });
                    })

                    getMongoDBUpdate({
                        projectId: projectId,
                        sprintId: sprint._id,
                        projectData: projects,
                        groupBy: {type:  groupById.value, items: sprint.items?.map((x) => ({key: `${x.searchKey}_${x.searchValue}`, value: x.searchValue, name: x.name}))}
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

async function getAllSprints() {
    const allSprints = {};
    const allFolders = {};

    const sprintPromises = filteredProjects.value.map(async (project) => {
        const projectId = project._id;

        if (getters["projectData/sprints"][projectId]) {
            allSprints[projectId] = getters["projectData/sprints"][projectId].filter((sp) => sp.deletedStatusKey === 0);
        } else {
            const sprints = await dispatch("projectData/setSprints", { projectId });
            allSprints[projectId] = sprints.filter((sp) => sp.deletedStatusKey === 0);
        }
    });

    const folderPromises = filteredProjects.value.map(async (project) => {
        const projectId = project._id;

        if (getters["projectData/folders"][projectId]) {
            allFolders[projectId] = getters["projectData/folders"][projectId];
        } else {
            const folders = await dispatch("projectData/setFolders", { projectId });
            allFolders[projectId] = folders;
        }
    });

    await Promise.allSettled([...sprintPromises, ...folderPromises]);

    Object.keys(allSprints).forEach((projectId) => {
        const projectFolders = allFolders[projectId] || [];

        allSprints[projectId] = allSprints[projectId]
            .filter((sprint) => {
                if (sprint.folderId) {
                    const folder = projectFolders.find((f) => f._id === sprint.folderId);
                    return folder === undefined ? false : folder.deletedStatusKey === 0;
                }
                return true;
            })
            .map((sprint) => {
                if (sprint.folderId) {
                    const folder = projectFolders.find((f) => f._id === sprint.folderId);
                    return { ...sprint, folderName: folder ? folder.name : null };
                }
                return sprint;
            });
            allSprintsFlat.value.push(...allSprints[projectId]);
    });

    sprintsData.value = allSprints;
    return allSprints;
}

async function searchMongoDB(parentId = '') {
    let filterSprintsId =  [];
    if(groupById.value !== 4){
        filterSprintsId = await filterSprintsIdQuery();
        const filteredIds = filterSprintsId.filter(x =>
            allSprintsFlat.value.some(y => y._id === x._id)
        );
        filterSprintsId = filteredIds;
    }
    return new Promise ((resolve,reject) => {
        try {
            let limit = groupById.value === 4 ? 15 : undefined;
            if(!taskSearch.value.trim().length &&!filterUsers.value.length && !Object.keys(filterQuery.value).length) {
                isLoading.value = false;
                searchTask.value = false;
                searchTaskData.value = [];
                resolve();
                return;
            }

            let query_by = {};
            let searchStr = taskSearch.value ? taskSearch.value.toString(): "";
            let andOr = '$or';
            query_by[andOr] = [];
            if(taskNameSearch.value) {
                query_by[andOr].push({'TaskName':{ $regex: searchStr, $options: 'i' }});
            }
            if(taskKeySearch.value) {
                query_by[andOr].push({'TaskKey':{ $regex: searchStr, $options: 'i' }});
            }
            if(taskDescriptionSearch.value) {
                query_by[andOr].push({'rawDescription':{ $regex: searchStr, $options: 'i' }});
            }
            let sprintIds = groupById.value === 4 ? allSprintsFlat.value : filterSprintsId || [];
            searchTask.value = true;
            const query = [
                {
                    $match: {
                        $and: [
                            {
                                $and:[
                                    {ProjectID: {objId: {$in : filteredProjects.value.map((x) => x._id)}}},
                                    {sprintId: {objId: {$in : sprintIds.map((x) => x._id)}}},
                                    { deletedStatusKey: { $in: [showArchived.value ? 2 : 0] } }
                                ]
                            },
                        ]
                    }
                }
            ];
            let filQuery = {
                ...( parentId && parentId.length ? 
                    { ParentTaskId: parentId }
                :
                    {
                        isParentTask: true,
                    }
                )
            }

            if (parentId) {
                if (!subtaskPagination.value[parentId]) {
                    subtaskPagination.value[parentId] = 0;
                }
                query.push({ $skip: subtaskPagination.value[parentId] });
            } else {
                if (limit !== undefined) {
                    query.push({ $skip: skip.value });
                }
            }
            if (limit !== undefined) {
                query[0].$match.$and.push(filQuery);
                query.push({ $limit: limit });
            }

            if (filterQuery.value && Object.keys(filterQuery.value).length > 0) {
                query[0].$match.$and.push(filterQuery.value);
            }

            if (filterUsers.value && filterUsers.value.length > 0) {
                query[0].$match.$and.push({ AssigneeUserId: { $in: filterUsers.value } });
            }
            if (searchStr && searchStr.length) {
                query[0].$match.$and.push(query_by);
            }
            queryFunction(query,parentId && parentId.length ? false : true).then((results) => {         
                if (!limit || (skip.value === 0 && parentId === '')) {
                    searchTaskData.value = [];
                }
                results.sort((a, b) => a.isParentTask > b.isParentTask ? -1 : 1);
                results.forEach((task) => {
                    if (task.isParentTask) {
                        const index = searchTaskData.value.findIndex((x) => x._id === task._id);
                        if (index !== -1) {
                            searchTaskData.value[index] = { ...searchTaskData.value[index], ...task };
                        } else {
                            searchTaskData.value.push({ ...task, subtaskArray: [] });
                        }
                    } else {
                        const parentIndex = searchTaskData.value.findIndex((x) => x._id === task.ParentTaskId);
                        if (parentIndex !== -1) {
                            const parentTask = searchTaskData.value[parentIndex];
        
                            const subtaskIndex = parentTask.subtaskArray.findIndex((subtask) => subtask._id === task._id);
                            if (subtaskIndex === -1) {
                                parentTask.subtaskArray.push(task);
                            }
                        }
                    }
                });
                if (results.length > 0) {
                    if (parentId) {
                        subtaskPagination.value[parentId] += results.length;
                    } else {
                        skip.value += results.length;
                    }
                }
                isLoading.value = false;
                resolve();
            }).catch((error) => {
                reject(error);
                isLoading.value = false;
                console.error("ERROR in search Task: ", error);
            })
        } catch (error) {
            isLoading.value = false;
            reject(error);
        }
    })
}

function queryFunction(query,isFindParent) {
    return new Promise((resolve, reject) => {
        apiRequest('post',`${env.TASK}/find`,{findQuery: teamIdToUserId(query, teamsArr)})
        .then((resp) => {
            if(resp.status === 200){
                const results = resp.data;
                const requiredParents = results.filter((x) => !x.isParentTask).map(x => x.ParentTaskId);
                const availableParents = results.filter((x) => x.isParentTask).map((x) => x._id)
                const parentIds = requiredParents.filter((x) => !availableParents.includes(x)).filter((x) => x !== '');
                if(parentIds?.length && isFindParent === true) {
                    let query = [
                        {
                            $match: {
                                $and:[
                                    {
                                        _id: { objId: {$in: parentIds.map(id => id)} }
                                    },
                                    {deletedStatusKey: { $in: showArchived.value === true ? [0,2] : [0] }}
                                ]
                            }
                        }
                    ]
                    apiRequest('post',`${env.TASK}/find`,{findQuery: query})
                    .then((results2) => {
                        if(results2 && results2?.status === 200 && results2?.data){
                            resolve([...results, ...results2.data]);
                        }else{
                            resolve([...results]);
                        }
                    }).catch((error) => {
                        reject(error);
                        console.error("ERROR in search tasks: ", error);
                    })
                } else {
                    resolve(results);
                }
            }
        })
        .catch((error) => {
            reject(error);
            console.error("ERROR in search tasks: ", error);
        })
    })
}

function toggleSearch() {
    if(taskDescriptionSearch.value === false && taskKeySearch.value === false) {
        taskNameSearch.value = true
    }
}

const scrollFunction = (e) => {
    if(groupById.value === 4) {
        debouncer(50).then(() => {
            if (e.target.scrollTop + e.target.clientHeight >= e.target.scrollHeight - 50) {
                if(props.filterData && props.filterData.length > 0) {
                    searchMongoDB()
                }
                else{
                    fetchTasks(15,'');
                }
            }
        })
    }
}

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

function toggleTask(task,e) {
    if(e) {
        task.isExpanded = !task.isExpanded;
    } else {
        if(!taskCollapsed.value){
            task.isExpanded = true;
        } else {
            task.isExpanded = !task.isExpanded;
        }
    }

    if(task.isExpanded) {
        nextTick(() => {
            let options = {
                root: document.querySelector("#list_scroll"),
                rootMargin: "0px",
                threshold: 0.1,
            };
            let obs = new IntersectionObserver((e) => {
                if(e[0] && e[0]?.isIntersecting) {
                    let storeSprintTasks = props.filterData && props.filterData.length > 0 ? searchTaskData.value : getters["projectData/alltasks"] || [];
                    if(storeSprintTasks.length && storeSprintTasks.find((x) => x._id === task._id)) {
                        fetchSubTask(task, true);
                    }
                }
            }, options);

            let target = document.querySelector(`#listItem_${task.sprintId}_${task._id}`);

            if(obs && target){
                subObserver[task._id] = obs
                obs.observe(target);
            }
        })
    } else {
        subObserver?.[task._id]?.disconnect();
        subObserver[task._id] = null;
    }
}
function fetchSubTask(task) {
    if(props.filterData && props.filterData.length > 0) {
        searchMongoDB(task._id);
    }
    else{
        fetchTasks(15,task._id);
    }
}
function checkSubTaskScroll(e, task) {
    debouncer(50)
    .then(() => {
        if(props.filterData && props.filterData.length > 0) {
            searchMongoDB(task._id);
        }
        else{
            fetchTasks(15,task._id);
        }
    })
    .catch((err) => {
        console.error("error", err);
    })
}

watch(() => getters["projectData/alltasks"], (newTasks) => {
    allTaskGetters.value = newTasks;
},{deep: true,immediate: true});

function fetchTasks(limit, parentId = "") {
    return new Promise((resolve,reject) => {
        try {
            let currentSkip = parentId ? subtaskPagination.value[parentId] || 0 : skip.value;

            dispatch("projectData/getAllTask", { 
                projectIds: filteredProjects.value.map((x) => x._id),
                skip: currentSkip,
                parentId: parentId,
                sprintIds: allSprintsFlat.value.map((x) => x._id)
            }).then(() => {
                allTaskGetters.value = getters["projectData/alltasks"];
                resolve();
                if (allTaskGetters.value.length > 0) {
                    if (parentId) {
                        let subtaskCount = allTaskGetters.value.find(task => task._id === parentId)?.subtaskArray?.length || 0;
                        if (!subtaskPagination.value[parentId]) {
                            subtaskPagination.value[parentId] = 0;
                        }
                        subtaskPagination.value[parentId] = subtaskCount;
                    } else {
                        skip.value = allTaskGetters.value.length;
                    }
                }
            }).catch((error) => {
                console.error("ERROR in fetchTasks:", error);
            });
        } catch (error) {
            reject(error);
        }
    })
}

function filterSprintsIdQuery () {
    return new Promise((resolve,reject) => {
        try {
            const query = [
                {
                    $match: {
                        $and: [{
                            ProjectID: { objId: { $in: filteredProjects.value.map(x => x._id) } },
                            deletedStatusKey: 0,
                            legacyId: {$exists:false}
                        }]
                    }
                },
                {
                    $group: {
                        _id: "$sprintId"
                    }
                }
            ];

            let query_by = {};
            let searchStr = taskSearch.value ? taskSearch.value.toString(): "";
            let andOr = '$or';
            query_by[andOr] = [];
            if(taskNameSearch.value) {
                query_by[andOr].push({'TaskName':{ $regex: searchStr, $options: 'i' }});
            }
            if(taskKeySearch.value) {
                query_by[andOr].push({'TaskKey':{ $regex: searchStr, $options: 'i' }});
            }
            if(taskDescriptionSearch.value) {
                query_by[andOr].push({'rawDescription':{ $regex: searchStr, $options: 'i' }});
            }

            if (filterQuery.value && Object.keys(filterQuery.value).length > 0) {
                query[0].$match.$and.push(filterQuery.value);
            }

            if (filterUsers.value && filterUsers.value.length > 0) {
                query[0].$match.$and.push({ AssigneeUserId: { $in: filterUsers.value } });
            }

            if (searchStr && searchStr.length) {
                query[0].$match.$and.push(query_by);
            }

            apiRequest('post', `${env.TASK}/find`, { findQuery: teamIdToUserId(query, teamsArr) }).then((resp) => {
                if (resp.status === 200) {
                    const results = resp.data;
                    resolve(results);
                }
            })

        } catch (error) {
            reject(error);
        }
    })
}

</script>

<style>
@import "./style.css";

.tasklist-range { gap: 6px; }
.tasklist-range-label { font-size: 12px; font-weight: 600; color: #3a3f52; white-space: nowrap; }
.tasklist-range-field {
    font-size: 12px;
    height: 30px;
    width: auto;
    min-width: 110px;
    padding: 2px 8px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    color: #3a3f52;
}
</style>