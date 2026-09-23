<template>
    <Transition v-if="!isLoading">
        <div v-if="groupType === 1 ? ((searchedTask ? filteredTasksGetter.length : items?.length) || !item?.users?.length) : (!searchedTask || filteredTasksGetter.length)" class="item_wrapper task-container" @scroll="checkScroll">
            <div class="new-row item_head">
                <div class="new-col1" :style="`${containerWidth > sideScrollWidth ? 'border:0px' : ''};`" :class="[{'new-col-mobile' : containerWidth < 768}]">
                    <div class="common-section head" @click="() => {emit('toggle', item); $forceUpdate();}">
                        <template v-if="groupType === 1">
                            <img src="@/assets/images/svg/triangleBlack.svg" alt="traingle" :style="`margin-right: 5px; transform: rotateZ(${item.isExpanded ? 90 : 0}deg)`">
                            <div class="cursor-default position-re d-flex align-items-center ml-8px assignee__wrapper" v-if="item.value?.length">
                                <Assignee
                                    :users="item.value.split('_')"
                                    :num-of-users="3"
                                    imageWidth="30px"
                                    :addUser="false"
                                    class="mr-5px"
                                />
                                <h5 v-if="containerWidth > 767" class="text-ellipse item-title font-size-14" :style="`color: ${item.textColor ? item.textColor : '#3a3a3a'}; background-color: ${item.backColor ? item.backColor : 'transparent'};`">
                                    <span v-for="(user, userIndex) in item.users" :key="userIndex">
                                        {{userIndex !== 0 ? ", " : "" }}{{user.Employee_Name}}
                                    </span>
                                </h5>
                            </div>
                            <div class="position-re d-flex align-items-center" v-else>
                                <img src="@/assets/images/Assign.png" alt="unassigned"/>
                                <h5 class="text-ellipse item-title" :style="`color: ${item.textColor ? item.textColor : '#818181'}; background-color: ${item.backColor ? item.backColor : 'transparent'}; margin-left: 5px;`">{{$t('general.unassigned')}}</h5>
                            </div>
                            <!-- <span>{{getTaskCount(item)}} Tasks</span> -->
                            <span class="font-size-14 ml-6px dark-gray">{{searchedTask ? filteredTasksGetter.length : tasksFound}} {{$t('Projects.tasks')}}</span>
                        </template>
                        <template v-else>
                            <img src="@/assets/images/svg/triangleBlack.svg" alt="traingle" class="mr-5px" :style="`transform: rotateZ(${item.isExpanded ? 90 : 0}deg); width: 6px;`">
                            <span class="text-ellipse status-sprint font-weight-500" :style="`color: ${item.textColor ? item.textColor : ''}; background-color: ${item.bgColor ? item.bgColor : 'transparent'}`">
                                <WasabiImage v-if="item.image" :data="{url: item.image, title: item.name}" class="mr-5px"/>
                                {{item.name}}
                            </span>
                            <!-- <span>{{getTaskCount(item)}} Tasks</span> -->
                            <span class="dark-gray font-size-13 font-weight-400 ml-6px tasks__title">{{searchedTask ? filteredTasksGetter.length : tasksFound}} {{$t('Projects.tasks')}}</span>
                        </template>
                    </div>
                </div>
                <div class="new-col2" v-if="containerWidth > 768">
                    <div class="common-section head">
                        <div v-for="(head,i) in headers.filter((x) => cardData.includes(x.id))" :key="i" class="span_wrapper">
                            <span
                                :title="head.label"
                                class="task_right dark-gray font-weight-500 font-size-12 text-ellipse"
                                :class="{
                                    'item-head-draggable-div' : false,
                                    'custom__field_list_view':head.key !== 'AssigneeUserId' && head.key !== 'commentCounts' && head.key !== 'DueDate' && head.key !== 'Task_Priority' && head.key !== 'TaskKey' && head.key !== 'created_date' && head.key !== 'created_by'
                                }"
                                v-if="(head.funcPermission ? checkPermission(head.funcPermission,projectData.isGlobalPermission) !== null : true )"
                            >
                            {{languageCheckHeaders.includes(head.key) ? $t(`Header.${head.key}`) : head.label}}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
            <div v-if="item.isExpanded">
                <div v-for="(task,index) in !searchedTask ? items : filteredTasksGetter" :key="index">
                    <Task
                        :data="task"
                        :key="task._id" 
                        @toggle="(e)=>(toggleTask(task,e))"
                        @createTask="createTask = task._id"
                        class="Task main-task"
                        v-if="(showArchived ? true : !task.deletedStatusKey)"
                        :item="item"
                        :projectObject="projectData"
                        :sprintObject="sprintsData"
                        :cardData="cardData"
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
                                    :item="item"
                                    :projectObject="projectData"
                                    :sprintObject="sprintsData"
                                    :cardData="cardData"
                                />
                            </div>
                            <div :id="`listItem_${sprintId}_${item.key}_${task._id}`" class="table__list-id w-100"></div>
                        </template>
                    </div>
                </div>
                <div :id="`listItem_${sprintId}_${item.key}`" class="table__list-id w-100"></div>
            </div>
        </div>
    </Transition>
    <div v-else>
        <div class="new-row item_head">
            <div class="new-col1" :style="`${containerWidth > sideScrollWidth ? 'border:0px' : ''};`" :class="[{'new-col-mobile' : containerWidth < 768}]">
                <div class="common-section head" @click="() => {emit('toggle', item); $forceUpdate();}">
                    <template v-if="groupType === 1">
                        <img src="@/assets/images/svg/triangleBlack.svg" alt="traingle" :style="`margin-right: 5px; transform: rotateZ(${item.isExpanded ? 90 : 0}deg)`">
                        <div class="cursor-default position-re d-flex align-items-center ml-8px assignee__wrapper" v-if="item.value?.length">
                            <Assignee
                                :users="item.value.split('_')"
                                :num-of-users="3"
                                imageWidth="30px"
                                :addUser="false"
                                class="mr-5px"
                            />
                            <h5 v-if="containerWidth > 767" class="text-ellipse item-title font-size-14" :style="`color: ${item.textColor ? item.textColor : '#3a3a3a'}; background-color: ${item.backColor ? item.backColor : 'transparent'};`">
                                <span v-for="(user, userIndex) in item.users" :key="userIndex">
                                    {{userIndex !== 0 ? ", " : "" }}{{user.Employee_Name}}
                                </span>
                            </h5>
                        </div>
                        <div class="position-re d-flex align-items-center" v-else>
                            <img src="@/assets/images/Assign.png" alt="unassigned"/>
                            <h5 class="text-ellipse item-title" :style="`color: ${item.textColor ? item.textColor : '#818181'}; background-color: ${item.backColor ? item.backColor : 'transparent'}; margin-left: 5px;`">{{$t('general.unassigned')}}</h5>
                        </div>
                        <!-- <span>{{getTaskCount(item)}} Tasks</span> -->
                        <span class="font-size-14 ml-6px dark-gray">{{searchedTask ? filteredTasksGetter.length : tasksFound}} {{$t('Notification.tasks')}}</span>
                    </template>
                    <template v-else>
                        <img src="@/assets/images/svg/triangleBlack.svg" alt="traingle" class="mr-5px" :style="`transform: rotateZ(${item.isExpanded ? 90 : 0}deg); width: 6px;`">
                        <span class="text-ellipse status-sprint font-weight-500" :style="`color: ${item.textColor ? item.textColor : ''}; background-color: ${item.bgColor ? item.bgColor : 'transparent'}`">
                            <WasabiImage v-if="item.image" :data="{url: item.image, title: item.name}" class="mr-5px"/>
                            {{item.name}}
                        </span>
                        <!-- <span>{{getTaskCount(item)}} Tasks</span> -->
                        <span class="dark-gray font-size-13 font-weight-400 ml-6px tasks__title">{{searchedTask ? filteredTasksGetter.length : tasksFound}} {{$t('Notification.tasks')}}</span>
                    </template>
                </div>
            </div>
            <div class="new-col2">
                <div class="common-section head">
                    <div v-for="(head,i) in headers.filter((x) => cardData.includes(x.id))" :key="i" class="span_wrapper">
                        <span
                            :title="head.label"
                            class="task_right dark-gray font-weight-500 font-size-12 text-ellipse"
                            :class="{
                                'item-head-draggable-div' : false,
                                'custom__field_list_view':head.key !== 'AssigneeUserId' && head.key !== 'commentCounts' && head.key !== 'DueDate' && head.key !== 'Task_Priority' && head.key !== 'TaskKey' && head.key !== 'created_date' && head.key !== 'created_by'
                            }"
                            v-if="(head.funcPermission ? checkPermission(head.funcPermission,projectData.isGlobalPermission) !== null : true )"
                        >
                            {{ head.label }}
                        </span>
                    </div>
                    <span class="span_wrapper task_right cursor-pointer" v-if="!projectData?.deletedStatusKey && checkPermission('task.list_view_column',project?.isGlobalPermission) == true">
                        <DropDown>
                            <template #button>
                                <img :src="addCustomField" :alt="addCustomField" v-if="props.statusIndex === 0" />
                            </template>
                            <template #options>
                                <DropDownOption>
                                    <input type="text" class="customfield__form-control" :placeholder="$t('PlaceHolder.search')" v-model="search" @input="handleInput">
                                </DropDownOption>
                                <DropDownOption v-if="checkPermission('task.task_custom_field',project?.isGlobalPermission) !== null && checkApps('CustomFields')">
                                    <span class="font-weight-500 line-height-19 font-roboto-sans blue" @click="isCustomField = true">+ {{$t('CustomField.custom_field')}}</span>
                                </DropDownOption>
                                <template v-if="headerHideShow && headerHideShow.length">
                                    <DropDownOption
                                        v-for="(obj, index) in headerHideShow.filter((head)=> (head.funcPermission ? checkPermission(head.funcPermission,projectData.isGlobalPermission) !== null : true ) && (head.appPermission ? checkApps(head.appPermission) : true ))"
                                        :key="index"
                                    >
                                        <div class="d-flex align-items-center justify-content-between w-100">
                                            <span class="font-weight-400 line-height-19 font-roboto-sans">
                                                {{obj.label}}
                                            </span>
                                            <span>
                                                <Toggle
                                                    v-model="obj.show"
                                                    width="20"
                                                    activeColor="rgba(78, 209, 100, 1)"
                                                    @click="toggleButton(obj.show,obj.key,obj)"
                                                />
                                            </span>
                                        </div>
                                    </DropDownOption>
                                </template>
                                <template v-else>
                                    <div class="text-center p-3px">
                                        {{$t('TimeTracker.No_Record_Found')}}
                                    </div>
                                </template>
                            </template>
                        </DropDown>
                    </span>
                </div>
            </div>
        </div>
        <Skelaton v-for="i in 5" :key="i" class="border-radius-5-px skelaton__option m-5px border-bottom"/>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, ref, watch, defineProps, unref, onMounted, inject, defineEmits, nextTick } from 'vue';
