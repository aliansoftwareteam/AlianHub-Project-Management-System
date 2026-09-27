<template>
    <div class="main__labled-component pt-20px">
        <div v-if="!hideLable" class="d-flex align-items-center flex-row justify-content-between mb-10px">
        <div class="d-flex align-items-center flex-row justify-content-start" >
            <div class="is__expanded-droparrow"  @click="isExpanded = !isExpanded">
                <img :src="dropdownArrow" alt="" class="cursor-pointer drop__down-arrow" :style="`transform: rotateZ(${isExpanded ? 90 : 0}deg);`">
            </div>
            <h3 class="font-size-14 font-weight-500 m-0 pl-20px dark-gray">{{lable}} <span class="font-size-13 font-weight-400 GunPowder" v-if="taskCount !== 0">({{ taskCount }})</span></h3>
        </div>
        <div class="d-flex" v-if="lable.toLowerCase() == 'overdue' || lable.toLowerCase() == 'next' || lable.toLowerCase() == 'done'"> 
            <button class="btn__task ml-10px border-radius-4-px black font-weight-400 border-0 font-size-12 cursor-pointer bg-colorlightgray mr-2px vertical-middle"  @click="sortArray(sortingVal)">
                <img :src="dueDateArrow" :style="`transform: rotateZ(${sortingVal == -1 ? 180 : 0}deg);`" alt="" class="cursor-pointer pr-3px" /> {{$t('Home.Due_Date')}} </button>
        </div>
        </div>
        <div v-else class="d-flex flex-row justify-content-start">
            <h3 class="font-size-14 font-weight-500 m-0 pb-10px">{{lable}}</h3>
        </div>
        <template v-if="isFetching && isExpanded == true">
            <div class="overflow-y-auto overflow-x-hidden overflow-scroll border-radius-3-px mywork__taskstatus-wrapper">
                <Skelaton v-for="i in (currentCountValue >= 5 ? 5 : currentCountValue !== 0 ? currentCountValue : 1)" :key="i" :class="'d-flex align-items-center justify-content-between bg-white display__componet-wrapper border-bottom-mobiledrop flex-wrap cursor-pointer ml-15px p10px-p15px h-50-px'"/>
            </div>
        </template>
        <template v-else>
        <Transition>
            <div v-if="isExpanded" class="overflow-y-auto overflow-x-hidden overflow-scroll border-radius-3-px mywork__taskstatus-wrapper"  @scroll="onScroll">
                <TransitionGroup name="listlablemain" appear tag="div">
                    <draggable
                        v-if="taskArrayValue.length !== 0 || isDragValue == true"
                        :list="taskArrayValue"
                        handle=".draggable_icon_home"
                        :key="'draggable-' + lable"
                        group="tasksarrayhome"
                        item-key="id"
                        @change="draggabledDataManagage($event,lable)"
                        @end="dragFunction(false)"
                        @start="dragFunction(true)"
                        :options="{ scroll: true }"
                    >
                        <template #item="{ element }">
                            <div :key="`${element._id}`">
                                <DisplayComponent
                                    :key="element._id"
                                    :separateArrays="separateArrays"
                                    :lable="lable"
                                    :findParticularProject="findParticularProject(element.ProjectID)"
                                    :taskObj="element"
                                    @dataToParent="handleDataFromChild"
                                    @openTaskDetailSidebar="sidebarDataMange"
                                />
                            </div>
                        </template>
                    </draggable>
                    <div :key="`no-task-message-${lable}`" v-if="(!taskArrayValue || (taskArrayValue && taskArrayValue.length == 0)) && !isLoading" class="d-flex justify-content-between font-weight-400 justify-content-center align-items-center bg-white p-10px gray81 font-ui font-size-12 ml-15px no__task-msg">
                     {{$t('Home.no')}} {{ `${lable.toLowerCase()}`}} {{  $t('Home.task_assign_to_you')   }}
                    </div>
                </TransitionGroup>
            </div>
        </Transition>
        </template>
    </div>
