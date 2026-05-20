<template>
    <template v-if="(props.activeTab === 'comments')">
        <div class="advancefilter__body--list advancefilter__body--listComment d-flex justify-content-between align-items-center">
            <div class="advancefilter__body--list--left d-flex align-items-center">
                <div class="advancefilter__body--list--left--image">
                    <div v-if="props.commentObj.type === 'text'">
                        <img :src="onlyComment" alt="onlyComment" class="onlyComment">
                    </div>
                    <div v-else-if="props.commentObj.type === 'link'">
                        <img :src="linkImage" alt="link" class="onlyComment">
                    </div>
                    <div v-else>
                        <ImageIcon
                            v-if="props.commentObj.mediaURL.includes('http')"
                            :src="props.commentObj.mediaURL"
                            :alt="props.commentObj.mediaName"
                            :extension="props.commentObj.type === 'audio' ? props.commentObj.mediaURL.includes('mp3') ? 'mp3' : props.commentObj.mediaURL.includes('mp4') ? 'mp4' : '' : props.commentObj.type"
                            class="onlyComment"
                        />
                        <WasabiImage 
                            v-else
                            class="onlyComment"
                            :data="{url: props.commentObj.mediaURL}"
                            :extension="props.commentObj.type === 'audio' ? props.commentObj.mediaURL.includes('mp3') ? 'mp3' : props.commentObj.mediaURL.includes('mp4') ? 'mp4' : '' : props.commentObj.type"
                        />
                    </div>
                </div>
                <div class="advancefilter__body--list--left--content advancefilter__body--projectname">
                    <div v-if="findParticularProject(props.commentObj.projectId)">
                        <div v-if="props.commentObj.project === true" class="text-ellipse text-ellipse-responsive">
                            <span class="advancefilter__body--taskstatus gray81">
                                {{findParticularProject(props.commentObj.projectId)?.ProjectName}}
                                <span class="advancefilter__body--pipeline" v-if="clientWidth >= 480">
                                    {{getDateAndTime(props.commentObj.createdAt)}}
                                </span>
                            </span>
                        </div>
                        <div v-else class="text-ellipse text-ellipse-responsive">
                            <span class="advancefilter__body--taskstatus gray81" v-if="props.commentObj?.folderArray">
                                {{findParticularProject(props.commentObj.projectId).ProjectName}} /
                                    <span v-if="props.commentObj?.folderArray?.name">
                                        <img src="@/assets/images/folder.png" /> {{props.commentObj?.folderArray?.name}} / 
                                    </span>
                                    {{props.commentObj?.sprintArray?.name}}
                                <span class="advancefilter__body--pipeline" v-if="clientWidth >= 480">
                                    {{getDateAndTime(props.commentObj.createdAt)}}
                                </span>
                            </span>
                            <span class="advancefilter__body--taskstatus gray81" v-else-if="props.commentObj?.sprintArray?.name">
                                {{findParticularProject(props.commentObj.projectId).ProjectName}} / 
                                {{props.commentObj?.sprintArray.name}}
                                <span class="advancefilter__body--pipeline" v-if="clientWidth >= 480">
                                    {{getDateAndTime(props.commentObj.createdAt)}}
                                </span>
                            </span>
                        </div>
                    </div>
                    <div v-if="props.commentObj.type === 'text'">
                        <span class="black d-block advancefilter__body--width">
                            <pre
                                class="advancefilter__body--taskname m-0 text-ellipse text-ellipse-responsive"
                                v-html="sanitizeInline(hightlight(props.commentObj.message))"
                            />
                        </span>
                    </div>
                    <div v-else-if="props.commentObj.type === 'link'">
                        <span class="black d-block advancefilter__body--width">
                            <pre
                                class="advancefilter__body--taskname m-0 text-ellipse text-ellipse-responsive"
                                v-html="sanitizeInline(hightlight(props.commentObj.message))"
                            />
                        </span>
                    </div>
                    <div v-else>
                        <span class="black d-block advancefilter__body--width">
                            <pre
                                class="advancefilter__body--taskname m-0 text-ellipse text-ellipse-responsive"
                                v-html="sanitizeInline(hightlight(props.commentObj.mediaName))"
                            />
                        </span>
                    </div>
                </div>
            </div>
            <div class="advancefilter__body--list--right">
                <ul class="advancefilter__body--ul">
                    <li class="cursor-pointer advancefilter__body--newtab" v-if="props.commentObj.project === false" @click="openInSameTabComments(props.commentObj)">
                        <img :src="imgOpenSameTab" alt="Copy Link"/>
                    </li>
                    <li class="cursor-pointer advancefilter__body--newtab" @click="openInNewTabComments(props.commentObj)">
                        <img :src="imgOpenNewTab" alt="Copy Link"/>
                    </li>
                    <li class="cursor-pointer" @click="copyLinkComments(props.commentObj)">
                        <img :src="imgCopyLink" alt="Copy Link"/>
                    </li>
                </ul>
            </div>
        </div>
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
</template>

