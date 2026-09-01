<template>
    <Transition>
        <div v-if="groupType === 1 ? ((searchMode ? filteredTasksGetter.length : items?.length) || !item?.users?.length) : true" class="item_wrapper" @scroll="checkScroll">
            <div class="new-row item_head">
                <div class="new-col1" :style="`${clientWidth > sideScrollWidth ? 'border:0px' : ''};`">
                    <div class="common-section head" @click="() => {emit('toggle', item); $forceUpdate();}">
                        <!-- Group tri-state checkbox: none / some (indeterminate) / all. Visible on header hover or when this group has selection. -->
                        <label
                            v-if="canGroupSelect && groupTaskIds.length"
                            class="group-multi-select"
                            :class="{ 'group-multi-select--active': groupCheckboxState !== 'none' }"
                            @click.stop
                        >
                            <input
                                type="checkbox"
                                :checked="groupCheckboxState === 'all'"
                                :indeterminate.prop="groupCheckboxState === 'some'"
                                @click.stop
                                @change="handleGroupCheckboxChange($event)"
                                :aria-label="$t ? ($t('Common.select_all_tasks') || 'Select all tasks in group') : 'Select all tasks in group'"
                            />
                        </label>
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
                                <h5 v-if="clientWidth > 767" class="text-ellipse item-title font-size-14" :style="`color: ${item.textColor ? item.textColor : '#3a3a3a'}; background-color: ${item.backColor ? item.backColor : 'transparent'};`">
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
                            <span class="font-size-14 ml-6px dark-gray">{{searchedTask ? filteredTasksGetter.length : tasksFound}} {{$t('Projects.tasks')}}<template v-if="pointsTotal"> · {{pointsTotal}} pts</template></span>
                        </template>
                        <template v-else>
                            <img src="@/assets/images/svg/triangleBlack.svg" alt="traingle" class="mr-5px" :style="`transform: rotateZ(${item.isExpanded ? 90 : 0}deg); width: 6px;`">
                            <span class="text-ellipse status-sprint font-weight-500 d-flex align-items-center" :style="`color: ${item.textColor ? item.textColor : ''}; background-color: ${item.bgColor ? item.bgColor : 'transparent'}`">
                                <WasabiImage v-if="item.image" :data="{url: item.image, title: item.name}" class="mr-5px"/>
                                {{item.name}}
                            </span>
                            <!-- <span>{{getTaskCount(item)}} Tasks</span> -->
                            <span class="dark-gray font-size-13 font-weight-400 ml-6px tasks__title">{{searchedTask ? filteredTasksGetter.length : tasksFound}} {{$t('Projects.tasks')}}<template v-if="pointsTotal"> · {{pointsTotal}} pts</template></span>
                        </template>
                    </div>
                </div>
                <div class="new-col2" v-if="clientWidth > 768">
                    <div class="common-section head">
                        <draggable v-model="headers" :disabled="true" class="span_wrapper" tag="div" item-key="TaskName" :group="`itemheader_${props.sprintId}_${item._id}}`">
                            <template #item="{element: head}">
                                <span
                                    :title="head.label"
                                    class="task_right dark-gray font-weight-500 font-size-12 text-ellipse"
                                    :class="{
                                        'item-head-draggable-div' : false,
                                        'custom__field_list_view':head.key !== 'AssigneeUserId' && head.key !== 'commentCounts' && head.key !== 'DueDate' && head.key !== 'Task_Priority' && head.key !== 'TaskKey' && head.key !== 'created_date' && head.key !== 'created_by'
                                    }"
                                    v-if="(head.funcPermission ? checkPermission(head.funcPermission,projectData.isGlobalPermission) !== null : true ) && (head.appPermission ? checkApps(head.appPermission) : true ) && head.show"
                                >
                                {{languageCheckHeaders.includes(head.key) ? $t(`Header.${head.key}`) : head.label}}
                                <!-- {{  head.label }}-{{languageCheckHeaders}} -->
                                <!--Header Name like Chat-->
                                </span>
                            </template>
                        </draggable>
                        <span class="span_wrapper task_right cursor-pointer custom_sticky" v-if="!projectData?.deletedStatusKey && checkPermission('task.list_view_column',project?.isGlobalPermission) == true">
                            <DropDown>
                                <template #button>
                                    <img :src="addCustomField" :alt="addCustomField" v-if="props.statusIndex === 0" />
                                </template>
                                <template #options>
                                    <DropDownOption>
                                        <input type="text" class="customfield__form-control" :placeHolder="$t('PlaceHolder.search')" v-model="search" @input="handleInput">
                                    </DropDownOption>
                                    <DropDownOption v-if="checkPermission('task.task_custom_field',project?.isGlobalPermission) !== null && checkApps('CustomFields') && isCustomFields()">
                                        <span class="font-weight-500 line-height-19 font-roboto-sans blue" @click="isCustomField = true">+ {{$t('CustomField.custom_field')}}</span>
                                    </DropDownOption>
                                    <template v-if="headerHideShow && headerHideShow.length">
                                        <DropDownOption
                                            v-for="(obj, index) in headerHideShow.filter((head)=> (head.funcPermission ? checkPermission(head.funcPermission,projectData.isGlobalPermission) !== null : true ) && (head.appPermission ? checkApps(head.appPermission) : true ))"
                                            :key="index"
                                        >
                                            <div class="d-flex align-items-center justify-content-between w-100">
                                                <span class="font-weight-400 line-height-19 font-roboto-sans">
                                                    {{ obj.label }}
                                                    <!--option DropDown Name-->

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
                                            {{$t('UserTimesheet.no_records_found')}}
                                        </div>
                                    </template>
                                </template>
                            </DropDown>
                        </span>
                        <span v-else class="span_wrapper task_right cursor-pointer custom_sticky">
                        </span>
                    </div>
                </div>
            </div>
            <div v-if="item.isExpanded !== false">
                <draggable
                    handle=".draggable_icon"
                    :class="{'isDisabled': item.isDisabled}"
                    :clone="clone"
                    :move="checkMove"
                    :list="visibleTaskRows"
                    tag="div"
                    @change="draggedTaskId = '',updateItem('task',$event, item)"
                    :item-key="taskRowKey"
                    :group="{name: 'task'}"
                    :sortable="true"
                    :id="`subtasklist_driver ${item.value}`"
                >
                    <template #item="{ element: task }">
                        <div @dragend="dragEnd" @dragstart="dragStart" @dragover="changeExpanded($event, task, true)">
                            <Task
                                :data="task"
                                :key="taskRowKey(task)" 
                                @toggle="(e)=>(toggleTask(task,e))"
                                @createTask="createTask = task._id"
                                class="Task main-task"
                                v-if="(showArchived ? true : !task.deletedStatusKey)"
                                :item="item"
                            />
                            <CreateTask
                                v-if="createTask === task._id"
                                :sprint="{...task.sprintArray, id: task.sprintId, folderId: task.folderObjId}"
                                :taskId="task._id"
                                :assigneeOptions="task.AssigneeUserId"
                                @cancel="createTask = ''"
                                class="create__task-id"
                                :groupBy="groupType"
                            />

                            <div class="subtask-wrapper position-re" @scroll="checkSubTaskScroll($event, task)">
                                <template v-if="task.isExpanded && (showArchived ? task.deletedStatusKey !== 2 : true)">
                                    <!--  -->
                                    <draggable 
                                        handle=".draggable_icon"
                                        :list="task?.subtaskArray"
                                        tag="div"
                                        :move="checkMove"
                                        @change="draggedTaskId = '',updateItem('subTask', $event, task)"
                                        item-key="TaskName"
                                        :group="{name: 'task'}"
                                        class="subTaskAddRemove"
                                        :class="{'SubTaskAdd':task.isExpanded, 'SubTaskAddRemove':!task.isExpanded,'isDisabled': item.isDisabled}"
                                        :sortable="true"
                                        :id="`${item.value}`"
                                    >
                                        <template #item="{ element: subTask, index }">
                                            <div @dragend="dragEnd">
                                                <Task
                                                    :data="subTask"
                                                    :key="subTask._id"
                                                    :lastChild="(task.subtaskArray.length - 1) === index"
                                                    :parentAssignee="task.AssigneeUserId"
                                                    @toggle="toggleTask(subTask)"
                                                    @createTask="createTask = subTask._id"
                                                    class="Task sub-task"
                                                    :item="item"
                                                />
                                            </div>
                                        </template>
                                    </draggable>
                                    <div :id="`listItem_${sprintId}_${item.key}_${task._id}`" class="table__list-id w-100"></div>
                                </template>
                            </div>
                        </div>
                    </template>
                </draggable>
                <div :id="`listItem_${sprintId}_${item.key}`" class="table__list-id w-100"></div>
            </div>
        </div>
    </Transition>
    <div v-if="false">
        <div class="new-row item_head">
            <div class="new-col1" :style="`${clientWidth > sideScrollWidth ? 'border:0px' : ''};`">
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
                            <h5 v-if="clientWidth > 767" class="text-ellipse item-title font-size-14" :style="`color: ${item.textColor ? item.textColor : '#3a3a3a'}; background-color: ${item.backColor ? item.backColor : 'transparent'};`">
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
                    <draggable v-model="headers" :disabled="true" class="span_wrapper" tag="div" item-key="TaskName" :group="`itemheader_${props.sprintId}_${item._id}}`">
                        <template #item="{element: head}">
                            <span
                                :title="head.label"
                                class="task_right dark-gray font-weight-500 font-size-12 text-ellipse"
                                :class="{
                                    'item-head-draggable-div' : false,
                                    'custom__field_list_view':head.key !== 'AssigneeUserId' && head.key !== 'commentCounts' && head.key !== 'DueDate' && head.key !== 'Task_Priority' && head.key !== 'TaskKey' && head.key !== 'created_date' && head.key !== 'created_by'
                                }"
                                v-if="(head.funcPermission ? checkPermission(head.funcPermission,projectData.isGlobalPermission) !== null : true ) && (head.appPermission ? checkApps(head.appPermission) : true ) && head.show"
                            >
                                {{ head.label }}
                            </span>
                        </template>
                    </draggable>
                    <span class="span_wrapper task_right cursor-pointer" v-if="!projectData?.deletedStatusKey && checkPermission('task.list_view_column',project?.isGlobalPermission) == true">
                        <DropDown>
                            <template #button>
                                <img :src="addCustomField" :alt="addCustomField" v-if="props.statusIndex === 0" />
                            </template>
                            <template #options>
                                <DropDownOption>
                                    <input type="text" class="customfield__form-control" placeholder="search" v-model="search" @input="handleInput">
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
    <CustomFieldsSidebarComponent
        @customFieldStore="customFieldStore"
        @closeSidebar="handleCloseSidebar"
        :componentDetail="{}"
        :customFieldObject="{}"
        :isCustomField="isCustomField"
        @handleClose="handleClose()"
    />
