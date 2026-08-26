<template>
    <div v-if="!currentCompany?.planFeature?.tableView">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('conformationmsg.unlock_table_view')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <template v-else>
    <button
        v-if="!searchedTask && checkPermission('task.task_create',project?.isGlobalPermission) === true && checkPermission('task.task_list',project?.isGlobalPermission) == true && showArchiveVar === false && createTask == false "
        class="outline-secondary-bg-gray mb-1 ml-20px bg-white"
        @click.stop="createTask = !createTask">
        + {{$t('Projects.new_task')}}
        </button>
        <div class="bg-white m0px-20px">
            <CreateTask
                v-if="createTask"
                :sprint="sprints[0]"
                @cancel="createTask = false"
                :assigneeOptions="project.AssigneeUserId"
                :groupBy="grouped"
            />
        </div>
    <div class="list_view-table-wrapper style-scroll" id="tableview_scroll">
        <table class="table__view">
            <thead class="w-100 table__userstatus-thead d-table"> 
            <tr class="header">
                <!-- Spacer header for the multi-select checkbox column added in TableViewRow -->
                <th class="header-item table-row-select-header" aria-label="Select"></th>
                <th class="header-item"><span class="dark-gray font-weight-500 font-size-12" >#</span></th>
                <th class="header-item"><span class="dark-gray font-weight-500 font-size-12" > {{$t('ProjectDetails.type')}} <img class="ml-1 cursor-pointer" @click="sortByColumns(globalSortKey == `TaskTypeKey: ${1}` ? `TaskTypeKey: ${-1}` : `TaskTypeKey: ${1}`)" :style="[{rotate: globalSortKey === `TaskTypeKey: ${1}` ? '0deg' : '180deg'}]" :src="arrow" alt=""></span></th>
                <th class="header-item"><span class="dark-gray font-weight-500 font-size-12" >{{$t('Projects.tasks')}}<img class="ml-1 cursor-pointer" @click="sortByColumns(globalSortKey == `TaskName: ${1}` ? `TaskName: ${-1}` : `TaskName: ${1}`)" :style="[{rotate: globalSortKey === `TaskName: ${1}` ? '0deg' : '180deg'}]" :src="arrow" alt=""></span></th>
                <th class="header-item"><span class="dark-gray font-weight-500 font-size-12" >{{$t('Header.Chat')}}</span></th>
                <th class="header-item"  v-if="checkPermission('task.task_status',project?.isGlobalPermission) !== null" ><span class="dark-gray font-weight-500 font-size-12" >{{$t('Projects.status')}}<img class="ml-1 cursor-pointer"  v-if="grouped !== 0" @click="sortByColumns(globalSortKey == `statusKey: ${1}` ? `statusKey: ${-1}` : `statusKey: ${1}`)" :style="[{rotate: globalSortKey === `statusKey: ${1}` ? '0deg' : '180deg'}]" :src="arrow" alt=""></span></th>
                <th class="header-item" v-if="checkPermission('task.task_assignee',project?.isGlobalPermission) !== null"><span class="dark-gray font-weight-500 font-size-12" >{{$t('ProjectDetails.assignee')}}</span></th>
                <th class="header-item" v-if="checkPermission('task.task_due_date',project?.isGlobalPermission) !== null"><span class="dark-gray font-weight-500 font-size-12" >{{$t('Projects.due_date')}}<img class="ml-1 cursor-pointer"  v-if="grouped !== 3"  @click="sortByColumns(globalSortKey == `DueDate:${1}` ? `DueDate:${-1}` : `DueDate:${1}`)" :style="[{rotate: globalSortKey === `DueDate:${1}` ? '0deg' : '180deg'}]" :src="arrow" alt=""></span></th>
                <th class="header-item" v-if="checkPermission('task.task_priority',project?.isGlobalPermission) !== null && checkApps('Priority')"><span class="dark-gray font-weight-500 font-size-12" >{{$t('Projects.priority')}}<img class="ml-1 cursor-pointer" v-if="grouped !== 2" @click="sortByColumns(globalSortKey == `Task_Priority: ${1}` ? `Task_Priority: ${-1}` : `Task_Priority: ${1}`)" :style="[{rotate: globalSortKey === `Task_Priority: ${1}` ? '0deg' : '180deg'}]" :src="arrow" alt=""></span></th>
                <th class="header-item"><span class="dark-gray font-weight-500 font-size-12" >{{$t('ProjectDetails.key')}}<img class="ml-1 cursor-pointer" @click="sortByColumns(globalSortKey == `TaskKey: ${1}` ? `TaskKey: ${-1}` : `TaskKey: ${1}`)" :style="[{rotate: globalSortKey === `TaskKey: ${1}` ? '0deg' : '180deg'}]" :src="arrow" alt=""></span></th>
            </tr>
            </thead>
            <div class="d-content">
                <div v-for="(item) in groupedTasks[0]?.items" class="style-scroll" :key="item?.key">
                    <TableViewTable :data="item" :sprintId="sprints[0]?.id ? sprints[0]?.id : sprints[0]?._id"  :group="grouped" :globalSortKey="globalSortKey" :keys="`${item.key}`"/>  
                </div>
            </div>
            <div class="d-flex align-items-center justify-content-center flex-column" v-if="totalTaskInFirstSprint.length === 0">
                <EmptyState
                    v-if="project?.deletedStatusKey !== 2"
                    :title="!project?.lastTaskId ? $t('EmptyState.no_tasks_title') : $t('EmptyState.no_match_title')"
                    :message="!project?.lastTaskId ? $t('EmptyState.no_tasks_msg') : $t('EmptyState.no_match_msg')"
                    helpPath="tasks"
                />
            </div>
        </table>
    </div>
    </template>