<script setup>
    import { useToast } from 'vue-toast-notification';
    import { defineProps,inject,nextTick,provide,ref } from 'vue';
    // import { useCustomComposable } from '@/composable';
    import TaskDetail from '@/views/TaskDetail/TaskDetail.vue'
    import { useRoute, useRouter } from 'vue-router';
    import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
    import ImageIcon from "@/components/atom/ImageIcon/ImageIcon.vue"
    import { useProjects } from '@/composable/projects';
    import { useI18n } from "vue-i18n";
    import { sanitizeInline } from '@/utils/sanitizeHtml';
    const { t } = useI18n();
    const {getDateAndTime} = useProjects();
    const route = useRoute();
    const router = useRouter();
    // import { useRoute, useRouter } from 'vue-router';
    // const route = useRoute();
    // const router = useRouter();
    // const {changeText} = useCustomComposable();
    const $toast = useToast();

    // inject
    const companyId = inject("$companyId");
    const clientWidth = inject("$clientWidth");

    // variable 
    const isTaskDetail = ref(false);
    // const selectedTask = ref({});
    const projectId = ref('');
    const sprintId = ref('');
    const taskId = ref('');
    
    // Images
    const imgCopyLink = require('@/assets/images/png/task_copy_link.png');
    const imgOpenNewTab = require('@/assets/images/png/task_open_new_tab.png');
    const onlyComment = require("@/assets/images/svg/Chat_blue.svg");
    const linkImage = require('@/assets/images/svg/link_image_svg.svg');
    const imgOpenSameTab = require('@/assets/images/svg/entertoopen.svg');

    // props
    const props = defineProps({
        commentObj : {type:Object,required:true},
        activeTab:{type:String,default:'all'},
        allProjectsArray:{type:Array,required:true},
        searchText:{type:String,default:''}
    });

    // Open comments in new tab
    const openInSameTabComments = (task) => {
        if(task.project === false){
            projectId.value = task.projectId ? task.projectId : task.ProjectID
            sprintId.value = task.sprintId
            taskId.value = task.taskId ? task.taskId : task._id;
            isTaskDetail.value = true;
        }else{
            let url = generateCommentURL(task);
            window.open(url, '_blank');
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
        let path = '';
        let navigation = `${window.location.origin}/#`;

        if(obj.project === true){
            path = `${navigation}/${companyId.value}/project/${obj.projectId}/p?tab=Comments`
        }else{
            if(findParticularProject(obj.projectId).sprintsObj[obj.sprintId]?.name){
                path = `${navigation}/${companyId.value}/project/${obj.projectId}/s/${obj.sprintId}/${obj.taskId}?detailTab=comment`
            }else{
                if(obj?.sprintArray?.folderId && obj?.sprintArray?._id){
                    path = `${navigation}/${companyId.value}/project/${obj.projectId}/fs/${obj?.sprintArray?.folderId}/${obj?.sprintArray?._id}/${obj.taskId}?detailTab=comment`;
                }
                else if(obj?.sprintArray?._id){
                    path = `${navigation}/${companyId.value}/project/${obj.projectId}/s/${obj?.sprintArray?._id}/${obj.taskId}?detailTab=comment`;
                }
            }
        }
        return path;
    };
    const hightlight = (msg, wrapStart = `<b class="mentioned">`, wrapEnd = `</b>`) => {
        const mentionRegex = /@\[[\w ]+?\]\(\w{4,30}\)/gi;
        let mentions = msg.match(mentionRegex);

        if(mentions !== null) {
            mentions.forEach((mention) => {
                msg = msg.replace(mention, `${wrapStart}@${mention.split("]")[0].replace("@[", "")}${wrapEnd}`)
            })
        }
        if(props.searchText){
            const regex = new RegExp(`(${props.searchText})`, 'gi');
            return msg.replace(regex, '<mark>$1</mark>');
        }else{
            return msg;
        }
    }
    const findParticularProject = (id) => {
        if(props.allProjectsArray && props.allProjectsArray.length && id){
            return props.allProjectsArray.find((xt) => xt._id === id)
        }else{
            return []
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
            openInSameTabComments({...task,project: false});
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