</template>

<script setup>
// PACKAGES
import { computed, ref, watch, defineProps, unref, onMounted, inject, defineEmits, nextTick } from 'vue';
import { useStore } from 'vuex';
import draggable from 'vuedraggable';
import { useCustomComposable } from '@/composable';
import { useTaskSelection } from '@/composable/useTaskSelection.js';
import { taskListHelper, useUpdateTasks } from '@/views/Projects/helper';
import taskClass from "@/utils/TaskOperations";

// COMPONENTS
import Cookies from 'js-cookie';
import Task from '../Task/Task.vue';
import { useToast } from 'vue-toast-notification';
import Toggle from "@/components/atom/Toggle/Toggle.vue";
import CreateTask from "@/components/atom/CreateTask/CreateTask.vue";
import Assignee from "@/components/molecules/Assignee/Assignee.vue";
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import {customField} from '../../../plugins/customFieldView/helper.js';
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';

const {isCustomFields} = customField();
import * as env from '@/config/env';
import { useI18n } from "vue-i18n";
import { apiRequest } from "../../../services";
import { firstId, sameGroupValue, sprintTasksBucket, unmatchedBoardTasks } from '@/utils/taskOpenProjectId';
import Skelaton from "@/components/atom/Skelaton/AiSkelaton.vue"
const { t } = useI18n();
// UTILS
const {getters,commit} = useStore();
const $toast = useToast();
const userId = inject("$userId")
const {getSprintTasks} = taskListHelper();
const {checkPermission, checkApps} = useCustomComposable();
const clientWidth = inject('$clientWidth');
const searchedTask = inject('searchedTask');
const projectData = inject('selectedProject');
const taskCollapsed = inject("taskCollapsed");
const showArchived = inject("showArchived");
const companyId = inject("$companyId");
const {updateTaskByGroup} = useUpdateTasks();
const sprintBucket = computed(() => sprintTasksBucket(
    getters['projectData/tasks'],
    firstId(props.projectId, props.project && (props.project._id || props.project.id)),
    firstId(props.sprintId, props.sprintObject && (props.sprintObject.id || props.sprintObject._id)),
));
const searchMode = computed(() => Boolean(unref(searchedTask)));
const visibleTaskRows = computed({
    get() {
        if (searchMode.value && filteredTasksGetter.value.length) return filteredTasksGetter.value;
        return items.value;
    },
    set(next) {
        if (searchMode.value) return;
        items.value = Array.isArray(next) ? next : [];
    },
});


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
    }
});

