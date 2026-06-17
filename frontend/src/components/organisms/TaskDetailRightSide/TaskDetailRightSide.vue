<template>
    <div class="task-detail-right-side">
        <div>
            <h4 class="details-heading">{{$t('ProjectDetails.details')}}</h4>
            <div class="d-flex task-detail-right-side-label" v-if="checkPermission('task.task_list',project?.isGlobalPermission)!==null && checkPermission('task.task_status',project?.isGlobalPermission) !== null">
                <h4>{{$t('ProjectDetails.status')}}</h4>
                <Skelaton v-if="(task?.statusKey === undefined || task?.statusKey === null || task?.statusKey === '') && isMainSpinner" :style="{ height: clientWidth <= 767 ? '38px' : '23px', width: clientWidth <= 767 ? '160px' : '70px' }"  class="border-radius-7-px"/>
                <TaskStatus
                    v-else
                    :task-key="task.statusKey"
                    :sprintId="task.sprintId"
                    :taskId="task._id"
                    :projectId="task.ProjectID"
                    @update:status="(oldVal,newVal)=>{updateStatus(oldVal,newVal)}"
                    class="d-flex taskdetail-label task-detail-right-wrapper"
                    :taskStatusIndex="props.taskStatusIndex"
                />
            </div>
            <div class="d-flex task-detail-right-side-label" v-if="checkPermission('task.task_assignee',project?.isGlobalPermission) !== null">
                <h4>{{$t('ProjectDetails.assignee')}}</h4>
                <Skelaton v-if="task?.AssigneeUserId?.length <= 0 && isMainSpinner" style="height: 30px;" class="w-30px border-radius-50-per"/>
                <template v-else>
                    <Assignee
                        v-if="checkPermission('task.task_assignee',project?.isGlobalPermission) === true && checkPermission('task.task_list',project?.isGlobalPermission) == true"
                        class="taskdetail-label task-detail-right-wrapper ml-5px"
                        :numOfUsers="2"
                        :users="task.AssigneeUserId"
                        :addUser="checkPermission('task.task_assignee',project?.isGlobalPermission) === true"
                        :options="permittedOptions"
                        @selected="updateAssignee($event, checkApps('MultipleAssignees',project) ? 'add' : 'replace')"
                        @removed="updateAssignee($event, 'remove')"
                        imageWidth="30px"
                        :showAddUser="true"
                        :zIndexAssigne="props.zIndexAssigne"
                        :isDisplayTeam="true"
                        :multiSelect="checkApps('MultipleAssignees')"
                    />
                    <Assignee
                        v-else
                        class="taskdetail-label task-detail-right-wrapper ml-5px"
                        :numOfUsers="2"
                        :showAddUser="true"
                        @selected="updateAssignee($event, checkApps('MultipleAssignees',project) ? 'add' : 'replace')"
                        @removed="updateAssignee($event, 'remove')"
                        :users="task.AssigneeUserId"
                        :options="nonPermittedOptions"
                        imageWidth="30px"
                        :zIndexAssigne="props.zIndexAssigne"
                        :isDisplayTeam="true"
                        :multiSelect="checkApps('MultipleAssignees')"
                    />
                </template>
            </div>
            <div class="d-flex task-detail-right-side-label">
                <h4>{{$t('Comment.created_by')}}</h4>
                <Skelaton v-if="!task?.Task_Leader && isMainSpinner" style="height: 30px;" class="w-30px border-radius-50-per"/>
                <template v-else>
                    <!-- Editable picker — gated by the same permission as Assignee. -->
                    <div
                        v-if="checkPermission('task.task_assignee',project?.isGlobalPermission) === true && checkPermission('task.task_list',project?.isGlobalPermission) == true"
                        class="d-flex align-items-center"
                    >
                        <Assignee
                            :numOfUsers="1"
                            :users="task.Task_Leader ? [task.Task_Leader] : []"
                            :addUser="true"
                            :options="permittedOptions"
                            @selected="updateTaskLeader($event)"
                            imageWidth="30px"
                            :showAddUser="false"
                            :zIndexAssigne="props.zIndexAssigne"
                            :isDisplayTeam="false"
                            :multiSelect="false"
                        />
                        <span
                            class="black text-ellipsis task-created-by ml-5px"
                            :class="{'font-size-13 font-weight-400' : clientWidth > 767, 'font-size-16' : clientWidth <=767}"
                            :title="taskLeaderData?.Employee_Name || 'N/A'">
                            {{ taskLeaderData?.Employee_Name || 'N/A' }}
                        </span>
                    </div>
                    <!-- Read-only display — original behaviour for users without permission. -->
                    <div v-else class="d-flex align-items-center">
                        <UserProfile
                            :data="{
                                image: taskLeaderData.Employee_profileImageURL,
                                title: taskLeaderData.Employee_Name
                            }"
                            :showDot="false"
                            width="30px"
                            :thumbnail="'30x30'"
                        />
                        <span
                            class="black text-ellipsis task-created-by"
                            :class="{'font-size-13 font-weight-400' : clientWidth > 767, 'font-size-16' : clientWidth <=767}"
                            :title="taskLeaderData?.Employee_Name || 'N/A'">
                            {{ taskLeaderData?.Employee_Name || 'N/A' }}
                        </span>
                    </div>
                </template>
            </div>
            <div class="d-flex task-detail-right-side-label" v-if="checkPermission('task.task_priority',project?.isGlobalPermission) !== null && checkApps('Priority')">
                <h4>{{$t('Projects.priority')}}</h4>
                <Skelaton v-if="!task.Task_Priority && isMainSpinner" style="height: 36px;" class="w-100px border-radius-7-px"/>
                <PriorityComp
                    v-else
                    :priorityVal="task.Task_Priority"
                    :showName="true"
                    @select="updatePriority($event)"
                    class="priority-comp taskdetail-label task-detail-right-wrapper ml-0"
                    :zIndexPriority="props.zIndexPriority"
                    :permission="checkPermission('task.task_priority',project?.isGlobalPermission) === true"
                />
            </div>
            <div class="d-flex task-detail-right-side-label" v-if="checkPermission('task.task_estimated_hours',project?.isGlobalPermission) !== null">
                <h4>Story Points</h4>
                <StoryPoints
                    :pointsVal="task.points"
                    :estimationScale="project?.estimationScale || 'fibonacci'"
                    :permission="checkPermission('task.task_estimated_hours',project?.isGlobalPermission) === true"
                    @select="updatePoints($event)"
                    class="taskdetail-label task-detail-right-wrapper ml-0"
                />
            </div>
            <div class="d-flex task-detail-right-side-label" v-if="isSupport === false && checkPermission('task.task_start_date',project?.isGlobalPermission) !== null">
                <h4>{{$t('Milestone.start_date')}}</h4>
                <Skelaton v-if="!task?.startDate && isMainSpinner" style="height: 36px;" class="w-100px border-radius-7-px"/>
                <template v-else>
                    <DueDateCompo
                        id="due-date-task"
                        class="taskdetail-label task-detail-right-wrapper"
                        :displyDate="task?.startDate? task.startDate : ''"
                        :isShowDateAndicon="true"
                        @SelectedDate="($event) => updateStartDate($event)"
                        :position="`right`"
                        v-if="checkPermission('task.task_list',project?.isGlobalPermission) == true && checkPermission('task.task_start_date',project?.isGlobalPermission) === true"
                    />
                    <template v-else>
                        <span v-if="task.startDate">{{convertDateFormat(task.startDate,'',{showDayName:false})}}</span>
                        <span v-else>{{$t('ProjectDetails.no_start_date')}}</span>
                    </template>
                </template>
            </div>
            <div class="d-flex task-detail-right-side-label" v-if="checkPermission('task.task_due_date',project?.isGlobalPermission) !== null">
                <h4>{{$t('Projects.due_date')}}</h4>
                <Skelaton v-if="!task?.DueDate && isMainSpinner" style="height: 36px;" class="w-100px border-radius-7-px"/>
                <template v-else>
                    <DueDateCompo
                        id="due-date-task"
                        class="taskdetail-label task-detail-right-wrapper"
                        :displyDate="task.DueDate? task.DueDate : ''"
                        :isShowDateAndicon="true"
                        :disabledDates="task.dueDateDeadLine"
                        @SelectedDate="($event) => updateDueDate($event)"
                        :position="`right`"
                        v-if="checkPermission('task.task_due_date',project?.isGlobalPermission) === true && checkPermission('task.task_list',project?.isGlobalPermission) == true"
                    />
                    <template v-else>
                        <span v-if="task.DueDate">{{convertDateFormat(task.DueDate,'',{showDayName:false})}}</span>
                        <span v-else>{{$t('ProjectDetails.no_due_date')}}</span>
                    </template>
                </template>
            </div>
             <div class="d-flex task-detail-right-side-label" v-if="checkApps('TimeEstimates') && checkPermission('task.task_estimated_hours',project?.isGlobalPermission) !== null">
                <h4>{{$t('UserTimesheet.estimated')}}</h4>
                <Skelaton v-if="isMainSpinner" style="height: 24px;" class="w-100px border-radius-7-px"/>
                <div v-if="Object.keys(task || {}).length && !isMainSpinner" class="d-flex align-items-center estimated-with-ai">
                    <EstimatedTimeInput
                        :task="task"
                        @update:totalEstimatedTime="(val) => updateTotalEstimatedTime(val)"
                    />
                    <!--
                      Icon-only AI estimator trigger. Tooltip via the native
                      title attribute matches the project's existing tooltip
                      convention (see BulkActionBar.vue / CheckList.vue).
                      Disabled + spinner state while a request is in flight.
                      Shown whenever the Estimated row is visible — the per-user
                      edit-permission gate (`=== true`) was removed on request.
                    -->
                    <button
                        type="button"
                        class="ai-estimate-btn"
                        :class="{ 'is-loading': isAiEstimateLoading }"
                        :disabled="isAiEstimateLoading"
                        :title="isAiEstimateLoading ? 'Generating estimate…' : 'Generate estimate using AI'"
                        :aria-label="isAiEstimateLoading ? 'Generating estimate' : 'Generate estimate using AI'"
                        @click.stop="generateAiEstimate"
                    >
                        <span v-if="isAiEstimateLoading" class="ai-estimate-spinner" aria-hidden="true"></span>
                        <img v-else :src="aiEstimateIcon" alt="" class="ai-estimate-icon" />
                    </button>
                </div>
            </div>
            <div class="d-flex task-detail-right-side-label" v-if="checkApps('TimeEstimates') && checkPermission('task.task_estimated_hours',project?.isGlobalPermission) !== null">
                <h4>{{$t('UserTimesheet.task_planning')}}</h4>
                <Skelaton v-if="isMainSpinner" style="height: 24px;" class="w-100px border-radius-7-px"/>
                <EstimateHours
                    v-if="Object.keys(task || {}).length && !isMainSpinner"
                    :permission="checkPermission('task.task_estimated_hours',project?.isGlobalPermission)"
                    :task="task"
                    class="d-flex taskdetail-label"
                    @update:dueDate="($event) => updateDueDate($event)"
                    @update:startDate="($event) => updateStartDate($event)"
                    :zIndexEstimate="props.zIndexEstimate"
                    :isSpinner="isSpinner"
                />
            </div>
               <div class="d-flex task-detail-right-side-label" v-if="checkApps('TimeEstimates') && checkPermission('task.task_estimated_hours',project?.isGlobalPermission) !== null">
                <h4>{{$t('UserTimesheet.task_remaining_planning')}}</h4>
                <Skelaton v-if="isMainSpinner" style="height: 24px;" class="w-100px border-radius-7-px"/>
                <div v-if="Object.keys(task || {}).length && !isMainSpinner" class="remaining-estimate-text">{{displayTime(task.remainingHours)}}</div>
            </div>
        </div>
    </div>