import { useStore } from 'vuex';
import { useCustomComposable } from '@/composable';
import { taskListHelper } from '@/views/Projects/helper';

// COMPONENTS
import Task from '../Task/Task.vue';
import { useToast } from 'vue-toast-notification';
import Toggle from "@/components/atom/Toggle/Toggle.vue";
import Assignee from "@/components/molecules/Assignee/Assignee.vue";
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import {customField} from '../../../../customFieldView/helper.js';
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';

const {isCustomFields} = customField();
import * as env from '@/config/env';
import { useI18n } from "vue-i18n";
import { apiRequest } from "../../../../../services/index";
import Skelaton from "@/components/atom/Skelaton/AiSkelaton.vue"
const { t } = useI18n();
// UTILS
const {getters,commit} = useStore();
const $toast = useToast();
const userId = inject("$userId")
const {getSprintTasks} = taskListHelper();
const {checkPermission, checkApps} = useCustomComposable();
const containerWidth = inject('$containerWidth');
const searchedTask = inject('searchedTask');

const taskCollapsed = inject("taskCollapsed");
const showArchived = inject("showArchived");
const companyId = inject("$companyId");
const isLoading = ref(false);

// IMAGES
const addCustomField = require('@/assets/images/svg/add_circle_plus.svg');

const props = defineProps({
    item: Object,
    groupType: Number,
    sprintId: String,
    projectId: String,
    commonDateFormatForDate: String,
    statusIndex:{
        type:Number,
        default:0
    },
    project:{
        type:Object,
        default:() => {}
    },
    sprintObject:{
        type:Object,
        default:() => {}
    },
    filteredProjects:{
        type:Array,
        default:() => []
    },
    searchTaskData:{
        type:Array,
        default:() => []
    },
    cardData: {
        type: Array,
        default: () => []
    }
});

