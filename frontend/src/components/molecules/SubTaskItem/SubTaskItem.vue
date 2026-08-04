<template>
    <div>
        <div class="d-flex align-items-center subtaskitem-wrapper w-100"> 
            <template v-if="clientWidth > 767">
                <ProjectTaskType
                    class="vertical-middle border-radius-3-px border-radius-3-px mr-8px subtask__taskimage"
                    :id="task._id+'type'"
                    :modelValue="taskType(task.TaskTypeKey)"
                    :options="projectTaskTypeOptions"
                    :disabled="showArchiveVar && checkPermission('task.task_list',project.isGlobalPermission)!==true || checkPermission('task.task_type',project.isGlobalPermission) !== true || showArchiveVar !== false"
                    @select="changeTaskType($event)"
                />
            </template>
            <span class="cursor-pointer blue text-nowrap mr-8px text-decoration-underline" @click="changeRoute()">{{task.TaskKey}}</span>
            <template v-if="!editTask">
                <span class="text-ellipsis mw-60" :style="`max-width: ${clientWidth <= 767 ? '100%!important' : ''};`" v-if="checkPermission('task.task_name_edit',project?.isGlobalPermission) === true" @dblclick.prevent="taskName=task.TaskName, editTask = true" :title="task.TaskName">{{task.TaskName}}</span>
                <span class="text-ellipsis mw-60" :style="`max-width: ${clientWidth <= 767 ? '100%!important' : ''};`" v-else :title="task.TaskName">{{task.TaskName}}</span>
            </template>
            <InputText
                v-else
                :input-id="'taskRename'+task._id"
                v-model="taskName"
                :is-direct-focus="true"
                :max-length="250"
                place-holder="Task Name"
                class="mr-10px"
                height="30px"
                :isOutline="false"
                :isDirectFocus="true"
                @blur="editTask = false"
                @enter="editTask = false, updateTaskName()"
            />
            <div v-if="!editTask && checkApps('tags') && clientWidth > 767" class="d-flex">
                <div v-for="(item, index) in tagChipArray" :key="index" @click.stop="">
                    <div v-if="(index < chipCount)" class="tagList">
                        <TagChip  :data="item" :isBorder="false" :ids="ids" :prjectGlobalPermission="project?.isGlobalPermission" :tagsArray="project.tagsArray" :taskId="task.id" :sprintId="task.sprintId" :taskName="task.TaskName"/>
                    </div>
                    <div v-if="index == chipCount" class="cursor-pointer tagcount" @click="openDropDwon"> +{{tagChipArray.length - chipCount}} </div>         
                </div>
                <div class="show_tag" v-if="checkPermission('task.task_tag',project?.isGlobalPermission) !== null">
                    <CreateTagPopup  ref="openDrop" :task="task" @send:tagChipArray="(val)=>tagChipArray = val"  @send:ids="(val)=>ids = val" :project="project" :chipCount="chipCount" :isTaskList="true" />
                </div>
            </div>
            <div class="count-block ml-15px justify-content-end" v-if="myCounts && clientWidth <= 767">{{myCounts > 99 ? "+99" : myCounts}}</div>
        </div>
        <div class="d-flex align-items-center justify-content-between table-span-wrapper w-100" v-if="clientWidth > 767">
            <span  class="position-re" @click="changeRoute('comment')">
                <img :src="chatIcon" alt="chatIcon">
                <div class="count-block position-ab show__count" v-if="myCounts">
                    {{myCounts > 99 ? "+99" : myCounts}}
                </div>
            </span>
            <span v-if="checkPermission('task.task_assignee',project?.isGlobalPermission) !== null">
                <Assignee
                    class="subtask__item-assignee"
                    v-if="checkPermission('task.task_assignee',project?.isGlobalPermission) === true && checkPermission('task.task_list',project?.isGlobalPermission) == true"
                    :users="task.AssigneeUserId"
                    :options="permittedOptions"
                    :num-of-users="2"
                    imageWidth="26px"
                    :addUser="!showArchiveVar"
                    @selected="changeAssignee(checkApps('MultipleAssignees',projectObject) ? 'add' : 'replace', $event)"
                    @removed="changeAssignee('remove', $event)"
                    :isDisplayTeam="true"
                    :multiSelect="checkApps('MultipleAssignees')"
                                    :enableAgents="true"
                    :agents="agentsForTask(task)"
                    :selectedAgents="selectedAgentsFor(task)"
                    @agentSelected="assignAgent(task, $event, true)"
                    @agentRemoved="assignAgent(task, $event, false)"
                    />
                <Assignee
                    v-else
                    :users="task.AssigneeUserId"
                    :options="nonPermittedOptions"
                    :num-of-users="2"
                    imageWidth="26px"
                    :addUser="!showArchiveVar"
                    @selected="changeAssignee(checkApps('MultipleAssignees',projectObject) ? 'add' : 'replace', $event)"
                    @removed="changeAssignee('remove', $event)"
                    :isDisplayTeam="true"
                    :multiSelect="checkApps('MultipleAssignees')"
                />
            </span>
            <span v-if="checkPermission('task.task_due_date',project?.isGlobalPermission) !== null">
                <DueDateCompo
                    id="due-date-sub-task-detail"
                    :displyDate="dueDate? dueDate : ''"
                    :disabledDates="task.dueDateDeadLine"
                    @SelectedDate="($event) => updateDueDate($event)"
                    v-if="!showArchiveVar && checkPermission('task.task_due_date',project?.isGlobalPermission) === true && checkPermission('task.task_list',project?.isGlobalPermission) == true"
                />
                <template v-else>
                    <span v-if="task.DueDate">{{convertDateFormat(task.DueDate,'',{showDayName:false})}}</span>
                    <span v-else>No Due Date</span>
                </template>
            </span>
            <span v-if="checkPermission('task.task_priority',project?.isGlobalPermission) !== null && checkApps('Priority')">
                <Priority
                    :priorityVal="task.Task_Priority"
                    @select="updatePriority"
                    :permission="!showArchiveVar && checkPermission('task.task_priority',project?.isGlobalPermission) === true"
                />
            </span>
            <span v-if="checkPermission('task.task_list',project?.isGlobalPermission)!==null && checkPermission('task.task_status',project?.isGlobalPermission) !== null">
                <TaskStatus
                    :modelValue="taskStatus"
                    :show-label="true"
                    :options="project.taskStatusData || []"
                    :disabled="showArchiveVar || (checkPermission('task.task_list',project?.isGlobalPermission)!==true || checkPermission('task.task_status',project?.isGlobalPermission) !== true)"
                    @select="changeStatus($event)"
                />
            </span>
            <!-- <span></span> -->
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import {computed, defineProps, inject, nextTick, ref} from "vue";
import { taskDueDateAdd, taskDueDateChange } from "@/utils/NotificationTemplate";
import { useConvertDate, useCustomComposable, useGetterFunctions, useMoment } from "@/composable";
import taskClass from "@/utils/TaskOperations"

