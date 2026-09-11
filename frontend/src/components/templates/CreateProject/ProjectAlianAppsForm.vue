<!-- =========================================================================================
    Created By : Dipsha Kalariya
    Commnet : This component is used to display project alian defaul app detail for blank project form as step-7 in create project module.
========================================================================================== -->
<template>
<div id="project-step-container" class="ProjectShareGraphicModel addProjectEnabale borderChange mobile-project-taskstatus-section">
    <div class="modalHeader bg-light-gray text-center p-1" :class="{'border-radius-5-px': clientWidth > 767 , 'border-radius-8-px': clientWidth <= 767}">
        <h3 class="m-0" :class="{'task-heading-desktop': clientWidth > 767 , 'task-heading-mobile': clientWidth <= 767}">{{$t('Projects.choose_apps')}}</h3>
    </div>
    <div class="checkBox_Text">
        <div class="d-flex align-items-center justify-content-center">
            <Toggle
                class="mr-10px"
                :modelValue="allSelected"
                activeColor="#3845B3"
                @click="(e) =>{checkOnOff(e)}"
                width="30"
            />
            <p class="turnOff">{{ $t('Templates.Turn') }} {{theModel && theModel.length>0 && theModel.filter((x) => x.appStatus).length === theModel.length ? $t('Templates.off') : $t('Templates.on')}} {{ $t('Templates.all_apps') }}</p>
        </div>
        <div class="d-flex align-items-center justify-content-between enable-app-data style-scroll flex-wrap">
            <label class="cat action" :class="{'border-radius-7-px enable-cataction-desktop': clientWidth > 767 , 'border-radius-8-px enable-cataction-mobile': clientWidth <= 767}" v-for="(appData,key) in theModel" v-bind:key="key"  :style="[{'border': appData.appStatus ? '1.5px solid #3845B3' :'' }]">
                <input type="checkbox" value="Priority" v-model.trim="appData.appStatus" :checked="appData.appStatus" />
                <div class="Image_other d-flex align-items-center justify-content-between" @click="manageApps(appData)">
                    <div class="d-flex align-items-center">
                        <img v-if="!appData.appStatus" alt="information" :src="getImageUrl(appData)">
                        <img v-if="appData.appStatus" alt="information" :src="getImageUrl(appData)">
                        <h4 class="changesFont ml-15px" :class="{'enableapp-list-desktop': clientWidth > 767 , 'enableapp-list-mobile': clientWidth <= 767}" :style="[{'color': appData.appStatus ? '#3845B3 !important' :'' }]" >{{$t(`Apps.${appData.key}`)}}</h4> 
                    </div>
                    <Tooltip :isImage="true" :Image="clientWidth > 767 ? information : information_svg" :text="getTooptipText(appData.key)" width="150px" />
                </div>
            </label>
        </div>
    </div>