const emit = defineEmits(["toggle"])
const sprintsData = ref(props.sprintObject);
const projectArray = ref(props.filteredProjects);
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
const headerHideShow = ref(headers.value);

const languageCheckHeaders = ["commentCounts","AssigneeUserId","DueDate","Task_Priority","TaskKey","created_date","created_by"]

const customFieldList = computed(() => (getters['settings/finalCustomFields'] && getters['settings/finalCustomFields'].length) ? JSON.parse(JSON.stringify(getters['settings/finalCustomFields'])) : []);
const projectData = computed(() => {
    return projectArray.value.filter((x) => (sprintsData.value.isExpanded && x._id === sprintsData.value.projectId))[0] || {};
})

watch(() => props.sprintObject, (newValue) => {
    sprintsData.value = newValue;
}, {immediate: true,deep:true})

watch(props.filteredProjects, (newValue) => {
    projectArray.value = newValue;
}, {immediate: true,deep:true})

onMounted(() => {
    setHeader(customFieldList.value);
    if(tasksGetter.value && tasksGetter.value.length) {
        items.value =  JSON.parse(JSON.stringify(tasksGetter.value));
        prepareIndexData();
    }

    nextTick(() => {
        let options = {
            root: document.querySelector("#list_scroll"),
            rootMargin: "0px",
            threshold: 0.1,
        };
        let obs = new IntersectionObserver((e) => {
            if(e[0] && e[0]?.isIntersecting) {
                if(getters['projectData/tasks']?.[props.projectId]?.[props.sprintId]?.tasks.length) {
                    getSprintTasks({
                        projectId: props.projectId,
                        sprintId: props.sprintId,
                        item: props.item,
                        fetchNew: true,
                        projectData: projectData.value
                    })
                }
            }
        }, options);
        let key;
        if(props.item.indexName === 'groupByPriorityIndex'){
            key = props.item.key.replace(/ /g, "_");
        }else{
            key = props.item.key;
        }

        let target = document.querySelector(`#listItem_${props.sprintId}_${key}`);
        if(obs && target){
            obs.observe(target);
        }
    })
});

