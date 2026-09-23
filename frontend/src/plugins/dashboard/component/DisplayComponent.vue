<template>
    <div class="d-flex align-items-center justify-content-between bg-white display__componet-wrapper border-bottom-mobiledrop flex-wrap cursor-pointer p10px-p15px" v-if="taskValue && Object.keys(taskValue).length" @click.stop.prevent="openInNewTab(taskValue)">
        <div class="d-flex align-items-center w-50">
            <div class="d-flex justify-content-between align-items-center" :class="[{'pr-10px' : lable.toLocaleLowerCase() === 'done'}]">
                <span class="position-re ml-5px border-radius-1-px" v-if="lable.toLocaleLowerCase() !== 'done'"   :style="[{'background-color':(allTaskStatusArray && allTaskStatusArray?.settings?.length) ? allTaskStatusArray.settings.find((ut)=> ut.key === taskValue.statusKey)?.textColor : 'black','width':'10px','height':'10px','margin-right': '15px'}]"></span>
                <img v-else :src="greenCheck" class="mr-15px">
            </div>
            <div class="d-flex flex-column text-ellipsis">
                <div v-if="findParticularProject && Object.keys(findParticularProject).length" class="d-flex white align-items-center pb-3px">
                    <span class="text-ellipsis text-capitalize font-weight-400 gray81 font-size-12 d-inline-block" v-if="taskValue.folderObjId && taskValue.folderArray?.name">
                        {{findParticularProject.ProjectName}} /
                        {{taskValue.folderArray?.name}} 
                        / {{taskValue.sprintArray?.name}} {{ taskValue.isParentTask == false ? taskValue.parentTaskName : '' }}
                    </span>
                    <span class="text-ellipsis text-capitalize black font-weight-400 gray81 font-size-12 d-inline-block" v-else-if="taskValue.sprintId && taskValue.sprintArray?.name">
                        {{findParticularProject.ProjectName}} / 
                        {{taskValue.sprintArray?.name}}
                        {{ taskValue.isParentTask == false ? taskValue.parentTaskName : '' }}
                    </span>
                    <span class="text-ellipsis text-capitalize black font-weight-400 gray81 font-size-12 d-inline-block" v-else>
                        {{findParticularProject.ProjectName}}
                    </span>
                </div>
                <div class="d-flex align-items-center text-ellipsis">
                    <img :src="subtask" v-if="!taskValue.isParentTask" class="mr-10px">
                    <span class="text-ellipsis text-capitalize black font-size-16 font-weight-400 d-inline-block pr-10px" :title="taskValue.TaskName">{{ taskValue.TaskName }}</span>
                </div>
            </div>
        </div>
        <div class="d-flex align-items-center justify-content-end priority__component--wrapper w-50">
            <div @click.stop.prevent>
                <DueDateCompo
                    :ref="dueDateComp" 
                    id="due-date-home"
                    :allowTillCurrentDate="true"
                    :displyDate="taskValue.DueDate"
                    @SelectedDate="($event) => updateDueDate($event)"
                    :position="`right`"
                    :autoposition="false"
                    v-if="checkPermission('task.task_due_date') === true && checkPermission('task.task_list') == true"
                />
                <template v-else>
                    <span v-if="taskValue.DueDate">{{convertDateFormat(taskValue.DueDate,'',{showDayName:false})}}</span>
                    <span v-else>{{ $t('ProjectDetails.no_due_date') }}</span>
                </template>
            </div>
            <div @click.stop.prevent v-if="checkApps('Priority',project)">
                <Priority
                    :priorityVal="priorityValue"
                    @select="updatePriority($event)"
                    class="ml-10px"
                    :permission="checkPermission('task.task_priority') === true"
                />
            </div>
        </div>
    </div>
</template>
<script setup>
import { ref,defineProps,computed,inject,defineEmits, watch } from "vue";
import Priority from "@/components/molecules/PriorityCompo/PriorityComp.vue"
import DueDateCompo from '@/components/molecules/DueDateCompo/DueDateCompo.vue';
import { taskDueDateAdd, taskDueDateChange } from "@/utils/NotificationTemplate";
import { useGetterFunctions , useMoment} from '@/composable'
import { useCustomComposable } from '@/composable';
import {useConvertDate} from '@/composable/index';
import taskClass from "@/utils/TaskOperations";
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { useI18n } from "vue-i18n";
const { t } = useI18n();
const $toast = useToast();
const emit = defineEmits([
    'dataToParent',
    'openTaskDetailSidebar'
])
const {changeDateFormate} = useMoment()
const dateFormat = inject('$dateFormat');
const { checkPermission, getWasabiImageLink, checkApps} = useCustomComposable();
const { getUser, getPriority } = useGetterFunctions();
const { getters } = useStore();
const userId = inject('$userId');
const companyOwner = computed(() => {
    return getters["settings/companyOwnerDetail"];
});