// COMPONENTS
// import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import TaskStatus from "@/components/atom/TaskStatus/TaskStatus.vue"
import Assignee from "@/components/molecules/Assignee/Assignee.vue"
import DueDateCompo from "@/components/molecules/DueDateCompo/DueDateCompo.vue"
import Priority from "@/components/molecules/PriorityCompo/PriorityComp.vue"
import InputText from "@/components/atom/InputText/InputText.vue"
import CreateTagPopup from "@/components/molecules/TagList/CreateTagPopup.vue";
import TagChip from '@/components/atom/TagChip/TagChip.vue'
import ProjectTaskType from "@/components/atom/TaskTypeSelection/TaskTypeSelection.vue"
import { useUpdateTasks } from "@/views/Projects/helper"

import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";
import { useTaskAgents } from '@/composable/taskAgents';

// Agents are assignable exactly like people, in every view. The composable
// fetches the list once for the whole page and resolves which apply to each
// task locally, so a long list does not fire one request per row.
const { agentsForTask, selectedAgentsFor, assignAgent } = useTaskAgents();
const { t } = useI18n();

// UTILS
const {checkPermission, checkApps,getWasabiImageLink} = useCustomComposable();
const {convertDateFormat} = useConvertDate();
const projectObject = inject("selectedProject");
const defaultTaskType = inject("$defaultTaskStatusImg");
const {getUser, getPriority} = useGetterFunctions();
const {changeDateFormate} = useMoment()
const dateFormat = inject('$dateFormat');
const userId = inject('$userId');
const showArchiveVar = inject("showArchived");
const $toast = useToast();
const {getters} = useStore();
const companyId = inject("$companyId");
const route = useRoute();
const router = useRouter();
const toggleTaskDetail = inject('toggleTaskDetail')
const isRouteRequired = inject('isRouteRequired')
const tagChipArray = ref()
const ids = ref()
const chipCount = ref(2)
const clientWidth = inject('$clientWidth');
// IMAGES
const chatIcon = require("@/assets/images/svg/ChatIcon.svg");
const {updateTaskByGroup} = useUpdateTasks();