</template>
<script setup>
import { computed, defineProps, inject, ref, watch, nextTick } from 'vue';
import { useStore } from 'vuex';

import EstimateHours from '@/components/molecules/EstimateHours/EstimateHours.vue';
import EstimatedTimeInput from '@/components/molecules/EstimatedTimeInput/EstimatedTimeInput.vue';
import TaskStatus from '@/components/molecules/TaskStatus/TaskStatus.vue';
import Assignee from '@/components/molecules/Assignee/Assignee.vue';
import UserProfile from '@/components/atom/UserProfile/UserProfile.vue';
import PriorityComp from '@/components/molecules/PriorityCompo/PriorityComp.vue';
import StoryPoints from '@/components/atom/StoryPoints/StoryPoints.vue';
import DueDateCompo from '@/components/molecules/DueDateCompo/DueDateCompo.vue';

import { useConvertDate, useCustomComposable, useGetterFunctions, useMoment } from '@/composable'
import taskClass from "@/utils/TaskOperations";
import { taskDueDateAdd, taskDueDateChange } from '@/utils/NotificationTemplate';
import { useToast } from 'vue-toast-notification';
import { useI18n } from "vue-i18n";
import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

// Icon for the "Generate estimate using AI" sidebar button. Same asset
// the SubTasks / Checklist / Sprints components use for their AI actions
// so the visual language stays consistent.
const aiEstimateIcon = require("@/assets/images/svg/ai_image.svg");
const { t } = useI18n();

