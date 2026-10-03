<template>
    <SpinnerComp :is-spinner="isSpiner" v-if="isSpiner"/>
    <div :style="`${!data.isParentTask ? 'height: 45px;' : ''}`" class="task-in-sidebar-dark-gray task__name-sidebar d-flex align-items-center justify-content-between" :class="[{'task-in-sidebar-bg-grey-2' : data._id === selectedTaskId}]" v-if="(props.fromWhich !== ''  && props.fromWhich == 'dashboard') || (data._id !== task._id && task.ParentTaskId !== data._id)" @click="selectTask(data),$emit('selectTask', data._id)">
        <div class="d-flex align-items-center task__desckey-wrapper w-100">
            <div class="d-flex align-items-center task__desc-wrapper text-ellipsis" :class="[{'pointer-event-none' : isSpiner == true}]" :style="[{width : clientWidth > 767 ? '59%' : '50%'}]">
                <div class="taskStatusInSidebar" :style="[{'background-color': taskStatus && taskStatus.textColor,'color':taskStatus && taskStatus.textColor}]"></div>
                <div class="text-ellipsis pr-10px pl-2px">
                    <!-- <div v-if="data.isParentTask === false"><span class="text-ellipsis gray parent-taskname-merge font-size-12">{{taskData.filter((x) => x.id === data.ParentTaskId)[0]?.TaskName}}</span></div> -->
                    <div v-if="data.isParentTask === false" class="text-ellipsis d-block w-100 data__is-parenttask"><span class="text-ellipsis task-in-sidebar-gray parent-taskname-merge task-in-sidebar-font-size-11 task-in-sidebar-font-weight-400">{{taskData.filter((x) => x._id === data.ParentTaskId)[0]?.TaskName || data.parentTaskName}}</span></div>
                    <div class="text-ellipsis d-block w-100 mt--1px">
                        <img v-if="data.isParentTask === false" :src="subTaskDefineArrowImg">
                        <span class="text-ellipsis converted__subtask-nam task-in-sidebar-font-size-14 task-in-sidebar-font-weight-400 ml-5px">{{data.TaskName}}</span>
                    </div>
                </div>
            </div>
            <div class="d-flex align-items-center justify-content-start task__key-wrapper">
                <span class="text-ellipsis converted__subtask-key task-in-sidebar-gray81 pr-15px" :class="{'task-in-sidebar-font-size-12' : clientWidth > 767, 'task-in-sidebar-font-size-14' : clientWidth <= 767}">{{data.TaskKey}}</span>       
            </div>
            <div class="task__userimage-wrapper d-flex align-items-center justify-content-end task__assignee-wrapper" v-if="getAssignes.length > 0">
                    <UserProfile
                        v-for="user in getAssignes.filter((x, index) => index < 1)"
                        :key="user._id"
                        :showDot="true" :data="{ image: user.Employee_profileImageURL,title: user.Employee_Name}"
                        width="25px" class="cursor-pointer converted__subtask-image"
                        :thumbnail="'25x25'"
                    />
                    <DropDown mode="dialog" :aria-label="$t('Common.more_assignees', { count: getAssignes.length - 1 }, getAssignes.length - 1)" :id="`timeloguser_${data._id}`" v-if="getAssignes.length > 1">
                        <template #button>
                            <div class="d-flex align-items-center justify-content-center task-in-sidebar-profile-image task-in-sidebar-GunPowder task-in-sidebar-black text-nowrap task-in-sidebar-font-size-12 border-2px-blue ml--5px task-in-sidebar-bg-colorlightgray">
                                <span aria-hidden="true">+{{getAssignes.length - 1}}</span>
                                <span class="ah-sr-only">{{ $t('Common.more_assignees', { count: getAssignes.length - 1 }, getAssignes.length - 1) }}</span>
                            </div>
                        </template>
                        <template #options>
                            <DropDownOption
                                v-for="(user, index) in getAssignes.filter((x, index) => index >= 1).map((x) => ({...x,label: x.Employee_Name, image: x.profileImage}))"
                                :key="'user'+index"
                            >
                                <div class="d-flex align-items-center" :title="user.label">
                                    <!-- <img :src="user.image" class="profile-image" alt="user image"> -->
                                    <UserProfile decorative
                                        :showDot="true"
                                        :data="{ image: user.Employee_profileImageURL, title: user.Employee_Name}"
                                        width="25px" class="cursor-pointer converted__subtask-image"
                                    />
                                    <span class="ml-10px">{{ user.label }}</span>
                                </div>
                            </DropDownOption>
                        </template>
                    </DropDown>
            </div>
            <div class="task-in-sidebar-gray81 task-in-sidebar-font-size-12 ml-auto" v-else>N/A</div>
        </div>
        <ConfirmationsInTask
            :subTaskConfirm="subTaskConfirm"
            :taskConfirm = "taskConfirm"
            :taskTypeConfirm="taskTypeConfirm"
            v-model="showSidebar"
            :statusConfirm="statusConfirm"
            :oldStatus="oldStatus"
            :oldTaskType="oldTaskType"
            @checkAllModel="checkAllModel"
            @checkTaskType="checkTaskType"
            :task="task"
            :selectedConvertTask="selectedConvertTask"
            :selectedProjectData="selectedProjectData"
            :data="data"
            :errorMsgType="errorMsgType"
            @changeStatus="changeStatus"
            @changeTaskType="changeTaskType"
            @finalConfirm="confirmData"
         />
    </div>
