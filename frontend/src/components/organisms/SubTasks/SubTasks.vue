<template>
    <div>
        <!-- <div class="d-flex align-items-center justify-content-between">
            <h4 class="task-details-subtitle"></h4>
            <img :src="addIcon" alt="addIcon" class="cursor-pointer" @click="createSubTask = true">
        </div> -->
        <div class="overflow-auto style-scroll mobile__bg--withPadding mt-10px">
            <div class="w-100 d-flex align-items-center justify-content-between">
                <div class="d-flex align-items-center">
                    <span :class="{'font-size-16 font-weight-600' : clientWidth <= 767 , 'font-size-14 font-weight-700' : clientWidth > 767 }" class="font-weight-700 font-size-14">{{$t('ProjectDetails.subtask')}}</span>
                    <!-- Subtask completion badge (AHE-3776): % of subtasks done, with a
                         mini progress bar and done/total count, right above the list. -->
                    <SubtaskProgressBadge
                        v-if="subtaskCompletion && subtaskCompletion.total"
                        :completed="subtaskCompletion.completed"
                        :total="subtaskCompletion.total"
                        variant="bar"
                        class="ml-10px"
                    />
                </div>
                <div class="d-flex align-items-center">
                    <div class="d-flex align-items-center" @click="sugestSubTask()" v-if="checkApps('AI',project) && checkPermission('task.sub_task_create',project?.isGlobalPermission) === true">
                        <img :src="aiIcon" class="mr-3px" />
                        <span class="font-size-14 font-weight-500 cursor-pointer ai-color ai-border-bottom" :class="[{'pointer-event-none' : isSpinnerSuggest}]">{{$t('AI.suggest_subtasks')}}</span>
                    </div>
                    <span v-if="checkPermission('task.sub_task_create',project?.isGlobalPermission) === true" @click="createSubTask = true" class="blue font-size-14 font-weight-500 cursor-pointer pl-20px text-decoration-underline">+ {{$t('Projects.add_subtask')}}</span>
                </div>
            </div>
            <div class="d-flex p-1 position-re subtask-mobile-width subtask__wrapper pl-0"  v-if="clientWidth > 767">
                <div class="d-flex align-items-center justify-content-between subtask__title w-100">
                    <span class="font-size-12 font-weight-500 gray81">{{$t('Members.name')}}</span>
                    <!-- <span :class="{'font-size-16 font-weight-600' : clientWidth <=767 , 'font-size-14 font-weight-700' : clientWidth > 767 }" class="font-weight-700 font-size-14">Subtask</span> -->
                    <!-- ({{task.subTasks || 0}}) -->
                </div>
                <div class="d-flex align-items-center justify-content-between table-span-wrapper w-100">
                    <span class="font-size-12 font-weight-500 gray81">{{$t('Header.Chat')}}</span>
                    <span class="font-size-12 font-weight-500 gray81" v-if="checkPermission('task.task_assignee',project?.isGlobalPermission) !== null">{{$t('ProjectDetails.assignee')}}</span>
                    <span class="font-size-12 font-weight-500 gray81" v-if="checkPermission('task.task_due_date',project?.isGlobalPermission) !== null">{{$t('Projects.due_date')}}</span>
                    <span class="font-size-12 font-weight-500 gray81" v-if="checkPermission('task.task_priority',project?.isGlobalPermission) !== null && checkApps('Priority')">{{$t('Projects.priority')}}</span>
                    <span class="font-size-12 font-weight-500 gray81" v-if="checkPermission('task.task_status',project?.isGlobalPermission) !== null">{{$t('Projects.status')}}</span>
                    <!-- <img v-if="checkPermission('task.sub_task_create',project?.isGlobalPermission) === true" :src="addIcon" alt="addIcon" class="cursor-pointer add_subtask_list position-ab" @click="createSubTask = true"> -->
                </div>
            </div>
            <template v-if="isMainSpinner">
                <Skelaton v-for="(item, index) in 4" :key="index" :class="['border-radius-5-px border-bottom border-right border-left px-1 subtask__item-input',{ 'border-top': index === 0 }]" />
            </template>
            <template v-else>
                <div v-if="(task.deletedStatusKey === 0 || task.deletedStatusKey === undefined) && subTasks.length > 0"
                    class="overflow-y-auto style-scroll border-bottom subtask-mobile-width sub__task-item"
                    @scroll="onScroll"
                    :style="`min-width: ${clientWidth <= 767 ? '0' : ''};`"
                    :class="{'mt-15px' : clientWidth <= 767  }"
                >
                    <SubTaskItem
                        v-for="(subTask) in subTasks" :key="'taskdetail-'+subTask._id"
                        class="d-flex align-items-center justify-content-between px-1 border-bottom subtask__item-input"
                        :task="subTask"
                        :project="project"
                        :parentAssignee="parentAssignee"
                    />
                </div>
                <div v-else class="red text-center font-size-11 py-10px">
                    {{$t('Projects.no_sub_tasks_found')}}
                </div>
                <div v-if="subTasksList && subTasksList.length" class="ai-generate-subtask-div">
                    <div v-for="(sub,index) in subTasksList" :key="index" class="border-bottom px-1 subtask__item-input d-flex align-items-center">
                        <img :src="aiIcon" class="mr-3px" />
                        <label class="d-flex align-items-center font-weight-400 font-size-13">
                            {{sub.title}}
                        </label>
                        <input type="checkbox" v-model="sub.isSelected" @click="handleChecked(sub)" class="ml-auto" />
                    </div>
                    <div class="d-flex justify-content-end pt-15px">
                        <button v-if="subTasksList.length" class="outline-primary mr-10-px font-size-16 font-weight-400" @click="subTasksList = []">{{$t('Projects.cancel')}}</button>
                        <button v-if="subTasksList.filter((x) => x.isSelected===true).length" class="btn-primary mr-10-px font-size-16 font-weight-400" @click="createSubTasks()">{{`${$t('general.Create')} ${subTasksList.filter((x) => x.isSelected===true).length} ${$t('ProjectDetails.subtask')}`}}</button>
                    </div>
                </div>
                <div v-if="isSpinnerSuggest">
                    <Skelaton v-for="i in 4" :key="i" class="border-radius-5-px m-5px border-bottom border-right border-left px-1 subtask__item-input"/>
                </div>
                <span v-if="isError" class="red">{{$t('Toast.something_went_wrong')}}</span>
            </template>
        </div>
        <CreateTask
            v-if="createSubTask"
            :sprint="{...task.sprintArray, id: task.sprintId, folderId: task.folderObjId}"
            :taskId="task._id"
            :project="project"
            :assigneeOptions="task.AssigneeUserId"
            :considerWidth="false"
            @cancel="createSubTask = false"
            class="bg-white m-0"
        />
        <SpinnerComp :is-spinner="isSpinner" />
    </div>