const props = defineProps({
    task: {
        type: Object,
        required: true,
    },
    project: {
        type: Object,
        required: true,
    },
    parentAssignee: {
        type: Array,
        default: () => []
    }
})

const projectTaskTypeOptions = computed(() => {
    return props.project?.taskTypeCounts ?? [];
})

const taskName = ref("");
const editTask = ref(false);
const openDrop = ref()
const assigneeInProgress = ref({});

const openDropDwon = () => {
    if(checkPermission('task.task_tag',props.project?.isGlobalPermission) === true) {
        openDrop.value.sendMethod()
    }
}

const companyUsers = computed(() => getters["settings/companyUsers"]?.map((x) => x.userId))

const myCounts = computed(() => {
    let total = 0;

    Object.keys(getters["users/myCounts"]?.data || {}).forEach((key) => {
        if(key.includes(`task_${props.project._id}_${props.task.sprintId}_${props.task._id}_comments`)) {
            total += getters["users/myCounts"]?.data?.[key] || 0
        }
    })

    return total;
})

const sprintData = computed(() => {
    let sprintData = false;
    if (props.project && props.task) {
        sprintData = props.task.folderObjId ? props.project?.sprintsfolders?.[props.task.folderObjId]?.sprintsObj?.[props.task.sprintId] : props.project?.sprintsObj?.[props.task.sprintId]
    }

    return sprintData || null;
})
const permittedOptions = computed(() => {
    let users = [];
    if(sprintData.value) {
        if(props.task.isParentTask) {
            if(sprintData.value?.private) {
                users = sprintData.value?.AssigneeUserId || [];
            } else {
                if(props.project?.isPrivateSpace) {
                    users = props.project?.AssigneeUserId || [];
                } else {
                    users = companyUsers.value;
                }
            }
        } else {
            if(sprintData.value?.private) {
                users = (props.parentAssignee || []).filter((x) => sprintData.value?.AssigneeUserId?.includes(x))
            } else {
                users = (props.parentAssignee || [])
            }
        }
    }
    if(props.project?.isPrivateSpace) {
        users = users.filter((x) => props.project?.AssigneeUserId.includes(x));
        return Array.from(new Set([...users, ...(props.task?.AssigneeUserId || [])]));
    } else {
        return users;
    }
})
const nonPermittedOptions = computed(() => {
    let users = [];
    if(sprintData.value) {
        if(props.task.isParentTask) {
            if(sprintData.value?.private) {
                users = (sprintData.value?.AssigneeUserId || []).filter((x) => x === userId.value);
            } else {
                if(props.project?.isPrivateSpace) {
                    users = (props.project?.AssigneeUserId || []).filter((x) => x === userId.value);
                } else {
                    users = [userId.value];
                }
            }
        } else {
            users = (props.parentAssignee || [])?.filter((x) => x === userId.value)
            if(sprintData.value?.private) {
                users = users.filter((x) => sprintData.value?.AssigneeUserId?.includes(x))
            }
        }
    }
    if(props.project?.isPrivateSpace) {
        users = users.filter((x) => props.project?.AssigneeUserId.includes(x));
        return users;
    } else {
        return users;
    }
})

const dueDate = computed(() => props.task.DueDate ? new Date(props.task.DueDate).getTime() : '');

const companyOwner = computed(() => getters["settings/companyOwnerDetail"])

const taskStatus = computed(() => {
    return props.project?.taskStatusData?.find((x) => x.key === props.task.statusKey) || {};
})

