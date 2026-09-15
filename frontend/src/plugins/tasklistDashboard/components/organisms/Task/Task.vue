<template>
    <div>
        <div class="new-row list-group-item" id="singletaskdisply">
            <!-- LEFT SECTION -->
            <div class="new-col1" :style="{ border: (containerWidth > sideScrollWidth ? '0px' : '')}" :class="[{'new-col-mobile' : containerWidth < 768}]">
                <div class="common-section task ignore-drag" :style="`${task.isParentTask === false ? 'padding-left: 12px;' : ''}`">
                    <div class="parent__tasksubarray-wrapper position-ab">
                        <template v-if="(task.subTasks && task.isParentTask) || (searchedTask && task?.subtaskArray?.length)">
                            <img id="tasktoggle_driver" class="cursor-pointer parent__task-image" v-if="(task.subTasks && task.isParentTask) || (searchedTask && task?.subtaskArray?.length)" :src="triangleBlack" alt="triangle" :style="`transform: rotateZ(${data.isExpanded ? '90' : '0'}deg)`" @click="$emit('toggle',true)">
                        </template>
                        <template v-else>
                            <img class="parent__task-image" v-if="(task.isParentTask) || (searchedTask && task?.subtaskArray?.length)" :src="triangleBlack" alt="triangle" :style="`opacity: 0.1;`" @click="$emit('toggle',true)">
                        </template>
                    </div>

                    <img v-if="!data.isParentTask" :src="lastChild ? pointer : extendedPointer" alt="" class="align-self-baseline parent__task-lastchild parent__task-image">

                    <!-- INVENTORY -->
                    <img v-if="task.deletedStatusKey === 2" :src="inventoryIcon" alt="inventory" class="ml-5px" />
                    <img v-if="task.deletedStatusKey === 1" :src="deleteIcon" alt="delete" class="ml-5px">

                    <!-- TASK STATUS -->
                    <TaskStatus
                        :id="task._id+'status'"
                        :modelValue="taskStatus"
                        :options="projectStatus"
                        :disabled="true"
                    />

                    <!-- TASK TYPE -->
                    <ProjectTaskType
                        :id="task._id+'type'"
                        :modelValue="taskType"
                        :options="projectTaskType"
                        :disabled="true"
                        :imgClasses="`ml-10px`"
                    />

                    <div @click="!showArchiveVar ? toggleTaskDetail(task) : ''" class="task_name_wrapper task_Name ml-6px">
                        <!-- TASK NAME -->
                        <span class="text-ellipsis d-inline-block edit__taskname" :title="task.TaskName">
                            {{task.TaskName}}
                        </span>
                        <div class="d-flex align-items-center task-options-image img__parent-task ml-5px p3x-5px" v-if="data?.isParentTask && ((showArchiveVar || searchedTask) ? data?.subtaskArray?.length : data?.subTasks)">
                            <img :src="subTaskImage" alt="subTaskImage" class="mr-2px">
                            {{(showArchiveVar || searchedTask) ? data?.subtaskArray?.length : data?.subTasks < 0 ? 0 : data?.subTasks}}
                            <div class="count-block ml-5px" v-if="myParentCounts">
                                {{myParentCounts > 99 ? "+99" : myParentCounts}}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- RIGHT SECTION -->
            <div class="new-col2 ignore-drag" v-if="containerWidth > 768">
                <div class="common-section task">
                    <!-- CHAT COUNTS -->
                    <span v-if="cardData?.find((x)=> x === 1)" class="chat-main-new position-re task_right" @click.stop="toggleTaskDetail(task,false,true)">
                        <img :src="chatIcon" alt="chatIcon" :class="{'cursor-pointer': !showArchiveVar}">
                        <div class="position-ab count-block show__count" v-if="myCounts">
                            {{myCounts > 99 ? "+99" : myCounts}}
                        </div>
                    </span>

                    <!-- ASSIGNEE -->
                    <span class="assignee-main-new task_right" v-if="checkPermission('task.task_assignee',true) !== null && cardData?.find((x)=> x === 2)">
                        <Assignee
                            v-if="checkPermission('task.task_assignee',true) === true && checkPermission('task.task_list',true) == true"
                            :users="task.AssigneeUserId"
                            :options="permittedOptions"
                            :num-of-users="2"
                            imageWidth="30px"
                            :addUser="false"
                            @selected="changeAssignee(checkApps('MultipleAssignees') ? 'add' : 'replace', $event)"
                            @removed="changeAssignee('remove', $event)"
                            :isDisplayTeam="true"
                            :multiSelect="checkApps('MultipleAssignees')"
                        />
                        <Assignee
                            v-else
                            :users="task.AssigneeUserId"
                            :options="nonPermittedOptions"
                            :num-of-users="2"
                            imageWidth="30px"
                            :addUser="false"
                            @selected="changeAssignee(checkApps('MultipleAssignees') ? 'add' : 'replace', $event)"
                            @removed="changeAssignee('remove', $event)"
                            :isDisplayTeam="true"
                            :multiSelect="checkApps('MultipleAssignees')"
                        />
                    </span>

                    <!-- DUE DATE -->
                    <span class="duedate-new task_right" v-if="checkPermission('task.task_due_date',true) !== null && cardData?.find((x)=> x === 3)">
                        <span v-if="task.DueDate">{{convertDateFormat(task.DueDate,'',{showDayName:false})}}</span>
                        <span v-else>{{$t('ProjectDetails.no_due_date')}}</span>
                    </span>

                    <!-- TASK PRIORITY -->
                    <span class="priority-new task_right" v-if="checkPermission('task.task_priority',true) !== null && cardData?.find((x)=> x === 4)">
                        <Priority
                            :priorityVal="task.Task_Priority"
                            @select="updatePriority"
                            :permission="!showArchiveVar && checkPermission('task.task_priority',true) === true"
                        />
                    </span>

                    <!-- TASK KEY -->
                    <span class="key-new task_right" v-if="cardData?.find((x)=> x === 5)">
                        {{task.TaskKey}}
                    </span>

                    <!-- Created Date -->
                    <span class="key-new task_right" v-if="cardData?.find((x)=> x === 6)">
                        {{convertDateFormat(task.createdAt,'',{showDayName: false})}}
                    </span>

                    <!-- Created By -->
                    <span class="pointer-event-none task_right" v-if="cardData?.find((x)=> x === 7)">
                        <Assignee
                            :users="[task?.Task_Leader]"
                            :num-of-users="1"
                            imageWidth="30px"
                            :addUser="false"
                        />
                    </span>
                    <template v-if="projectData?.viewColumn && projectData?.viewColumn.length && isCustomFields()">
                        <CustomFieldListViewColumnComponent 
                            :projectData="projectData"
                            :task="task"
                        />
                    </template>
                </div>
            </div>
        </div>
        <ConfirmationSidebar
            v-model="showSidebar"
            :title="`${archive ? $t('Projects.archive') : $t('Projects.delete')}`"
            :message="archive ? $t('conformationmsg.archive') : $t('conformationmsg.delete')"
            :confirmationString="`${archive ? 'archive' : 'delete'}`"
            :acceptButtonClass="archive ? 'btn-primary': 'btn-danger'"
            :acceptButton="`${archive ? $t('Projects.archive') : $t('Projects.delete')}`"
            @confirm="updateTask(), showSidebar = false"
        />
    </div>