const {convertDateFormat} = useConvertDate();
const { getUser, getPriority } = useGetterFunctions();
const { checkPermission, checkApps, getWasabiImageLink } = useCustomComposable();
const { changeDateFormate } = useMoment();
const { getters } = useStore();

//inject
const userId = inject('$userId');
const dateFormat = inject('$dateFormat');
const project = inject('selectedProject');

const $toast = useToast();
const props = defineProps({
    task: {
        type: Object,
        required: true
    },
    parentTask: {
        type: Object,
        required: false
    },
    taskStatusIndex: {
        type: Number,
        default: 7
    },
    zIndexAssigne: {
        type: Number,
        default: 7
    },
    zIndexPriority: {
        type: Number,
        default: 7
    },
    zIndexEstimate: {
        type: Number,
        default: 7
    },
    isSupport: {
        type: Boolean,
        default: false
    },
    isMainSpinner: {
        type: Boolean,
        default: false
    },
    clientWidth: Number,
})
//ref
const taskLeaderData = ref(getUser(props.task?.Task_Leader));
const assigneeInProgress = ref({});
const isSpinner = ref(false);
// In-flight flag for the manual AI-estimate request — drives both the
// button's spinner state and the click-debounce.
const isAiEstimateLoading = ref(false);
watch(() => props.task,(val) => {
    taskLeaderData.value = getUser(val?.Task_Leader);
});