const taskType = () => {
    let defaultObj = {
        taskImage: defaultTaskType.value,
        name: "N/A",
    }
    return props.project?.taskTypeCounts?.length ? props.project?.taskTypeCounts?.find((x) => x.key === props.task.TaskTypeKey) : defaultObj
}
function changeTaskType(status) {
    const statusIndex = props.project?.taskTypeCounts.findIndex((x) => x.key === props.task.TaskTypeKey);
    if(statusIndex === -1) return;
    updateTaskByGroup(props.task, status, 4);
}

function changeRoute(tab="task-detail-tab") {
    toggleTaskDetail(props.task);
    if(isRouteRequired == false) {
        nextTick(() => {
            router.push({
                ...route,
                params: {
                    ...route.params
                },
                query: {
                    ...route.query,
                    detailTab: tab
                }
            })
        })
    } else {
        nextTick(() => {
            router.push({
                ...route,
                params: {
                    ...route.params, taskId: props.task._id
                },
                query: {
                    ...route.query,
                    detailTab: tab
                }
            })
        })
    }

}
// TASK UPDATES
function getUserData() {
    const user = getUser(userId.value);
    const userData = {
        id: user.id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: companyOwner.value.userId,
    }

    return userData;
}

// UPDATE TASK NAME
function updateTaskName() {
    if(taskName.value.trim().length < 3 || taskName.value.trim().length > 250) return;

    const userData = getUserData();

    const firebaseObj = {
        'TaskName': taskName.value
    }
    let obj = {
        'previousTaskName': props.task.TaskName,
        'userName' : userData.Employee_Name
    }
    const projectData = {
        _id: props.project._id,
        CompanyId: props.project.CompanyId,
        lastTaskId: props.project.lastTaskId,
        ProjectName: props.project.ProjectName,
        ProjectCode: props.project.ProjectCode
    }

    taskClass.updateTaskName({firebaseObj, projectData, taskData: props.task, obj, userData})
    .then(() => {
        $toast.success(t('Toast.Task_name_updated_successfully'), {position: "top-right"})
    })
    .catch((err) => {
        console.error(err);
    })
}

// CHANGE STATUS
function changeStatus(status) {
    const statusIndex = props.project.taskStatusData.findIndex((x) => x.key === props.task.statusKey);
    if(statusIndex === -1) return;

    const userData = getUserData();

    const prev = {
        backColor: props.project.taskStatusData[statusIndex].bgColor,
        color: props.project.taskStatusData[statusIndex].textColor,
        statusName: props.project.taskStatusData[statusIndex].name,
    }
    const updatedStatus = {
        'text': status.name,
        'key': status.key,
        'type': status.type,
        'value': status.value,
    }
    const newStatus = {
        status: updatedStatus,
        'statusType': status.type,
        'statusKey': status.key
    }
    let prevStatus = {
        ...prev,
        'taskName': props.task.TaskName,
        'bgColor': status.bgColor,
        'textColor': status.textColor,
        'taskId': props.task._id,
        'updatedTaskName': status.name,
    }

    const projectData = {
        _id: props.project._id,
        CompanyId: props.project.CompanyId,
        lastTaskId: props.project.lastTaskId,
        ProjectName: props.project.ProjectName,
        ProjectCode: props.project.ProjectCode
    }

    taskClass.updateStatus({ newStatus, prevStatus, projectData, task: props.task, userData})
    .then(() => {
        $toast.success(t(`Toast.Status_changed_successfully`), {position: "top-right"})
    })
    .catch((error) => {
        console.error("ERROR in changeStatus: ", error);
    })
}

// CHANGE ASSIGNEE
function changeAssignee(type, value) {
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

    const projectData = {
        _id: props.project._id,
        CompanyId: props.project.CompanyId,
        lastTaskId: props.project.lastTaskId,
        ProjectName: props.project.ProjectName,
        ProjectCode: props.project.ProjectCode
    }

    taskClass.updateAssignee({
        firebaseObj: updateObject,
        projectData,
        taskData: props.task,
        employeeName: userData.Employee_Name,
        type: operation,
        userData
    })
    .then(() => {
        delete assigneeInProgress.value[value?.id];
        $toast.success(t(`Toast.Assignee ${type === "add" || type === "replace" ? 'added' : 'removed'} successfully`), {position: "top-right"})
    })
    .catch((error) => {
        delete assigneeInProgress.value[value?.id];
        console.error("ERROR in changeAssignee: ", error);
    })
}

