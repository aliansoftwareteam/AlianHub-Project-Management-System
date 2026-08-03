<template>
    <div :style="`${considerWidth && containerWidth ? `width: calc(${containerWidth} - 25px);` : ''}`" class="d-flex justify-content-between border-primary mb-1 border-radius-5-px create__task-div" id="createtaskinput_driver">
        <template v-if="sprint && Object.keys(sprint).length">
           <div :class="`d-flex align-items-center position-re ${clientWidth > 412 ? 'task-create-width' : 'w-100'}`">
                <TaskType
                    :tourId="'createtaskstatus_driver'"
                    :id="sprint.id+taskId+'create_taskType'"
                    v-model="taskType"
                    :options="taskTypes"
                />
                <InputText
                    v-model="taskName.value"
                    :placeHolder="$t('PlaceHolder.Task_name')"
                    class="border-0 create__task-inputtext"
                    :maxLength="250"
                    :minLength="3"
                    :isOutline="false"
                    @enter="saveTask()"
                    :isDirectFocus="true"
                    @keyup="checkErrors({'field':taskName,
                    'name':taskName.name,
                    'validations':taskName.rules,
                    'type':taskName.type,
                    'event':$event.event})"
                />
                <div v-if="save" class="red position-ab z-index-1 save__error" :style="[{fontSize : clientWidth > 480 ? '11px' : '10px', left : clientWidth > 480 ? '30px' : '0px',width : clientWidth > 480 ? '100%' : '320px'},]">{{taskName.error}}</div>
            </div>
            <div :class="`d-flex align-items-center ${clientWidth > 412 ? '' : 'justify-content-between'}`">
                <!-- checklist -->

                <!-- <img style="margin-right: 5px;" :src="checklist" class="cursor-pointer" alt="dateImage"/> -->

                <!-- ASSIGNEE -->
                <div class="d-flex align-items-center">
                    <Assignee
                        :tourId="'createtaskassignee_driver'"
                        :users="assignee"
                        :options="checkPermission('task.task_assignee',project.isGlobalPermission) === true ? assigneeOptions : assigneeOptions.filter((x) => x === userId)"
                        :num-of-users="3"
                        @selected="changeAssignee(checkApps('MultipleAssignees',project) ? 'add' : 'replace', $event)"
                        @removed="changeAssignee('remove', $event)"
                        imageWidth="25px"
                        class="mr-5px"
                        :isDisplayTeam="true"
                        :multiSelect="checkApps('MultipleAssignees')"
                    />
    
                    <!-- DUE DATE -->
                    <DueDateCompo
                        :tourId="'createtaskduedate_driver'"
                        v-if="$route?.query?.tab !== 'Calendar'"
                        id="due-date-task"
                        :allowTillCurrentDate="true"
                        :displyDate="dueDate"
                        @SelectedDate="dueDate = $event?.dateVal"
                        :position="`right`"
                    />
    
                    <!-- PRIORITY -->
                    <Priority
                        :tourId="'createtaskpriority_driver'"
                        :priorityVal="priority"
                        @select="changePriority"
                        class="ml-5px"
                    />
                </div>

                <!-- SAVE CLOSE -->
                <div class="d-flex align-items-center">
                    <button class="btn-primary save__btn-primary ml-10px p0x-10px"  @click.stop.prevent="saveTask()">{{$t("Projects.save")}}</button>
                    <img :src="closeRedIcon" alt="closeRedIcon" :class="`cursor-pointer ${clientWidth > 412 ? 'm-10px' : 'ml-10px'}`" @click.stop.prevent="$emit('cancel')">
                </div>
            </div>
        </template>
        <template v-else>
            <span class="red">SPRINT DATA REQUIRED</span>
        </template>
    </div>
</template>

<script setup>
// PACKAGES
import { ref, defineProps, defineEmits, onMounted, inject, computed, onBeforeUnmount, watch } from "vue";
import { useStore } from "vuex";

// COMPONENTS
import DueDateCompo from '@/components/molecules/DueDateCompo/DueDateCompo.vue';
import Assignee from "@/components/molecules/Assignee/Assignee.vue"
import InputText from "@/components/atom/InputText/InputText.vue"
import Priority from "@/components/molecules/PriorityCompo/PriorityComp.vue"
import TaskType from "@/components/atom/TaskType/TaskType.vue"
import { useI18n } from "vue-i18n";
const { t } = useI18n();

// UTILS
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { taskPlanPermission } from "@/composable/commonFunction";
import taskClass from "@/utils/TaskOperations"
const projectRef = inject("selectedProject");
import { useValidation } from "@/composable/Validation";
import { useToast } from "vue-toast-notification";
const clientWidth = inject("$clientWidth");
const companyId = inject("$companyId");
const $toast = useToast()
const {getUser} = useGetterFunctions()
const userId = inject("$userId")
const {getters, commit} = useStore();
const {checkPermission, checkApps} = useCustomComposable();
const  { checkErrors , checkAllFields } = useValidation();
const { checkTaskPerSprintPermisssion } = taskPlanPermission();