const companyOwner = computed(() => {return getters["settings/companyOwnerDetail"]});
const companyUsers = computed(() => getters["settings/companyUsers"]?.map((x) => x.userId));

const sprintData = computed(() => {
    let sprintData = false;
    if (project.value && props.task && Object.keys(props.task).length > 0) {
        sprintData = props.task.folderObjId ? project.value?.sprintsfolders?.[props.task?.folderObjId]?.sprintsObj?.[props.task?.sprintId] : project.value?.sprintsObj?.[props.task?.sprintId]
    }
    return sprintData || null;
});

const permittedOptions = computed(() => {
    let users = [];
    if(sprintData.value) {
        if(props.task.isParentTask) {
            if(sprintData.value?.private) {
                users = sprintData.value?.AssigneeUserId || [];
            } else {
                if(project.value?.isPrivateSpace) {
                    users = project.value?.AssigneeUserId || [];
                } else {
                    users = companyUsers.value;
                }
            }
        } else {
            if(sprintData.value?.private) {
                users = (props.parentTask?.AssigneeUserId || []).filter((x) => sprintData.value?.AssigneeUserId?.includes(x))
            } else {
                users = (props.parentTask?.AssigneeUserId || [])
            }
        }
    }
    if(project.value?.isPrivateSpace) {
        users = users.filter((x) => project.value?.AssigneeUserId.includes(x));
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
                if(project.value?.isPrivateSpace) {
                    users = (project.value?.AssigneeUserId || []).filter((x) => x === userId.value);
                } else {
                    users = [userId.value];
                }
            }
        } else {
            users = (props.parentTask?.AssigneeUserId || [])?.filter((x) => x === userId.value)
            if(sprintData.value?.private) {
                users = users.filter((x) => sprintData.value?.AssigneeUserId?.includes(x))
            }
        }
    }
    if(project.value?.isPrivateSpace) {
        users = users.filter((x) => project.value?.AssigneeUserId.includes(x));
        return users;
    } else {
        return users;
    }
})

function getUserData() {
    const user = getUser(userId.value);
    return {
        id: user.id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: companyOwner.value.userId,
    };
}

