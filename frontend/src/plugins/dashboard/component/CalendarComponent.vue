<template>
    <div class="calendar__detail--wrapper bg-white border-radius-10-px dashboard-calender-component-main"> 
        <div class="calendar__component--header d-flex align-items-center justify-content-between border-bottom-serach">
            <div class=" d-flex align-items-center">   
                <div class=" d-flex align-items-center" :style="[{marginRight : clientWidth > 767 ? '40px' : '15px' }]">
                    <span class="cursor-pointer"><img class="calendar_days left__days position-re z-index-1"  :src="calnedarLeft" @click="subtractDays(1)"/></span>
                    <span class="font-size-16 black font-weight-500 due-date-home-calender-wrapper">
                        <DueDateCompo
                            :ref="'dueDate'"
                            class="due-date-home-cal"
                            id="due-date-home-calender"
                            :allowTillCurrentDate="true"
                            :isShowDateAndicon="true"
                            :displyDate="new Date(dateValue).getTime()"
                            @SelectedDate="($event) => updateDueDate($event)"
                            :position="`right`"
                            :autoposition="true"
                        />
                    </span>
                    <span class="cursor-pointer"><img class="calendar_days right__side position-re z-index-1" :src="calnedarRight" @click="addDays(1)"/></span>
                </div>
            </div>
            <div class="d-flex align-items-center">
                <span class="day__status font-size-14 gray81 cursor-pointer lable-status-hover" :style="[{marginLeft : clientWidth > 767 ? '20px' : '10px' }]" @click="updateDueDate({dateVal:new Date()})">{{$t('Home.Today')}}</span>
            </div>
        </div> 
        <div class="calendar__main-component">
            <!-- <SpinnerComp :is-spinner="loading" v-if="loading" class="position-re mt-30px"/> -->
            <div class="p-10px" v-if="loading">
                <div class="calendar__taskdisplay--wrapper-skelaton mb-10px" v-for="(ele,index) in 3" :key="index">
                    <SkelatonVue :style="{width: '40%', height: '11px', margin: '5px 0px 5px 5px'}" :class="{}"/>
                    <SkelatonVue :style="{width: '100%', height: '16px', margin: '5px 0px 5px 5px'}" :class="{}"/>
                </div>
            </div>
            <div class="calnedar__projectstatus--timecomponent overflow-y-auto overflow-x-hidden" @scroll="onScroll">
                <div v-if="!loading && searchResults && searchResults.length == 0" class="text-center">
                   {{$t('Home.no_task_found')}}
                </div>
                <Transition>
                    <TransitionGroup name="list" appear tag="div">
                        <div v-if="!loading && searchResults && searchResults.length">
                            <CalendarTaskDisplayComponent v-for="(task) in searchResults" @openTaskDetailSidebar="openInNewTab(task)" :key="task._id" :taskObject="task" :findParticularProject="findParticularProject(task.ProjectID)"/>
                        </div>
                    </TransitionGroup>
                </Transition>
            </div>
        </div>
        <TaskDetail 
            v-if="isTaskDetail" 
            :companyId="companyId" 
            :projectId="projectId" 
            :sprintId="sprintId"
            :taskId="taskId" 
            :isTaskDetailSideBar="isTaskDetail" 
            @toggleTaskDetail="toggleTaskDetail" 
            :zIndex="5" 
        />
    </div>
</template>

<script setup>
import { defineProps, ref, onMounted, inject, watch, nextTick, provide } from "vue";
import { useStore } from "vuex";
import SkelatonVue from '@/components/atom/Skelaton/Skelaton.vue';
import DueDateCompo from '@/components/molecules/DueDateCompo/DueDateCompo.vue';
import TaskDetail from '@/views/TaskDetail/TaskDetail.vue';
import { apiRequest } from "@/services";
import * as env from '@/config/env';
import { buildFilterQuery, teamIdToUserId } from "@/composable/commonFunction";
const calnedarLeft = require('@/assets/images/rectangle_leftArrow.png');
const calnedarRight = require('@/assets/images/rectangle_rightArrow.png');
const { getters } = useStore();
const teamsArr = getters["settings/teams"];

const props = defineProps({
    allProjectsArrayFilter: {
        type: Array,
        required: true
    },
    updatedObject: {
        type: Object,
        default: () => { }
    },
    cardData: {
        type: Object,
        default: () => { }
    },
    filterData: {
        type: Array,
        default: () => { }
    },
});