const emit = defineEmits(["toggle", "visibleCount"])

function taskRowKey(row) {
    return firstId(row && (row._id || row.id)) || String((row && (row.TaskKey || row.TaskName)) || '');
}

const languageCheckHeaders = ["commentCounts","AssigneeUserId","DueDate","Task_Priority","TaskKey","created_date","created_by"]

const customFieldList = computed(() => (getters['settings/finalCustomFields'] && getters['settings/finalCustomFields'].length) ? JSON.parse(JSON.stringify(getters['settings/finalCustomFields'])) : []);

onMounted(() => {
    setHeader(customFieldList.value);
    if(tasksGetter.value && tasksGetter.value.length) {
        try {
            items.value = JSON.parse(JSON.stringify(tasksGetter.value));
        } catch (_error) {
            items.value = cloneTaskRows(tasksGetter.value);
        }
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
                if(sprintBucket.value?.tasks?.length) {
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

watch(()=> projectData.value.viewColumn,(newValue,oldValue)=>{
    if(newValue != oldValue){        
        headers.value = newValue;
        headerHideShow.value = headers.value; 
        if(props.statusIndex === 0){
            setHeader(getters['settings/finalCustomFields']);
        }
    }
});

const headers = ref(projectData.value.viewColumn);
const headerHideShow = ref(headers.value);
const search = ref('');
const searchKey = ref("");
const isCustomField = ref(false);
const sideScrollWidth= 765;
const taskFields = ref(projectData.value?.taskFields || {});
const filteredTaskFields = ref(Object.values(taskFields.value));
const draggedTaskId = ref('');

watch(projectData, () => {
    taskFields.value = projectData.value?.taskFields || {}
})

const filterHeaders = ref(headers.value.filter((x) => filteredTaskFields.value.find((y) => y.key === x.key && y.visible)));
watch([headers, filteredTaskFields], ([val]) => {
    filterHeaders.value = val.filter((x) => filteredTaskFields.value.find((y) => y.key === x.key && y.visible));
})

watch([searchKey, taskFields], () => {
    filteredTaskFields.value = Object.values(taskFields.value).filter((x) => x.label.toLowerCase().includes(searchKey.value.toLowerCase()));
})

function checkMove(evt){
    if(props.item.value !== 'NO_DUE_DATE'){
        if(evt.to.id.includes("NO_DUE_DATE")){
            return false;
        }    
    }
    if(props.item.value !== 'NEXT'){
        if(evt.to.id.includes("NEXT")){
            return false;
        }    
    }
    if(props.item.value !== 'OVERDUE'){
        if(evt.to.id.includes("OVERDUE")){
            return false;
        }    
    }
        
    try {
        draggedTaskId.value = evt.draggedContext.element ? evt.draggedContext.element._id : "";
    } catch (error) {
        console.error("ERROR: ", error);
        return;
    }

    if(evt.willInsertAfter) {
        evt.dragged.style.borderBottom = "none";
        evt.dragged.style.borderTop = "1px solid #614add";
    } else {
        evt.dragged.style.borderBottom = "1px solid #614add";
        evt.dragged.style.borderTop = "none";
    }
    return true;
}
function clone(element) {
    return {...element};
}
function dragEnd(e) {
    if(e){
        if (e?.target?.classList?.contains('dragTask')) {
            e.target.classList.remove('dragTask');
        }
        e.target.style.border = "none";
    }
}
function dragStart (e) {
    e.target.classList.add('dragTask');
}
function changeExpanded(e, field) {
    field.subtaskArray = field.subtaskArray && field.subtaskArray.length ? field.subtaskArray : []
    if(!field.isExpanded){
        toggleTask(field);
    }
}
const tasksFound = computed(() => {
    if(sprintBucket.value) {
        const found = JSON.parse(JSON.stringify(sprintBucket.value.found || {}))
        return found?.[`${props.item.searchKey}_${props.item.searchValue}`] || 0
    } else {
        return 0;
    }
})

// S3-02: total story points across this group's tasks (shown beside the count).
const pointsTotal = computed(() => {
    const list = Array.isArray(items.value) ? items.value : [];
    return list.reduce((total, t) => total + (Number(t && t.points) || 0), 0);
});

const tasksGetter = ref([])
function cloneTaskRows(rows) {
    try {
        return JSON.parse(JSON.stringify(rows || []));
    } catch (_error) {
        return (rows || []).map((row) => ({ ...row }));
    }
}
function idBearingTaskRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter((row) => (
        row && !row.deletedStatusKey && firstId(row._id, row.id)
    ));
}
function bindListRows() {
    const grouped = idBearingTaskRows(props.item && props.item.tasksArray);
    if (grouped.length) {
        tasksGetter.value = cloneTaskRows(grouped);
        return;
    }
    if(sprintBucket.value) {
        let store;
        try {
            store = JSON.parse(JSON.stringify(sprintBucket.value))
        } catch (_error) {
            store = sprintBucket.value;
        }
        const storeTasks = Array.isArray(store && store.tasks) ? store.tasks : [];
        let tmp = [];
        if(props.item.searchKey === "DueDate") {
            tmp = storeTasks.filter((x) => {
                return (x.DueDate ? checkCase(props.item.operation, props.item.searchValue, (new Date(x?.[props.item.searchKey]).getTime() / 1000)) : props.item.operation === "non") && !x?.deletedStatusKey
            })?.sort((a,b)=> a?.groupByDueDateIndex - b?.groupByDueDateIndex);
        } else if(props.item.searchKey === "AssigneeUserId") {
            tmp = storeTasks.filter((x) => {
                return x.AssigneeUserId.sort((a,b) => a > b ? 1 : -1).join("_") === props.item.value && !x?.deletedStatusKey;
            })?.sort((a,b)=> a.groupByAssigneeIndex - b.groupByAssigneeIndex);
        } else {
            if (props.item.searchKey === "statusKey") {
                tmp = storeTasks.filter((x) => sameGroupValue(x.statusKey, props.item.searchValue) && !x?.deletedStatusKey)?.sort((a,b)=> a?.groupByStatusIndex - b?.groupByStatusIndex);
                if (Number(props.statusIndex) === 0) {
                    const siblings = (props.sprintObject && Array.isArray(props.sprintObject.items))
                        ? props.sprintObject.items
                        : [props.item];
                    const mapped = siblings.map((group) => ({
                        tasksArray: storeTasks.filter((x) => sameGroupValue(x.statusKey, group.searchValue) && !x?.deletedStatusKey),
                    }));
                    const extra = unmatchedBoardTasks(mapped, storeTasks);
                    extra.forEach((row) => {
                        const id = firstId(row && (row._id || row.id));
                        if (id && !tmp.some((have) => firstId(have && (have._id || have.id)) === id)) tmp.push(row);
                    });
                }
            } else if (props.item.searchKey === "Task_Priority") {
                tmp = storeTasks.filter((x) => x[props.item.searchKey] === props.item.searchValue && !x?.deletedStatusKey)?.sort((a,b)=> a.groupByPriorityIndex - b.groupByPriorityIndex);
            } else {
                tmp = storeTasks.filter((x) => x[props.item.searchKey] === props.item.searchValue && !x?.deletedStatusKey)
            }
        }

        tmp = tmp.map((x) => {            
            if(x?.subtaskArray) {
                x.subtaskArray = x.subtaskArray.filter((y) => !y?.deletedStatusKey);
            }
            return x;
        })

        tasksGetter.value = idBearingTaskRows(tmp);
    } else {
        tasksGetter.value = [];
    }
}
watch([
    () => props.item && props.item.tasksArray,
    () => sprintBucket.value && sprintBucket.value.tasks,
], bindListRows, {immediate: true, deep: true})
const filteredTasksGetter = computed(() => {
    if(getters['projectData/searchedTasks']?.length && props.sprintId) {
        if(props.item.searchKey === "DueDate") {
            return getters['projectData/searchedTasks'].filter((x) => {
                if(x.DueDate?.seconds) {
                    return x.sprintId === props.sprintId && x.DueDate?.seconds ? checkCase(props.item.operation, props.item.searchValue, x[props.item.searchKey].seconds) : props.item.operation === "non"
                } else {
                    return (x.sprintId === props.sprintId) && (x.DueDate ? checkCase(props.item.operation, props.item.searchValue, new Date(x.DueDate).getTime() / 1000) : props.item.operation === "non")
                }
            });
        } else if(props.item.searchKey === "AssigneeUserId") {
            
            return getters['projectData/searchedTasks'].filter((x) => {
                return x.sprintId === props.sprintId && x.AssigneeUserId.sort((a,b) => a > b ? 1 : -1).join("_") === props.item.value;
            })
        } else {
            if (props.item.searchKey === "statusKey") {
                return getters['projectData/searchedTasks'].filter((x) => firstId(x.sprintId, x.SprintId) === firstId(props.sprintId) && sameGroupValue(x.statusKey, props.item.searchValue));
            }
            return getters['projectData/searchedTasks'].filter((x) => firstId(x.sprintId, x.SprintId) === firstId(props.sprintId) && x[props.item.searchKey] === props.item.searchValue);
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

watch([taskCollapsed], ([newVal], [oldVal]) => {
    if(newVal !== oldVal && !searchedTask.value) {
        let tmp = items.value;
        if(newVal === false) {
            tmp.filter((x) => x.isParentTask).forEach((x) => {
                x.isExpanded = true;
                fetchSubTask(x, true);
            })
        } else {
            tmp.filter((x) => x.isParentTask).forEach((x) => {
                x.isExpanded = false;
            })
        }
    }
})

const items = ref([]);
watch(() => unref(tasksGetter), (newVal) => {
    const rows = Array.isArray(newVal) ? newVal : [];
    items.value = rows.map((x) => {
        const id = firstId(x && (x._id || x.id));
        let index = items.value.findIndex((y) => id && id === firstId(y && (y._id || y.id)));
        if(index !== -1) {
            x.isExpanded = items.value[index].isExpanded;
        }

        return x;
    });
    // prepareIndexData();
})
watch(() => idBearingTaskRows(visibleTaskRows.value).length, (n) => {
    emit('visibleCount', Number(n) || 0);
}, { immediate: true, flush: 'post' });

const createTask = ref(false);

// Multi-select group header: tri-state checkbox that selects/deselects all
// visible tasks (incl. expanded subtasks) for this status/assignee/etc group.
const selection = useTaskSelection();
const canGroupSelect = computed(() => checkPermission('task.task_status', projectData.value?.isGlobalPermission) === true
    && !showArchived.value);
const groupTaskIds = computed(() => {
    const source = visibleTaskRows.value;
    if (!Array.isArray(source)) return [];
    const ids = [];
    for (const t of source) {
        if (!t?._id) continue;
        if (showArchived.value ? true : !t.deletedStatusKey) ids.push(String(t._id));
        if (t.isExpanded && Array.isArray(t.subtaskArray)) {
            for (const s of t.subtaskArray) {
                if (s?._id && (showArchived.value ? true : !s.deletedStatusKey)) ids.push(String(s._id));
            }
        }
    }
    return ids;
});
const groupCheckboxState = computed(() => selection.groupState(groupTaskIds.value));
const handleGroupCheckboxChange = (evt) => {
    if (evt) evt.stopPropagation();
    selection.toggleGroup(groupTaskIds.value);
};

let subObserver = {};
function toggleTask(task,e) {
    if(e) {
        task.isExpanded = !task.isExpanded;
    } else {
        if(!taskCollapsed._value){
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
                    let storeSprintTasks = (sprintBucket.value && sprintBucket.value.tasks) || [];
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
        let fetchNew = sprintBucket.value?.index?.[`${task._id}_${props.item.searchKey}_${props.item.searchValue}`] === undefined;
        fetchSubTask(task, fetchNew);
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
function updateItem(type,e, item) {
    if(
        ((e.added && (!e.added.element || !Object.keys(e.added.element).length)) ||
        (e.moved && (!e.moved.element || !Object.keys(e.moved.element).length)) ||
        (e.removed && (!e.removed.element || !Object.keys(e.removed.element).length))) || (props.item.value === "NO_DUE_DATE") || (props.item.value === "NEXT")
    ){
        if((props.item.value === "NO_DUE_DATE") || (props.item.value === "NEXT")) {
            const store = JSON.parse(JSON.stringify(sprintBucket.value || { tasks: [] }))
            let tmp = [];
            if(store?.tasks?.length){
                tmp = store.tasks.filter((x) => {
                    return (x.DueDate ? checkCase(props.item.operation, props.item.searchValue, (new Date(x?.[props.item.searchKey]).getTime() / 1000)) : props.item.operation === "non") && !x?.deletedStatusKey
                })?.sort((a,b)=> a?.groupByDueDateIndex - b?.groupByDueDateIndex);
                tmp = tmp.map((x) => {            
                    if(x?.subtaskArray) {
                        x.subtaskArray = x.subtaskArray.filter((y) => !y?.deletedStatusKey);
                    }
                    return x;
                })
            }

            tasksGetter.value = tmp;
        }
        return;
    }
    if(e?.added?.element) {
        const pid = JSON.parse(JSON.stringify(props.project))._id
        const snap = '';
        const sprintId = props.sprintObject.id
        const showAllTasks = true;
        const taskObject = JSON.parse(JSON.stringify(e?.added?.element))
        
        if(type === 'subTask' && checkPermission('task.task_convert_to_subtask', props.project?.isGlobalPermission) === true){
            // The dropped task always has to be attached locally. This used to be
            // split three ways with only two of them doing anything: a task that
            // HAS subtasks but was never expanded — so its subtaskArray was never
            // loaded — matched neither, and the screen was left untouched while the
            // server converted it anyway.
            const attach = (row) => {
                commit("projectData/mutateUpdateFirebaseTasks",{
                    snap,
                    op: "modified",
                    pid,
                    sprintId,
                    data: {...row,isParentTask:false,ParentTaskId:item._id},
                    showAllTasks,
                    updatedFields:{
                        deletedStatusKey:1,
                        updatedAt:new Date(),
                        ParentTaskId: item._id,
                        isParentTask: false,
                    },
                    dragDropcheck:true
                });
            };

            // Already a subtask elsewhere: drop it from the old parent's list too.
            if(e?.added?.element?.ParentTaskId){
                setTimeout(() => {
                    commit("projectData/mutateUpdateFirebaseTasks",{
                        snap, 
                        op: "removed",
                        pid,
                        sprintId,
                        data: {...taskObject,isParentTask:false,ParentTaskId:e?.added?.element?.ParentTaskId},
                        showAllTasks
                    });
                },800)
            }

            attach(taskObject);

            // Its own children come across beside it — only one level of nesting
            // exists — so each of the loaded ones is attached as well. Any that were
            // never loaded are reconciled by the parent's own update from the server.
            (e?.added?.element?.subtaskArray || []).forEach((x) => attach(x));
            taskClass.convertToSubTask({
                companyId: companyId.value,
                projectData: {
                    id:pid
                },
                sprintId: item.sprintId,
                selectedTaskId:e?.added?.element._id,
                taskId: item._id,
                oldProject : {
                    id : pid,
                    taskTypeCounts : props.project.taskTypeCounts,
                    taskStatusData : props.project.taskStatusData
                },
                isSubTask : e?.added?.element?.subTasks <= 0 ? false : true
            }).then(()=>{
            }).catch((error) => {
                console.error("ERROR: ", error);
            });
        }else if(type === "task" && checkPermission('task.convert_to_task', props.project?.isGlobalPermission) === true) {
            if(e?.added?.element.isParentTask === false){
                taskClass.convertToTask({
                    companyId: companyId.value,
                    projectData: {
                        id:pid
                    },
                    taskId : e?.added?.element._id,
                    parentTaskId:e?.added?.element.ParentTaskId,
                    sprintObj: props.sprintObject,
                    oldSprintObj :{
                        id:props.sprintObject.id,
                        folderId:null
                    },
                    oldProject: {
                        id : pid,
                        taskTypeCounts : props.project.taskTypeCounts,
                        taskStatusData : props.project.taskStatusData
                    }
                }).then(() => {
                    commit("projectData/mutateUpdateFirebaseTasks",{
                        snap, 
                        op: "removed",
                        pid,
                        sprintId,
                        data: {...taskObject,isParentTask:false,ParentTaskId:e?.added?.element?.ParentTaskId},
                        showAllTasks
                    });
                }).catch((error) => {
                    console.error("ERROR: ", error);
                });

                updateTaskByGroup(e.added.element, item, props.groupType).catch((error) => {
                    console.error("ERROR: ", error);
                });
            }
        }
        debouncer(1000)
        .then(() => {
            function updateCountObject(tasks, searchKey, keyExtractor) {
                const object = {};
                tasks.forEach((task) => {
                    const key = `${searchKey}_${keyExtractor(task)}`;
                    if (countTask.found[key] >= 0) {
                        object[key] = (object[key] || 0) + 1;
                    }
                });
                return object;
            }

            function commitFoundData(foundKey, object) {
                Object.keys(countTask.found).forEach((key) => {
                    if (key.includes(foundKey)) {
                        commit('projectData/mutateTypesenseTasks', {
                            found: { [key]: object[key] || 0 },
                            nextPage: { [key]: 0 },
                            pid: JSON.parse(JSON.stringify(props.project))._id,
                            sprintId: props.sprintObject.id,
                            data: null,
                        });
                    }
                });
            }

            let countTask = sprintBucket.value || { found: {} };

            const { indexName, searchKey } = props.item;

            if (indexName === 'groupByStatusIndex') {
                const object = updateCountObject(countTask.tasks, searchKey, (task) => task.statusKey);
                commitFoundData(searchKey, object);
            } else if (indexName === 'groupByPriorityIndex') {
                const object = updateCountObject(countTask.tasks, searchKey, (task) => task.Task_Priority);
                commitFoundData(searchKey, object);
            } else if (indexName === 'groupByDueDateIndex') {
                const object = updateCountObject(countTask.tasks, searchKey, (task) => {
                    return task.DueDate ? new Date(task.DueDate).setHours(0, 0, 0, 0) / 1000 : 0;
                });
                commitFoundData(searchKey, object);
            }

        })
        .catch((err) => {
            console.error("error", err);
        })
    }else{
        console.info('NO Event Found');
    }
    
    if(type === "task" && props.item.value !== "OVERDUE" && props.item.value !== "NEXT" && props.item.value !== "NO_DUE_DATE"){        
        let element = null;
        let index = null;        
        if (e.added) {
            element = e.added.element
            index = e.added.newIndex
        }
        else if (e.moved) {
            element = e.moved.element
            index = e.moved.newIndex
        }        
        if(element){
            let relevantIndex;
            let tempIndex;
            let taskDt = items.value
            let findTask = items.value.find(e => e?._id === element?._id);   
            if (index === 0 && taskDt.length === 1) {
                tempIndex = 0
            } else if ((index+1) === taskDt.length) {
                tempIndex = taskDt[taskDt.length - 2][item.indexName] + 65536
            } else {
                if (index === 0) {
                    tempIndex = taskDt[1][item.indexName] - 65536
                } else {                                        
                    tempIndex = (taskDt[index - 1][item.indexName] + taskDt[index + 1][item.indexName]) / 2
                }
            }            
            if (taskDt.length !== 1 && taskDt.length !== 0) {
                if (index === 0) {
                    relevantIndex = taskDt[1][item.indexName]
                } else {
                    relevantIndex = taskDt[index - 1][item.indexName]
                }         
            } else {
                relevantIndex = 0
            }
            let UpdateData
            let uniqueeTime = new Date().getTime()
            
            if (props.groupType === 0) {
                const updatedStatus = {
                    'text': item.name,
                    'key': item.key,
                    'type': item.type,
                }
                UpdateData = {
                    status: updatedStatus,
                    'statusType': item.type,
                    'statusKey': item.key,
                    'updateToken': {user: Cookies.get('accessToken'),timeStamp: uniqueeTime},
                    'islocalSnapStop': true
                }
            }
            if (props.groupType ===2) {
                UpdateData ={
                    Task_Priority : item.value,
                    'updateToken': {user: localStorage.getItem('updateToken'),timeStamp: uniqueeTime},
                    'islocalSnapStop': true,
                    Updated_At: new Date()
                }
            }
            if (props.groupType === 1) {
                UpdateData = {
                    AssigneeUserId : item.value !== '' ? item.value.split("_") : [],
                    'updateToken': {user: localStorage.getItem('updateToken'),timeStamp: uniqueeTime},
                    'islocalSnapStop': true
                }
            }
            if (props.groupType === 3) {
                UpdateData = {
                    DueDate: item.searchValue ? new Date(item.searchValue * 1000) : null,
                    'updateToken': {user: localStorage.getItem('updateToken'),timeStamp: uniqueeTime},
                    Updated_At: new Date(),
                    'islocalSnapStop': true
                }
                
            }   
            try {
                apiRequest("post", env.UPDATA_TASK_INDEX, {
                relevantIndex: relevantIndex,
                projectId: findTask.ProjectID,
                companyId: findTask.CompanyId,
                taskId: findTask._id,
                isFirst: index === 0 ? true : false,
                isFirstWithRecord: (index === 0 && taskDt.length !== 1 && taskDt.length !== 0) ? true : false,
                indexName: item.indexName,
                sprintId: findTask.sprintId,
                relevantKey: item.searchValue,
                searchKey: item.searchKey,
                taskKey: findTask.TaskKey,
                updateData: UpdateData
            }).then(()=>{
                findTask = {...findTask, ...UpdateData,  [item.indexName]: tempIndex}
                findTask.updateTimeStamp = uniqueeTime;
                var newObj = {pid: projectData.value._id, sprintId: findTask.sprintId, task: findTask};                                                
                commit("projectData/mutateTaskForDragAndDrop",newObj)
            })
            .catch((error) => {
                console.error("ERROR in update project history: ", error);
            })
            } catch (error) {
                console.error('ERROR',error);
            }
            
        }
        
    }
    // it will needed in future so it is commented
    // else if (e?.moved && e?.moved?.element){
    // }else if(e?.removed && e?.removed?.element) {
    // }
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

const customFieldStore = async(object) => {
    let value = JSON.parse(JSON.stringify(object))
    value.global = false;
    value.projectId = [props.projectId];
    value.createdAt = new Date();
    value.updatedAt = new Date();
    value.userId = userId.value;
    value.type = 'task';
    const objects = {
        type: "save",
        updateObject:value
    }
    await apiRequest("post",env.CUSTOM_FIELD,objects).then((res) => {
        if(res.status === 200) {
            value._id = res?.data?._id || '';
            commit("settings/mutateFinalCustomFields", {data: value || {},op: "added"});
            $toast.success(t("Toast.Field_Added_Successfully"), {position: 'top-right' });
    
            const object = {
                updateObject : {
                    viewColumn:  {
                        label: value.fieldTitle,
                        key: res?.data?._id || '',
                        postition: projectData?.value?.viewColumn.length ? projectData?.value?.viewColumn.length + 1 : 0,
                        show: true
                    }
                },
                key:'$push'
            }
            apiRequest("put",`${env.PROJECT}/${props.projectId}`,object).then((response) => {
                if(response.status === 200){
                    projectData.value.viewColumn.push({
                        label: value.fieldTitle,
                        key: res?.data?._id || '',
                        postition: projectData?.value?.viewColumn.length ? projectData?.value?.viewColumn.length + 1 : 0,
                        show: true
                    })
                    commit('projectData/mutateProjects', [{ op: "modified", data: { ...projectData.value } }]);
                }
                // headerHideShow.value.push({
                //     label:x?.fieldTitle,
                //     key:x?._id,
                //     postition:headerHideShow.value.length + 1,
                //     show:false,
                //     newAdded:true
                // })
            }).catch((error)=>{
                console.error('ERROR',error);
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            });
        }else{
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        }
        isCustomField.value = false;
    }).catch((err)=>{
        $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        console.error("Error in inseting the customfield",err)
    });
    
};

const handleCloseSidebar = (val,pageIndex) => {
    if(pageIndex === 0) isCustomField.value = val;
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
        let countFunction = (row) => {
            if (count >= taskWithoutFilter.length) {
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
const handleClose = () => {
    isCustomField.value = false;
};
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
</style>