const updateAssignee = (event, type) =>{
    try {
        if(assigneeInProgress.value[event?.id] && assigneeInProgress.value[event?.id] === type) return;
        assigneeInProgress.value[event?.id] = type;
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
            AssigneeUserId : event.id
        }

        const projectData = {
            _id: project.value._id,
            CompanyId: project.value.CompanyId,
            lastTaskId: project.value.lastTaskId,
            ProjectName: project.value.ProjectName,
            ProjectCode: project.value.ProjectCode
        }

        taskClass.updateAssignee({
            firebaseObj: updateObject,
            projectData: projectData,
            taskData: props.task,
            employeeName: getUser(event.id).Employee_Name,
            type: operation,
            userData
        })
        .then(() => {
            delete assigneeInProgress.value[event?.id];
            $toast.success(t(`Toast.Assignee ${type === "add" || type === "replace"? 'added' : 'removed'} successfully`),{position: 'top-right'});
        })
        .catch((error) => {
            delete assigneeInProgress.value[event?.id];
            console.error("ERROR in updateAssignee: ", error);
            $toast.error(t('Toast.Assignee_not_updated'),{position: 'top-right'});
        })
    } catch (error) {
        console.error(error);
        $toast.error(t('Toast.Assignee_not_updated'),{position: 'top-right'});
    }
}

const updateTaskLeader = (event) => {
    try {
        if (!event || !event.id) return;
        if (event.id === props.task.Task_Leader) return;
        const userData = getUserData();

        const updateObject = {
            Task_Leader: event.id
        }

        const projectData = {
            _id: project.value._id,
            CompanyId: project.value.CompanyId,
            lastTaskId: project.value.lastTaskId,
            ProjectName: project.value.ProjectName,
            ProjectCode: project.value.ProjectCode
        }

        taskClass.updateTaskLeader({
            firebaseObj: updateObject,
            projectData: projectData,
            taskData: props.task,
            employeeName: getUser(event.id).Employee_Name,
            userData
        })
        .then(() => {
            $toast.success(t('Toast.Created_by_updated_successfully'), { position: 'top-right' });
        })
        .catch((error) => {
            console.error("ERROR in updateTaskLeader: ", error);
            $toast.error(t('Toast.Created_by_not_updated'), { position: 'top-right' });
        })
    } catch (error) {
        console.error(error);
        $toast.error(t('Toast.Created_by_not_updated'), { position: 'top-right' });
    }
}

const updatePriority = async(val) => {
    try {
        const userData = getUserData();

        let updateObj = {
            Task_Priority : val.value
        }

        let projectData = {
            '_id': project.value._id ? project.value._id : "",
            'ProjectName' : project.value.ProjectName,
            "CompanyId": project.value.CompanyId,
        }


        const priority = getPriority(props.task.Task_Priority)

        let priorityObj = {
            'statusImage' : await getWasabiImageLink(project.value.CompanyId,priority.image),
            'priorityName' : priority.name,
            'taskId': props.task._id,
            'taskName': props.task.TaskName,
            'userName' : userData.Employee_Name,
            'newStatusImage' : await getWasabiImageLink(project.value.CompanyId,val.statusImage),
            'newPriorityName' : val.name
        }

        taskClass.updatePriority({firebaseObj: updateObj, projectData: projectData, taskData: props.task, priorityObj, userData})
        .then(() => {
            $toast.success(t('Toast.Priority_updated_successfully'),{position: 'top-right'});
        })
        .catch((error) => {
            console.error("ERROR in update priority: ", error);
            $toast.error(t('Toast.Priority_not_updated'),{position: 'top-right'});
        })
    } catch (error) {
        console.error('updatePriority error', error);
        $toast.error(t('Toast.Priority_not_updated'),{position: 'top-right'});
    }
}

const updatePoints = (val) => {
    try {
        const userData = getUserData();
        const projectData = {
            '_id': project.value._id ? project.value._id : "",
            'ProjectName': project.value.ProjectName,
            "CompanyId": project.value.CompanyId,
        };
        const updateObj = { points: (val === null || val === undefined || val === '') ? null : Number(val) };
        taskClass.updatePoints({ firebaseObj: updateObj, projectData, taskData: props.task, userData })
        .then(() => {
            $toast.success('Story points updated', { position: 'top-right' });
        })
        .catch((error) => {
            console.error("ERROR in update points: ", error);
            $toast.error('Story points not updated', { position: 'top-right' });
        });
    } catch (error) {
        console.error('updatePoints error', error);
        $toast.error('Story points not updated', { position: 'top-right' });
    }
}

