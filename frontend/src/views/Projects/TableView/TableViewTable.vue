<template>
    <div v-if="(searchedTask ? filteredTask : tasksGetter)?.length"  class="task__groups">
        <!-- Group-level tri-state select-all checkbox. Visible on header hover OR when this group has selection. -->
        <label
            v-if="canGroupSelect && groupTaskIds.length"
            class="table-group-multi-select"
            :class="{ 'table-group-multi-select--active': groupCheckboxState !== 'none' }"
            @click.stop
        >
            <input
                type="checkbox"
                :checked="groupCheckboxState === 'all'"
                :indeterminate.prop="groupCheckboxState === 'some'"
                @click.stop
                @change="handleGroupCheckboxChange($event)"
                aria-label="Select all tasks in group"
            />
        </label>
        <div class="view-status" v-if="data?.searchKey == 'statusKey'  " :style="[{'background-color':data?.bgColor , 'color':data?.textColor}]">
            {{data?.name}}
        </div>
        <div class="view-status p-0" v-if="data?.searchKey == 'DueDate'" >
            <span :style="[{'color':data?.name == 'Today' ? '#FF9600' : data?.textColor}]" class="font-weight-bold">  {{data?.name}} </span>
            <span class="ml-1">{{(searchedTask ? filteredTask : tasksGetter)?.length}} Tasks</span>
        </div>
        <div class="view-status p-0 task-priority-view-status" v-if="data?.searchKey == 'Task_Priority'">
            <WasabiImage
                class="priority__wasabi-image"
                :data="{ url: data?.statusImage }"
                v-if="!data?.statusImage.includes('http')"
            />
            <img :src="data?.statusImage" alt="" v-else>
            <span class="font-weight-bold ml-1">{{data?.name}}</span>
            <span class="ml-1">{{(searchedTask ? filteredTask : tasksGetter)?.length}} Tasks</span>
        </div>
        <div v-if="data?.searchKey == 'AssigneeUserId'">
            <div class="d-flex view-status" v-if="data.users?.length" @click.stop="">
                <Assignee
                v-if="checkPermission('task.task_assignee',project?.isGlobalPermission) === true && checkPermission('task.task_list',project?.isGlobalPermission) == true"
                :users="users"
                :num-of-users="4"
                :options="project?.AssigneeUserId"
                imageWidth="30px"
                :addUser="false"
                />
                <span v-for="(item,index) in data?.users" class="font-weight-bold" :key="index">
                    {{index!== 0 ? ", " : "" }} {{ item?.Employee_Name}} 
                </span>
                <span class="ml-1">{{(searchedTask ? filteredTask : tasksGetter)?.length}} Tasks</span>
            </div>
            <span class="d-flex align-items-center" v-else>
                <img :src="unassigned" alt="unassigned"/>
                <h5 class="text-ellipse item-title ml-1">Unassigned</h5>
                <span class="ml-1">{{(searchedTask ? filteredTask : tasksGetter)?.length}} Tasks</span>      
            </span>
        </div>
    </div>
    <tbody class="list_view_table">
        <template v-if="!isLoading">
            <template v-for="(task, index) in (searchedTask ? filteredTask : tasksGetter)" :key="index">
                <tr class="hover-bg-light-lavender bg-white">
                    <TableViewRow :taskData="taskData"  :data="task" :index="index+1" :parentAssignee="getParentTaskAssignee(searchedTask ? filteredTask : tasksGetter,task)"/>
                </tr>
            </template>
        </template>
        <template v-else>
            <Skelaton v-for="i in 4" :key="i" class="border-radius-5-px skelaton__option m-5px"/>
        </template>
        <div :id="`table_list_item_${sprintId}_${data.key}`" class="table__list-task-id w-100"></div>                                    
    </tbody>
    
</template>
<script setup>
// COMPONENTS
import TableViewRow from '@/components/atom/TableViewRow/TableViewRow.vue'
import Assignee from "@/components/molecules/Assignee/Assignee.vue"
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import { apiRequest } from "../../../services";
import * as env from '@/config/env';

// UTILS
import { useCustomComposable} from "@/composable";
import { taskListHelper } from '@/views/Projects/helper.js';
import { useTaskSelection } from '@/composable/useTaskSelection.js';

// PACKAGES
import {useStore} from 'vuex'
import {ref,watch , inject , computed,onUnmounted ,onMounted} from 'vue'
import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';

const unassigned = require("@/assets/images/png/unassigned-black.png")
const {checkPermission} = useCustomComposable();
const searchedTask = inject('searchedTask');
const observerRef = ref(null);
const {checkCase} = taskListHelper();
const {getters,dispatch,commit} = useStore()
const users = ref([])
const filteredTask = ref([])
const props = defineProps({
    data : {
        type:Object
    },
    group:{
        type: Number,
        default: 0
    },
    sprintId:{
        type:String
    },
    globalSortKey:{
        default:'',
        type:String
    },
    keys:{
        default:'',
        type:String
    }
})


