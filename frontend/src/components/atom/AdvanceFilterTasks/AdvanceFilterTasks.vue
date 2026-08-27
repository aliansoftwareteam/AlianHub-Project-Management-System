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
                        <button type="button" class="advancefilter__body--taskname black text-ellipse d-block advancefilter__body--width cursor-pointer" @click="openInApp($event, props.taskObj)" v-html="highlightSearchTerm(props.taskObj?.TaskName)"></button>
                    </div>
                </div>
            </div>
            <div class="advancefilter__body--list--right">
                <ul class="advancefilter__body--ul align-items-center">
                    <li class="cursor-pointer advancefilter__body--newtab">
                        <button type="button" @click="openInApp($event, props.taskObj)">
                            <img :src="imgOpenSameTab" alt="Open"/>
                        </button>
                    </li>
                    <li class="cursor-pointer advancefilter__body--newtab">
                        <button type="button" @click="openInApp($event, props.taskObj)">
                            <img :src="imgOpenNewTab" alt="Open"/>
                        </button>
                    </li>
                    <li class="cursor-pointer" @click="copyLink(props.taskObj)">
                        <img :src="imgCopyLink" alt="Copy Link"/>
                    </li>
                </ul>
            </div>
        </div>
    </template>
</template>

<script setup>
    import { inject,defineProps } from 'vue';
    import { useToast } from 'vue-toast-notification';
    import {filterFun} from '@/components/molecules/AdvanceSearch/helper';
    import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
    import { useRouter, useRoute } from 'vue-router';
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();
    import { useCustomComposable } from '../../../composable';
    import { firstId, injectedId, resolveTaskOpenIds, sameId, taskOpenRoute } from '@/utils/taskOpenProjectId';
    const { generateTaskURL } = filterFun();
    const $toast = useToast();
    const {sanitizeInput} = useCustomComposable();

    const userId = inject("$userId");
    const companyId = inject("$companyId");
    const closeAdvanceSearch = inject('closeAdvanceSearch', () => {});
    const router = useRouter();
    const route = useRoute();

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
            return props.allProjectsArray.find((xt) => sameId(xt._id, id))
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
    const companyIdNow = () => firstId(
        injectedId(companyId),
        route.params && route.params.cid,
        typeof localStorage !== 'undefined' && localStorage.getItem('selectedCompany'),
    );

    const taskDest = (task) => {
        const ids = resolveTaskOpenIds(task || {});
        return taskOpenRoute({
            companyId: companyIdNow(),
            projectId: ids.projectId,
            sprintId: ids.sprintId,
            taskId: ids.taskId,
            folderId: task && task.folderObjId,
        });
    };

    const copyLink = (task) => {
        generateTaskURL(task, companyIdNow()).then((url)=>{
            if (!url) return;
            navigator.clipboard.writeText(url);
            $toast.success(t("Toast.Link_is_Copied_to_clipboard"),{position: 'top-right'});
        });
    };
    const openInApp = (event, task) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
        const dest = taskDest(task);
        if (!dest) return;
        if (typeof closeAdvanceSearch === 'function') closeAdvanceSearch();
        router.push({ ...dest, query: { detailTab: 'task-detail-tab' } }).catch((error) => {
            console.error('ERROR opening search task: ', error);
            const path = router.resolve({ ...dest, query: { detailTab: 'task-detail-tab' } }).href || '';
            if (path) window.location.hash = path.replace(/^[^#]*#/, '');
        });
    };
</script>
<style scoped>
.onlyComment{
    width: 18px !important;
    height: 18px !important;
}
button.advancefilter__body--taskname {
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    font: inherit;
}
.advancefilter__body--newtab button {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
}
</style>