</template>

<script setup>
import { defineProps, computed, ref, inject, watch, nextTick, defineEmits} from 'vue';
import { useStore } from 'vuex';
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import taskClass from "@/utils/TaskOperations";
// import { useDocument } from 'vuefire';
import ConfirmationsInTask from "@/components/atom/ConfirmationsInTask/ConfirmationsInTask.vue"
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';

import { useRoute, useRouter } from 'vue-router';
import { useToast } from "vue-toast-notification";
import { useGetterFunctions } from '@/composable';
import { taskPlanPermission } from "@/composable/commonFunction";
import { useI18n } from "vue-i18n";
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { treeRefusalReason } from '@/views/Projects/composables/taskDepth';
const { t } = useI18n();
const emit = defineEmits([
    'dataToParent','closeTaskSidebar','mergeTask','taskSelect'
])

const route = useRoute();
const router = useRouter();
const { getters,commit } = useStore();
const props = defineProps({
    data: {
        type: Object,
        required: true
    },
    selectedProjectData: {
        type: Object,
    },
    selectedSprintData: {
        type: Object,
    },
    isMergeTask: {
        type: Boolean,
        default:false
    },
    taskData: {
        type:Array
    },
    task : {
        type:Object
    },
    fromWhich : {
        type:String,
        default:''
    },
    isShowSpinner: {
        type: Boolean,
        default: false
    },
    index: {
        type: Number,
        default: 0
    },
    selectedTaskId:{
        type: Number
    },
    item: {
        type: Object,
        default: () => {}
    },
    isDuplicate: {
        type: Boolean,
        default: false
    }
})
const companyId = inject('$companyId');
const clientWidth = inject("$clientWidth");
const userId = inject("$userId");
const usersData = ref(getters["users/users"]);
const showSidebar = ref(false);
const selectedConvertTask = ref({});
const subTaskConfirm = ref(false);
const statusConfirm = ref(false);
const projectData = (props.fromWhich == undefined || props.fromWhich == '') ? inject("selectedProject") : {};
const convertedSubTask = ref([]);
const $toast = useToast();
const isConfirm = ref(false);
const errorMsg = ref('');
const taskTypeConfirm = ref(false);
const isTest = ref(false);
const errorMsgType = ref('');
const toggleTaskDetail = (props.fromWhich == undefined || props.fromWhich == '') ? inject('toggleTaskDetail') : {};
const isSpiner = ref(false); 
const isRedirect = ref(false); 
const subTaskDefineArrowImg = require("@/assets/images/svg/sub_task_define_arrow.svg");
const taskConfirm = ref(false)
const {getUser} = useGetterFunctions()
const { checkTaskPerSprintPermisssion } = taskPlanPermission();
const getAssignes = computed(() => {
    let finalArray = []
    let tempTaskAssigne = Object.keys(props.data).length > 0 ? props.data.AssigneeUserId : [];
    if(Object.keys(usersData.value).length && usersData.value && usersData.value.length > 0){
        let tempArray = [];
        usersData.value.map((item)=>{
            if(tempTaskAssigne.includes(item._id)){
                tempArray.push({...item,'profileImage':item.Employee_profileImageURL ? item.Employee_profileImageURL : ''})
            }
        })
        finalArray = tempArray
    }
    return finalArray
})

