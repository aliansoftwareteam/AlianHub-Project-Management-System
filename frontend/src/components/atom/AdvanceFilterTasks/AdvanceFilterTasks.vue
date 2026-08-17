<template>
    <template v-if="props.activeTab === 'tasks'">
        <div v-if="(props.taskObj.TaskName)" class="advancefilter__body--list d-flex justify-content-between align-items-center">
            <div class="advancefilter__body--list--left d-flex align-items-center">
                <div class="advancefilter__body--list--left--image">
                    <div v-if="findParticularProject(props.taskObj.ProjectID)?.taskTypeCounts.find((otr)=> otr.key === props.taskObj.TaskTypeKey)?.taskImage">
                        <TaskTypeIcon
                            class="onlyComment"
                            :taskType="findParticularProject(props.taskObj.ProjectID)?.taskTypeCounts.find((otr)=> otr.key === props.taskObj.TaskTypeKey) || {}"
                        />
                    </div>
                </div>
                <div class="advancefilter__body--list--left--content advancefilter__body--projectname">
                    <div class="d-flex align-items-center">
                        <div class="d-flex align-items-center advancefilter__body--taskblock">
                            <span class="d-block" :style="[{'background-color':(props?.allTaskStatusArray && props.allTaskStatusArray?.settings?.length) ? props?.allTaskStatusArray?.settings.find((ut)=> ut.key === props?.taskObj?.statusKey)?.bgColor : '','width':'10px','height':'10px','margin-right': '5px'}]"></span>
                            <span class="advancefilter__body--taskstatus gray81 status_text_overflow">
                                {{(props?.allTaskStatusArray && props?.allTaskStatusArray?.settings?.length) ? props.allTaskStatusArray?.settings.find((ut)=> ut.key === props?.taskObj?.statusKey)?.name : ''}}
                            </span>
                        </div>
                        <div v-if="findParticularProject(props?.taskObj?.ProjectID)" class="text-ellipse">
                            <span class="advancefilter__body--taskstatus gray81" v-if="props.taskObj?.folderArray">
                                {{findParticularProject(props.taskObj?.ProjectID)?.ProjectName}} /
                                <img src="@/assets/images/folder.png" />
                                {{props.taskObj?.folderArray?.name}}
                                / {{props.taskObj?.sprintArray?.name}}
                            </span>
                            <span class="advancefilter__body--taskstatus gray81" v-else-if="props.taskObj?.sprintArray?.name">
                                {{findParticularProject(props.taskObj?.ProjectID)?.ProjectName}} / 
                                {{props.taskObj?.sprintArray?.name}}
                            </span>
                        </div>
                    </div>
                    <div class="d-flex align-items-center">
                        <span class="advancefilter__body--marginright" v-if="props.taskObj?.isParentTask === false"><img :src="subTaskImage" /> </span>
                        <span class="advancefilter__body--marginright"><img :src="favourite(props.taskObj?.favouriteTasks) && favourite(props.taskObj?.favouriteTasks)?.length ? filledStar : blankStar" /></span>
                        <span class="advancefilter__body--taskname black text-ellipse d-block advancefilter__body--width" v-html="highlightSearchTerm(props.taskObj?.TaskName)"></span>
                    </div>
                </div>
            </div>
            <div class="advancefilter__body--list--right">
                <ul class="advancefilter__body--ul align-items-center">
                    <li class="cursor-pointer advancefilter__body--newtab" @click="openModel(props.taskObj)">
                        <img :src="imgOpenSameTab" alt="Copy Link"/>
                    </li>
                    <li class="cursor-pointer advancefilter__body--newtab" @click="openInNewTab(props.taskObj)">
                        <img :src="imgOpenNewTab" alt="Copy Link"/>
                    </li>
                    <li class="cursor-pointer" @click="copyLink(props.taskObj)">
                        <img :src="imgCopyLink" alt="Copy Link"/>
                    </li>
                </ul>
            </div>
        </div>
    </template>
    <TaskDetail
        v-if="isTaskDetail"
        :companyId="companyId"
        :projectId="projectId"
        :sprintId="sprintId"
        :taskId="taskId"
        :isTaskDetailSideBar="isTaskDetail"
        @toggleTaskDetail="toggleTaskDetail"
        :zIndex='9'
    />
