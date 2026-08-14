<template>
    <ConfirmationSidebar 
        v-model="showSidebarData"
        :title="`Modify Status`"
        :message="`This status is already assigned to a ${projectStatusType ? 'project' : 'task'}. To remove it, please select a different status accordingly.`"
        :acceptButtonClass="'btn-primary font-roboto-sans'"
        :acceptButton="$t('general.Continue')"
        :isShowInput="false"
        @confirm="() => $emit('confirm')"
        @update:modelValue="() => $emit('closeModel', false)"
    >
        <template #body v-if="statusType">
            <div class="mw-100 w-100 conforms__task-component">
                <div class="overflow-x-visible overflow-y-auto overflow-y-auto::-webkit-scrollbar" :style="[{maxHeight : clientWidth > 767 ? 'calc(100vh - 550px)' : 'calc(100vh - 275px)'}]">
                    <div class="d-flex justify-content-between position-sti z-index-1 bg-white old__newstatustitle-wrapper">
                        <p class="font-size-12 font-roboto-sans position-re old__newstatus-title text-left gray81 mb-6px w-50">{{$t('general.Old_Status')}}</p>
                        <p class="font-size-12 font-roboto-sans position-re old__newstatus-title text-left gray81 mb-6px w-50">{{$t('general.New_Status')}}</p>
                    </div>
                    <div class="d-flex justify-content-between border-bottom-mobiledrop status__deatil-wrapper p20px-0px" v-for="(data,index) in oldStatus" :key="index"> 
                        <div class="d-flex align-items-center justify-content-between w-50 pr-20px pl-10px">
                            <div class="d-flex align-items-center">
                                <div class="sattus-color-div" :style="[{'background-color': data.bgColor,'color':data.textColor}]"></div>
                                <span :style="[{'color':data.textColor}]" class="oldstatusName" :class="{'font-size-13' : clientWidth > 767, 'font-size-16' : clientWidth <= 767}" >{{data.name}}</span>
                            </div>
                            <img :src="arrow" />
                        </div>
                        <div class="d-flex align-items-center border-groupBy border-radius-6-px task__type-wrapper">
                            <TaskStatus
                                :options="selectedProjectData.taskStatusData.filter(x => !oldStatus.some(status => status.key === x.key))"
                                :convertStatus="data"
                                @select="(val,val1) => $emit('changeStatus',val,val1,'taskStatus')"
                                :id="data.key+'create_taskType'"
                            >
                            <template #head>
                                <span v-if="data.convertStatus === undefined || data.convertStatus === ''" class="font-size-16 color94">{{$t('general.Select_Status')}}</span>
                                <div class="d-flex align-items-center" v-if="data.convertStatus !== undefined">
                                    <div class="sattus-color-div" :style="[{'background-color': data.convertStatus.bgColor,'color':data.convertStatus.textColor}]"></div>
                                    <span :style="[{'color':data.convertStatus.textColor}]" class="font-roboto-sans pl-8px" :class="{'font-size-13' : clientWidth > 767, 'font-size-16' : clientWidth <= 767}"  >{{data.convertStatus ? data.convertStatus.name : ''}}</span>
                                </div>
                                <span class="red position-ab font-size-11 mt-50px" v-if="(data.convertStatus === undefined || data.convertStatus === '')">{{errorMsg}}</span>
                            </template>
                            </TaskStatus>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template #body v-else-if="taskType">
            <div class="mw-100 w-100">
                <div class="overflow-x-visible overflow-y-auto overflow-y-auto::-webkit-scrollbar" :style="[{maxHeight : clientWidth > 767 ? 'calc(100vh - 550px)' : 'calc(100vh - 275px)'}]">
                    <div class="d-flex justify-content-between position-sti z-index-1 bg-white old__newstatustitle-wrapper">
                        <p class="font-size-12 font-roboto-sans text-left gray81 mb-6px w-50">{{$t('general.Old_Task_Type')}}</p>
                        <p class="font-size-12 font-roboto-sans text-left gray81 mb-6px w-50">{{$t('general.New_Task_Type')}}</p>
                    </div>
                    <div  class="d-flex justify-content-between border-bottom-mobiledrop status__deatil-wrapper p20px-0px" v-for="(data,index) in oldStatus" :key="index">
                        <div class="d-flex align-items-center justify-content-between w-50 pr-20px pl-10px">
                            <div class="d-flex align-items-center">
                                <!-- <div class="position-re task__status-img" style="width:14px; min-width: 14px; height: 14px; object-fit: cover;border-radius: 2px;top: 3px;margin-right:8px;"></div> -->
                                <span class="oldstatusName GunPowder" :class="{'font-size-13' : clientWidth > 767, 'font-size-16' : clientWidth <= 767}">{{data.name}}</span>
                            </div>
                            <img :src="arrow" />
                        </div>
                        <div class="d-flex align-items-center border-groupBy border-radius-6-px select__tasktype task__type-wrapper position-re">
                            <TaskType
                                :id="data.key+'create_taskType'"
                                :options="selectedProjectData.taskTypeCounts.filter(x => !oldStatus.some(type => type.key === x.key))"
                                @select="(val,val1) => $emit('changeTaskType',val,val1)"
                                :convertTaskType="data"
                                >
                                <template #head>    
                                    <div class="mw-100 w-100 d-flex align-items-center">
                                    <span v-if="data.convertType === undefined || data.convertType === ''" class="font-size-16 color94 task_type-title">{{$t('general.Select_Task_Type')}}</span>
                                    <div class="d-flex align-items-center" v-if="data.convertType !== undefined">
                                        <TaskTypeIcon :taskType="data.convertType" class="position-re border-radius-2-px convert__type mr-8px" />
                                        <span :class="{'font-size-13' : clientWidth > 767, 'font-size-16' : clientWidth <= 767}">{{data.convertType ? data.convertType.name : ''}}</span>
                                    </div>
                                    <span class="red position-ab font-size-11 error__msg-text mt-50px" v-if="(data.convertType === undefined || data.convertType === '')">{{errorMsgType}}</span>
                                    </div>
                                </template>
                            </TaskType>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <template #body v-else-if="projectStatusType">
            <div class="mw-100 w-100">
                <div class="overflow-x-visible overflow-y-auto overflow-y-auto::-webkit-scrollbar" :style="[{maxHeight : clientWidth > 767 ? 'calc(100vh - 550px)' : 'calc(100vh - 275px)'}]">
                    <div class="d-flex justify-content-between position-sti z-index-1 bg-white old__newstatustitle-wrapper">
                        <p class="font-size-12 font-roboto-sans position-re old__newstatus-title text-left gray81 mb-6px w-50">{{$t('general.Old_Status')}}</p>
                        <p class="font-size-12 font-roboto-sans position-re old__newstatus-title text-left gray81 mb-6px w-50">{{$t('general.Old_Status')}}</p>
                    </div>
                    <div class="d-flex justify-content-between border-bottom-mobiledrop status__deatil-wrapper p20px-0px" v-for="(data,index) in oldStatus" :key="index"> 
                        <div class="d-flex align-items-center justify-content-between w-50 pr-20px pl-10px">
                            <div class="d-flex align-items-center">
                                <div class="sattus-color-div" :style="[{'background-color': data.backgroundColor,'color':data.textColor}]"></div>
                                <span :style="[{'color':data.textColor}]" class="oldstatusName" :class="{'font-size-13' : clientWidth > 767, 'font-size-16' : clientWidth <= 767}" >{{data.name}}</span>
                            </div>
                            <img :src="arrow" />
                        </div>
                        <div class="d-flex align-items-center border-groupBy border-radius-6-px select__tasktype task__type-wrapper position-re">
                            <TaskStatus
                                :options="selectedProjectData.projectStatusData.filter((x) => x.type !== 'close' && x.key !== oldStatus[0].key) || []"
                                @select="(val,val1) => $emit('changeStatus',val,val1,'projectStatus')"
                                :convertStatus="data"
                                :id="'123'"
                            >
                            <template #head>
                                <span v-if="data.convertStatus === undefined || data.convertStatus === ''" class="font-size-16 color94" >{{$t('general.Select_Status')}}</span>
                                <div class="d-flex align-items-center" v-if="data.convertStatus !== undefined">
                                    <div class="sattus-color-div" :style="[{'background-color': data.convertStatus.bgColor,'color':data.convertStatus.textColor}]"></div>
                                    <span :style="[{'color':data.convertStatus.textColor}]" class="font-roboto-sans pl-8px" :class="{'font-size-13' : clientWidth > 767, 'font-size-16' : clientWidth <= 767}" >{{data.convertStatus ? data.convertStatus.name : ''}}</span>
                                </div>
                                <span class="red position-ab font-size-11 mt-50px" v-if="(data.convertStatus === undefined || data.convertStatus === '')">{{errorMsg}}</span>
                            </template>
                            </TaskStatus>
                        </div>
                    </div>
                </div>
            </div>
        </template>
    </ConfirmationSidebar>
</template>

<script setup>
import ConfirmationSidebar from '@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue';
import TaskStatus from "@/components/atom/TaskStatus/TaskStatus.vue"
import TaskType from "@/components/atom/TaskType/TaskType.vue"
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";

import { ref } from 'vue';

const arrow = require("@/assets/images/svg/arrow_back_sub_task.svg");

const showSidebarData = ref(true);

defineProps({
    oldStatus: {
        type: Array,
        required: true
    },
    selectedProjectData: {
        type: Object,
        required: true
    },
    statusType: {
        type: Boolean,
        required: false
    },
    taskType:{
        type: Boolean,
        required: false
    },
    projectStatusType:{
        type: Boolean,
        required: false
    },
    errorMsg:{
        type: String,
        required: false
    },
    errorMsgType:{
        type: String,
        required: false
    }
});

</script>