</template>
<script setup>
import { ref,defineProps,defineEmits, computed,inject, watch} from 'vue';
import draggable from 'vuedraggable';
import { useGetterFunctions,useMoment } from '@/composable'
import { taskDueDateAdd, taskDueDateChange } from "@/utils/NotificationTemplate";
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import taskClass from "@/utils/TaskOperations";
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue"
import { useI18n } from "vue-i18n";
const { t } = useI18n();

const $toast = useToast();
const { getters } = useStore();
const companyOwner = computed(() => {
    return getters["settings/companyOwnerDetail"];
});
const { getUser } = useGetterFunctions();
const {changeDateFormate} = useMoment()
const dateFormat = inject('$dateFormat');
const userId = inject('$userId');
const dragFunction = inject('dragFunction');
function getUserData() {
    const user = getUser(userId.value);
    return {
        id: user._id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: companyOwner.value.userId,
    };
}

const props = defineProps({
    allProjectsArray : {type:Array,required:true},
    taskArray : {type:Array,required:true, default: () => []},
    separateArrays : {type:Object,required:true},
    lable:{type:String,default:''},
    totalTask:{type:Number,default:0},
    hideLable:{type:Boolean,default:false},
    isLoading:{type:Boolean,default:false},
    isFetching:{type:Boolean,default:false},
    isDragValue:{type:Boolean,default:false},
});
const emit = defineEmits([
    'update:dataToGrandparent',
    'dataToGrandparentScrool',
    'update:dateSort',
    'openTaskDetailSidebar',
    'openTaskDetail'
])

const isExpanded = ref(true)
const allProjectsArray = ref(props.allProjectsArray);
const timer = ref(null);
const taskCount = computed(()=>{return props.totalTask})
const sortingVal = ref((props.lable == 'Overdue' || props.lable == 'Done') ? -1 : props.lable == 'Next' ? 1 : 1);

const taskArrayValue = computed(()=>{return JSON.parse(JSON.stringify(props.taskArray))})
const currentCountValue = ref(props.totalTask || 1);
watch(taskCount,(newVal,oldvalue)=>{
    if (oldvalue !== newVal && newVal !== 0) {
        currentCountValue.value = newVal;
    } else if (newVal === 0) {
        currentCountValue.value = oldvalue;
    }
})
const dueDateArrow = require('@/assets/images/up_duedate_arrow.svg');
const dropdownArrow = require('@/assets/images/svg/triangleBlack.svg');
const findParticularProject = (id) => allProjectsArray.value.find((xt) => xt._id === id) || {};

