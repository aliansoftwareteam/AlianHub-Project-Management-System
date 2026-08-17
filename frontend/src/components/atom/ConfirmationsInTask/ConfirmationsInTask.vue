<template>
    <ConfirmationSidebar
            v-model="showSidebarData"
            :title="`${statusConfirmData === true ? $t('general.Different_Statuses') : ''}`"
            :message="`${subTaskConfirm === true ? `<b class='black'>${task!== undefined ? task?.TaskName : ''}’s</b> ${$t('conformationmsg.subtasks_will_become_subtasks_of')} <b class='black'>${selectedTask !== undefined  ? selectedTask?.TaskName : ''}</b>.` : taskConfirm ? `<b class='black'>${task!== undefined ? task?.TaskName : ''}’s</b> ${$t('conformationmsg.task_will_become_subtasks_of')} <b class='black'>${selectedTask !== undefined  ? selectedTask?.TaskName : ''}</b>.` : ''}`"
            :acceptButtonClass="'btn-primary font-roboto-sans'"
            :acceptButton="$t('general.Continue')"
            :isShowInput="false"
            @update:modelValue="$emit('closeModel')"
            @confirm="subTaskConfirm || taskConfirm ? $emit('checkAllModel') : statusConfirmData ? $emit('checkTaskType') : assigneeConfirmData ? $emit('assigneeConfirm',assignee,getWatchers) : $emit('finalConfirm')"
        >
        <template #body v-if="subTaskConfirm || taskConfirm">
            <div></div>
        </template>
        <template #body v-else-if="statusConfirmData">
            <div class="mw-100 w-100 conforms__task-component">
                <div class="overflow-x-visible overflow-y-auto overflow-y-auto::-webkit-scrollbar" :style="[{maxHeight : clientWidth > 767 ? 'calc(100vh - 550px)' : 'calc(100vh - 275px)'}]">
                    <div class="d-flex justify-content-between position-sti z-index-1 bg-white old__newstatustitle-wrapper">
                        <p class="font-size-12 font-roboto-sans position-re old__newstatus-title text-left gray81 mb-6px w-50">{{$t('general.Old_Status')}}</p>
                        <p class="font-size-12 font-roboto-sans position-re old__newstatus-title text-left gray81 mb-6px w-50">{{$t('general.New_Status')}}</p>
                    </div>
                    <div class="d-flex justify-content-between border-bottom-mobiledrop status__deatil-wrapper p20px-0px" v-for="(data,index) in oldStatus" :key="index"> 
                        <div class="d-flex align-items-center justify-content-between w-50 pr-20px pl-10px">
                            <div class="d-flex align-items-center">
                                <div class="sattus-color-div" :style="[{'background-color': data.bgColor,'color':data.textColor}]"></div>
                                <span :style="[{'color':data.textColor}]" class="oldstatusName" :class="{'font-size-13' : clientWidth > 767, 'font-size-16' : clientWidth <= 767}" >{{data.name}}</span>
                            </div>
                            <img :src="arrow" />
                        </div>
                        <div class="d-flex align-items-center border-groupBy border-radius-6-px task__type-wrapper">
                            <TaskStatus
                                :modelValue="taskStatus"
                                :options="newTaskStatusData === undefined ? selectedProjectData.taskStatusData || [] : newTaskStatusData"
                                @select="(val,val1) => $emit('changeStatus',val,val1,'taskStatus')"
                                :convertStatus="data"
                            >
                            <template #head>
                                <span v-if="data.convertStatus === undefined || data.convertStatus === ''" class="font-size-16 color94">{{$t('general.Select_Status')}}</span>
                                <div class="d-flex align-items-center" v-if="data.convertStatus !== undefined">
                                    <div class="sattus-color-div" :style="[{'background-color': data.convertStatus.bgColor,'color':data.convertStatus.textColor}]"></div>
                                    <span :style="[{'color':data.convertStatus.textColor}]" class="font-roboto-sans pl-8px" :class="{'font-size-13' : clientWidth > 767, 'font-size-16' : clientWidth <= 767}"  >{{data.convertStatus ? data.convertStatus.name : ''}}</span>
                                </div>
                                <span class="red position-ab font-size-11 mt-50px" v-if="(data.convertStatus === undefined || data.convertStatus === '')">{{errorMsg}}</span>
                            </template>
                            </TaskStatus>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template #body v-else-if="taskTypeConfirm">
            <div class="mw-100 w-100">
                <div class="overflow-x-visible overflow-y-auto overflow-y-auto::-webkit-scrollbar" :style="[{maxHeight : clientWidth > 767 ? 'calc(100vh - 550px)' : 'calc(100vh - 275px)'}]">
                    <div class="d-flex justify-content-between position-sti z-index-1 bg-white old__newstatustitle-wrapper">
                        <p class="font-size-12 font-roboto-sans text-left gray81 mb-6px w-50">{{$t('general.Old_Task_Type')}}</p>
                        <p class="font-size-12 font-roboto-sans text-left gray81 mb-6px w-50">{{$t('general.New_Task_Type')}}</p>
                    </div>
                    <div  class="d-flex justify-content-between border-bottom-mobiledrop status__deatil-wrapper p20px-0px" v-for="(data,index) in oldTaskType" :key="index">
                        <div class="d-flex align-items-center justify-content-between w-50 pr-20px pl-10px">
                            <div class="d-flex align-items-center">
                                <!-- <div class="position-re task__status-img" style="width:14px; min-width: 14px; height: 14px; object-fit: cover;border-radius: 2px;top: 3px;margin-right:8px;"></div> -->
                                <span class="oldstatusName GunPowder" :class="{'font-size-13' : clientWidth > 767, 'font-size-16' : clientWidth <= 767}">{{data.name}}</span>
                            </div>
                            <img :src="arrow" />
                        </div>
                        <div class="d-flex align-items-center border-groupBy border-radius-6-px select__tasktype task__type-wrapper position-re">
                            <TaskType
                                v-model="taskTypes"
                                :id="selectedProjectData.sprintId+selectedProjectData._id+'create_taskType'"
                                :options="newTaskTypeData === undefined ? props.selectedProjectData.taskTypeCounts : newTaskTypeData || []"
                                @select="(val,val1) => $emit('changeTaskType',val,val1)"
                                :convertTaskType="data"
                                >
                                <template #head>
                                    <div class="d-flex align-items-center">
                                        <span v-if="data.convertType === undefined || data.convertType === ''" class="font-size-16 color94">{{$t('general.Select_Task_Type')}}</span>
                                        <div class="d-flex align-items-center">
                                            <TaskTypeIcon :taskType="data.convertType" class="position-re border-radius-2-px convert__type" />
                                            <span class="pl-10px" :class="{'font-size-13' : clientWidth > 767, 'font-size-16' : clientWidth <= 767}">{{data.convertType ? data.convertType.name : ''}}</span>
                                        </div>
                                        <span class="red position-ab font-size-11 mt-50px" v-if="(data.convertType === undefined || data.convertType === '')">{{errorMsgType}}</span>
                                    </div>
                                </template>
                            </TaskType>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template #body v-else-if="projectStatusConfirm">
            <div class="mw-100 w-100">
                <div class="overflow-x-visible overflow-y-auto overflow-y-auto::-webkit-scrollbar" :style="[{maxHeight : clientWidth > 767 ? 'calc(100vh - 550px)' : 'calc(100vh - 275px)'}]">
                    <div class="d-flex justify-content-between position-sti z-index-1 bg-white old__newstatustitle-wrapper">
                        <p class="font-size-12 font-roboto-sans position-re old__newstatus-title text-left gray81 mb-6px w-50">{{$t('general.Old_Status')}}</p>
                        <p class="font-size-12 font-roboto-sans position-re old__newstatus-title text-left gray81 mb-6px w-50">{{$t('general.Old_Status')}}</p>
                    </div>
                    <div class="d-flex justify-content-between border-bottom-mobiledrop status__deatil-wrapper p20px-0px" v-for="(data,index) in oldProjectStatus" :key="index"> 
                        <div class="d-flex align-items-center justify-content-between w-50 pr-20px pl-10px">
                            <div class="d-flex align-items-center">
                                <div class="sattus-color-div" :style="[{'background-color': data.bgColor,'color':data.textColor}]"></div>
                                <span :style="[{'color':data.textColor}]" class="oldstatusName" :class="{'font-size-13' : clientWidth > 767, 'font-size-16' : clientWidth <= 767}" >{{data.name}}</span>
                            </div>
                            <img :src="arrow" />
                        </div>
                        <div class="d-flex align-items-center border-groupBy border-radius-6-px select__tasktype task__type-wrapper position-re">
                            <TaskStatus
                                :modelValue="projectStatus"
                                :options="newProjectStausData.filter((x) => x.type !== 'close') || []"
                                @select="(val,val1) => $emit('changeStatus',val,val1,'projectStatus')"
                                :convertStatus="data"
                                :id="'123'"
                            >
                            <template #head>
                                <span v-if="data.convertStatus === undefined || data.convertStatus === ''" class="font-size-16 color94" >{{$t('general.Select_Status')}}</span>
                                <div class="d-flex align-items-center" v-if="data.convertStatus !== undefined">
                                    <div class="sattus-color-div" :style="[{'background-color': data.convertStatus.bgColor,'color':data.convertStatus.textColor}]"></div>
                                    <span :style="[{'color':data.convertStatus.textColor}]" class="font-roboto-sans pl-8px" :class="{'font-size-13' : clientWidth > 767, 'font-size-16' : clientWidth <= 767}" >{{data.convertStatus ? data.convertStatus.name : ''}}</span>
                                </div>
                                <span class="red position-ab font-size-11 mt-50px" v-if="(data.convertStatus === undefined || data.convertStatus === '')">{{errorMsg}}</span>
                            </template>
                            </TaskStatus>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template #body v-else-if="assigneeConfirmData">
            <!-- FOR ASSIGNEE -->
            <div class="mw-100 w-100 conforms__task-component">
                <div class="overflow-x-visible overflow-y-auto overflow-y-auto::-webkit-scrollbar" :style="[{maxHeight : clientWidth > 767 ? 'calc(100vh - 550px)' : 'calc(100vh - 275px)'}]">
                    <div class="d-flex justify-content-between position-sti z-index-1 bg-white old__newstatustitle-wrapper">
                        <p class="font-size-12 font-roboto-sans position-re old__newstatus-title text-left gray81 mb-6px w-50">{{$t('general.Old_Task_Assignee')}}</p>
                        <p class="font-size-12 font-roboto-sans position-re old__newstatus-title text-left gray81 mb-6px w-50">{{$t('general.New_Task_Assignee')}}</p>
                    </div>
                    <div class="d-flex justify-content-between border-bottom-mobiledrop status__deatil-wrapper p20px-0px"> 
                        <div class="d-flex align-items-center justify-content-between w-50 pr-20px pl-10px">
                            <div class="d-flex align-items-center" v-if="detailedUsers?.length > 0">
                                <UserProfile
                                    v-for="user in detailedUsers.filter((x, index) => index < 1)"
                                    :key="user._id"
                                    :showDot="true" :data="{ image: user.profileImage,title: user.Employee_Name}"
                                    :thumbnail="'30x30'"
                                    width="26px"
                                    height="25px"
                                />
                                <DropDown v-if="detailedUsers.length > 1">
                                    <template #button>
                                        <div class="d-flex align-items-center justify-content-center profile-image GunPowder blue text-nowrap border-2px-blue">
                                            +{{detailedUsers.length - 1}}
                                        </div>
                                    </template>
                                    <template #options>
                                        <DropDownOption
                                            v-for="(user, index) in detailedUsers.filter((x, index) => index >= 1).map((x) => ({...x,label: x.Employee_Name, image: x.profileImage}))"
                                            :key="'user'+index" @click="usersFilter(user)"
                                        >
                                        <UserProfile
                                            :showDot="true"
                                            :data="{
                                                image: user.image,
                                                title: user.Employee_Name
                                            }"
                                            width="26px"
                                            height="25px"
                                            :thumbnail="'30x30'"
                                        />
                                        <span class="ml-10px">{{ user.label }}</span>
                                        </DropDownOption>
                                    </template>
                                </DropDown>
                            </div>
                            <div v-else class="font-size-13">{{$t('general.No_Assignee')}}</div>
                            <img :src="arrow" />
                        </div>
                        <div class="d-flex align-items-center task__type-wrapper">
                            <Assignee
                                :users="assignee"
                                :options="userOPtions"
                                :num-of-users="1"
                                imageWidth="30px"
                                @selected="changeAssignee('add', $event)"
                                @removed="changeAssignee('remove', $event)"
                                :isDisplayTeam="true"
                                :showAddUser="true"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <!-- FOR WATCHER -->
            <div class="mw-100 w-100 conforms__task-component pt-3">
                <div class="overflow-x-visible overflow-y-auto overflow-y-auto::-webkit-scrollbar" :style="[{maxHeight : clientWidth > 767 ? 'calc(100vh - 550px)' : 'calc(100vh - 275px)'}]">
                    <div class="d-flex justify-content-between position-sti z-index-1 bg-white old__newstatustitle-wrapper">
                        <p class="font-size-12 font-roboto-sans position-re old__newstatus-title text-left gray81 mb-6px w-50">{{$t('general.Old_Task_Watchers')}}</p>
                        <p class="font-size-12 font-roboto-sans position-re old__newstatus-title text-left gray81 mb-6px w-50">{{$t('general.New_Task_Watchers')}}</p>
                    </div>
                    <div class="d-flex justify-content-between border-bottom-mobiledrop status__deatil-wrapper p20px-0px"> 
                        <div class="d-flex align-items-center justify-content-between w-50 pr-20px pl-10px">
                            <div class="d-flex align-items-center" v-if="watcherUsers.length > 0">
                                <UserProfile
                                    v-for="user in watcherUsers.filter((x, index) => index < 1)"
                                    :key="user._id"
                                    :showDot="true" :data="{ image: user.profileImage,title: user.Employee_Name}"
                                    width="26px"
                                    height="25px"
                                    :thumbnail="'30x30'"
                                />
                                <DropDown v-if="watcherUsers.length > 1">
                                    <template #button>
                                        <div class="d-flex align-items-center justify-content-center profile-image GunPowder blue text-nowrap border-2px-blue">
                                            +{{watcherUsers.length - 1}}
                                        </div>
                                    </template>
                                    <template #options>
                                        <DropDownOption
                                            v-for="(user, index) in watcherUsers.filter((x, index) => index >= 1).map((x) => ({...x,label: x.Employee_Name, image: x.profileImage}))"
                                            :key="'user'+index" @click="usersFilter(user)"
                                        >
                                        <UserProfile
                                            :showDot="true"
                                            :data="{
                                                image: user.image,
                                                title: user.Employee_Name
                                            }"
                                            width="26px"
                                            height="25px"
                                            :thumbnail="'30x30'"
                                        />
                                        <span class="ml-10px">{{ user.label }}</span>
                                        </DropDownOption>
                                    </template>
                                </DropDown>
                            </div>
                            <div v-else class="font-size-13">{{$t('general.No_Watchers')}}</div>
                            <img :src="arrow" />
                        </div>
                        <div class="d-flex align-items-center task__type-wrapper">
                            <div v-if="getWatchers.length > 0" class="d-flex align-items-center">
                                <UserProfile
                                    v-for="user in getWatchers.filter((x, index) => index < 1)"
                                    :key="user._id"
                                    :showDot="true" :data="{ image: user.profileImage,title: user.Employee_Name}"
                                    width="26px"
                                    height="25px"
                                    :thumbnail="'30x30'"
                                />
                                <DropDown v-if="getWatchers.length > 1">
                                    <template #button>
                                        <div class="d-flex align-items-center justify-content-center profile-image GunPowder blue text-nowrap border-2px-blue">
                                            +{{getWatchers.length - 1}}
                                        </div>
                                    </template>
                                    <template #options>
                                        <DropDownOption
                                            v-for="(user, index) in getWatchers.filter((x, index) => index >= 1).map((x) => ({...x,label: x.Employee_Name, image: x.profileImage}))"
                                            :key="'user'+index" @click="usersFilter(user)"
                                        >
                                        <UserProfile
                                            :showDot="true"
                                            :data="{
                                                image: user.image,
                                                title: user.Employee_Name
                                            }"
                                            width="26px"
                                            height="25px"
                                            :thumbnail="'30x30'"
                                        />
                                        <span class="ml-10px">{{ user.label }}</span>
                                        </DropDownOption>
                                    </template>
                                </DropDown>
                            </div>
                            <div class="font-size-13" v-else>{{$t('general.No_Watchers')}}</div>
                        </div>
                    </div>
                </div>
            </div>
        </template>
    </ConfirmationSidebar>
