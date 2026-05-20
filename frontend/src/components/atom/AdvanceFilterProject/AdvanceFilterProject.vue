<template>
    <template v-if="(props.activeTab === 'project')">
        <div class="advancefilter__body--list advancefilter__body--listComment d-flex justify-content-between align-items-center" :class="[{'opacity-5' : props.projectObj?.isRestrict === true}]">
            <div class="advancefilter__body--list--left d-flex align-items-center">
                <div class="advancefilter__body--list--left--image">
                    <span v-if="props.projectObj.projectIcon && props.projectObj.projectIcon?.type === 'color'" class="d-flex align-items-center justify-content-center inital-box-setting-project ml-6px" :style="[{'background-color': props.projectObj.projectIcon.data}]">{{ props.projectObj.ProjectName.charAt(0).toUpperCase()}}</span>
                    <div v-if="props.projectObj.projectIcon && props.projectObj.projectIcon?.type === 'image'">
                        <WasabiImage  class="profile-sm-square ml-6px" v-if="!props.projectObj.projectIcon.data.includes('http')" :data="{url: props.projectObj.projectIcon.data, filename: props.projectObj.projectIcon.data.split('/').pop(), extension: props.projectObj.projectIcon.data.split('/').pop().split('.').pop()}"/>
                        <img v-else  class="profile-sm-square ml-6px" :src="props.projectObj.projectIcon.data" alt=""/>
                    </div>
                </div>
                <div class="advancefilter__body--list--left--content advancefilter__body--projectname">
                    <div class="d-flex align-items-center">
                        <div class="d-flex align-items-center advancefilter__body--taskblock" v-if="props.projectObj?.projectStatusData && props.projectObj?.projectStatusData.length">
                            <span class="d-block mr-5px border-radius-1-px" :style="[{'background-color':props.projectObj.projectStatusData.find((status) => status.value.toLowerCase() === props.projectObj.status.toLowerCase()).textColor,'width':'9px','height':'9px'}]"></span>
                            <span class="advancefilter__body--taskstatus gray81">
                                {{ props.projectObj.projectStatusData.find((status) => status.value.toLowerCase() === props.projectObj.status.toLowerCase()).name }}
                            </span>
                        </div>
                        <img v-if="props.projectObj?.isPrivateSpace" :src="round_clock" alt="time" title="Private project" class="ml-2px">
                        <img v-if="!props.projectObj?.isPrivateSpace" :src="round_clock_open" alt="time" title="Private project" class="ml-2px">
                    </div>
                    <!-- <div v-if="findParticularProject(props.projectObj.projectId)">
                        <div v-if="props.projectObj.project === true">
                            <span class="advancefilter__body--taskstatus gray81">
                                {{findParticularProject(props.projectObj.projectId)?.ProjectName}}
                                <span class="advancefilter__body--pipeline">
                                    {{moment(props.projectObj.createdAt * 1000).format('ddd, D MMM, YYYY [at] h:mm a')}}
                                </span>
                            </span>
                        </div>
                        <div v-else>
                            <span class="advancefilter__body--taskstatus gray81" v-if="findParticularProject(props.projectObj.projectId).sprintsObj[props.projectObj.sprintId]?.name">
                                {{findParticularProject(props.projectObj.projectId).ProjectName}} / 
                                {{findParticularProject(props.projectObj.projectId).sprintsObj[props.projectObj.sprintId ? props.projectObj.sprintId : '']?.name}}
                                <span class="advancefilter__body--pipeline">
                                    {{moment(props.projectObj.createdAt * 1000).format('ddd, D MMM, YYYY [at] h:mm a')}}
                                </span>
                            </span>
                            <span class="advancefilter__body--taskstatus gray81" v-if="!findParticularProject(props.projectObj.projectId).sprintsObj[props.projectObj.sprintId]?.name">
                                {{findParticularProject(props.projectObj.projectId).ProjectName}} /
                                <template v-for="(folder,folderIndex) in findParticularProject(props.projectObj.projectId).sprintsfolders" :key="folderIndex">
                                    <span v-if="folder.sprintsObj[props.projectObj.sprintId]?.name">
                                        <img src="@/assets/images/folder.png" /> {{folder.name}} / 
                                    </span>
                                    {{folder.sprintsObj[props.projectObj.sprintId]?.name}}
                                </template>
                                <span class="advancefilter__body--pipeline">
                                    {{moment(props.projectObj.createdAt * 1000).format('ddd, D MMM, YYYY [at] h:mm a')}}
                                </span>
                            </span>
                        </div>
                    </div> -->
                    <div class="d-flex align-items-center">
                        <span class="advancefilter__body--marginright"><img :src="favourite ? filledStar : blankStar" /></span>
                        <span class="advancefilter__body--taskname m-0 text-ellipse black d-block advancefilter__body--width" v-html="sanitizeInline(highlightSearchTerm(props.projectObj.ProjectName))"></span>
                    </div>
                </div>
            </div>
            <div class="advancefilter__body--list--right">
                <ul class="advancefilter__body--ul">
                    <li class="cursor-pointer advancefilter__body--newtab" @click="openInNewTab(props.projectObj)">
                        <img :src="imgOpenNewTab" alt="Copy Link"/>
                    </li>
                    <li class="cursor-pointer" @click="copyLink(props.projectObj)">
                        <img :src="imgCopyLink" alt="Copy Link"/>
                    </li>
                </ul>
            </div>
        </div>
    </template>
</template>
<script setup>
    import { defineProps,inject,computed } from 'vue';
    import { useToast } from 'vue-toast-notification';
    import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();
    import { useCustomComposable } from '../../../composable';
    import { sanitizeInline } from '@/utils/sanitizeHtml';

    //inject
    const companyId = inject("$companyId");
    const userId = inject('$userId');

    // helper
    const $toast = useToast();

    // props
    const props = defineProps({
        activeTab:{type:String,default:'all'},
        projectObj : {type:Object,required:true},
        allProjectsArray:{type:Array,required:true},
        searchText:{type:String,default:""}
    });
    const {sanitizeInput} = useCustomComposable();

    // computed
    const favourite = computed(() => {
        return props.projectObj.favouriteTasks && props.projectObj.favouriteTasks.length && props.projectObj.favouriteTasks.filter((x) => userId.value && x.userId === userId.value).length;
    });

    // Images
    const imgCopyLink = require('@/assets/images/png/task_copy_link.png');
    const imgOpenNewTab = require('@/assets/images/png/task_open_new_tab.png');
    const round_clock = require("@/assets/images/svg/round_lock.svg");
    const round_clock_open = require("@/assets/images/svg/openProject.svg");
    const filledStar = require("@/assets/images/svg/start10.svg");
    const blankStar = require("@/assets/images/svg/blankStar.svg");

    // This function is use to copy link of selected task
    const copyLink = (project) => {
        generateProjectURL(project).then((url)=>{
            navigator.clipboard.writeText(url);
            $toast.success(t("Toast.Link_is_Copied_to_clipboard"),{position: 'top-right'});
        });
    };
    // Open task in new tab
    const openInNewTab = (project) => {
        generateProjectURL(project).then((url)=>{
            window.open(url, '_blank');
        });  
    };
    const highlightSearchTerm = (text) => {
        if(props.searchText){
            const regex = new RegExp(`(${props.searchText})`, 'gi');
            return text.replace(regex, '<mark>$1</mark>');
        }else{
            return sanitizeInput(text);
        }
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
</script>
<style scoped>
.profile-sm-square{
    min-width: 28px !important;
    height: 28px !important;
}
</style>