const TaskStatusArray = computed(() => getters["settings/AllTaskStatus"]);
const {convertDateFormat} = useConvertDate();
const dueDateComp = ref('');
const allTaskStatusArray = ref(JSON.parse(JSON.stringify(TaskStatusArray.value)));
const subtask = require ('@/assets/images/svg/subtaskicon.svg')
const greenCheck = require("@/assets/images/svg/green_check.svg");
// const dragIcon = require("@/assets/images/svg/Swip.svg");
const props = defineProps({
    taskObj : {type:Object,required:true},
    lable : {type:String,default: ''},
    findParticularProject: {
        type:Object,
        default: ()=>{}
    },
    separateArrays : {type:Object,required:true},
})
const project = ref(JSON.parse(JSON.stringify(props.findParticularProject)));
function getUserData() {
    const user = getUser(userId.value);
    return {
        id: user._id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: companyOwner.value.userId,
    };
}

const taskValue = ref(props.taskObj);
const priorityValue = ref(taskValue.value.Task_Priority);
watch(() => props.taskObj,(val)=>{
    taskValue.value = val;
})
const updatePriority = async(val) => {
    try {
        const userData = getUserData();

        let updateObj = {
            Task_Priority : val.value,
            Updated_At: new Date()
        }

        let projectData = {
            '_id': project.value._id ? project.value._id : "",
            'ProjectName' : project.value.ProjectName,
            "CompanyId": project.value.CompanyId,
        }

        const priority = getPriority(taskValue.value.Task_Priority)

        let priorityObj = {
            'statusImage' : await getWasabiImageLink(project.value.CompanyId,priority.image),
            'priorityName' : priority.name,
            'taskId': taskValue.value._id,
            'taskName': taskValue.value.TaskName,
            'userName' : userData.Employee_Name,
            'newStatusImage' : await getWasabiImageLink(project.value.CompanyId,val.statusImage),
            'newPriorityName' : val.name
        }
        taskClass.updatePriority({firebaseObj: updateObj, projectData: projectData, taskData: taskValue.value, priorityObj, userData})
        .then(() => {
            priorityValue.value = val.value;
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
const updateDueDate = (event) => {
    try {
        const userData = getUserData();
        let oldDate = taskValue.value.DueDate

        let newdueDateDeadLine = [];
        if(taskValue.value.dueDateDeadLine.length > 0) {
            taskValue.value.dueDateDeadLine.forEach((date) => {
                newdueDateDeadLine.push({ date: new Date(date) })
            })
            newdueDateDeadLine.push({ date: new Date(event.dateVal)});
        } else {
            newdueDateDeadLine.push({ date: new Date(event.dateVal)});
        }
        let typesenseDeadLine = JSON.parse(JSON.stringify(newdueDateDeadLine));
        typesenseDeadLine.forEach(day => {
            day.date = new Date(day.date)
        })
        const updateobj = {
            DueDate: new Date(event.dateVal),
            dueDateDeadLine: newdueDateDeadLine
        }
        const typesensObj = {
            DueDate: new Date(event.dateVal),
            dueDateDeadLine: typesenseDeadLine
        }
        let notificationObj = {
            key: "task_due_date",
            projectId: taskValue.value.ProjectID,
            taskId: taskValue.value._id,
            sprintId: taskValue.value.sprintId
        }
        let obj = {
            'ProjectName' : project.value.ProjectName,
            'TaskName' : taskValue.value.TaskName,
        }
        if(taskValue.value.dueDateDeadLine.length > 0 ) {
            obj.previousDate = changeDateFormate(new Date(taskValue.value.dueDateDeadLine[taskValue.value.dueDateDeadLine.length - 1]))
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
            typesenseObj: typesensObj,
            project: projectData,
            task: taskValue.value,
            obj: notificationObj,
            userData
        }).then(() => {
            $toast.success(t(`Toast.Due_date_updated_successfully`), {position: "top-right"})
            emit('dataToParent', event.dateVal,{...taskValue.value,...typesensObj},oldDate);
        }).catch((error) => {
            console.error("ERROR in updateDueDate: ", error);
        })
    } catch (error) {
        console.error("ERROR in updateDueDate: ", error);
    }
}
const openInNewTab = (task) => {
    emit('openTaskDetailSidebar',task)
};
</script>
<style scoped src="../css/style.css"></style>