// CHANGE DUE DATE
const updateDueDate = (event) => {
    try {
        const userData = getUserData();

        let newdueDateDeadLine = [];
        if(props.task.dueDateDeadLine.length > 0) {
            props.task.dueDateDeadLine.forEach((date) => {
                newdueDateDeadLine.push({ date: new Date(date.date.seconds * 1000) })
            })
            newdueDateDeadLine.push({ date: new Date(event.dateVal)});
        } else {
            newdueDateDeadLine.push({ date: new Date(event.dateVal)});
        }
        let typesenseDeadLine = JSON.parse(JSON.stringify(newdueDateDeadLine));
        typesenseDeadLine.forEach(day => {
            day.date = new Date(day.date).getTime()/1000
        })
        const updateobj = {
            DueDate: event.dateVal,
            dueDateDeadLine: newdueDateDeadLine
        }
        const typesensObj = {
            DueDate: new Date(event.dateVal).getTime()/1000,
            dueDateDeadLine: typesenseDeadLine.map((x) => JSON.stringify(x))
        }
        let notificationObj = {
            key: "task_due_date",
            projectId: props.task.ProjectID,
            taskId: props.task._id,
            sprintId: props.task.sprintId
        }
        let obj = {
            'ProjectName' : props.project.ProjectName,
            'TaskName' : props.task.TaskName,
        }
        if(props.task.dueDateDeadLine.length > 0 ) {
            obj.previousDate = changeDateFormate(new Date(props.task.dueDateDeadLine[props.task.dueDateDeadLine.length - 1].date.seconds * 1000))
            obj.changedDate = changeDateFormate(event.dateVal)
            notificationObj.message = taskDueDateChange(obj);
        } else  {
            obj.lastDate = changeDateFormate(event.dateVal)
            notificationObj.message = taskDueDateAdd(obj);
        }
        const projectData = {
            _id: props.project._id,
            CompanyId: props.project.CompanyId,
            lastTaskId: props.project.lastTaskId,
            ProjectName: props.project.ProjectName,
            ProjectCode: props.project.ProjectCode
        }

        taskClass.updateDueDate({
            commonDateFormatString: dateFormat.value,
            firebaseObj: updateobj,
            typesenseObj: typesensObj,
            project: projectData,
            task: props.task,
            obj: notificationObj,
            userData
        }).then(() => {
            $toast.success(t(`Toast.Due_date_updated_successfully`), {position: "top-right"})
        }).catch((error) => {
            console.error("ERROR in updateDueDate: ", error);
        })
    } catch (error) {
        console.error("ERROR in updateDueDate: ", error);
    }
}

// CHANGE PRIORITY
async function updatePriority(val) {
    const userData = getUserData();

    let updateObj = {
        Task_Priority : val.value
    }

    let projectData = {
        '_id': props.project._id ? props.project._id : "",
        'ProjectName' : props.project.ProjectName,
        "CompanyId": companyId.value,
    }

    const priority = getPriority(props.task.Task_Priority)

    let priorityObj = {
        'statusImage' : await getWasabiImageLink(props.project.CompanyId,priority.image),
        'priorityName' : priority.name,
        'taskId': props.task._id,
        'taskName': props.task.TaskName,
        'userName' : userData.Employee_Name,
        'newStatusImage' : await getWasabiImageLink(props.project.CompanyId,val.image),
        'newPriorityName' : val.name
    }

    taskClass.updatePriority({firebaseObj: updateObj, projectData, taskData: props.task, priorityObj, userData})
    .then(() => {
        $toast.success(t(`Toast.Task_updated_successfully`), {position: "top-right"})
    })
    .catch((error) => {
        console.error("ERROR in update priority: ", error);
    })
}
</script>

<style scoped>
.subtaskitem-wrapper span {
    font-size: 13px;
    line-height: 20px;
    font-weight: 400;
    color: #505050;
}
.subtask__taskimage{
    width:13px;
    height: 13px;
}
.show__count{
   position: absolute;
   transform: translateX(78%); 
   top: -8px;
   height: 12px;
   min-width: 22px;
}

</style>

<style>
.subtask__taskimage img {
    margin-left: 0px !important;
    width:13px !important;
    height: 13px !important;
}
</style>