// IMAGES
const closeRedIcon = require("@/assets/images/svg/closeBlack.svg");
// PROPS
const props = defineProps({
    sprint: {
        type: Object,
        required: true
    },
    taskId: {
        type: String,
        default: ""
    },
    groupBy: {
        type: Number,
        default: 1
    },
    assigneeOptions: {
        type: Array,
        default: () => []
    },
    projectProp: {
        type: Object,
        default: null
    },
    // Pre-fill the creator as assignee when the inline task row opens. Defaults
    // to true so a new task is self-assigned instead of starting unassigned;
    // pass false to opt a call site out.
    addDefaultAssignee: {
        type: Boolean,
        default: true
    },
    startDate: {
        type: Date
    },
    endDate: {
        type: Date
    },
    groupType:{
        type: Number,
        default: null
    },
    considerWidth:{
        type: Boolean,
        default: true
    }
})
// EMITS
const emits = defineEmits(["cancel", "submit"]);
const companyOwner = computed(() => {
    return getters["settings/companyOwnerDetail"];
})

const taskName = ref({
    value: "",
    rules:
    "required | min: 3",
    name: "name",
    error: "",
});
const taskType = ref({});
const taskTypes = computed(() => project.value.taskTypeCounts)
const status = ref({});
const containerWidth = ref(0);
const save = ref(false);
const dueDate = ref("");
const priority = ref("MEDIUM");
const assignee = ref([]);
const project = computed(() => {
    if(props.projectProp) {
        return props.projectProp;
    } else {
        return projectRef.value;
    }
})

watch(clientWidth, () => {
    const element = document.querySelector(".itemSprintWrapper");

    if(props.taskId) {
        containerWidth.value = `${element?.clientWidth}px`;
    } else {
        containerWidth.value = "";
    }
}, {immediate: true});

onMounted(() => {
    // SELECT DEFAULT TASK TYPE
    const taskTypeIndex = taskTypes.value && taskTypes.value.length ? 0 : -1
    if(taskTypeIndex !== -1) {
        taskType.value = taskTypes.value[taskTypeIndex]
    }

    // SELECT DEFAULT STATUS
    let statusIndex = project?.value?.taskStatusData && project?.value?.taskStatusData.length ? project?.value?.taskStatusData.findIndex((x) => x.type === "default_active") : -1
    if(statusIndex !== -1) {
        status.value = project?.value.taskStatusData[statusIndex];
    }

    if(props.addDefaultAssignee) {
        assignee.value.push(userId.value);
    }
})

function changePriority(val) {
    priority.value = val.value
}

function changeAssignee(type, user) {
    if(type === "add") {
        assignee.value.push(user.id)
    } else if(type === 'remove') {
        const userIndex = assignee.value.findIndex((x) => x === user.id);

        if(userIndex !== -1) {
            assignee.value.splice(userIndex, 1);
        }
    } else if(type === 'replace') {
        assignee.value = [];
        assignee.value.push(user.id);
    }
}

function resetTaskFields() {
    dueDate.value = "";
    taskName.value.value = "";
    taskName.value.error = "";
    priority.value = "MEDIUM";
    assignee.value = [];
}

