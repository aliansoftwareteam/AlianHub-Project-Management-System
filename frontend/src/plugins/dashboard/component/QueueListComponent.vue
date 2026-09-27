<template>
    <div class="queue__list-wrapper">
        <div class="queue__title-wrapper d-flex align-items-center mb-10px">
            <h2 class="font-size-22 font-weight-500 black font-ui m-0 d-flex align-items-center position-re quelist__title">{{ title }}<span class="font-size-13 font-weight-400 GunPowder ml-10px">({{ searchResultTotal }})</span></h2>
            <button class="btn__task ml-10px border-radius-4-px black font-weight-400 border-0 font-size-12 cursor-pointer bg-colorlightgray mr-2px vertical-middle" @click="queueButtonClick"> + {{$t('Home.AddtoQueue')}}</button>
            <div v-if="allProjectsArrayFilter.length">
                <ConvertToSubTaskSidebar @dataToMainComp="(ele)=>{taskOperations(ele,'add')}" :allProjectsArrayFilter="allProjectsArrayFilter" v-if="openConvertSubTaskSidebar === true" :closeSideBar="openConvertSubTaskSidebar"  @isConvertSubtaskOPen="(val) => {openConvertSubTaskSidebar = val}" :openMoveSubTask="false" :isMergeTask="false" :isDuplicate="false" :isOpenSubTask="false" :selectedProjectObject="allProjectsArrayFilter[0]" :fromWhich="'dashboard'"/>   
            </div>
        </div>
        <div class="queue__list-task  style-scroll-6-px" v-if="searchResults.length && !isSpinner" @scroll="scrollFunction">
            <SingleQueueListComponent v-for="data in searchResults" :key="data._id" :Taskdata="data" @removeTaskFromQueueData="(ele)=>{taskOperations(ele,'remove')}" @openTaskDetailSidebar="openInNewTab(data)"/>
        </div>
        <div class="text-center" v-else-if="!searchResults.length && !isSpinner">
            {{ $t('Home.noquelist') }}
        </div>
        <div class="queue__list-task style-scroll-6-px" v-else>
            <SkelatonVue v-for="index in 9" :key="index"  :style="{height: '40px', margin: '5px 0px 5px 5px'}" :class="{}"/>
        </div>
        <TaskDetail 
            v-if="isTaskDetail" 
            :companyId="companyId" 
            :projectId="projectId" 
            :sprintId="sprintId"
            :taskId="taskId" 
            :isTaskDetailSideBar="isTaskDetail" 
            @toggleTaskDetail="toggleTaskDetail" 
            :zIndex="5" 
        />
    </div>
</template>
<script setup>
import {ref,computed, inject, onMounted, provide, nextTick, watch } from 'vue';
// import SkelatonVue from '../Skelaton/Skelaton.vue';
import SkelatonVue from '@/components/atom/Skelaton/Skelaton.vue';
import ConvertToSubTaskSidebar from '@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue';
import { useStore } from 'vuex';
import { useToast } from "vue-toast-notification"
import taskClass from "@/utils/TaskOperations";
import { useGetterFunctions } from '@/composable';
import { useI18n } from "vue-i18n";
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import TaskDetail from '@/views/TaskDetail/TaskDetail.vue';
const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const props = defineProps({
    title:{
        type: String,
        required: false,
        default: 'List'
    },
    cardData:{
        type: Object,
        required: true
    },
    cardUID : {
        type: String,
        required: true
    }
})

watch(() => props.cardData?.statusArray, (newStatusArray) => {
    if(newStatusArray.length > 0){
        getAllQueueListData(true);
    }
    getAllQueueListData(true);
});

//Computed
const projectsGetter = computed(() => getters["projectData/onlyActiveProjects"]);