const userId = inject("$userId");
const companyId = inject("$companyId");
const clientWidth = inject("$clientWidth");
const allProjects = ref(props.allProjectsArrayFilter);
const filterData = ref(JSON.parse(JSON.stringify(props.filterData)))
const filterQuery = ref([]);
const searchResults = ref([]);
const pageNumber = ref(1);
const loading = ref(false);
const timer = ref(null);
const memorizationArray = ref([]);
const dateValue = ref(new Date());
const findParticularProject = (id) => allProjects.value.find((xt) => xt._id === id) || {}
const skip = ref(0)
const limit = ref(10)
const projectId = ref(null);
const sprintId = ref(null);
const taskId = ref(null);
const isTaskDetail = ref(false);
const cardObject = ref(props.cardData);

watch(() => props.updatedObject, (newVal) => {
    if (newVal) {
        let start_date = new Date(dateValue.value).setHours(0, 0, 0);
        let end_date = new Date(dateValue.value).setHours(23, 59, 59);
        if (new Date(newVal.DueDate).getTime() >= start_date && new Date(newVal.DueDate).getTime() <= end_date) {
            let fIndex = searchResults.value.findIndex((e) => e._id === newVal._id)
            if (fIndex === -1) {
                searchResults.value.unshift(newVal);
            } else {
                searchResults.value.splice(fIndex, 1, newVal)
            }
        } else {
            let findIndex = searchResults.value.findIndex((ele) => { return ele._id === newVal._id });
            if (findIndex !== -1) {
                searchResults.value.splice(findIndex, 1);
            }
        }
    }
})

const openInNewTab = (task) => {
    projectId.value = task.ProjectID;
    sprintId.value = task.sprintId;
    taskId.value = task._id;
    isTaskDetail.value = true;
};

const toggleTaskDetail = (task, close = false) => {
    isTaskDetail.value = false;
    if (close == true) {
        return;
    }
    projectId.value = '';
    sprintId.value = '';
    taskId.value = '';
    nextTick(() => {
        openInNewTab(task);
    })
}
provide('toggleTaskDetail', toggleTaskDetail);

const addOrSubtractDaysFromToday = (daysToAddOrSubtract) => {
    const newDate = new Date(dateValue.value);
    newDate.setDate(dateValue.value.getDate() + daysToAddOrSubtract);
    searchMongoTasks(new Date(newDate), true)
    return newDate;
}

const addDays = (days) => {
    dateValue.value = addOrSubtractDaysFromToday(days);
}

const subtractDays = (days) => {
    dateValue.value = addOrSubtractDaysFromToday(-days);
}

const searchMongoTasks = (date = null, reset = true) => {
    try {
        if (reset) {
            searchResults.value = [];
            pageNumber.value = 1;
            loading.value = true;
            skip.value = 0
        } else {
            skip.value += limit.value
        }

        let startDate = date == null ? new Date(dateValue.value.setHours(0, 0, 0)).getTime() : new Date(date.setHours(0, 0, 0)).getTime();
        let endDate = date == null ? new Date(dateValue.value.setHours(23, 59, 59)).getTime() : new Date(date.setHours(23, 59, 59)).getTime();
        const projectIDs = cardObject.value.projectId.length ? cardObject.value.projectId : JSON.parse(JSON.stringify(allProjects.value)).map((e) => e?._id);
        // Project scope, always bounded to accessible projects: exclude → whitelist
        // (accessible minus excluded) so a raw $nin can't leak other projects.
        const projectMode = cardObject.value.projectMode || 'all';
        const excludeIds = cardObject.value.projectId || [];
        const accessibleIds = JSON.parse(JSON.stringify(allProjects.value)).map((e) => e?._id);
        const projectIdObjId = (projectMode === 'exclude' && excludeIds.length)
            ? { $in: accessibleIds.filter((id) => !excludeIds.includes(id)) }
            : (projectIDs && projectIDs.length ? { $in: projectIDs } : {});
        // const statusKeys = cardObject.value.statusArray || [];
        let queryAndConditions = [
            {
                objId: {
                    CompanyId: companyId.value,
                },
            },
            { deletedStatusKey: 0 },
            {
                ProjectID: {
                    objId: projectIdObjId,
                },
            },
            ...(filterQuery.value ? Object.entries(filterQuery.value).map(([key, value]) => ({ [key]: value })) : [])
        ];

        // if (statusKeys && statusKeys.length) {
        //     queryAndConditions.push({ statusKey: { $in: statusKeys } });
        // }

        let obj = [
            {
                $match: {
                    $and: queryAndConditions,
                    $or: [
                        { startDate: { dbDate: { $gte: startDate, $lte: endDate } } },
                        { DueDate: { dbDate: { $gte: startDate, $lte: endDate } } },
                        {
                            $and: [
                                { DueDate: { dbDate: { $gte: startDate } } },
                                { startDate: { dbDate: { $lte: endDate } } }
                            ]
                        }
                    ]
                }
            },
            {
                $lookup: {
                    from: 'folders',
                    localField: 'folderObjId',
                    foreignField: '_id',
                    as: 'folderArray',
                    pipeline: [
                        {
                            $project: {
                                name: 1
                            }
                        }
                    ],
                }
            },
            {
                $lookup: {
                    from: 'sprints',
                    localField: 'sprintId',
                    foreignField: '_id',
                    as: 'sprintArray',
                    pipeline: [
                        {
                            $project: {
                                name: 1,
                                folderId: 1
                            }
                        }
                    ],
                }
            },
            {
                $unwind: '$sprintArray'
            },
            {
                $unwind: { path: '$folderArray', preserveNullAndEmptyArrays: true }
            },
            { $sort: { DueDate: -1, _id: 1 } },
            { $skip: skip.value },
            { $limit: limit.value }
        ]
        obj = teamIdToUserId(obj, teamsArr);
        const queryRef = apiRequest('post', `${env.TASK}/find`, { findQuery: obj })

        debouncer(500).then(() => {
            queryRef.then((response) => {
                if (response.status !== 200) {
                    loading.value = false;
                    searchResults.value = []
                    return;
                }
                let result = response.data;
                if (!result.length || result.length == 0) {
                    loading.value = false;
                    if (reset) {
                        searchResults.value = []
                    }
                    return;
                }
                pageNumber.value = pageNumber.value + 1;
                if (reset) {
                    searchResults.value = result
                } else {
                    result.forEach(x => {
                        searchResults.value.push({ ...x })
                    })
                }
                let count = 0;
                const updateTask = async (ele) => {
                    if (count >= searchResults.value.length) {
                        return;
                    } else {
                        if (ele.parentTaskName == undefined && !ele.isParentTask) {
                            let dataVal = await getSubTaskData(ele.ParentTaskId)
                            ele.parentTaskName = dataVal ? dataVal.TaskName : '';
                            count++;
                            updateTask(searchResults.value[count]);
                        } else {
                            count++;
                            updateTask(searchResults.value[count]);
                        }
                    }
                }
                updateTask(searchResults.value[count]);
                loading.value = false;
            })
            .catch((error) => {
                loading.value = false;
                console.error("ERROR in search tasks: ", error);
            })
        })
    } catch (error) {
        loading.value = false;
        console.error("ERROR in search tasks: ", error);
    }
}

