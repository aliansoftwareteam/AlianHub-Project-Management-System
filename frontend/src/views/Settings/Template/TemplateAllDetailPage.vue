<!-- =========================================================================================
    Created By : Dipsha Kalariya
    Commnet : This component is used to display all project selected detail for blank project form as step-9 in create project module.
========================================================================================== -->
<template>
<div id="project-step-container" class="ProjectShareGraphicModel addProjectEnabale borderChange mobile-project-taskstatus-section">
    <div class="modalHeader bg-light-gray mb-28px"
    :style="[{padding : clientWidth > 767 ? '16.5px' : '18.5px'}]"
    :class="{'border-radius-5-px': clientWidth > 767 , 'border-radius-8-px': clientWidth <= 767}"
    >
        <h3 class="m-0" :class="{'task-heading-desktop': clientWidth > 767 , 'task-heading-mobile': clientWidth <= 767}">{{$t('Templates.all_good')}} ?</h3>
    </div>
    <div class="Allgood">
        <div class="d-flex justify-content-between align-items-center allgoodproject allgoodprojectvalue">
            <h5>{{ $t('Templates.project_status') }}</h5>
            <ul class="d-flex align-items-center">
                <li class="setImagevalue" v-for="(status,index) in [...theModel.projectStatusForm.projectStatusField.value.projectActiveStatus, ...theModel.projectStatusForm.projectStatusField.value.projectDoneStatus, {...theModel.projectStatusForm.projectStatusField.value.projectCompletedStatus}]" :key="index">
                    <span :title="status.name" class="default-status-squer d-inline-block border-radius-2-px status__name" :style="[{'background-color': status.textColor,'cursor': 'pointer'}]"></span>
                </li>
            </ul>
        </div>
        <div class="d-flex justify-content-between align-items-center allgoodproject allgoodprojectvalue">
            <h5>{{$t('Projects.task_type')}}</h5>
            <ul class="d-flex align-items-center" v-if="theModel.taskTypeForm.taskTypeField.value && Object.keys(theModel.taskTypeForm.taskTypeField.value).length">
                <li class="setImagevalue cursor-pointer" v-for="(taskType,index) in theModel.taskTypeForm.taskTypeField.value.taskTypes" :key="index">
                    <TaskTypeIcon :taskType="taskType" :title="taskType.name" class="task-type-image-block" />
                </li>
            </ul>
        </div>
        <div class="d-flex justify-content-between align-items-center allgoodproject allgoodprojectvalue">
            <h5>{{$t('Templates.task_status')}}</h5>
            <ul class="d-flex align-items-center" v-if="theModel.taskStatusForm.taskStatusField.value && Object.keys(theModel.taskStatusForm.taskStatusField.value).length">
                <li class="setImagevalue" v-for="(status,index) in [theModel.taskStatusForm.taskStatusField.value.defaultActive, ...theModel.taskStatusForm.taskStatusField.value.ActiveStatusList, ...theModel.taskStatusForm.taskStatusField.value.DoneStatusList, theModel.taskStatusForm.taskStatusField.value.defaultComplete]" :key="index">
                    <span :title="status.name" class="default-status-squer d-inline-block border-radius-2-px status__name" :style="[{'background-color': status.textColor,'cursor': 'pointer'}]"></span>
                </li>
            </ul>
        </div>
        <div class="d-flex justify-content-between align-items-center allgoodproject allgoodprojectvalue">
            <h5>{{ $t('Templates.apps') }}</h5>
            <ul class="d-flex align-items-center" v-if="alianAppsFlag">
                <template v-for="(appData,ids) in theModel.alianAppsObj">
                    <li class="setImagevalue" v-bind:key="ids" v-if="appData.appStatus">
                        <span :title="appData.name">
                            <img v-if="appData.afterIcon" :src="getImageUrl(appData)" />
                        </span>
                    </li>
                </template>
            </ul>
            <span v-if="!alianAppsFlag">{{$t('Templates.no_app_selected')}}</span>
        </div>
        <div class="d-flex justify-content-between align-items-center allgoodproject">
            <h5>{{$t('Templates.default_views') }}</h5>
            <ul class="d-flex align-items-center">
                <template v-for="(displayView,ids) in theModel.requiredViewobj.value">
                    <li class="setImagevalue" :key="ids" v-if="displayView.viewStatus">
                        <span :title="displayView.name">
                            <img :src="!displayView.viewStatus ? projectComponentsIcons(displayView.keyName).icon : projectComponentsIcons(displayView.keyName).activeIcon" :alt="displayView.name">
                        </span>
                    </li>
                </template>
            </ul>
        </div>
    </div>
</div>
</template>
<script setup>
import { ref , inject} from "vue";
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
import { projectComponentsIcons } from '@/composable/commonFunction';
    const props = defineProps({
        modelValue : {
            type : Object,
            default : ()=>({})
        }
    })
    const clientWidth = inject("$clientWidth");
    const theModel = ref(props.modelValue);
    const alianAppsFlag = ref((theModel.value.alianAppsObj && theModel.value.alianAppsObj.filter(ele=> ele.appStatus == true).length !== 0));

    const multipleAssigneBlue = require("@/assets/images/png/mutipleblue.png");
    const timeBlue = require("@/assets/images/timeBlue.png");
    const priorityBlue = require("@/assets/images/priorityblue.png");
    const timetrackingBlue = require("@/assets/images/timevalueblue.png");
    const milestoneBlue = require("@/assets/images/checkflagblue.png");
    const tagsBlue = require("@/assets/images/tagsblue.png");
    const editBlue = require("@/assets/images/editblue.png");
    const aiBlue = require("@/assets/images/AI_active_blue.png");

    function getImageUrl (item) {
        if(item.name === 'Multiple Assignees'){
            return multipleAssigneBlue;
        }
        if(item.name === 'Time Estimate'){
            return timeBlue;
        }
        if(item.name === 'Priority'){
            return priorityBlue;
        }
        if(item.name === 'Time Tracking'){
            return timetrackingBlue;
        }
        if(item.name === 'Milestones'){
            return milestoneBlue;
        }
        if(item.name === 'Tags'){
            return tagsBlue;
        }
        if(item.name === 'Custom Fields'){
            return editBlue;
        }
        if(item.name === 'AI'){
            return aiBlue;
        }
    }
</script>
<style scoped>
@import "./style.css";
</style>