<template>
    <div v-if="isSpinner">
        <LogTimeSheetSkelaton></LogTimeSheetSkelaton>
    </div>
    <div v-else>
        <div class="timesheet_sidebar-screen">
            <div class="mainTimeTrackerDetail position-re" v-for="(data,index) in dataObj" :key='index'>
                <div class="d-flex timelogtracker justify-content-between  logDetail-head" >
                    <div class="d-flex align-items-center" v-if="!isUser">
                        <div>
                            <div><span class="font-size-16 font-weight-500 data__task-name">{{data.taskName}}</span> | <span class="font-size-13 font-weight-400 GunPowder">{{data.taskKey}}</span></div>
                            <div><span class="font-size-14 font-weight-400 GunPowder data__project-key">{{data.projectKey}}</span> | <span class="font-size-13 font-weight-400 GunPowder">{{data.projectName}}</span></div>
                        </div>
                    </div>
                    <div class="d-flex align-items-center w-65" v-else>
                        <UserProfile
                            v-if="data.profileImage && data.profileImage != null && data.profileImage != ''"
                            :showDot="false"
                            class="timesheet_user_profile p-0 mr-10px timesheet__profile-user"
                            :data="{
                                id: data.id,
                                title: data.name,
                                image: data.profileImage
                            }"
                            width="30px"
                            :thumbnail="'30x30'"
                        />
                        <img alt="" v-else src="@/assets/images/default_user.png" class="timesheet_user_profile"
                            :title="data.name"/>
                            <div class="text-ellipsis cursor-default"><span class="font-size-16 font-weight-500 text-ellipsis pr-10px data__task-name" :title="data.name">{{data.name}}</span></div>
                    </div>
                    <div class="d-flex align-items-center justify-content-end w-35">
                        <span class="timelogHours black font-roboto-sans">
                            {{ $t('TimeTracker.hours_value', { time: convertedTimeString(data.total,'update') }) }}
                        </span>
                    </div>
                </div>
                <div>
                    <div v-if="!isUser">
                        <div class="mainDetail" v-for="(ele,index) in data.trackArray" :key="index">
                            <LogdetailViewBodyScreenShot :data="ele" :mainData="data"/>
                        </div>
                    </div>
                    <div v-else>
                        <div v-for="(elem,mindex) in data.manageArray" :key="mindex">
                            <div class="mainDetail" v-for="(ele,index) in elem.trackArray" :key="index">
                                <LogdetailViewBodyScreenShot
                                    :data="ele"
                                    :mainData="data"
                                    :dataSub="{
                                        taskName: elem.taskName,
                                        taskKey: elem.taskKey,
                                        projectName : elem.projectName,
                                        projectKey :elem.projectKey,
                                        isFolderSprint : elem.isFolderSprint,
                                        sprintName : elem.sprintName,
                                        folderName : elem.folderName,
                                        userId: elem.loggeduser,
                                    }"
                                    :userData="{
                                        id: data.id,
                                        title: data.name,
                                        image: data.profileImage
                                    }"
                                    :isUser="isUser"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="norecords__found" v-if="dataObj && dataObj.length == 0">
            <div class="norecords__wrapper">
                <p class="red">{{ $t('UserTimesheet.no_records_found') }}</p>
            </div>
        </div>
    </div>
</template>
<script setup>
import {ref,watch} from "vue";
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
import { getConvertedTimeString } from '@/composable/commonFunction';
import LogdetailViewBodyScreenShot from '@/components/atom/TimesheetView/LogDetailView/LogdetailViewBodyScreenShot'
import LogTimeSheetSkelaton from '@/components/atom/Skelaton/LogTimeSheetSkelaton.vue';
const props = defineProps({
    data: {type: Object},
    isUser: {type: Boolean, default: true},
});
const convertedTimeString = (n, type)=>{
    return getConvertedTimeString(n,type);
}
const dataObj = ref(props.data);
const isSpinner = ref(true);
watch(()=> props.data,(newValue) => {
    dataObj.value = newValue;
    isSpinner.value = false;
})
</script>
<style scoped>
.circlegreen {
  width: 10px;
  height: 10px;
  background-color: #1CB303;
  border-radius: 50%;
}
.circlePurple {
  width: 10px;
  height: 10px;
  background-color: #7367F0;
  border-radius: 50%;
}
.timesheet_sidebar-screen {
    max-height: 80vh;
    overflow: auto;
    padding: 0px 20px 20px;
}
.mainTimeTrackerDetail{
margin-bottom: 20px;
}
.data__task-name{
    line-height: 24px;
}
.data__project-key{
    line-height: 23px;
}
.norecords__found{
    display: grid;
    place-items: center;
    height: 70vh;
}
.timesheet_sidebar-screen::-webkit-scrollbar{display: none;}
.default-image-sidebar{cursor: default !important;}
</style>
<style src="./style.css"></style>