const checkSubTask = () => {
    return new Promise((resolve, reject) => {
        try {
            const findQuery = [
                {
                    "$match": {
                        objId:{
                            ProjectID:route.params.id,
                            sprintId: props.task.sprintId
                        },
                        isParentTask: false
                    }
                }
            ];
            apiRequest('post',`${env.TASK}/find`,{findQuery: findQuery}).then((result) => {
                if(result.status === 200){
                    if(result.data.length === 0){
                        if(props.isMergeTask === false){
                            resolve(false);
                            showSidebar.value = true;
                            taskConfirm.value = true;
                        }else{
                            resolve('noSubTask');
                        }
                    }
                    result.data.filter((x)=>{
                        if(x.ParentTaskId === props.task._id){
                            subTaskConfirm.value = true;
                            showSidebar.value = true;
                            const doc = x;
                            convertedSubTask.value.push(doc);
                            if(isConfirm.value === true){
                                resolve(true);
                            }else{
                                resolve(false);
                            }
                        }else{
                            if(props.isMergeTask === false){
                                resolve(false);
                                showSidebar.value = true;
                                taskConfirm.value = true;
                            }else{
                                resolve('noSubTask');
                            }
                        }
                    })
                }else{
                    $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                    resolve('noSubTask');
                }
            }).catch((error) => {
                console.error(error, "error");
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            })
        } catch (error) {
            reject(false);
            console.error(error,"error");
        }
    })
}

const oldStatus = computed(() => {
    let data = [];
    let uniqueArray = [];
    if(projectData.value && Object.keys(projectData.value).length) {
        projectData.value.taskStatusData.filter((x) => {
            x.convertStatus = ''
            convertedSubTask.value.filter((y)=>{
                if(x.key === y.statusKey){
                    data.push(x);
                }
            })
            uniqueArray = [...new Set(data)];
        })
    }
    return uniqueArray;
})

const oldTaskType = computed(() => {
    let data = [];
    let uniqueArray = [];
    if(projectData.value && Object.keys(projectData.value).length) {
        projectData.value.taskTypeCounts.filter((x) => {
            x.convertType = ''
            convertedSubTask.value.filter((y)=>{
                if(x.value === y.TaskType){
                    data.push(x);
                }
            })
            uniqueArray = [...new Set(data)];
        })
    }
    return uniqueArray;
})

const checkAllModel = () => {
    return new Promise((resolve, reject) => {
        try {
            isConfirm.value = true;
            convertedSubTask.value = props.isMergeTask === false ?  [...convertedSubTask.value, props.task] : convertedSubTask.value;
            if(selectedConvertTask.value.ProjectID !== props.task.ProjectID){
                showSidebar.value = true;
                statusConfirm.value = true;
                subTaskConfirm.value = false;
                taskConfirm.value = false;
                if(isTest.value === true){
                    resolve(true);
                }else{
                    resolve(false);
                }
            }else{
                showSidebar.value = false;
                resolve(true);
                if(props.isMergeTask === true && isSpiner.value == false){
                    mergeTask();
                }else{
                    convertTaskToSub();
                }
            }
        } catch (error) {
            reject(false);
            console.error(error,"error");
        }
    })
}