</template>

<script setup>
// PACKAGES
import { ref, watch, defineProps, inject, defineEmits, defineComponent, computed, onMounted, provide } from "vue"

// COMPONENTS
import Assignee from "@/components/molecules/Assignee/Assignee.vue"
import Priority from "@/components/molecules/PriorityCompo/PriorityComp.vue"
import TaskStatus from "@/components/atom/TaskStatus/TaskStatus.vue"
import ProjectTaskType from "@/components/atom/TaskTypeSelection/TaskTypeSelection.vue"
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
// UTILS
import taskClass from "@/utils/TaskOperations";
import { useConvertDate, useCustomComposable, useGetterFunctions } from "@/composable";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification"
import { useUpdateTasks } from "@/views/Projects/helper"
import { permittedAssignees, selfAssignable } from "@/utils/assigneeOptions"
import {customField} from '../../../../customFieldView/helper.js';
import { useI18n } from "vue-i18n";
const { t } = useI18n();

const {isCustomFields} = customField();
const containerWidth = inject('$containerWidth');
const userId = inject('$userId');
const {getUser} = useGetterFunctions();
const {getters,commit} = useStore();
const companyId = inject("$companyId");
const searchedTask = inject('searchedTask');
const {convertDateFormat} = useConvertDate();
const {checkPermission, checkApps} = useCustomComposable();
const showArchiveVar = inject("showArchived");
const $toast = useToast()
const {updateTaskByGroup} = useUpdateTasks();

// IMAGES
const triangleBlack = require("@/assets/images/svg/triangleBlack.svg");
const inventoryIcon = require("@/assets/images/inventory_2.png");
const deleteIcon = require("@/assets/images/DeleteIcon.png");
const subTaskImage = require("@/assets/images/subtask2.png");
const pointer = require("@/assets/images/svg/pointer.svg");
const extendedPointer = require("@/assets/images/svg/pointer_extended.svg");
const chatIcon = require("@/assets/images/svg/ChatIcon.svg");
// const clockBlue = require("@/assets/images/svg/clock_timer_svg.svg");