</template>

<script setup>
// PACKAGES
import {computed,defineProps, inject, nextTick, ref,watch} from "vue";

// COMPONENTS
import SubTaskItem from "@/components/molecules/SubTaskItem/SubTaskItem.vue"
import CreateTask from "@/components/atom/CreateTask/CreateTask.vue"
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp'
import SubtaskProgressBadge from '@/components/atom/SubtaskProgressBadge/SubtaskProgressBadge.vue'
import { useCustomComposable } from "@/composable";
import { useToast } from "vue-toast-notification";
import taskClass from "@/utils/TaskOperations"
import { useGetterFunctions } from "@/composable";
import { useStore } from "vuex";
import { useAiApiFunction } from "@/composable/aiHelper"
import Skelaton from "@/components/atom/Skelaton/AiSkelaton.vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from '@/services';
import * as env from '@/config/env';
const { t } = useI18n();
// UTILS
const {checkPermission, checkApps, debouncerWithPromise, debounce} = useCustomComposable();

// IMAGES
// const addIcon = require("@/assets/images/black_plus.png");
const aiIcon = require("@/assets/images/svg/ai_image.svg");

// PROPS
const props = defineProps({
    task: {
        type: Object,
        required: true
    },
    parentAssignee: {
        type: Array,
        default: () => []
    },
    subTasksArray: {
        type: Array,
        default: () => []
    },
    isMainSpinner: {
        type: Boolean,
        default: false
    }
})

const createSubTask = ref(false);
const subTasks = ref(props.subTasksArray);
const skip = ref(0);
const limit = ref(35);
const clientWidth = inject("$clientWidth");
const project = inject("selectedProject");
// Provided by TaskDetail.vue — { total, completed } for the subtask % badge.
const subtaskCompletion = inject('subtaskCompletion', null);
const subTasksList = ref([]);
const isSpinner = ref(false);
const isSpinnerSuggest = ref(false);
const isError = ref(false);

const companyId = inject("$companyId");
const userId = inject('$userId');
const $toast = useToast();
const {getUser} = useGetterFunctions()
const {getters,commit} = useStore();
const {generateAiRequestForFunction} = useAiApiFunction();
const companyOwner = computed(() => {
    return getters["settings/companyOwnerDetail"];
})
const taskDetailGetter = computed(()=>{
    return getters["projectData/gettaskDetailData"];
})

watch(taskDetailGetter,(newVal)=>{
    if (newVal?.fullDocument && Object.keys(newVal?.fullDocument).length) {
        if (newVal.isSubTaskUpdate) {
            const taskIndex = subTasks.value.findIndex((x) => x._id == newVal.fullDocument._id)
            if(!newVal.fullDocument?.deletedStatusKey) {
                if(taskIndex !== -1) {
                    subTasks.value[taskIndex] = {...subTasks.value[taskIndex], ...newVal.fullDocument}
                } else {
                    subTasks.value.push(newVal.fullDocument);
                }
            }
        }
    } else if (newVal.isSubTaskData) {
        subTasks.value = newVal.data;
    }
})