const checkTaskType = () => {
    return new Promise((resolve, reject) => {
        try {
            isTest.value = true;
            if(selectedConvertTask.value.ProjectID !== props.task.ProjectID){
                oldStatus.value.filter((x) => {
                    if(x.convertStatus === undefined || x.convertStatus === ''){
                        errorMsg.value = t('general.Please_Select_Status');
                    }else{
                        errorMsg.value = '';
                    }
                })
                if(errorMsg.value !== ''){
                    return false;
                }
                statusConfirm.value = false;
                showSidebar.value = true;
                taskTypeConfirm.value = true;
                resolve(true);
            }else{
                showSidebar.value = false;
                resolve(true);
                if(props.isMergeTask === true){
                    mergeTask();
                }else{
                    convertTaskToSub();
                }
            }
        } catch (error) {
            reject(false);
        }
    })
}
const taskStatus = computed(() => {
    return props.selectedProjectData.taskStatusData.find((x) => x.key === props.data.statusKey)
})

const selectTask = (data) => {
    if(isSpiner.value == true){
        return;
    }
    if(props.isMergeTask === true){
        emit('taskSelect',data)
        if(props.fromWhich !== undefined && props.fromWhich == 'dashboard') {
            emit('dataToParent', {...data});
        } else {
            selectedConvertTask.value = data;
            if(selectedConvertTask.value.status && typeof selectedConvertTask.value.status === "string"){
                selectedConvertTask.value.status = JSON.parse(selectedConvertTask.value.status)
            }
        }
    }
    else{
        checkTaskPerSprintPermisssion(data.sprintId).then((resp) => {
            if(resp){
                emit('taskSelect',data)
                if(props.fromWhich !== undefined && props.fromWhich == 'dashboard') {
                    emit('dataToParent', {...data});
                } else {
                    selectedConvertTask.value = data;
                    if(selectedConvertTask.value.status && typeof selectedConvertTask.value.status === "string"){
                        selectedConvertTask.value.status = JSON.parse(selectedConvertTask.value.status)
                    }
                }
            }else{
                $toast.error(t(`Toast.create_task_plan_limit_message`).replace('TASK_SPRINT', data?.sprintArray?.name), {position: "top-right"});
                return;
            }
        })
    }
}

const changeStatus = (st,st1) => {
    projectData.value.taskStatusData.filter((val) => {
        if(val.key === st1.key){
            val['convertStatus'] = st;
        }
    })
}

const changeTaskType = (type,type1) => {
    projectData.value.taskTypeCounts.filter((val) => {
        if(val.value === type1.value){
            val['convertType'] = type;
        }
    })
}