// EMITS
const emit = defineEmits(["toggle", "createTask"]);

// COMPONENT
defineComponent({
    name: "Task-Component",

    components: {
        Assignee,
        // InputText,
        Priority,
        TaskStatus,
        ConfirmationSidebar,
        ProjectTaskType
    }
})

const props = defineProps({
    data: {
        type: Object,
        default: null
    },
    lastChild: {
        type: Boolean,
        default: false
    },
    parentAssignee: {
        type: Array,
        default: () => []
    },
    item: {
        type: Object,
        default: () => {}
    },
    projectObject: {
        type: Object,
        default: () => {}
    },
    sprintObject: {
        type: Object,
        default: () => {}
    },
    cardData: {
        type: Array,
        default: () => []
    }
})

const showSidebar = ref(false);
const archive = ref(false);
const customFieldList = computed(() => (getters['settings/finalCustomFields'] && getters['settings/finalCustomFields'].length) ? JSON.parse(JSON.stringify(getters['settings/finalCustomFields'])) : []);

const companyUsers = computed(() => getters["settings/companyUsers"]?.map((x) => x.userId))

const projectData = ref(props.projectObject)
provide("selectedProject", {});

const companyOwner = computed(() => {
    return getters["settings/companyOwnerDetail"];
})
const sideScrollWidth = ref(769);
const task = ref(props.data);
const toggleTaskDetail = inject('toggleTaskDetail')
const statusSearch = ref("");
const assigneeInProgress = ref({});

const projectStatus = computed(() => {
    return projectData.value?.taskStatusData.filter((x) => x.name?.toLowerCase().includes(statusSearch.value.toLowerCase()))
})
const projectTaskType = computed(() => {
    return projectData.value?.taskTypeCounts;
})

const taskStatus = computed(() => {
    return projectData.value?.taskStatusData.find((x) => x.key === task.value.statusKey)
})
const taskType = computed(() => {
    return projectData.value?.taskTypeCounts.find((x) => x.key === task.value.TaskTypeKey)
})

const sprintData = computed(() => {
    return props.sprintObject || null;
})
const assigneeInput = computed(() => ({
    task: props.data,
    sprint: sprintData.value,
    project: projectData.value,
    parentAssignees: props.parentAssignee,
    companyUsers: companyUsers.value
}))
const permittedOptions = computed(() => permittedAssignees(assigneeInput.value))
const nonPermittedOptions = computed(() => selfAssignable({ ...assigneeInput.value, userId: userId.value }))

watch(() => props.data, (newVal, oldVal) => {
    if(JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
        task.value = newVal;
        manageCustomField(customFieldList.value);
    }
});

watch(() => projectData.value?.viewColumn?.length, (newVal, oldVal) => {
    if(JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
        manageCustomField(customFieldList.value);
    }
});
watch(() => getters['settings/finalCustomFields'], (newVal) => {
    manageCustomField(newVal);
},{deep:true});

//onMounted

const taskCollapsed = inject("taskCollapsed");
onMounted(() => {
    if(taskCollapsed.value !== undefined && !taskCollapsed.value) {
        emit("toggle");
    }
    manageCustomField(customFieldList.value);
})

function getUserData() {
    const user = getUser(userId.value);
    const userData = {
        id: user.id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: companyOwner.value.userId,
    }

    return userData;
}

function updateTask(value = null) {
    const deletedStatusKey = value !== null ? value : archive.value ? 2 : 1;
    const userData = getUserData();
    const project = {
        _id: projectData.value._id,
        CompanyId: projectData.value.CompanyId,
        lastTaskId: projectData.value.lastTaskId,
        ProjectName: projectData.value.ProjectName,
        ProjectCode: projectData.value.ProjectCode
    }
    taskClass.updateArchiveDelete({
        companyId: companyId.value,
        projectData: project,
        sprintId: task.value.sprintId,
        task: task.value,
        folderId : task.value.folderObjId ? task.value.folderObjId : '',
        userData,
        deletedStatusKey,
    })
    .then((res) => {
        let sprint = {};
        if(task.value.folderObjId){
            sprint = projectData.value.sprintsfolders[task.value.folderObjId].sprintsObj[task.value.sprintId];
        }
        else{
            sprint = projectData.value.sprintsObj[task.value.sprintId];
        }
        sprint.tasks = sprint.tasks - (task.value.isParentTask ? ((task.value.subTasks || 0) + 1) : 1)
        commit("projectData/mutateSprints",{op:'modified',data:{...sprint}});
        if(res.status) {
            $toast.success(t(`Toast.Task_${value !== null ? 'restored' : archive.value ? 'archived' : 'deleted'}_successfully`), { position: "top-right" })
        }
    })
    .catch((err) => {
        console.error(err);
    })
}