//Define Var
const allProjectsArrayFilter = ref([]);
const searchResults = ref([]);
const searchResultTotal = ref(0);
const isSpinner = ref(false);
const pageNumber = ref(1);
const addcount = ref(0);
const remcount = ref(0);
const timer = ref(null);
const companyId = inject("$companyId");
const userId = inject('$userId');
const openConvertSubTaskSidebar = ref(false);
const {getUser} = useGetterFunctions();
const taskOperations = (obj, action) => {
    if (action === 'add') {
        if (props.cardData?.statusArray?.includes(obj.statusKey)) {
            searchResults.value.push(obj);
            searchResultTotal.value += 1;
        }
        openConvertSubTaskSidebar.value = false;
        addcount.value += 1;
    } else if (action === 'remove') {
        let findIndex = searchResults.value.findIndex((ele) => {
            return ele._id == obj._id;
        });
        if (findIndex !== -1) {
            searchResults.value.splice(findIndex, 1);
            searchResultTotal.value -= 1;
            remcount.value += 1;
        }
    }
    const user = getUser(userId.value);
    const userData = {
        id: user.id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: user.companyOwnerId
    }
    taskClass.updateQueueList({CompanyId:obj.CompanyId, projectId:obj.ProjectID, sprintId:obj.sprintId, taskId:obj._id,userId:userId.value,actionType:action,taskName:obj.TaskName,userData:userData, queueListArray: obj.queueListArray})
    .then(() => {
        if(searchResults.value.length == 9 && searchResultTotal.value - searchResults.value.length > 0) {
            if(addcount.value == 10) {
                addcount.value = 0;
                pageNumber.value += 1;
            }
            if(remcount.value == 10){
                remcount.value = 0;
                pageNumber.value -= 1;
            }
            getAllQueueListData(false);
        }
        $toast.success(t(`Toast.Queue list ${action == 'add' ? 'added' : 'removed'} successfully`),{position: 'top-right'});
    })
    .catch((error) => {
        console.error("ERROR in update QueueList: ", error);
        $toast.error(t('Toast.queue_list_not_updated'),{position: 'top-right'});
    })
};


const projectId = ref(null);
const sprintId = ref(null);
const taskId = ref(null);
const isTaskDetail = ref(false);

const toggleTaskDetail = (task,close=false) => {
    isTaskDetail.value = false;
    if(close == true) {
        return;
    }
    projectId.value = '';
    sprintId.value = '';
    taskId.value = '';
    nextTick(()=>{
        openInNewTab(task);
    })
}
provide('toggleTaskDetail', toggleTaskDetail);

const openInNewTab = (task) => {
    projectId.value = task.ProjectID;
    sprintId.value = task.sprintId;
    taskId.value = task._id;
    isTaskDetail.value = true;
};

const queueButtonClick = () =>{
    if(projectsGetter.value && projectsGetter.value.data?.length){
        openConvertSubTaskSidebar.value = true;
        allProjectsArrayFilter.value = projectsGetter.value.data.filter((x) => x.id !== '6571e7195470e64b1203295c')
    }
}

onMounted(() => {
    getAllQueueListData();
});

const getAllQueueListData = (reset = true) => {
    try {
        if (reset) {
            isSpinner.value = true;
            searchResults.value = [];
            pageNumber.value = 1;
        }

        const resultsPerPage = 10;
        const searchQuery = {
            $match: {
                $and: [
                    { objId: { CompanyId: companyId.value } },
                    { AssigneeUserId: { $in: [userId.value] } },
                    { queueListArray: { $in: [userId.value] } },
                    { deletedStatusKey: 0 }
                ]
            }
        };

        if (props.cardData?.statusArray?.length > 0) {
            searchQuery.$match.$and.push({ statusKey: { $in: props.cardData?.statusArray } });
        }

        const query = [
            {
                $facet: {
                    "results": [
                        searchQuery,
                        { $skip: (pageNumber.value - 1) * resultsPerPage },
                        { $limit: resultsPerPage }
                    ],
                    "count": [
                        searchQuery,
                        { $count: "count" }
                    ]
                }
            }
        ];

        apiRequest('post', `${env.TASK}/find`, { findQuery: query })
            .then((response) => {
                if (response.status !== 200) {
                    throw new Error('Failed to fetch queue list data');
                }

                const result = response.data[0].results ?? [];
                const count = response.data[0].count[0]?.count ?? 0;

                if (reset) {
                    searchResultTotal.value = count;
                }

                if (!result.length) {
                    isSpinner.value = false;
                    return;
                }

                result.forEach(x => {
                    let findIndex = searchResults.value.findIndex((ele) => ele._id === x._id);
                    if (findIndex === -1) {
                        searchResults.value.push({ ...x });
                    }
                });
                pageNumber.value++;
                isSpinner.value = false;
            }).catch((error) => {
                isSpinner.value = false;
                console.error("ERROR in: ", error);
            });
    } catch (error) {
        isSpinner.value = false; 
        console.error(error);
    }
};
const scrollFunction = (e) => {
    debouncer(50).then(() => {
        if (e.target.scrollTop + e.target.clientHeight >= e.target.scrollHeight - 50) {
            getAllQueueListData(false)
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
</script>

<style scoped src="../css/style.css"></style>