const search = ref('');
const searchKey = ref("");
const isCustomField = ref(false);
const sideScrollWidth= 765;
const taskFields = ref(projectData?.value?.taskFields || {});
const filteredTaskFields = ref(Object.values(taskFields.value));

watch(projectData, () => {
    taskFields.value = projectData?.value?.taskFields || {}
})

const filterHeaders = ref(headers.value.filter((x) => filteredTaskFields.value.find((y) => y.key === x.key && y.visible)));
watch([headers, filteredTaskFields], ([val]) => {
    filterHeaders.value = val.filter((x) => filteredTaskFields.value.find((y) => y.key === x.key && y.visible));
})

watch([searchKey, taskFields], () => {
    filteredTaskFields.value = Object.values(taskFields.value).filter((x) => x.label.toLowerCase().includes(searchKey.value.toLowerCase()));
})

const tasksFound = computed(() => {
    if(getters['projectData/tasks'][props.projectId] && getters['projectData/tasks'][props.projectId][props.sprintId]) {
        const found = JSON.parse(JSON.stringify(getters['projectData/tasks'][props.projectId][props.sprintId]?.found))
        return found?.[`${props.item.searchKey}_${props.item.searchValue}`] || 0
    } else {
        return 0;
    }
})

const tasksGetter = ref([])
watch(() => getters['projectData/tasks']?.[props.projectId]?.[props.sprintId]?.tasks, () => {
    if(getters['projectData/tasks'][props.projectId] && getters['projectData/tasks'][props.projectId][props.sprintId]) {
        const store = JSON.parse(JSON.stringify(getters['projectData/tasks'][props.projectId][props.sprintId]))
        let tmp = [];
        if(props.item.searchKey === "DueDate") {
            tmp = store.tasks.filter((x) => {
                return (x.DueDate ? checkCase(props.item.operation, props.item.searchValue, (new Date(x?.[props.item.searchKey]).getTime() / 1000)) : props.item.operation === "non") && !x?.deletedStatusKey
            })?.sort((a,b)=> a?.groupByDueDateIndex - b?.groupByDueDateIndex);
        } else if(props.item.searchKey === "AssigneeUserId") {
            tmp = store.tasks.filter((x) => {
                return x.AssigneeUserId.sort((a,b) => a > b ? 1 : -1).join("_") === props.item.value && !x?.deletedStatusKey;
            })?.sort((a,b)=> a.groupByAssigneeIndex - b.groupByAssigneeIndex);
        } else {
            if (props.item.searchKey === "statusKey") {
                tmp = store.tasks.filter((x) => x[props.item.searchKey] === props.item.searchValue && !x?.deletedStatusKey)?.sort((a,b)=> a?.groupByStatusIndex - b?.groupByStatusIndex);
            } else if (props.item.searchKey === "Task_Priority") {
                tmp = store.tasks.filter((x) => x[props.item.searchKey] === props.item.searchValue && !x?.deletedStatusKey)?.sort((a,b)=> a.groupByPriorityIndex - b.groupByPriorityIndex);
            } else {
                tmp = store.tasks.filter((x) => x[props.item.searchKey] === props.item.searchValue && !x?.deletedStatusKey)
            }
        }

        tmp = tmp.map((x) => {
            if(x?.subtaskArray) {
                x.subtaskArray = x.subtaskArray.filter((y) => !y?.deletedStatusKey);
            }
            return x;
        })
        tasksGetter.value = tmp;
    } else {
        tasksGetter.value = [];
    }
}, {immediate: true, deep: true})
const filteredTasksGetter = computed(() => {
    if(props.searchTaskData?.length && props.sprintId) {
        if(props.item.searchKey === "DueDate") {

            return props.searchTaskData.filter((x) => {
                if(x.DueDate?.seconds) {
                    return x.sprintId === props.sprintId && x.DueDate?.seconds ? checkCase(props.item.operation, props.item.searchValue, x[props.item.searchKey].seconds) : props.item.operation === "non"
                } else {
                    return (x.sprintId === props.sprintId) && (x.DueDate ? checkCase(props.item.operation, props.item.searchValue, new Date(x.DueDate).getTime() / 1000) : props.item.operation === "non")
                }
            });
        } else if(props.item.searchKey === "AssigneeUserId") {

            return props.searchTaskData.filter((x) => {
                return x.sprintId === props.sprintId && x.AssigneeUserId.sort((a,b) => a > b ? 1 : -1).join("_") === props.item.value;
            })
        } else {

            return props.searchTaskData.filter((x) => x.sprintId === props.sprintId && x[props.item.searchKey] === props.item.searchValue);
        }
    } else {
        return [];
    }
});