</template>

<script setup>
import { defineEmits, computed, inject, watch, ref, onMounted } from "vue";
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
import TaskStatus from "@/components/atom/TaskStatus/TaskStatus.vue"
import TaskType from "@/components/atom/TaskType/TaskType.vue"
import Assignee from "@/components/molecules/Assignee/Assignee.vue"
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue"
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import { useStore } from "vuex";
import { useGetterFunctions } from "@/composable";
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";

const emit = defineEmits(["checkAllModel", "checkTaskType", "finalConfirm", "changeStatus","update:modelValue" ,"changeTaskType","assigneeConfirm","closeModel"]);
const clientWidth = inject("$clientWidth");
const props = defineProps({
    modelValue: {
        type: Boolean,
        default: false,
    },
    task: {
        type: Object,
        default: () => {},
    },
    selectedConvertTask: {
        type: Object,
        default: () => {},
    },
    subTaskConfirm: {
        type: Boolean,
        default: false,
    },
    statusConfirm: {
        type: Boolean,
        default: false,
    },
    taskTypeConfirm: {
        type: Boolean,
        default: false,
    },
    oldStatus: {
        type: Array,
        default: () => {},
    },
    oldTaskType: {
        type: Array,
        default: () => {},
    },
    selectedProjectData: {
        type: Object,
        default: () => {},
    },
    errorMsg: {
        type: String,
        default: "",
    },
    errorMsgType: {
        type: String,
        default: "",
    },
    data: {
        type: Object,
        default: () => {},
    },
    taskConfirm: {
        type: Boolean,
        default: false,
    },
    projectStatusConfirm: {
        type: Boolean,
        default: false
    },
    newProjectStausData:{
        type:Array
    },
    oldProjectStatus:{
        type:Array
    },
    newTaskTypeData:{
        type:Array
    },
    newTaskStatusData:{
        type:Array
    },
    assigneeSidebar : {
        type: Boolean,
        default: false,
    },
    selectedSprintData : {
        type: Object,
        default: () => {},
    }
});