function saveTask() {
    save.value = true;
    checkAllFields({taskName: taskName.value}).then((valid)=>{
        if(valid){
            checkTaskPerSprintPermisssion(props.sprint.id).then((resp) => {
                if(resp){
                    save.value = false;
                    if(taskName.value.value.trim().length < 3 || taskName.value.value.trim().length > 250) return;
        
                    const name = taskName.value.value.trim();

                    const user = getUser(userId.value)

                    const userData = {
                        id: user.id,
                        Employee_Name: user.Employee_Name,
                        companyOwnerId: companyOwner.value.userId,
                    }

                    let sprintObj = {
                        id: props.sprint.id,
                        name: props.sprint.name,
                        value: props.sprint.value
                    }

                    if(props.sprint.folderId) {
                        sprintObj.folderId = props.sprint.folderId;
                        sprintObj.folderName = props.sprint.folderName;
                    }

                    let obj = {
                        'TaskName': name,
                        'TaskKey': '-',
                        'AssigneeUserId': assignee.value,
                        'watchers': [...assignee.value, userId.value],
                        'DueDate': new Date(props.endDate ? props.endDate : dueDate.value),
                        'dueDateDeadLine': [],
                        'TaskType': taskType.value.value,
                        'TaskTypeKey': taskType.value.key,
                        'ParentTaskId': props.taskId,
                        'ProjectID': project.value._id,
                        'CompanyId': companyId.value,
                        'status': {
                            "text": status.value.name,
                            "key": status.value.key,
                            "value": status.value.value,
                            'type': status.value.type
                        },
                        'isParentTask': props.taskId === "",
                        'Task_Leader': userId.value,
                        'sprintArray': sprintObj,
                        'Task_Priority': priority.value,
                        'deletedStatusKey': 0,
                        'sprintId': props.sprint.id,
                        'statusType': status.value.type,
                        'statusKey': status.value.key,
                    }
                    if(props.sprint.folderId) {
                        obj.folderObjId = props.sprint.folderId;
                    }
                    if (props.startDate) {
                        obj.startDate = new Date(props.startDate)
                    }
                    const projectData = {
                        _id: project.value._id,
                        CompanyId: project.value.CompanyId,
                        lastTaskId: project.value.lastTaskId,
                        ProjectName: project.value.ProjectName,
                        ProjectCode: project.value.ProjectCode
                    }

                    let indexObj
                    if (props.taskId === "") {
                        if(props?.groupType){
                            if (props.groupType === 1){
                                indexObj = {
                                    indexName : "groupByStatusIndex",
                                    searchKey : "statusKey",
                                    searchValue : 1
                                }
                            }else if (props.groupType === 2){
                                let find = props.sprint.items.find(e => e.value === priority.value)
                                if(find){
                                    indexObj = {
                                        indexName : find.indexName,
                                        searchKey : find.searchKey,
                                        searchValue : find.searchValue
                                    }
                                }else{
                                    indexObj = {
                                        indexName : "groupByStatusIndex",
                                        searchKey : "statusKey",
                                        searchValue : 1
                                    }
                                }
                            }else if (props.groupType === 3){
                                const dueDateValue = dueDate.value ? dueDate.value : '';
                                const time = dueDateValue ? new Date(dueDateValue).setHours(0,0,0,0)/1000 : 0;
                                props.sprint.items.some(element => {
                                    if (element.searchValue === time) {
                                        indexObj = {
                                            indexName: element.indexName,
                                            searchKey: element.searchKey,
                                            searchValue: element.searchValue
                                        };
                                        return true; // break the loop
                                    } else if (element.searchValue > time && element.operation === 'lt' && time !== 0) {  
                                        indexObj = {
                                            indexName: element.indexName,
                                            searchKey: element.searchKey,
                                            searchValue: element.searchValue
                                        };
                                        return true; // break the loop
                                    } else if (element.searchValue < time && element.operation === 'gt' && time !== 0) {
                                        indexObj = {
                                            indexName: element.indexName,
                                            searchKey: element.searchKey,
                                            searchValue: element.searchValue
                                        };
                                        return true; // break the loop
                                    }
                                });
                            }
                        }else{
                            indexObj = {
                                indexName : "groupByStatusIndex",
                                searchKey : "statusKey",
                                searchValue : 1
                            }
                        }
                    }
                    if(!indexObj){
                        indexObj = {
                            indexName: "groupByStatusIndex",
                            searchKey: "statusKey",
                            searchValue: 1
                        };
                    }
                    resetTaskFields();
                    taskClass.create({data: obj, user: userData, projectData, indexObj, groupBy: props.groupBy})
                    .then((data) => {
                        if(data.status){
                            let sprint = {};
                            if(props.sprint.folderId) {
                                sprint = project.value?.sprintsfolders?.[props.sprint.folderId]?.sprintsObj?.[props.sprint.id];
                            }else{
                                sprint = project.value?.sprintsObj[props.sprint.id];
                            }
                            sprint.tasks = sprint.tasks + 1;
                            commit("projectData/mutateSprints",{op:'modified',data:{...sprint}});
                            $toast.success(t('Toast.task_created_successfully'), {position: "top-right"});
                            emits('submit', {data: {...obj, _id: data.id}})
                        }else if(data.isUpgrade){
                            $toast.error(t('Toast.create_task_plan_limit_message').replace('TASK_SPRINT', props.sprint.name), {position: "top-right"});
                        }else{
                            $toast.error(t('Toast.something_went_wrong'), {position: "top-right"});
                        }
                    })
                    .catch((error) => {
                        console.error("ERROR in create task: ", error);
                    })
                }else{
                    $toast.error(t('Toast.create_task_plan_limit_message').replace('TASK_SPRINT', props.sprint.name), {position: "top-right"});
                }
            })
        }
    })
    .catch((error)=>{
        console.error("ERROR in creat task: ", error);
    })
}
onBeforeUnmount(() => {
    resetTaskFields()
})
</script>

<style scoped>
input#inputId::placeholder {
    color: #959595;
    font-size: 12px;
    font-weight: 400;
    text-transform: capitalize;
}
.create__task-div{
    height: 34px;
    padding: 0px 10px 0px 0px;
}
.save__error{
    bottom: -15px;
}
.save__btn-primary{
    height: 25px !important;
}
.create__task-inputtext{
    height: 28px !important;
}
.task-create-width {
    width: calc(100% - 250px);
}
@media(max-width: 412px){
    .create__task-div {
        flex-direction: column;
        height: 80px;
        padding: 5px 10px;
    }
}
</style>