// CHECK DUE DATE FOR GROUP BY
function checkCase(op, todayS, seconds) {
    const dayHrs = 24 * 60 * 60 * 1000;

    switch(op) {
        case "eq":
            return todayS <= seconds && (((todayS * 1000) + dayHrs)/1000) > seconds;

        case "lt":
            return todayS >= seconds; // compared second less than todayS

        case "gt":
            return todayS <= seconds; // compared second greater than todayS
    }
}
const items = ref([]);
watch(() => unref(tasksGetter), (newVal) => {       
    items.value = newVal.map((x) => {
        let index = items.value.findIndex((y) => x._id === y._id);        
        if(index !== -1) {
            x.isExpanded = items.value[index].isExpanded;
        }

        return x;
    });
    // prepareIndexData();
})

const createTask = ref(false);

let subObserver = {};
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
                    let storeSprintTasks = getters['projectData/tasks']?.[props.projectId]?.[props.sprintId]?.tasks || [];
                    if(storeSprintTasks.length && storeSprintTasks.find((x) => x._id === task._id)) {
                        fetchSubTask(task, true);
                    }
                }
            }, options);

            let target = document.querySelector(`#listItem_${props.sprintId}_${props.item.key}_${task._id}`);

            if(obs && target){
                subObserver[task._id] = obs
                obs.observe(target);
            }
        })
    } else {
        subObserver?.[task._id]?.disconnect();
        subObserver[task._id] = null;
    }

    if(task.isExpanded === true && (!task.subtaskArray || task.subtaskArray.length < 25)) {
        fetchSubTask(task, true);
    }
}