const onScroll = (e) => {
    debouncer(50).then(() => {
        if (e.target.scrollTop >= (e.target.scrollHeight - e.target.clientHeight) - 200) {
            emit('dataToGrandparentScrool',props.lable,sortingVal.value);
        }
    })
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
function sortArray(value) {
    if(value == -1) {
        sortingVal.value = 1;
    } else if(value == 1) {
        sortingVal.value = -1;
    }
    emit('update:dateSort',props.lable,sortingVal.value);
}
function handleDataFromChild(data,taskId,oldDate) {
    emit('update:dataToGrandparent',data,taskId,props.lable,sortingVal.value,oldDate);
}

const draggabledDataManagage = (event,taskLable) => {
    if (event.added?.element) {
        updateDueDate(event.added.element,taskLable)
    }
}
const addOrSubtractDaysFromToday =(daysToAddOrSubtract) => {
    const newDate = new Date();
    newDate.setDate(newDate.getDate() + daysToAddOrSubtract);
    return newDate;
}
const updateDueDate = (dataObject,lable) => {
    try {
        let oldDueDate = JSON.parse(JSON.stringify(dataObject)).DueDate;
        let dateVal = null;
        if(lable.toLowerCase() == 'today') {
            dateVal = new Date();
        } else if(lable.toLowerCase() == 'overdue') {
            dateVal = addOrSubtractDaysFromToday(-1);
        } else if(lable.toLowerCase() == 'next') {
            dateVal = addOrSubtractDaysFromToday(1);
        } else if(lable.toLowerCase() == 'unscheduled') {
            dateVal = null;
        }
        const userData = getUserData();

        let newdueDateDeadLine = [];
        if(dataObject.dueDateDeadLine.length > 0) {
            dataObject.dueDateDeadLine.forEach((date) => {
                newdueDateDeadLine.push({ date: new Date(date) })
            })
            if(dateVal !== null){
                newdueDateDeadLine.push({ date: dateVal});
            }
        } else {
            if(dateVal !== null){
                newdueDateDeadLine.push({ date: dateVal});
            }else{
                newdueDateDeadLine = [];
            }
        }
        let typesenseDeadLine = JSON.parse(JSON.stringify(newdueDateDeadLine));
        typesenseDeadLine.forEach(day => {
            day.date = new Date(day.date)
        })
        const updateobj = {
            DueDate: dateVal,
            dueDateDeadLine: newdueDateDeadLine
        }
        const typesensObj = {
            DueDate: dateVal,
            dueDateDeadLine: typesenseDeadLine
        }
        let notificationObj = {
            key: "task_due_date",
            projectId: dataObject.ProjectID,
            taskId: dataObject._id,
            sprintId: dataObject.sprintId
        }
        let obj = {
            'ProjectName' : findParticularProject(dataObject.ProjectID).ProjectName,
            'TaskName' : dataObject.TaskName,
        }
        if(dataObject.dueDateDeadLine.length > 0 ) {
            obj.previousDate = changeDateFormate(new Date(dataObject.dueDateDeadLine[dataObject.dueDateDeadLine.length - 1]))
            obj.changedDate = changeDateFormate(dateVal)
            notificationObj.message = taskDueDateChange(obj);
        } else  {
            obj.lastDate = changeDateFormate(dateVal)
            notificationObj.message = taskDueDateAdd(obj);
        }
        const projectData = {
            _id: findParticularProject(dataObject.ProjectID)._id,
            CompanyId: findParticularProject(dataObject.ProjectID).CompanyId,
            lastTaskId: findParticularProject(dataObject.ProjectID).lastTaskId,
            ProjectName: findParticularProject(dataObject.ProjectID).ProjectName,
            ProjectCode: findParticularProject(dataObject.ProjectID).ProjectCode
        }
        emit('update:dataToGrandparent',dateVal,{...dataObject,...typesensObj},lable,sortingVal.value,oldDueDate);
        taskClass.updateDueDate({
            commonDateFormatString: dateFormat.value,
            firebaseObj: updateobj,
            typesenseObj: typesensObj,
            project: projectData,
            task: dataObject,
            obj: notificationObj,
            userData
        }).then(() => {
            $toast.success(t(`Toast.Due_date_updated_successfully`), {position: "top-right"})
            let findIndex = taskArrayValue.value.findIndex((ele)=>{return ele._id === dataObject._id})
            if(findIndex !== -1) {
                taskArrayValue.value.splice(findIndex,1)
            }
        }).catch((error) => {
            console.error("ERROR in updateDueDate: ", error);
        })
    } catch (error) {
        console.error("ERROR in updateDueDate: ", error);
    }
}
function sidebarDataMange(taskObj) {
    emit('openTaskDetail',taskObj);
}
</script>
<style>
.listlablemain-move,
.listlablemain-enter-active,
.listlablemain-leave-active {
  transition: opacity 0.30s ease;
}
.drop__down-arrow{
    vertical-align:middle;
    transition: all 0.35s;
}
.is__expanded-droparrow{
    min-width: 5px;
    left: 10px;
}
.btn__task{
    opacity: 0.6;
    padding : 4px 14px 2px;
    line-height: 18px;
}
.no__task-msg{
    height: 38px;
}
.mywork__taskstatus-wrapper{
    max-height: 314px;
    filter: drop-shadow(0px 1px 8px rgba(0, 0, 0, 0.10));
}
.h-50-px {
    height: 63px !important;
}
</style>