const convertTaskToSub = () => {
    if(selectedConvertTask.value.ProjectID !== props.task.ProjectID){
        oldTaskType.value.filter((x) => {
            if(x.convertType === undefined || x.convertType === ''){
                errorMsgType.value = t('Toast.Please_Select_Task_Type');
            }else{
                errorMsgType.value = '';
            }
        })
    }
    if(errorMsgType.value !== ''){
        return false;
    }
    if(isSpiner.value == true){
        return;
    }
    emit("closeTaskSidebar",false);
    const user = getUser(userId.value)

    const userData = {
        id: user.id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: user.companyOwnerId,
    }
    isSpiner.value = true;
    taskClass.convertToSubTask({
        companyId: companyId.value,
        projectData: {
            id:props.selectedProjectData._id,
            ProjectName :props.selectedProjectData.ProjectName
        },
        sprintId: selectedConvertTask.value.sprintId,
        selectedTaskId:props.task._id,
        taskId: selectedConvertTask.value._id,
        oldProject : {
            id : projectData.value._id,
            taskTypeCounts : projectData.value.taskTypeCounts,
            taskStatusData : projectData.value.taskStatusData,
            ProjectName : projectData.value.ProjectName
        },
        isSubTask : convertedSubTask.value.length > 1 ? true : false,
        userData : userData
    })
    .then((result) => {
        if(route.params?.taskId){
            toggleTaskDetail(selectedConvertTask.value);
        }

        if (props.selectedSprintData._id !== props.task.sprintId) {
            const sprint = { 
                ...props.selectedSprintData, 
                tasks: props.selectedSprintData.tasks + result.data.sprintCount 
            };

            let sprint2 = {};
            if(props.task.folderObjId){
                sprint2 = projectData.value.sprintsfolders?.[props.task.folderObjId]?.sprintsObj?.[props.task.sprintId];
            }else{
                sprint2 = projectData.value.sprintsObj[props.task.sprintId];
            }
            sprint2.tasks = sprint2.tasks - result.data.sprintCount;
            commit("projectData/mutateSprints",{op:'modified',data:{...sprint}});
            commit("projectData/mutateSprints",{op:'modified',data:{...sprint2}});
        }
        else{
            let countTask = getters['projectData/tasks'][props.task.ProjectID][props.selectedSprintData._id];

            const { indexName, searchKey } = props.item;

            if (indexName === 'groupByStatusIndex') {
                const object = updateCountObject(countTask.tasks, searchKey,countTask.found, (task) => task.statusKey);
                commitFoundData(searchKey, object,countTask.found);
            } else if (indexName === 'groupByPriorityIndex') {
                const object = updateCountObject(countTask.tasks, searchKey,countTask.found, (task) => task.Task_Priority);
                commitFoundData(searchKey, object,countTask.found);
            } else if (indexName === 'groupByDueDateIndex') {
                const object = updateCountObject(countTask.tasks, searchKey,countTask.found, (task) => {
                    return task.DueDate ? new Date(task.DueDate).setHours(0, 0, 0, 0) / 1000 : 0;
                });
                commitFoundData(searchKey, object,countTask.found);
            }
        }
        if(isRedirect.value){
            let paramsObj = {};
            if(selectedConvertTask.value.sprintId && !selectedConvertTask.value.folderObjId){
                paramsObj = {
                    cid: companyId.value,
                    id: selectedConvertTask.value.ProjectID,
                    sprintId: selectedConvertTask.value.sprintId,
                    taskId: selectedConvertTask.value._id
                }
            }else if(selectedConvertTask.value.folderObjId){
                paramsObj = {
                    cid: companyId.value,
                    id: selectedConvertTask.value.ProjectID,
                    sprintId: selectedConvertTask.value.sprintId,
                    folderId: selectedConvertTask.value.folderObjId,
                    taskId: selectedConvertTask.value._id
                }
            }
            nextTick(() => {
                isSpiner.value = false;
                router.push({
                    name: selectedConvertTask.value.folderObjId ? 'ProjectFolderSprintTask' : 'ProjectSprintTask',
                    params: paramsObj,
                    query: {...route.query, detailTab: 'task-detail-tab'}
                })
            })
        }
        emit("closeTaskSidebar",false);
        $toast.success(t("Toast.Task_converted_sucessfully"),{position: 'top-right'});
    })
    .catch((err) => {
        console.error(err);
        isSpiner.value = false;
        $toast.error(treeRefusalReason(err) || t('Toast.something_went_wrong'), {position: 'top-right'});
    })
}

function taskOperationFun (value) {
    isRedirect.value = value;
    if(props.isMergeTask === true){
        isTest.value = false;
        isConfirm.value = false;
        checkSubTask(props.data).then((res) => {
            if(res === true){
                checkAllModel();
            }
            if(res === 'noSubTask'){
                mergeTask();
            }
        }).catch((err) => {
            console.error(err,"err");
        })
    }
    else{
        isTest.value = false;
        isConfirm.value = false;
        checkSubTask(props.data).then((res) => {
            if(res === true){
                checkAllModel();
            }
        }).catch((err) => {
            convertTaskToSub()
            console.error(err,"err");
        })
    }
}