</template>
<script setup>
// COMPONENTS
import CreateTask from "@/components/atom/CreateTask/CreateTask.vue"
import TableViewTable from './TableViewTable.vue'
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';

// UTILS
import { useCustomComposable  } from "@/composable";
import isEqual from 'lodash/isEqual';
import { taskListHelper } from '@/views/Projects/helper.js';

// PACKAGES
import {useStore} from 'vuex'
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import { ref,
    inject,
    onMounted,computed,watch
} from "vue"

const {groupBy} = taskListHelper();
const createTask = ref(false)
const arrow = require('@/assets/images/svg/up-down-arrow.svg')
const {getters}  = useStore()
const {checkPermission, checkApps} = useCustomComposable();
const emit = defineEmits(["openSeeAllProject"])
const props = defineProps({
    grouped: {
        type: Number,
        default: 0
    },
    projectData:{
        type : Object
    },
    commonDateFormatForDate: {
        type: String,
        default: "DD/MM/YYYY"
    },
    sprints: {
        type: Array,
        default: () => []
    },
    calendarDate: {
        type: [String,Number],
        default: ""
    },
    billingPeriod:{
        type:String,
        default:''
    },
    data:{
        type:String,
        default:''
    },
    userIds:{
        type:Array,
        default:() => []
    },
    startDate:{
        type:Object,
        default:() => {}
    },
    watchers:{
        type:Object,
        default:() => {}
    },
    checklistArray:{
        type:Array,
        default:() => []
    },
    isvisible:{
        type:Boolean,
        default:true
    },
    title:{
        type:String,
        default:''
    },
    class:{
        type:String,
        default:''
    },
    // calendarDateChange: {
    //     type: Function,
    //     default: () => false
    // }
})
const project = inject('selectedProject')
const searchedTask = inject('searchedTask');
const showArchiveVar = inject("showArchived");
const globalSortKey = ref('')
const groupedTasks = ref([]);
// computed
const taskData = computed(() => getters["projectData/tableTasks"])
const currentCompany = computed(() => getters["settings/selectedCompany"])
//watch

watch([() => props.grouped, () => props.sprints,taskData], ([newGroup, newSprints], [oldGroup, oldSprints]) => {
    if(project.value && Object.keys(project.value).length) {
        groupBy(props.grouped, !isEqual(newGroup,oldGroup) || JSON.stringify(newSprints) !== JSON.stringify(oldSprints),project.value,props.sprints,groupedTasks,true,'table',null, true, (resp)=>{
            groupedTasks.value = resp;
        });
    }
    // globalSortKey.value = ''
});
const totalTaskInFirstSprint = computed(() => {
    if(getters['projectData/tableTasks'][props.projectData._id] && getters['projectData/tableTasks'][props.projectData._id][props.sprints[0]?.id]) {
        let tmp = [];
        tmp = JSON.parse(JSON.stringify(getters['projectData/tableTasks'][props.projectData._id][props.sprints[0]?.id])).tasks || [];
        return tmp;
    } else {
        return [];
    }
});
function openSeeAll(data) {
    if(data === 'project'){
        emit("openSeeAllProject" )
    }
}
openSeeAll('')

onMounted(() => {
    if(project.value && Object.keys(project.value).length) {
		if (!taskData.value || !Object.keys(taskData.value).length) {
			groupBy(props.grouped,true,project.value,props.sprints,groupedTasks,true,'table',true, true, (resp)=>{
                groupedTasks.value = resp;
            });
		} else {
			groupBy(props.grouped,true,project.value,props.sprints,groupedTasks,true,'table',true, true, (resp)=>{
                groupedTasks.value = resp;
            });
		}
    }
})


const sortByColumns = (sortKey = "") => {
    globalSortKey.value = sortKey
}

</script>
<style scoped>
@import './style.css'
</style>