// CHANGE ASSIGNEE
function changeAssignee(type, value) {
    if(!value?.id) return;
    if(assigneeInProgress.value[value?.id] && assigneeInProgress.value[value?.id] === type) return;
    assigneeInProgress.value[value?.id] = type;

    const userData = getUserData();

    let operation = ""

    if(type === "add") {
        operation = "assigneeAdd"
    } else if(type === 'remove') {
        operation = "assigneRemove"
    } else if(type === 'replace') {
        operation = "replace"
    }

    let updateObject = {
        AssigneeUserId : value.id
    }

    const project = {
        _id: projectData.value._id,
        CompanyId: projectData.value.CompanyId,
        lastTaskId: projectData.value.lastTaskId,
        ProjectName: projectData.value.ProjectName,
        ProjectCode: projectData.value.ProjectCode
    }

    taskClass.updateAssignee({
        firebaseObj: updateObject,
        projectData: project,
        taskData: props.data,
        employeeName: getUser(value.id).Employee_Name,
        type: operation,
        userData
    })
    .then(() => {
        if(operation === "assigneRemove"){
           let index = task.value.AssigneeUserId.findIndex((x) => x === value.id);
            task.value.AssigneeUserId.splice(index,1);
            commit("projectData/mutateSearchTask", {op:"modified", data: [task.value]});
        }
        delete assigneeInProgress.value[value?.id];
        $toast.success(t(`Toast.Assignee ${type === "add" || type === "replace" ? 'added' : 'removed'} successfully`), {position: "top-right"})
    })
    .catch((error) => {
        delete assigneeInProgress.value[value?.id];
        console.error("ERROR in changeAssignee: ", error);
    })
}

// CHANGE PRIORITY
function updatePriority(val = null) {
    if(!val) return;
    updateTaskByGroup(props.data, val, 2);
}

const myCounts = computed(() => {
    let total = 0;

    if(getters["users/myCounts"]?.data?.[`task_${projectData.value._id}_${task.value.sprintId}_${task.value._id}_comments`]) {
        total += getters["users/myCounts"]?.data?.[`task_${projectData.value._id}_${task.value.sprintId}_${task.value._id}_comments`] || 0
    }

    return total;
})
const myParentCounts = computed(() => {
    let total = 0;

    if(getters["users/myCounts"]?.data?.[`parentTask_${projectData.value._id}_${task.value.sprintId}_${task.value._id}_comments`]) {
        total += getters["users/myCounts"]?.data?.[`parentTask_${projectData.value._id}_${task.value.sprintId}_${task.value._id}_comments`] || 0
    }

    return total;
})


const manageCustomField = (data) => {
    if (!(data && data.length)) {
        return;
    }
    if(projectData.value?.viewColumn && projectData.value?.viewColumn.length){
        let count = 0;
        let countFunction = (element) => {
            if(count >= projectData.value?.viewColumn.length){
                return;
            }else{
                let checkCustom = customFieldList.value.find((x)=> (x._id === element.key) && (x?.isDelete) && (x?.type === 'task') && (x?.global || x?.projectId.includes(task?.value?.ProjectID)));
                if (checkCustom && Object.keys(checkCustom).length) {
                    if(task.value.customField?.[element.key]){
                        if(checkCustom.fieldType === 'phone'){
                            task.value.customField[element.key] = {
                                ...checkCustom,
                                taskId:task.value._id,
                                fieldValue:task.value.customField[element.key].fieldValue,
                                fieldCode:task.value.customField[element.key].fieldCode,
                                fieldFlag:task.value.customField[element.key].fieldFlag,
                                fieldPattern:task.value.customField[element.key].fieldPattern
                            }
                        }else{
                            task.value.customField[element.key] = {
                                ...checkCustom,
                                taskId:task.value._id,
                                fieldValue:task.value.customField[element.key].fieldValue
                            }
                        }
                        count ++;
                        countFunction(projectData.value.viewColumn[count]);
                    }else{
                        delete checkCustom?.fieldPattern;
                        delete checkCustom?.fieldValue;
                        delete checkCustom?.fieldCode;
                        delete checkCustom?.fieldFlag;
                        checkCustom.taskId = task.value._id;
                        let newObject = {
                            [element.key]:checkCustom
                        };
                        task.value.customField = {
                            ...task.value.customField,
                            ...newObject
                        }
                        count ++;
                        countFunction(projectData.value.viewColumn[count]);
                    }
                }else{
                    count ++;
                    countFunction(projectData.value.viewColumn[count]);
                }
            }
        }
        countFunction(projectData.value.viewColumn[count])
    }
};
</script>

<style src="./style.css">
    
</style>