const getSubTaskData = async (id1) => {
    const query = [
        {
            "$match": {
                objId: {
                    _id: id1
                }
            }
        }
    ];

    const findIndex = memorizationArray.value.findIndex((ele) => ele._id === id1);
    if (findIndex === -1) {
        try {
            const response = await apiRequest('post', `${env.TASK}/find`, { findQuery: query });
            if (response.status === 200) {
                memorizationArray.value.push({ ...response.data[0] });
                return { ...response.data[0] };
            } else {
                console.error(`ERROR: ${response.status} - ${response.data.message}`);
                return null;
            }
        } catch (error) {
            console.error("Error fetching subtask data:", error);
            return null;
        }
    } else {
        return memorizationArray.value[findIndex];
    }
}

const updateDueDate = (event) => {
    if (new Date(dateValue.value).toLocaleDateString() === new Date(event.dateVal).toLocaleDateString()) {
        return
    }
    dateValue.value = new Date(event.dateVal);
    searchMongoTasks(dateValue.value, true)
}

const onScroll = (e) => {
    debouncer(50).then(() => {
        if (e.target.scrollTop >= (e.target.scrollHeight - e.target.clientHeight) - 200) {
            searchMongoTasks(new Date(dateValue.value), false);
        }
    })
}

function debouncer(timeout = 1000) {
    return new Promise((resolve) => {
        if (timer.value) {
            clearTimeout(timer.value);
        }
        timer.value = setTimeout(() => {
            resolve();
        }, timeout);
    })
}

onMounted(() => {
    if (filterData.value && filterData.value.length) {
        filterQuery.value = buildFilterQuery(filterData.value,userId.value);
    }
    loading.value = true;
    searchMongoTasks();
})

// Watch for changes in cardData prop
watch(() => props.cardData, (newValue) => {
    cardObject.value = newValue;
    searchMongoTasks(new Date(dateValue.value), true);
}, { deep: true, immediate: true });

// Watch for changes in advance filter prop
watch(() => props.filterData, (newValue) => {
    const hasValues = Object.values(newValue).length > 0;

    if (hasValues) {
        filterQuery.value = buildFilterQuery(Object.values(newValue),userId.value);
        searchMongoTasks();
    } else if (filterQuery.value !== '') {
        filterQuery.value = '';
        searchMongoTasks();
    }
}, { immediate: true, deep: true });
</script>

<style scoped src="../css/style.css"></style>