</template>

<script setup>
    import { inject,defineProps,ref,provide, nextTick } from 'vue';
    import { useToast } from 'vue-toast-notification';
    import {filterFun} from '@/components/molecules/AdvanceSearch/helper';
    import TaskDetail from '@/views/TaskDetail/TaskDetail.vue';
    import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
    import { useRoute, useRouter } from 'vue-router';
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();
    import { useCustomComposable } from '../../../composable';
    const { generateTaskURL } = filterFun();
    const $toast = useToast();
    const {sanitizeInput} = useCustomComposable();

    //inject
    const userId = inject("$userId");
    const companyId = inject("$companyId");
    // variable
    const isTaskDetail = ref(false);
    // const selectedTask = ref({});
    const projectId = ref('');
    const sprintId = ref('');
    const taskId = ref('');
    const route = useRoute();
    const router = useRouter();

    // image
    const filledStar = require("@/assets/images/svg/start10.svg");
    const blankStar = require("@/assets/images/svg/blankStar.svg");
    const subTaskImage = require("@/assets/images/svg/sub_task_image.svg");
    const imgCopyLink = require('@/assets/images/png/task_copy_link.png');
    const imgOpenNewTab = require('@/assets/images/png/task_open_new_tab.png');
    const imgOpenSameTab = require('@/assets/images/svg/entertoopen.svg');
    // props
    const props = defineProps({
        taskObj : {type:Object,required:true},
        activeTab:{type:String,default:'all'},
        allProjectsArray:{type:Array,required:true},
        allTaskStatusArray:{type:Object,required:true},
        searchText:{type:String,default:""}
    });
    // favourite function
    const favourite = (value) => {
        if(value && value.length){
            let filteredArray = value
            if(typeof value[0] === 'string'){
                filteredArray = value
            }
            const filteredArrayId = filteredArray.filter((x) => x === userId.value);
            return filteredArrayId;
        }else{
            return [];
        }
    };
    const findParticularProject = (id) => {
        if(props.allProjectsArray && props.allProjectsArray.length && id){
            return props.allProjectsArray.find((xt) => xt._id === id)
        }else{
            return []
        }
    };
    const highlightSearchTerm = (text) => {
        if(props.searchText){
            const regex = new RegExp(`(${props.searchText})`, 'gi');
            return text.replace(regex, '<mark>$1</mark>');
        }else{
            return sanitizeInput(text);
        }
    };

    // This function is use to copy link of selected task
    const copyLink = (task) => {
        generateTaskURL(task,companyId.value).then((url)=>{
            navigator.clipboard.writeText(url);
            $toast.success(t("Toast.Link_is_Copied_to_clipboard"),{position: 'top-right'});
        });
    };
    // Open task in new tab
    const openModel = (task) => {
        isTaskDetail.value = true;
        projectId.value = task.ProjectID
        sprintId.value = task.sprintId
        taskId.value = task._id
        // generateTaskURL(task,companyId.value).then((url)=>{
        //     window.open(url, '_blank');
        // });  
    };
    // Open task in new tab
    const openInNewTab = (task) => {
        generateTaskURL(task,companyId.value).then((url)=>{
            window.open(url, '_blank');
        });
    };
    const toggleTaskDetail = (task,close=false) => {
        isTaskDetail.value = false;
        if(close == true) {
            router.push({...route,query: {}})
            return;
        }
        projectId.value = '';
        sprintId.value = '';
        taskId.value = '';
        nextTick(()=>{
            router.push({...route,query: {detailTab: "task-detail-tab"}})
            openModel(task);
        })
    }
    provide('toggleTaskDetail', toggleTaskDetail);
    provide('isSupport', ref(false));
    provide('isRouteRequired', false);
    provide('showArchived', ref(false));
</script>
<style scoped>
.onlyComment{
    width: 18px !important;
    height: 18px !important;
}
</style>