// DEBOUNCE
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

function checkScroll(e) {
    debouncer(50)
    .then(() => {
        if(e.target.scrollTop >= (e.target.scrollHeight - e.target.clientHeight) - 200) {
            getSprintTasks({
                projectId: props.projectId,
                sprintId: props.sprintId,
                item: props.item,
                userId: userId.value,
                fetchNew: true,
                projectData: projectData.value,
            })
        }
    })
    .catch((err) => {
        console.error("error", err);
    })
}
function checkSubTaskScroll(e, task) {
    debouncer(50)
    .then(() => {
        if(e.target.scrollTop >= (e.target.scrollHeight - e.target.clientHeight) - 150) {
            fetchSubTask(task, true);
        }
    })
    .catch((err) => {
        console.error("error", err);
    })
}

function fetchSubTask(task, fetchNew = false) {
    getSprintTasks({
        projectId: props.projectId,
        sprintId: props.sprintId,
        item: props.item,
        userId: userId.value,
        fetchNew: fetchNew,
        projectData: projectData.value,
        parentId: task.isParentTask ? task._id : ""
    })
}

const handleInput = () => {
    headerHideShow.value = headers.value;
    if(search.value){
        const filters = headerHideShow.value.filter(x => x?.label?.toLowerCase()?.includes(search.value?.toLowerCase()));
        headerHideShow.value = filters;
    }
}
const toggleButton = async(value,index,obj) => {
    try {
        const object = {
            updateObject : {},
            key:''
        }
        if(obj?.newAdded === true){
            delete obj?.newAdded;
            object.updateObject = {
                viewColumn: obj
            }
            object.key = '$push'
        }else{
            object.updateObject = {
                [`viewColumn.$[elementIndex].show`]: value
            }
            object.key = '$set'
            object.arrayFilters = [{ "elementIndex.key": index }]
        }
        const result = await apiRequest("put",`${env.PROJECT}/${projectData.value._id}`,object)
        if(result.status === 200){
            commit('projectData/projectLocalUpdate', { op: "modified", itemData: { ...props.project } });
        }else{
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        }
    } catch (error) {
        console.error("Error in updating the custom field value:",error)
        $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
    }
};