const taskData = ref(props.data)
const isLoading = ref(false);
const project = inject("selectedProject")
const companyId = inject("$companyId")
const userId = inject('$userId')
const permit = checkPermission("task.show_tasks",project?.value?.isGlobalPermission);

const selection = useTaskSelection();
const { setActiveView, setActiveProject } = selection;
setActiveView('table');
watch(() => project.value?._id, (newId) => {
    if (newId) setActiveProject(String(newId));
}, { immediate: true });

const showArchivedInj = inject('showArchived', null);
const canGroupSelect = computed(() => checkPermission('task.task_status', project.value?.isGlobalPermission) === true
    && !(showArchivedInj?.value));
const groupTaskIds = computed(() => {
    const source = searchedTask ? filteredTask.value : tasksGetter.value;
    if (!Array.isArray(source)) return [];
    const ids = [];
    for (const t of source) {
        if (t?._id && (showArchivedInj?.value ? true : !t.deletedStatusKey)) ids.push(String(t._id));
    }
    return ids;
});
const groupCheckboxState = computed(() => selection.groupState(groupTaskIds.value));
const handleGroupCheckboxChange = (evt) => {
    if (evt) evt.stopPropagation();
    selection.toggleGroup(groupTaskIds.value);
};

watch(()=> props.globalSortKey, () => {
    if (observerRef.value) {
        observerRef.value.disconnect();
    }
    dispatch("projectData/setTableTasksFromTypesense", {
        cid: companyId.value,
        pid: project.value._id,
        sprintId: props.sprintId,
        item : props.data,
        fetchNew : true,
        resetTable : null,
        userId: userId.value,
        sortKey : props.globalSortKey,
        isFirst : true,
        showAllTasks: project.value.isGlobalPermission === false ? permit : true,
    }).then(()=>{
        addIntersections()
    })
})

function addIntersections() {
    setTimeout(() => {
        let options = {
            root: document.getElementById("tableview_scroll"),
            rootMargin: "0px",
            threshold: 0,
        };
        let obs = new IntersectionObserver((e) => {
            if(e[0].isIntersecting) {
                let item = JSON.parse(JSON.stringify(props.data))
                dispatch("projectData/setTableTasksFromTypesense", {
                    cid: companyId.value,
                    pid: project.value._id,
                    sprintId: props.sprintId,
                    item : item,
                    userId: userId.value,
                    fetchNew: true,
                    resetTable : null,
                    sortKey : props.globalSortKey,
                    isFirst: false,
                    showAllTasks: project.value.isGlobalPermission === false ? permit : true
                })
            }
        }, options);

        let target = document.getElementById(`table_list_item_${props.sprintId}_${props.data.key}`);
        if(target) {
            obs.observe(target)
        }
        observerRef.value = obs;
    })
}


const getTaskData = () => {
    taskData.value = props.data;
    if(props.data?.searchKey == 'AssigneeUserId') { users.value = ((taskData.value?.conditions[0])?.split(':')[1]?.split(','))?.map((item) => {return item?.trim()}) }
    if(searchedTask){ fetchFilteredTasks() }
    addIntersections()
}
watch(()=> props.sprintId, (newValue,oldValue) => {
    if(newValue.key === oldValue.key){
        if(observerRef.value){
            observerRef.value.disconnect();
        }
        getTaskData()
    }
})

const filteredTasksGetter = computed(() => {
    const searchedTasks = getters['projectData/searchedTasks'];
    if (!searchedTasks?.length || !props.sprintId) return [];

    const { searchKey, searchValue, operation, value } = taskData.value;
    let filteredTasks = [];

    const filterTasks = (key, compareFn) =>
        searchedTasks.filter((task) => task.sprintId === props.sprintId && compareFn(task));

    const sortTasks = (tasks, sortKey) => tasks.sort((a, b) => a?.[sortKey] - b?.[sortKey]);

    const dueDateFilter = (task) =>
        task.DueDate ? checkCase(operation, searchValue, new Date(task[searchKey]).getTime() / 1000) : operation === "non";

    const assigneeUserIdFilter = (task) =>
        task.AssigneeUserId.sort().join("_") === value;

    switch (searchKey) {
        case "DueDate":
            filteredTasks = filterTasks(searchKey, dueDateFilter);
            if (!props.globalSortKey) filteredTasks = sortTasks(filteredTasks, 'groupByDueDateIndex');
            break;
        case "AssigneeUserId":
            filteredTasks = filterTasks(searchKey, assigneeUserIdFilter);
            if (!props.globalSortKey) filteredTasks = sortTasks(filteredTasks, 'groupByAssigneeIndex');
            break;
        case "statusKey":
            filteredTasks = filterTasks(searchKey, (task) => task[searchKey] === searchValue);
            if (!props.globalSortKey) filteredTasks = sortTasks(filteredTasks, 'groupByStatusIndex');
            break;
        case "Task_Priority":
            filteredTasks = filterTasks(searchKey, (task) => task[searchKey] === searchValue);
            if (!props.globalSortKey) filteredTasks = sortTasks(filteredTasks, 'groupByPriorityIndex');
            break;
        default:
            filteredTasks = filterTasks(searchKey, (task) => task[searchKey] === searchValue);
            break;
    }

    return filteredTasks;
});