function getTasks() {
    let queryObj = [
        {
            $match: 
            { 
                ParentTaskId: props.task._id,
                deletedStatusKey : {$in : [0,undefined]}
            }
        },
        { $sort: {createdAt: -1,_id: 1} },
        { $skip: skip.value },
        {
            $limit: limit.value,
        }
    ]

    apiRequest('post', `${env.TASK}/find`, { findQuery: queryObj }).then((response) => {
        const res = response.data;
        res.forEach((sub) => {
            const index = subTasks.value.findIndex(item => item._id === sub._id);
            if (index !== -1) {
                subTasks.value[index] = sub;
            }else{
                subTasks.value.push(sub);
            }
        })
    })
    .catch((error) => {
        console.error("Error in getTasks hook: ", error);
    })
}

const onScroll = debounce((e) => {
    const { scrollTop, offsetHeight, scrollHeight } = e.target
    if ((scrollTop + offsetHeight) >= scrollHeight) {
        skip.value += limit.value;
        getTasks();
    }
},50)

function sugestSubTask () {
    if(!isSpinnerSuggest.value){
        isSpinnerSuggest.value = true;
        subTasksList.value = [];
        debouncerWithPromise(1000).then(() => {
            isError.value = false;
            let data = {
                userId: userId.value,
                uniqueUserId: userId.value,
                companyId: companyId.value
            }
            generateAiRequestForFunction(data,props.task.TaskName,props.task.rawDescription,'Create SubTask',true,'single',project.value?.isGlobalPermission).then((result) => {
                if(result.status === true){
                    try {
                        isSpinnerSuggest.value = false;
                        subTasksList.value = JSON.parse(JSON.stringify(result.statusText.data.statusText));
                        subTasksList.value = subTasksList.value.replace(/\n|\r/g, '').trim();
                        subTasksList.value = eval(subTasksList.value)
                        if(isArrayOfObjects(subTasksList.value) == true){
                            subTasksList.value = eval(subTasksList.value).map((x) => ({...x,isSelected: true}));
                        }else{
                            isSpinnerSuggest.value = false;
                            isError.value = true;
                            subTasksList.value = [];
                        }
                    } catch (error) {
                        isSpinnerSuggest.value = false;
                        isError.value = true;
                        subTasksList.value = [];
                        console.error(error,"ERROR IN GENERAE PROMPTS:");
                    }
                }else{
                    if(result.isReachedLimit){
                        $toast.error(t("Toast.Ai_limit_reached"),{position: 'top-right'});
                    }else if(result.isNotAi){
                        $toast.error(result.statusText,{position: 'top-right'});
                    }
                    isSpinnerSuggest.value = false;
                }
            }).catch((error) => {
                isSpinnerSuggest.value = false;
                isError.value = true;
                console.error(error,"ERROR IN GENERAE PROMPTS:");
            })
        })
    }
}

function createSubTasks () {
    let array = subTasksList.value.filter((data) => data.isSelected);
    if(array.length > 0){
        subTasksList.value = [];
        isSpinner.value = true;
        let sprintObj = {
            id: props.task.sprintArray.id,
            name: props.task.sprintArray.name,
        }
        if(props.task.sprintArray.folderId){
            sprintObj.folderId = props.task.sprintArray.folderId;
            sprintObj.folderName = props.task.sprintArray.folderName;
        }

        const projectData = {
            _id: project.value._id,
            CompanyId: companyId.value,
            lastTaskId: project.value.lastTaskId,
            ProjectName: project.value.ProjectName,
            ProjectCode: project.value.ProjectCode
        }
        const user = getUser(userId.value)
        const userData = {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: companyOwner.value.userId,
        }
        taskClass.createSubTaskWithAi({
            companyId:companyId.value,
            userId: userId.value,
            subTitles: array,
            sprintObj: sprintObj,
            projectData: projectData,
            userData:userData,
            parentTask: {id: props.task._id, ProjectID: props.task.ProjectID},
            type: 'subTask'
        }).then((res) => {
            if(res.status === true){
                let subtaskArray = res.data;
                const showAllTasks = true;
                const pid = props.task.ProjectID;
                const sprintId = props.task.sprintArray.id;
                const snap = '';
                subtaskArray.forEach((x)=>{
                    subTasks.value.push(x);
                    commit("projectData/mutateUpdateFirebaseTasks",{
                        snap, 
                        op: "added",
                        pid,
                        sprintId,
                        data: x,
                        showAllTasks,
                        updatedFields: x
                    });
                })
                nextTick(() => {
                    isSpinner.value = false;
                    $toast.success(t(`Toast.task_created_successfully`), {position: "top-right"});
                })
            }
        }).catch((error) => {
            $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"});
            isSpinner.value = false;
            console.error(error);
        })
    }else{
        $toast.error(t(`Toast.Please_select_sub_task.`), {position:"top-right"});
    }
}

function isArrayOfObjects(arr) {
  if (!Array.isArray(arr)) {
    return false;
  }

  return arr.every(item => item !== null && typeof item === 'object');
}

function handleChecked (item) {
    item.isChecked = !item.isChecked;
}
</script>

<style>
@import './style.css';
</style>