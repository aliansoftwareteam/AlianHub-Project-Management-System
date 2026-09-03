<template>
    <div class="sbf">
        <div class="sbf__row" :class="{ 'is-folder': folder === true, 'is-target': data.isDuplicateSprint }">
            <button
                v-if="data.sprintsObj && Object.keys(data.sprintsObj).length && props.isShowIcon === true"
                type="button"
                class="sbf__caret"
                :aria-label="data.name"
                @click.stop="$emit('change', data), $emit('expand')"
            >
                <img :src="triangleBlack" alt="" :style="`transform: rotateZ(${data.isExpanded ? '90' : '0'}deg)`">
            </button>
            <span v-else class="sbf__caret sbf__caret--empty"></span>

            <img v-if="data.deletedStatusKey === 2" :src="inventoryIcon" alt="" class="sbf__icon">
            <img v-else-if="data.deletedStatusKey === 1" :src="deleteIcon" alt="" class="sbf__icon">
            <img v-if="folder" :src="folderIcon" alt="" class="sbf__icon">

            <button
                v-if="props.isMoveTask === false && isDuplicate === false && isConvertTask === false && !folder"
                type="button"
                class="sbf__caret sbf__caret--tasks"
                :aria-label="data.name"
                @click="expandTask(), $emit('expand')"
            >
                <img :src="triangleBlack" alt="" :style="`transform: rotateZ(${allData.isTaskExpanded ? '90' : '0'}deg)`">
            </button>

            <span class="sbf__name" :title="data.name">{{ data.name }}</span>
            <span v-if="allData.isTaskExpanded && items.length" class="ah-mono sbf__count">{{ $t('MembersV2.sprint_tasks', { count: items.length }) }}</span>
        </div>
        <div v-if="data.isExpanded && data.sprintsObj && Object.keys(data.sprintsObj).length > 0" class="sbf__children">
            <SideBarSprintFolderData
                v-for="(subItem,index) in isMoveTask === true ? Object.values(data.sprintsObj).filter((x)=> (x.deletedStatusKey == undefined || x.deletedStatusKey === 0) && x.id !== task.sprintId) : Object.values(data.sprintsObj).filter((x)=> (x.deletedStatusKey === undefined || x.deletedStatusKey === 0))"
                :key="subItem.id"
                :ref="el => sprintRefs[index] = el"
                :data="subItem"
                :selectedProjectData="props.selectedProjectData"
                @change="toggleSubItem($event)"
                :taskSearch="props.taskSearch"
                :searchData="props.searchData"
                @click="props.isMoveTask === true || props.isDuplicate === true || props.isConvertTask === true ? $emit('clickSprint', subItem) : ''"
                :isMergeTask="props.isMergeTask"
                :isMoveTask="props.isMoveTask"
                :isDuplicate="props.isDuplicate"
                :task="props.task"
                :fromWhich="props.fromWhich"
                @dataToGrandParent="(ele)=>{getDataFromTaskComp(ele)}"
                :isConvertTask="props.isConvertTask"
                :isDup="props.isDup"
                @taskSelect="(e) => $emit('taskSelect',e)"
                @expand="selectedSprintIndex = index"
                :item="item"
            />
        </div>
        <div v-if="allData.isTaskExpanded && props.isMoveTask === false && props.isDuplicate === false && isConvertTask === false" class="sbf__tasks ah-scroll" @scroll="onScroll">
            <!-- <div v-for="(task, taskIndex) in taskSearch === '' ? items : searchData.filter((x) => x.sprintId === data.id)" :key="taskIndex" class="taskin__Sidebar-wrapper"> -->
                <TaskInSidebar
                    v-for="(task, taskIndex) in taskSearch === '' ? items : searchData.filter((x) => x.sprintId === data.id)"
                    :ref="el => taskRefs[taskIndex] = el"
                    :key="taskIndex"
                    :index="taskIndex"
                    :data="task"
                    :selectedProjectData="props.selectedProjectData"
                    :selectedSprintData="selectedSprintData"
                    :isMergeTask="isMergeTask"
                    :taskData="taskSearch === '' ? items : searchData.filter((x) => x.sprintId === data._id)"
                    :fromWhich="props.fromWhich"
                    :task="props.task"
                    @dataToParent="(ele)=>{getDataFromTaskComp(ele)}"
                    @closeTaskSidebar="$emit('closeTaskSidebar',false)"
                    :isShowSpinner="isSpiner"
                    @taskSelect="(e) => {$emit('taskSelect',e),selectedIndex=taskIndex}"
                    :selectedTaskId="selectedTaskId"
                    @selectTask="(e) => selectedTaskId = e"
                    :item="item"
                    :isDuplicate="props.isDuplicate"
                />
            <!-- </div> -->
        </div>
    </div>
</template>

<script setup>
import { defineProps, ref, inject } from 'vue';
import SideBarSprintFolderData from './SideBarSprintFolderData'
import TaskInSidebar from '@/components/organisms/TaskInSidebar/TaskInSidebar.vue';

import { apiRequest } from '@/services';
import * as env from '@/config/env';

const emit = defineEmits(["change", "clickSprint","dataToGrandParent","closeTaskSidebar"])

const props = defineProps({
    data: {
        type: Object,
        required: true
    },
    folder: {
        type: Boolean,
        default: false
    },
    selectedProjectData: {
        type: Object,
    },
    taskSearch: {
        type: String,
        default: ""
    },
    searchData: {
        type: Array,
    },
    isShowIcon: {
        type: Boolean,
        default: true
    },
    isMoveTask: {
        type: Boolean,
        default: false
    },
    isMergeTask: {
        type: Boolean,
        default: false
    },
    task: {
        type: Object,
    },
    isDuplicate: {
        type: Boolean,
        default: false
    },
    fromWhich: {
        type: String,
        default: ''
    },
    isConvertTask: {
        type:Boolean,
        default:false
    },
    isDup : {
        type:Boolean,
        default:false
    },
    item: {
        type: Object,
        default: () => {}
    }
})