const fetchFilteredTasks = () =>{
    if(filteredTasksGetter.value && filteredTasksGetter.value.length){
        let array = [...filteredTasksGetter.value]
        filteredTasksGetter.value  = filteredTasksGetter.value.forEach((item) =>{ array = array.concat(item?.subtaskArray) })
        
        filteredTask.value = array
        if(!filteredTask.value?.length){ taskData.value = props.data }
    }else{
        return [];
    }
}

watch(filteredTasksGetter,() =>{
    fetchFilteredTasks()
})

const tasksGetter = computed(() => {
    const projectTasks = getters['projectData/tableTasks']?.[project.value._id]?.[props.sprintId];
    if (!projectTasks) return [];
    const store = JSON.parse(JSON.stringify(projectTasks));
    const { searchKey, searchValue, operation, value } = props.data;
    let filteredTasks = [];
    const filterTasks = (key, compareFn) => 
        store.tasks.filter((task) => compareFn(task) && !task?.deletedStatusKey);
    const sortTasks = (tasks, sortKey) => tasks.sort((a, b) => a?.[sortKey] - b?.[sortKey]);
    const dueDateFilter = (task) => 
        (task.DueDate ? checkCase(operation, searchValue, new Date(task.DueDate).getTime() / 1000) : operation === "non");
    const assigneeUserIdFilter = (task) => 
        task.AssigneeUserId.sort().join("_") === value;
    switch (searchKey) {
        case "DueDate":
            filteredTasks = filterTasks(searchKey, dueDateFilter);
            if (!props.globalSortKey) filteredTasks = sortTasks(filteredTasks, 'groupByDueDateIndex');
            break;
        case "AssigneeUserId":
            filteredTasks = filterTasks(searchKey, assigneeUserIdFilter);
            if (!props.globalSortKey) filteredTasks = sortTasks(filteredTasks, 'groupByAssigneeIndex');
            break;
        case "statusKey":
            filteredTasks = filterTasks(searchKey, (task) => task[searchKey] === searchValue);
            if (!props.globalSortKey) filteredTasks = sortTasks(filteredTasks, 'groupByStatusIndex');
            break;
        case "Task_Priority":
            filteredTasks = filterTasks(searchKey, (task) => task[searchKey] === searchValue);
            if (!props.globalSortKey) filteredTasks = sortTasks(filteredTasks, 'groupByPriorityIndex');
            break;
        default:
            filteredTasks = filterTasks(searchKey, (task) => task[searchKey] === searchValue);
            break;
    }

    return filteredTasks;
});
onMounted(() => {
    if(observerRef.value){
        observerRef.value.disconnect();
    }
    getTaskData();
    prepareIndexData();
})
onUnmounted(() => {
   // Disconnect the observer when the component is unmounted
   if (observerRef.value) {
      observerRef.value.disconnect();
   }
});

function prepareIndexData () {
    let taskWithoutFilter = []
    let taskArray = [];
    let withoutIndexTask = tasksGetter.value?.filter((data) => {
        return (data[props.data.indexName] === undefined || data[props.data.indexName] === null) && data.TaskKey !== '--'
    })
    if (withoutIndexTask?.length > 0) {
        withoutIndexTask.map((x) => taskWithoutFilter.push({data: x._id, item: props.data, taskKey: x.TaskKey}))
        withoutIndexTask.map((x) => taskArray.push(x));
    }    
    if (!(taskWithoutFilter.length === 0 && taskArray.length === 0)) {
        var newObj = {pid: project.value._id, sprintId: tasksGetter.value[0].sprintId, tasksArray: taskArray, indexName: tasksGetter.value[0].indexName};
        commit("project/mutateTaskIndex",newObj)
        let count = 0;
        if (taskArray.length !== 1) {
            isLoading.value = true;
        }
        let countFunction = (row) => {
            if (count >= taskWithoutFilter.length) {
                isLoading.value = false;
                return;
            } else {
                if (row.taskKey != '--') {
                    apiRequest("post", env.ONLOAD_UPDATE_TASK_INDEX, {
                        taskUpdate : row,
                        companyId: companyId.value,
                    }).then(()=>{
                        count++;
                        countFunction(taskWithoutFilter[count])
                    })
                    .catch((error) => {
                        console.error("ERROR in update project history: ", error);
                        count++;
                        countFunction(taskWithoutFilter[count])
                    })
                } else {
                    count++;
                    countFunction(taskWithoutFilter[count]);
                }
            }
        }
        countFunction(taskWithoutFilter[count])
    }
}

function getParentTaskAssignee(tasks, selectedTask) {
  if (selectedTask.isParentTask) return [];

  const parentTask = tasks.find((task) => task._id === selectedTask.ParentTaskId);

  return parentTask ? parentTask.AssigneeUserId : [];
}


</script>
<style>
@import "./style.css"
</style>