const mergeTask = () => {
    if(isSpiner.value == true){
        return;
    }
    isSpiner.value = true;
    const user = getUser(userId.value)

    const userData = {
        id: user.id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: user.companyOwnerId,
    }
    emit("closeTaskSidebar",false);
    taskClass.mergeTask({
        companyId: companyId.value,
        projectData: {
            id : props.selectedProjectData._id,
            ProjectName : props.selectedProjectData.ProjectName
        },
        taskId: props.task._id,
        mergeTaskId: props.data._id,
        oldProject : {
            id : projectData.value._id,
            taskTypeCounts : projectData.value.taskTypeCounts,
            taskStatusData : projectData.value.taskStatusData,
            ProjectName : projectData.value.ProjectName
        },
        isSubTask : convertedSubTask.value.length > 0 ? true : false,
        userData : userData
    }).then((result)=>{
        let sprint = {};
        if(props.task.folderObjId){
            sprint = projectData.value.sprintsfolders?.[props.task.folderObjId]?.sprintsObj?.[props.task.sprintId];
        }else{
            sprint = projectData.value.sprintsObj[props.task.sprintId];
        }
        sprint.tasks = sprint.tasks - result.data.sprintCount;
        commit("projectData/mutateSprints",{op:'modified',data:{...sprint}});
        if(route.params?.taskId){
            toggleTaskDetail(props.data);
        }
        if(isRedirect.value){
            let paramsObj = {};
            if(props.data.sprintId && !props.data.folderObjId){
                paramsObj = {
                    cid: companyId.value,
                    id: props.data.ProjectID,
                    sprintId: props.data.sprintId,
                    taskId: props.data._id
                }
            }else if(props.data.folderObjId){
                paramsObj = {
                    cid: companyId.value,
                    id: props.data.ProjectID,
                    folderId: props.data.folderObjId,
                    sprintId: props.data.sprintId,
                    taskId: props.data._id
                }
            }
            nextTick(() => {
                isSpiner.value = false;
                router.push({
                    name:props.data.folderObjId ? 'ProjectFolderSprintTask' : 'ProjectSprintTask',
                    params: paramsObj,
                    query: {...route.query, detailTab: 'task-detail-tab'}
                })
            })
        }
        $toast.success(t("Toast.Task_merged_sucessfully"),{position: 'top-right'});
        emit("closeTaskSidebar",false);
    })
    .catch((err) => {
        isSpiner.value = false;
        console.error(err);
    })
}

function confirmData (){
    if(isSpiner.value == true){
        return;
    }
    if(props.isMergeTask === true && isSpiner.value === false){
        mergeTask();
    }else{
        convertTaskToSub();
    }
}

function updateCountObject(tasks, searchKey,found, keyExtractor) {
    const object = {};
    tasks.forEach((task) => {
        const key = `${searchKey}_${keyExtractor(task)}`;
        if (found[key] >= 0) {
            object[key] = (object[key] || 0) + 1;
        }
    });
    return object;
}

function commitFoundData(foundKey, object,found) {
    Object.keys(found).forEach((key) => {
        if (key.includes(foundKey)) {
            commit('projectData/mutateTypesenseTasks', {
                found: { [key]: object[key] || 0 },
                nextPage: { [key]: 0 },
                pid: props.task.ProjectID,
                sprintId: props.selectedSprintData._id,
                data: null,
            });
        }
    });
}

defineExpose({taskOperationFun})

watch(() => errorMsg.value, () => {})

</script>
<style src="./style.css"></style>

<style scoped>
.task-in-sidebar-black {
    color: var(--ink);
}
.task-in-sidebar-gray {
    color: var(--ink-2);
}
.task-in-sidebar-dark-gray {
    color: var(--ink);
}
.task-in-sidebar-GunPowder {
    color: var(--ink-2);
}
.task-in-sidebar-gray81 {
    color: var(--ink-2);
}
.task-in-sidebar-bg-colorlightgray {
    background-color: var(--fill);
}
.task-in-sidebar-bg-grey-2 {
    background-color: var(--fill);
}
.task-in-sidebar-font-weight-400 {
    font-weight: 400 !important;
}
.task-in-sidebar-font-size-11 {
    font-size: 11px;
}
.task-in-sidebar-font-size-12 {
    font-size: 12px;
}
.task-in-sidebar-font-size-14 {
    font-size: 14px;
}
.task-in-sidebar-profile-image {
    object-fit: fill;
    height: 25px;
    width: 25px;
    border-radius: 50%;
    background-color: var(--surface);
    border: 1px solid var(--hairline);
}
@media (max-width: 767px) {
    .task-in-sidebar-profile-image {
        border-radius: 50% !important;
    }
}
</style>