const assignee = ref([]);

const {getUser} = useGetterFunctions();

const showSidebarData = computed({
    get() {
        return props.modelValue
    },
    set(value) {
        emit('update:modelValue', value)
    }
});
const {getters} = useStore();
const selectedTask = ref(props.selectedConvertTask);
const statusConfirmData = ref(props.statusConfirm);
const assigneeConfirmData = ref(props.assigneeSidebar);
const defaultUserIcon = inject("$defaultUserAvatar");

onMounted(() => {
    getAssignes();
})


watch(() => props.selectedConvertTask,(val) => {
    selectedTask.value = val;
})
watch(() => props.statusConfirm,(value) => {
    statusConfirmData.value = value
})
watch(() => [props.assigneeSidebar,props.selectedSprintData],(value) => {
    assigneeConfirmData.value = value[0];
    getAssignes();
})

watch(() => props.oldStatus,(newVal,oldVal) => {
    if(newVal.length !== oldVal.length){
        const result = addConvertStatus(newVal,props.selectedProjectData.taskStatusData,'convertStatus');
        emit('updateOldStatus',result);
    }
})

watch(() => props.oldTaskType,(newVal,oldVal) => {
    if(newVal.length !== oldVal.length){
        const result = addConvertStatus(newVal,props.selectedProjectData.taskTypeCounts,'convertType');
        emit('updateOldType',result);
    }
})
const companyUsers = computed(() => {
    return getters["settings/companyUsers"]?.map((x) => x.userId)
})
const usersData = computed(() => getters["users/users"]);
const arrow = require("@/assets/images/svg/arrow_back_sub_task.svg");
const taskStatus = computed(() => {
    const foundStatus = props.selectedProjectData.taskStatusData.find((x) => x.key === props.data ? props.data.statusKey : 1)
    return foundStatus ? { ...foundStatus, convertStatus: foundStatus } : null
})
const taskTypes = computed(() => {
    const foundType = props.selectedProjectData?.taskTypeCounts.find((x) => x.key === props.data ? props.data.TaskTypeKey : 1)
    return foundType ? { ...foundType, convertType: foundType } : null
})
const projectStatus = computed(() => {
    return props.selectedProjectData?.projectStatusData.find((x) => x.value === props.selectedProjectData.status)
})