const setHeader = (customFieldArray) => {
    if(!isCustomFields()){
        headers.value = headers.value.filter(e => e?.appPermission !== 'CustomFields');
        headerHideShow.value = headerHideShow.value.filter(e => e?.appPermission !== 'CustomFields');
    }else{
        if(customFieldArray && customFieldArray.length && props.statusIndex === 0){
            customFieldArray.forEach((x)=>{
                let checkId = headerHideShow.value.findIndex((e) => e.key === x._id);
                let headerIndex = headers.value?.findIndex((ele) => ele.key === x._id);                
                if(headerIndex !== -1){
                    headers.value[headerIndex].label = x.fieldTitle;
                    headers.value[headerIndex].funcPermission = 'task.task_custom_field';
                    headers.value[headerIndex].appPermission = 'CustomFields';
                }
                if(checkId !== -1){
                    const check = x?.global && x?.global === true ? false : !x?.projectId?.includes(props?.projectId)
                    if(!x?.isDelete || x?.type !== 'task' || check){
                        headerHideShow.value.splice(checkId,1);
                    }
                }else{
                    if((x?.isDelete) && (x?.type === 'task') && (x?.global || x?.projectId?.includes(props?.projectId))){
                        headerHideShow.value.push({
                            label:x?.fieldTitle,
                            key:x?._id,
                            postition:headerHideShow.value.length + 1,
                            show:false,
                            newAdded:true,
                            funcPermission: 'task.task_custom_field',
                            appPermission: 'CustomFields'
                        })
                    }
                }
            });
        }
    }
}


function prepareIndexData () {    
    // setTimeout(() => {
    let taskWithoutFilter = []
    let taskArray = [];
    let withoutIndexTask = items.value?.filter((data) => {
        return (data[props.item.indexName] === undefined || data[props.item.indexName] === null) && data.TaskKey !== '--'
    })
    if (withoutIndexTask?.length > 0) {
        withoutIndexTask.map((x) => taskWithoutFilter.push({data: x._id, item: props.item, taskKey: x.TaskKey}))
        withoutIndexTask.map((x) => taskArray.push(x));
    }    
    if (!(taskWithoutFilter.length === 0 && taskArray.length === 0)) {
        var newObj = {pid: projectData.value._id, sprintId: items.value[0].sprintId, tasksArray: taskArray, indexName: items.value[0].indexName};
        commit("projectData/mutateTaskIndex",newObj)
        let count = 0;
        if (taskArray.length !== 1) {
            isLoading.value = true;
        }
        let countFunction = (row) => {
            if (count >= taskWithoutFilter.length) {
                isLoading.value = false;
                return;
            } else {
                if (row.taskKey != '--') {
                    apiRequest("post", env.ONLOAD_UPDATE_TASK_INDEX, {
                        taskUpdate : row,
                        companyId: companyId.value,
                    }).then(()=>{
                        count++;
                        countFunction(taskWithoutFilter[count])
                    })
                    .catch((error) => {
                        console.error("ERROR in update project history: ", error);
                        count++;
                        countFunction(taskWithoutFilter[count])
                    })
                } else {
                    count++;
                    countFunction(taskWithoutFilter[count]);
                }
            }
        }
        countFunction(taskWithoutFilter[count])
    }
    // }, 2000);
}
</script>

<style>
@import "./style.css";
.v-enter-active,
.v-leave-active {
  transition: all 0.2s ease;
}
.v-enter-from,
.v-leave-to {
  opacity: 0;
}
.assignee__wrapper{
    max-width: 78%;
}
.table__list-id{
    height: 100px;
    /* margin-top: -100px; */
    position: absolute;
    bottom: 0;
    z-index: -1;
}
.tasks__title{
    line-height:20px !important;
}
.create__task-id{
    margin: 0px 0px 10px 20px !important;
}
.task-container{
    container-type: inline-size; /* Enables container queries */
    container-name: tasksList; /* This name is referenced in @container */
    box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.08);
}
</style>