const inventoryIcon = require("@/assets/images/inventory_2.png");
const deleteIcon = require("@/assets/images/DeleteIcon.png");
const folderIcon = require("@/assets/images/svg/blue_folder.svg");
const allData = ref(props.data);
const selectedSprintData = ref({});
const items = ref([]);
const sprintRefs = ref([])
const taskRefs = ref([]);
const userId = inject("$userId");
const triangleBlack = require("@/assets/images/svg/triangleBlack.svg");
const expandTask = () => {
    if(props.isMoveTask === false){
        allData.value.isTaskExpanded = !allData.value.isTaskExpanded;
        selectedSprintData.value = allData.value; 
        getMongodbData();
    }
}
const batchSize = ref(10);
const skip = ref(0);
const selectedIndex = ref(0);
const selectedSprintIndex = ref(0)
const selectedTaskId = ref(null)

const getMongodbData = () => {
    return new Promise((resolve, reject) => {
        try {
            let defaultFilterPrivate = {};
            if(props.fromWhich !== '' && props.fromWhich == 'dashboard') {
                defaultFilterPrivate = {
                    AssigneeUserId : { $in: [userId.value] },
                    queueListArray : { $nin: [userId.value] }
                }
            }else{
                if(props.isMergeTask === false){
                    defaultFilterPrivate = {
                        isParentTask : true,
                    }
                }else{
                    defaultFilterPrivate = {
                        ParentTaskId : {$ne : props.task._id},
                    }
                }
            }
            let searchResult = {
                $match: {
                    $and:[
                        {
                            objId: {
                                ProjectID: props.selectedProjectData?._id,
                                sprintId: selectedSprintData.value.id
                            }
                        },
                        {deletedStatusKey: 0},
                        defaultFilterPrivate
                    ]
                }
            };
            const query = [
                {
                    $facet: {
                        "results": [
                            searchResult,
                            {
                                $skip: skip.value,
                            },
                            {
                                $limit: batchSize.value,
                            }
                        ]
                    }
                }
            ];
            apiRequest('post', `${env.TASK}/find`, { findQuery: query }).then((response) => {
                const result = response.data[0];
                if(result?.results.length > 0){
                    let arrayData = result.results;
                    items.value = items.value.concat(arrayData.filter(newItem => !items.value.some(existingItem => existingItem._id === newItem._id)));
                    items.value.map(async(x) =>{
                        if(!x.isParentTask) {
                            let findIndex = arrayData.findIndex((ele)=>{return x.ParentTaskId == ele._id})
                            if(findIndex !== -1) {
                                x.parentTaskName = arrayData[findIndex].TaskName
                            } 
                            else {
                                apiRequest('get', `${env.TASK}/${x.ParentTaskId}`).then((getRes) => {
                                    x.parentTaskName = getRes.data.TaskName
                                }).catch((err) => {
                                    console.error("Error in get API call inside getMongodbData hook: ", err)
                                });
                            }
                        } 
                        return x;
                    })
                    if(props.isMergeTask === true){
                        let parentData = []
                        items.value.forEach((y) => {
                            if(y.isParentTask === false){
                                let testIndex = items.value.findIndex((x) => x._id === y.ParentTaskId);
                                if(testIndex === -1) {
                                    const findQuery = [
                                        {
                                            $match: {
                                                $and:[
                                                    {
                                                        objId: {
                                                            ProjectID: y.ProjectID,
                                                            sprintId: y.sprintId
                                                        }
                                                    },
                                                    { deletedStatusKey: 0 },
                                                    { _id: y.ParentTaskId }
                                                ]
                                            }
                                        }
                                    ];
                                    apiRequest('post', `${env.TASK}/find`, { findQuery: findQuery }).then((response) => {
                                        const res = response.data;
                                        res.forEach((hit) => {
                                            parentData.push(hit);
                                        })
                                        items.value = items.value.concat(parentData.filter(newItem => !items.value.some(existingItem => existingItem._id === newItem._id)));
                                    })
                                }
                            }
                        })
                    }
                    resolve(result);
                }
            })
            .catch((error)=>{
                console.error("Error in getMongodbData hook: ", error);
            })
        } catch (error) {
            reject(error);
            console.error(error,"error");
        }
    })
}

function toggleSubItem(data) {
    Object.keys(data.sprintsObj).forEach((key) => {
        if(data.sprintsObj[key].id === data.id) {
            data.sprintsObj[key].isExpanded = !data.sprintsObj[key].isExpanded;
        } else {
            data.sprintsObj[key].isExpanded = false;
        }
    })
}

const onScroll = (e) => {
    const { scrollTop, offsetHeight, scrollHeight } = e.target
    if ((scrollTop + offsetHeight) >= scrollHeight) {
        skip.value += batchSize.value
        getMongodbData();
    }
}

const getDataFromTaskComp = (data) => {
    emit('dataToGrandParent',data);
}
function taskOperationFun (value) {
    if (sprintRefs.value[selectedSprintIndex.value] && sprintRefs.value[selectedSprintIndex.value].taskOperationFun) {
        sprintRefs.value[selectedSprintIndex.value].taskOperationFun(value);
    }
    if (taskRefs.value[selectedIndex.value] && taskRefs.value[selectedIndex.value].taskOperationFun) {
        taskRefs.value[selectedIndex.value].taskOperationFun(value);
    }
}
defineExpose({
  taskOperationFun
});

</script>
<style scoped src="./style.css"></style>