const getAssignes = (() => {
    let assigneArray = props?.selectedProjectData?.AssigneeUserId || [];
    let sortedAssignee = props?.data?.AssigneeUserId.length > 0 ? props?.selectedProjectData?.isPrivateSpace == true ? assigneArray.filter((x) => props?.data?.AssigneeUserId.includes(x)) : props?.data?.AssigneeUserId : [];

    if(props?.selectedSprintData?.private === true){
        sortedAssignee = sortedAssignee.filter((x) => props?.selectedSprintData?.AssigneeUserId.includes(x))
    }
    assignee.value = sortedAssignee;
    return sortedAssignee;
})

const detailedUsers = computed(() => {
  return usersData.value.filter((x) => props.data.AssigneeUserId.includes(x._id))
    .map((x) => {
        const user = getUser(x._id);
        if (user && !user.ghostUser) {
            return {
                _id: x._id,
                Employee_Name: x.Employee_Name,
                profileImage: x.Employee_profileImageURL || defaultUserIcon,
            };
        }
    })
});

const watcherUsers = computed(() => {
  return usersData.value.filter((x) => props.data.watchers?.includes(x._id))
    .map((x) => {
        const user = getUser(x._id);
        if (user && !user.ghostUser) {
            return {
                _id: x._id,
                Employee_Name: x.Employee_Name,
                profileImage: x.Employee_profileImageURL || defaultUserIcon,
            };
        }
    })
});