</div>
</template>
<script setup>
import { ref, onMounted, inject, computed, watch } from "vue";
import Toggle from "@/components/atom/Toggle/Toggle.vue";
import { useStore } from 'vuex';
import {customField} from '../../../plugins/customFieldView/helper.js'
import * as env from '@/config/env';
import { apiRequest } from '@/services';
import { useI18n } from "vue-i18n";
import Tooltip from "@/components/molecules/ToolTip/ToolTip.vue";    
const { t } = useI18n();

    const {projectAlianApp} = customField();
    const { getters } = useStore();

    const props = defineProps({
        modelValue : {
            type : Object,
            default : (()=>{})
        }
    })
    const theModel = ref(props.modelValue);
    const clientWidth = inject("$clientWidth");
    const information = require("@/assets/images/information.png");
    const information_svg = require("@/assets/images/svg/information_svg.svg");
    const multipleAssigneBlue = require("@/assets/images/svg/mutipleblue.svg");
    const multipleAssigneGray = require("@/assets/images/svg/mutiplegrey.svg");
    const timeBlue = require("@/assets/images/svg/timeBlue.svg");
    const timeGray = require("@/assets/images/svg/timegrey.svg");
    const priorityBlue = require("@/assets/images/svg/priorityBlue.svg");
    const priorityGray = require("@/assets/images/svg/priorityGray.svg");
    const timetrackingBlue = require("@/assets/images/svg/timevalueblue.svg");
    const timetrackingGray = require("@/assets/images/svg/timetrackinggray.svg");
    const milestoneBlue = require("@/assets/images/svg/checkflagblue.svg");
    const milestoneGray = require("@/assets/images/svg/checkflaggrey.svg");
    const tagsBlue = require("@/assets/images/svg/tagsblue.svg");
    const tagsGray = require("@/assets/images/svg/tagsgrey.svg");
    const editBlue = require("@/assets/images/svg/editblue.svg");
    const editGray = require("@/assets/images/svg/editgray.svg");
    const aiGray = require("@/assets/images/svg/AI_inactive_gray.svg");
    const aiBlue = require("@/assets/images/svg/AI_active_blue.svg");

    const currentCompany = computed(() => getters['settings/selectedCompany']);

    onMounted(() => {
        if(theModel.value.length <= 0 || theModel.value.length == undefined){
            getAllApps();
        }
    })
    watch(()=> props.modelValue ,(val)=>{
        theModel.value = val;
    })
    const emit = defineEmits([
        'update:modelValue'
    ]);
    const allSelected = computed(() => {
        return theModel.value && theModel.value.length>0 && theModel.value.filter((x) => x.appStatus).length === theModel.value.length});

    function getAllApps(){

        apiRequest('get',env.PROJECTS_APPS)
        .then((querySnapshot) => {

            if(querySnapshot.status !== 200){
                return
            }

            let data = querySnapshot.data?.data || []

            const arr = [...projectAlianApp()];
            if(!currentCompany.value?.planFeature?.projectProjectApp){
                arr.push("Priority")
            }
            if(!currentCompany.value?.planFeature?.tagProjectApp){
                arr.push("tags")
            }
            const temp = data.filter((item) => {
                if(!arr.includes(item.key)) {
                    return item;
                }
            });
            temp.sort((a, b) => a.sortIndex - b.sortIndex);
            theModel.value = temp.map((x) => ({...x,appStatus:true}));
            emit('update:modelValue', theModel.value);
        })
        .catch((error) => {
            console.error(error,"EROOR")
        })
    }
    function manageApps(){
        emit('update:modelValue', theModel.value);
    }
    function checkOnOff(e){
        if(!e){
            theModel.value = theModel.value.map((x) => ({...x, appStatus: true}))
        }else{
            theModel.value = theModel.value.map((x) => ({...x, appStatus: false}))
        }
        emit('update:modelValue', theModel.value);
    }

    function getImageUrl (item) {
        if(item.name === 'Multiple Assignees' && item.appStatus === false){
            return multipleAssigneGray;
        }
        if(item.name === 'Multiple Assignees' && item.appStatus === true){
            return multipleAssigneBlue;
        }
        if(item.name === 'Time Estimate' && item.appStatus === true){
            return timeBlue;
        }
        if(item.name === 'Time Estimate' && item.appStatus === false){
            return timeGray;
        }
        if(item.name === 'Priority' && item.appStatus === true){
            return priorityBlue;
        }
        if(item.name === 'Priority' && item.appStatus === false){
            return priorityGray;
        }
        if(item.name === 'Time Tracking' && item.appStatus === true){
            return timetrackingBlue;
        }
        if(item.name === 'Time Tracking' && item.appStatus === false){
            return timetrackingGray;
        }
        if(item.name === 'Milestones' && item.appStatus === true){
            return milestoneBlue;
        }
        if(item.name === 'Milestones' && item.appStatus === false){
            return milestoneGray;
        }
        if(item.name === 'Tags' && item.appStatus === true){
            return tagsBlue;
        }
        if(item.name === 'Tags' && item.appStatus === false){
            return tagsGray;
        }
        if(item.name === 'Custom Fields'){
            if(item.appStatus === false) {
                return editGray;
            } else {
                return editBlue;
            }
        }
        if(item.name === 'AI'){
            if(item.appStatus === false) {
                return aiGray;
            } else {
                return aiBlue;
            }
        }
    }

    function getTooptipText(key) {
        switch (key) {
            case "Priority":
                return `${t('tooltipText.enable_app_manage_priority')}`;
            case "MultipleAssignees":
                return `${t('tooltipText.enable_app_manage_multiple_assignee')}`;
            case "TimeEstimates":
                return `${t('tooltipText.enable_app_manage_time_estimates')}`;
            case "Milestones":
                return `${t('tooltipText.enable_app_use_milestones')}`;
            case "tags":
                return `${t('tooltipText.enable_app_manage_tags')}`;
            case "CustomFields":
                return `${t('tooltipText.enable_app_manage_custom_fields')}`;
            case "TimeTracking":
                return `${t('tooltipText.enable_app_manage_time_log')}`;
            case "AI":
                return `${t('tooltipText.enable_app_use_ai_operations')}`;
            default:
                break;
        }
    }
</script>
<style scoped>
@import './style.css';

</style>