const updateStatus = (oldVal, newval) => {
    try {
        const userData = getUserData();
        const prev = {
            backColor: oldVal.bgColor ,
            color: oldVal.textColor,
            statusName: oldVal.name,
        }
        const updatedStatus = {
            'text': newval.name,
            'key': newval.key,
            'type': newval.type,
            'value': newval.value,
        }
        const newStatus = {
            status: updatedStatus,
            'statusType': newval.type,
            'statusKey': newval.key
        }
        let prevStatus = {
            ...prev,
            'taskName': props.task.TaskName,
            'bgColor': newval.bgColor,
            'textColor': newval.textColor,
            'taskId': props.task._id,
            'updatedTaskName': newval.name,
        }
        const projectData = {
            _id: project.value._id,
            CompanyId: project.value.CompanyId,
            lastTaskId: project.value.lastTaskId,
            ProjectName: project.value.ProjectName,
            ProjectCode: project.value.ProjectCode
        }
        taskClass.updateStatus({ newStatus, prevStatus, projectData: projectData, task: props.task, userData})
        .then(() => {
            $toast.success(t('Toast.Status_updated_successfully'),{position: 'top-right'});
        })
        .catch(() => {
            $toast.error(t('Toast.Status_not_updated'),{position: 'top-right'});
        })
    } catch (error) {
        console.error('updateStatus error', error);
        $toast.error(t('Toast.Status_not_updated'),{position: 'top-right'});
    }
}

const updateDueDate = (event) => {
    try {
        isSpinner.value = true;
        const userData = getUserData();
        let newdueDateDeadLine = [];
        if(props.task.dueDateDeadLine.length > 0) {
            props.task.dueDateDeadLine.forEach((date) => {
                newdueDateDeadLine.push({ date: new Date(date.date) })
            })
            newdueDateDeadLine.push({ date: new Date(event.dateVal)});
        } else {
            newdueDateDeadLine.push({ date: new Date(event.dateVal)});
        }
        const updateobj = {
            DueDate: event.dateVal,
            dueDateDeadLine: newdueDateDeadLine,
        }
        let notificationObj = {
            key: "task_due_date",
            projectId: props.task.ProjectID,
            taskId: props.task._id,
            sprintId: props.task.sprintId
        }
        let obj = {
            'ProjectName' : project.value.ProjectName,
            'TaskName' : props.task.TaskName,
        }
        if(props.task.dueDateDeadLine.length > 0 ) {
            obj.previousDate = changeDateFormate(new Date(props.task.dueDateDeadLine[props.task.dueDateDeadLine.length - 1].date))
            obj.changedDate = changeDateFormate(event.dateVal)
            notificationObj.message = taskDueDateChange(obj);
        } else  {
            obj.lastDate = changeDateFormate(event.dateVal)
            notificationObj.message = taskDueDateAdd(obj);
        }
        const projectData = {
            _id: project.value._id,
            CompanyId: project.value.CompanyId,
            lastTaskId: project.value.lastTaskId,
            ProjectName: project.value.ProjectName,
            ProjectCode: project.value.ProjectCode
        }

        taskClass.updateDueDate({
            commonDateFormatString: dateFormat.value,
            firebaseObj: updateobj,
            project: projectData,
            task: props.task,
            obj: notificationObj,
            userData
        }).then(() => {
            $toast.success(t('Toast.Due_date_updated_successfully'),{position: 'top-right'});
            nextTick(() => {
                isSpinner.value = false;
            });
        }).catch((error) => {
            console.error("ERROR in updateDueDate: ", error);
            $toast.error(t('Toast.Due_date_not_updated'),{position: 'top-right'});
            isSpinner.value = false;
        })
    } catch (error) {
        console.error("ERROR in updateDueDate: ", error);
        $toast.error(t('Toast.Due_date_not_updated'),{position: 'top-right'});
        isSpinner.value = false;
    }
}