const userOPtions = computed(() => {
    return props.selectedProjectData?.isPrivateSpace ? props.selectedSprintData?.private ? props.selectedSprintData.AssigneeUserId : (props.selectedProjectData?.AssigneeUserId || []) : props.selectedSprintData?.private ? props.selectedSprintData.AssigneeUserId : (companyUsers.value || [])
})

const getWatchers = computed(() => {
    let sortedWatchers = props.data.watchers && props.data.watchers.length > 0 ? props.selectedProjectData.isPrivateSpace == true ? props.selectedProjectData.AssigneeUserId?.filter((x) => props.data.watchers.includes(x)) : props.data.watchers : [];
    let tempTaskAssigne = Object.keys(props.data).length > 0 ? sortedWatchers : [];
    if(props.selectedSprintData.private === true){
        tempTaskAssigne = tempTaskAssigne.filter((x) => props.selectedSprintData.watchers?.includes(x))
    }

    let tempArray = [];
    if(Object.keys(usersData.value).length && usersData.value && usersData.value.length > 0){
        usersData.value.map((item) => {
            if(tempTaskAssigne.includes(item._id)){
                tempArray.push({_id : item._id,Employee_Name : item.Employee_Name,'profileImage':item.Employee_profileImageURL ? item.Employee_profileImageURL : defaultUserIcon});
            }
        })
    }
    return tempArray;
})

function changeAssignee(type, user) {
    if(type === "add") {
        assignee.value.push(user.id)
    } else {
        const userIndex = assignee.value.findIndex((x) => x === user.id);

        if(userIndex !== -1) {
            assignee.value.splice(userIndex, 1);
        }
    }
}

function addConvertStatus(arr1, arr2,type) {
    return arr1.map(obj => {
        let match = arr2.find(item => item.key === obj.key);
        if (match) {
            return { ...obj, [type]: obj };
        }
        return obj;
    });
}
</script>

<style src="./style.css">
</style>