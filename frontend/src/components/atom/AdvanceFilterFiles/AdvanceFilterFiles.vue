<template>
    <template v-if="props.activeTab === 'files'">
        <div v-if="props.taskObj.taskAttachment && props.taskObj.taskAttachment.length">
            <template v-for="(attachmentArray,attachmentArrayIndex) in Array.from(new Set(props?.taskObj?.taskAttachment))" :key="attachmentArrayIndex">
                <template v-if="attachmentArray?.attachments && attachmentArray?.attachments?.length">
                    <template v-for="(attachment,attachmentIndex) in Array.from(new Set(attachmentArray?.attachments))" :key="attachmentIndex">
                        <div class="advancefilter__body--list d-flex justify-content-between align-items-center" >
                            <div v-if="attachment?.url" class="d-flex align-items-center advancefilter__body--list--left">
                                <div class="advancefilter__body--list--left--image">
                                    <ImageIcon
                                        v-if="attachment?.url?.includes('http')"
                                        :src="attachment?.url"
                                        :alt="attachment?.filename"
                                        :extension="attachment?.extension"
                                        class="onlyComment"
                                    />
                                    <WasabiImage 
                                        v-else
                                        class="onlyComment"
                                        :data="{url: attachment?.url}"
                                        :extension="attachment?.extension"
                                    />
                                </div>
                                <div class="advancefilter__body--list--left--content advancefilter__body--projectname">
                                    <div v-if="findParticularProject(attachmentArray?.ProjectID)" class="text-ellipse text-ellipse-responsive">
                                        <span class="advancefilter__body--taskstatus gray81" v-if="attachmentArray?.folderData">
                                            {{findParticularProject(attachmentArray.ProjectID).ProjectName}} /
                                            <img src="@/assets/images/folder.png" /> 
                                            {{attachmentArray?.folderData?.name}}
                                            / {{attachmentArray?.sprintData?.name}}
                                            / {{attachmentArray?.TaskName}}
                                        </span>
                                        <span class="advancefilter__body--taskstatus gray81" v-else-if="attachmentArray?.sprintData">
                                            {{findParticularProject(attachmentArray?.ProjectID)?.ProjectName}} / 
                                            {{attachmentArray?.sprintData?.name}} / {{attachmentArray?.TaskName}}
                                        </span>
                                    </div>
                                    <div>
                                        <span class="advancefilter__body--taskname black text-ellipse d-block advancefilter__body--width" v-html="sanitizeInline(highlightSearchTerm(attachment.filename))"></span>
                                    </div>
                                </div>
                            </div>
                            <div class="advancefilter__body--list--right">
                                <ul class="advancefilter__body--ul">
                                    <li class="cursor-pointer advancefilter__body--newtab" @click="openModel(attachmentArray,'task')">
                                        <img :src="imgOpenSameTab" alt="Copy Link"/>
                                    </li>
                                    <li class="cursor-pointer advancefilter__body--newtab" @click="openInNewTab(attachmentArray)">
                                        <img :src="imgOpenNewTab" alt="Copy Link"/>
                                    </li>
                                    <li class="cursor-pointer" @click="copyLink(attachmentArray)">
                                        <img :src="imgCopyLink" alt="Copy Link"/>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </template>
                </template>
            </template>
        </div>
        <div v-if="props.taskObj?.attachments && props.taskObj.attachments?.length">
            <template v-for="(attachment,attachmentIndex) in Array.from(new Set(props.taskObj?.attachments))" :key="attachmentIndex">
                <div class="advancefilter__body--list d-flex justify-content-between align-items-center" >
                    <div v-if="attachment?.url" class="d-flex align-items-center advancefilter__body--list--left">
                        <div class="advancefilter__body--list--left--image">
                            <ImageIcon
                                v-if="attachment?.url?.includes('http')"
                                :src="attachment?.url"
                                :alt="attachment?.filename"
                                :extension="attachment?.extension"
                                class="onlyComment"
                            />
                            <WasabiImage 
                                v-else
                                class="onlyComment"
                                :data="{url: attachment?.url}"
                                :extension="attachment?.extension"
                            />
                        </div>
                        <div class="advancefilter__body--list--left--content advancefilter__body--projectname">
                            <div v-if="findParticularProject(props?.taskObj?._id)" class="text-ellipse text-ellipse-responsive">
                                <span class="advancefilter__body--taskstatus gray81" v-if="findParticularProject(props?.taskObj?._id)?.ProjectName">
                                    {{findParticularProject(props?.taskObj?._id)?.ProjectName}}
                                </span>
                            </div>
                            <div>
                                <span class="advancefilter__body--taskname black text-ellipse d-block advancefilter__body--width" v-html="sanitizeInline(highlightSearchTerm(attachment.filename))"></span>
                            </div>
                        </div>
                    </div>
                    <div class="advancefilter__body--list--right">
                        <ul class="advancefilter__body--ul">
                            <li class="cursor-pointer advancefilter__body--newtab" @click="openInNewTabProject(props?.taskObj)">
                                <img :src="imgOpenNewTab" alt="Copy Link"/>
                            </li>
                            <li class="cursor-pointer" @click="copyLinkProject(props?.taskObj)">
                                <img :src="imgCopyLink" alt="Copy Link"/>
                            </li>
                        </ul>
                    </div>
                </div>
            </template>
        </div>
        <div v-if="props.taskObj.commentsAttachment && props.taskObj.commentsAttachment.length">
            <template v-for="(attachment,attachmentArrayIndex) in Array.from(new Set(props.taskObj.commentsAttachment))"  :key="attachmentArrayIndex">
                <div class="advancefilter__body--list d-flex justify-content-between align-items-center" >
                    <div v-if="attachment?.mediaURL" class="d-flex align-items-center advancefilter__body--list--left">
                        <div class="advancefilter__body--list--left--image">
                            <ImageIcon
                                v-if="attachment?.mediaURL?.includes('http')"
                                :src="attachment?.mediaURL"
                                :alt="attachment?.mediaOriginalName"
                                :extension="attachment?.mediaOriginalName?.split('.')?.pop()"
                                class="onlyComment"
                            />
                            <WasabiImage 
                                v-else
                                class="onlyComment"
                                :data="{url: attachment?.mediaURL}"
                                :extension="attachment?.mediaOriginalName?.split('.')?.pop()"
                            />
                        </div>
                        <div class="advancefilter__body--list--left--content advancefilter__body--projectname">
                            <div v-if="findParticularProject(attachment?.projectId)">
                                <div v-if="attachment.project === true" class="text-ellipse text-ellipse-responsive">
                                    <span class="advancefilter__body--taskstatus gray81">
                                        {{findParticularProject(attachment?.projectId)?.ProjectName}}
                                    </span>
                                </div>
                                <div v-else class="text-ellipse text-ellipse-responsive">
                                    <span class="advancefilter__body--taskstatus gray81" v-if="findParticularProject(attachment?.projectId)?.sprintsObj[attachment.sprintId]?.name">
                                        {{findParticularProject(attachment?.projectId)?.ProjectName}} / 
                                        {{findParticularProject(attachment?.projectId)?.sprintsObj[attachment?.sprintId ? attachment?.sprintId : '']?.name}}
                                    </span>
                                    <span class="advancefilter__body--taskstatus gray81" v-if="!findParticularProject(attachment?.projectId)?.sprintsObj[attachment?.sprintId]?.name">
                                        {{findParticularProject(attachment.projectId).ProjectName}} /
                                        <template v-for="(folder,folderIndex) in findParticularProject(attachment?.projectId)?.sprintsfolders" :key="folderIndex">
                                            <span v-if="folder?.sprintsObj[attachment?.sprintId]?.name">
                                                <img src="@/assets/images/folder.png" /> {{folder?.name}} / 
                                            </span>
                                            {{folder?.sprintsObj[attachment?.sprintId]?.name}}
                                        </template>
                                    </span>
                                </div>
                            </div>
                            <div>
                                <span class="advancefilter__body--taskname black text-ellipse d-block advancefilter__body--width" v-html="sanitizeInline(highlightSearchTerm(attachment?.mediaOriginalName))"></span>
                            </div>
                        </div>
                    </div>
                    <div class="advancefilter__body--list--right">
                        <ul class="advancefilter__body--ul">
                            <li class="cursor-pointer advancefilter__body--newtab" v-if="attachment.project === false" @click="openModel(attachment,'comment')">
                                <img :src="imgOpenSameTab" alt="Copy Link"/>
                            </li>
                            <li class="cursor-pointer advancefilter__body--newtab" @click="openInNewTabComments(attachment)">
                                <img :src="imgOpenNewTab" alt="Copy Link"/>
                            </li>
                            <li class="cursor-pointer" @click="copyLinkComments(attachment)">
                                <img :src="imgCopyLink" alt="Copy Link"/>
                            </li>
                        </ul>
                    </div>
                </div>
            </template>
        </div>
        <div v-if="props.searchResultsLength === props.index + 1 && props.activeTab === 'files'">
            <div v-if="!props.searchResults.filter((x) => {return x?.taskAttachment?.length || x?.attachments?.length || x?.commentsAttachment?.length})?.length" class="nodata">{{$t('Filters.no_files_found')}}</div>
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
    import { defineProps,inject,ref,provide, nextTick } from 'vue';
    import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
    import ImageIcon from "@/components/atom/ImageIcon/ImageIcon.vue"
    import { useToast } from 'vue-toast-notification';
    import {filterFun} from '@/components/molecules/AdvanceSearch/helper';
    import TaskDetail from '@/views/TaskDetail/TaskDetail.vue'
    import { useRoute, useRouter } from 'vue-router';
    import { useI18n } from "vue-i18n";
    import { sanitizeInline } from '@/utils/sanitizeHtml';
    const { t } = useI18n();
    const route = useRoute();
    const router = useRouter();
    const { generateTaskURL } = filterFun();
    const $toast = useToast();

    //variable
    const isTaskDetail = ref(false);
    // const selectedTask = ref({});
    const projectId = ref('');
    const sprintId = ref('');
    const taskId = ref('');
    // inject
    const companyId = inject("$companyId");
    // Images
    const imgCopyLink = require('@/assets/images/png/task_copy_link.png');
    const imgOpenSameTab = require('@/assets/images/svg/entertoopen.svg');
    const imgOpenNewTab = require('@/assets/images/png/task_open_new_tab.png');
    // props
    const props = defineProps({
        taskObj : {type:Object,required:true},
        activeTab:{type:String,default:'all'},
        searchResultsLength:{type:Number,default:0},
        index:{type:Number,default:0},
        searchResults:{type:Array,required:true},
        allProjectsArray:{type:Array,required:true},
        searchText:{type:String,default:''}
    });
    const findParticularProject = (id) => {
        if(props.allProjectsArray && props.allProjectsArray.length && id){
            return props.allProjectsArray.find((xt) => xt._id === id)
        }else{
            return []
        }
    };

    // This function is use to copy link of selected task
    const copyLink = (task) => {
        generateTaskURL(task,companyId.value,'attachment').then((url)=>{
            navigator.clipboard.writeText(url);
            $toast.success(t("Toast.Link_is_Copied_to_clipboard"),{position: 'top-right'});
        });
    };
    const openModel = (task,action) => {
        isTaskDetail.value = true;
        if(action === 'task'){
            projectId.value = task.ProjectID;
            sprintId.value = task.sprintId;
            taskId.value = task._id;
        }else{
            projectId.value = task.projectId;
            sprintId.value = task.sprintId;
            taskId.value = task.taskId;
        }
    };
    // Open task in new tab
    const openInNewTab = (task) => {
        generateTaskURL(task,companyId.value,'attachment').then((url)=>{
            window.open(url, '_blank');
        });  
    };
    const highlightSearchTerm = (text) => {
        if(props.searchText){
            const regex = new RegExp(`(${props.searchText})`, 'gi');
            return text.replace(regex, '<mark>$1</mark>');
        }else{
            return text;
        }
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
            openModel(task,'task');
        })
    }
    provide('toggleTaskDetail', toggleTaskDetail);
    provide('isSupport', ref(false));
    provide('isRouteRequired', false);
    provide('showArchived', ref(false));
    const copyLinkProject = (project) => {
        generateProjectURL(project).then((url)=>{
            navigator.clipboard.writeText(url);
            $toast.success(t("Toast.Link_is_Copied_to_clipboard"),{position: 'top-right'});
        });
    };
    // Open task in new tab
    const openInNewTabProject = (project) => {
        generateProjectURL(project).then((url)=>{
            window.open(url, '_blank');
        });  
    };
    const generateProjectURL = (obj) => {
        try {
            return new Promise((resolve, reject) => {
                try{
                    let path = null;
                    let navigation = `${window.location.origin}/#`;
                    path = `${navigation}/${companyId.value}/project/${obj._id}/p?tab=ProjectDetail`
                    resolve(path);
                } catch (e) {
                    reject(e)
                    console.error(e);
                }
            });
        }catch (e) {
            console.error(e);
        }
    };
    const openInNewTabComments = (task) => {
        let url = generateCommentURL(task);
        window.open(url, '_blank');
    };

    // This function is use to copy link of selected comments
    const copyLinkComments = (task) => {
        let url = generateCommentURL(task);
        navigator.clipboard.writeText(url);
        $toast.success(t("Toast.Link_is_Copied_to_clipboard"),{position: 'top-right'});
    };

    const generateCommentURL = (obj) => {
        let path = null;
        let navigation = `${window.location.origin}/#`;

        if(obj.project === true){
            path = `${navigation}/${companyId.value}/project/${obj.projectId}/p?tab=Comments`
        }else{
            if(findParticularProject(obj.projectId).sprintsObj[obj.sprintId]?.name){
                path = `${navigation}/${companyId.value}/project/${obj.projectId}/s/${obj.sprintId}/${obj.taskId}?detailTab=comment`
            }else{
                let folderIndexVar = ''
                for (let folder in  findParticularProject(obj.projectId).sprintsfolders) {
                    if(findParticularProject(obj.projectId).sprintsfolders[folder].sprintsObj[obj.sprintId]?.name){
                        folderIndexVar = folder
                        break;
                    }else{
                        folderIndexVar = ''
                    }
                }
                path = `${navigation}/${companyId.value}/project/${obj.projectId}/fs/${folderIndexVar}/${obj.sprintId}/${obj.taskId}?detailTab=comment`;
            }
        }
        return path;
    };
</script>
<style scoped>
.onlyComment{
    width: 18px !important;
    height: 18px !important;
}
</style>