const updateStartDate = (event) => {
    try {
        const userData = getUserData();

        const updateobj = {
            startDate: event.dateVal,
        }
        let notificationObj = {
            key: "task_due_date",
            projectId: props.task.ProjectID,
            taskId: props.task._id,
            sprintId: props.task.sprintId
        }
        let obj = {
            'ProjectName' : project.value.ProjectName,
            'TaskName' : props.task.TaskName,
        }
        if(props.task?.startDate) {
            obj.previousDate = changeDateFormate(new Date(props.task?.startDate.seconds * 1000))
            obj.changedDate = changeDateFormate(event.dateVal)
            notificationObj.message = taskDueDateChange(obj);
        } else  {
            obj.lastDate = changeDateFormate(event.dateVal)
            notificationObj.message = taskDueDateAdd(obj);
        }
        const projectData = {
            _id: project.value._id,
            CompanyId: project.value.CompanyId,
            lastTaskId: project.value.lastTaskId,
            ProjectName: project.value.ProjectName,
            ProjectCode: project.value.ProjectCode
        }

        taskClass.updateStartDate({
            commonDateFormatString: dateFormat.value,
            firebaseObj: updateobj,
            project: projectData,
            task: props.task,
            obj: notificationObj,
            userData
        }).then(() => {
            $toast.success(t('Toast.Start_date_updated_successfully'),{position: 'top-right'});
        }).catch((error) => {
            console.error("ERROR in updateStartDate: ", error);
            $toast.error(t('Toast.Start_date_not_updated'),{position: 'top-right'});
        })
    } catch (error) {
        console.error("ERROR in updateStartDate: ", error);
        $toast.error(t('Toast.Start_date_not_updated'),{position: 'top-right'});
    }
}
const updateTotalEstimatedTime = (value) => {
    const userData = getUserData();

    const firebaseObj = {
        'totalEstimatedTime': value
    }
    let obj = {
        'previousEstimatedTime': props.task.totalEstimatedTime,
        'userName' : userData.Employee_Name
    }
    const projectData = {
        _id: project.value._id,
        CompanyId: project.value.CompanyId,
        lastTaskId: project.value.lastTaskId,
        ProjectName: project.value.ProjectName,
        ProjectCode: project.value.ProjectCode
    }

    taskClass.updateTotalEstimatedTime({firebaseObj, projectData, taskData: props.task, obj, userData})
    .then(() => {
        $toast.success(t('Toast.Task_total_estimate_update_succesfull'), {position: "top-right"})
    })
    .catch((err) => {
        console.error(err);
    })
}

const displayTime = (time) => {
  const totalMinutes = time || 0
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`
}

// Manual AI-estimate trigger. Posts to the EstimatedTime route which
// loads the canonical task doc server-side, runs the LLM estimator with
// force=true (so it overwrites any existing value), persists to
// `totalEstimatedTime`, and emits a Socket.io `task` update — so other
// connected clients see the new value without a refresh. We don't need
// to patch local state here because the socket update flows back through
// the same channel that drives `props.task`.
const generateAiEstimate = async () => {
    if (isAiEstimateLoading.value) return;
    const taskId = props.task && props.task._id;
    if (!taskId) {
        $toast.error('Task is not available', { position: 'top-right' });
        return;
    }
    isAiEstimateLoading.value = true;
    try {
        // Send the logged-in user so the estimator can attribute the
        // "updated estimated time" activity-log entry to whoever clicked
        // (and so the required HISTORY.UserId is never blank).
        const userData = getUserData();
        const response = await apiRequest('post', `${env.ESTIMATED_TIME}/ai/${taskId}`, {
            userName: userData.Employee_Name,
            userId: userData.id,
        });
        if (response && response.data && response.data.status) {
            $toast.success('Estimate generated', { position: 'top-right' });
        } else {
            const msg = (response && response.data && response.data.statusText)
                || 'Could not generate estimate';
            $toast.error(msg, { position: 'top-right' });
        }
    } catch (err) {
        const msg = (err && err.response && err.response.data && err.response.data.statusText)
            || (err && err.message)
            || 'Could not generate estimate';
        $toast.error(msg, { position: 'top-right' });
    } finally {
        isAiEstimateLoading.value = false;
    }
}
</script>
<style scoped src='./style.css'>
</style>