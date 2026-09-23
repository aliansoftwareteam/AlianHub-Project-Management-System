<template>
    <div class="d-flex timelogtimeDetail justify-content-between  bg-white" v-if="!isUser">
        <div class="d-flex align-items-center">
                <span class="startEndHours black font-weight-500">{{dataObj.time}}</span>
                <img v-if="dataObj.startTimeTracker && !checkDateDiff(dataObj.startTimeTracker)" class="ml-20px" src="@/assets/images/svg/time_tracker.svg">
            </div>
            <div class="d-flex align-items-center">
                <img v-if="dataObj.logAddType" src="@/assets/images/svg/green_dot.svg" class="active_inactivedot p0x-15px" alt="greenDot">
                <img v-else src="@/assets/images/svg/Purple_dot.svg" class="active_inactivedot p0x-15px" alt="purpleDot">
                <span class="totalHours font-weight-500 black font-roboto-sans">{{ $t('TimeTracker.hours_value', { time: convertedTimeString(dataObj.duration,'update') ? convertedTimeString(dataObj.duration,'update') : '00:00' }) }}</span>
        </div>
    </div>
    <div class="d-flex timelogtimeDetail justify-content-between bg-white text-ellipsis mb-10px" v-if="isUser">
        <div class="d-flex align-items-center text-ellipsis w-65">
            <div class="startEndHours d-flex align-items-center text-ellipsis w-100 cursor-default start__hours-lineheight"><span class="start__EndHours-taskname black font-weight-500 font-size-16 text-ellipsis d-inline-block mw-82" :title="dataSub.taskName">{{ dataSub.taskName }}  | </span><span class="font-size-13 GunPowder font-weight-400 start__EndHours-taskkey text-ellipsis pl-5px" :title="dataSub.taskKey"> {{ dataSub.taskKey }}</span></div>
        </div>
        <div class="d-flex align-items-center justify-content-end w-35">
            <img v-if="dataObj.logAddType" src="@/assets/images/svg/green_dot.svg" class="active_inactivedot p0x-15px" alt="greenDot">
            <img v-else src="@/assets/images/svg/Purple_dot.svg" class="active_inactivedot p0x-15px" alt="purpleDot">
            <span class="totalHours font-weight-500 black font-roboto-sans converted__timestring">{{ $t('TimeTracker.hours_value', { time: convertedTimeString(dataObj.duration,'update') ? convertedTimeString(dataObj.duration,'update') : '00:00' }) }}</span>
        </div>
    </div>
    <div class="d-flex timelogtimeDetail justify-content-between bg-white pt-0" v-if="isUser">
        <p class="black font-weight-500 m-0">{{dataObj.time}}</p>
        <img v-if="dataObj.startTimeTracker && !checkDateDiff(dataObj.startTimeTracker)" class="ml-20px" src="@/assets/images/svg/time_tracker.svg">
    </div>
    <div class="commentMain position-re">
        <div class="cooment_titledesc-wrapper bg-white">
            <p class="commentDetail font-roboto-sans GunPowder text-ellipsis font-size-16 font-weight-400 start__hours-lineheight">{{dataObj.discription}}</p>
        </div>
        <div class="d-flex mainImageDiv flex-wrap" v-if="dataObj.trackShotArray !== undefined && dataObj.trackShotArray">
            <div class="timelogImage bg-white position-re overflow-hidden" v-for="(trackDetail,ind) in dataObj.trackShotArray" v-bind:key="ind">
                <div v-if="trackDetail.deleted">
                    <img class="innerImageTimelog" src='@/assets/images/svg/deleted-placeholder.svg' @click="previewScreenShot(trackDetail)">
                </div>
                <div v-else>
                    <img :src="trackDetail.image" class="innerImageTimelog"  v-if="trackDetail.image.includes('http')" alt="timelogImage" @click="previewScreenShot(trackDetail)"/>
                    <WasabiImage v-else class="border-radius-10-px" :data="{url: trackDetail.image}" @click="previewScreenShot(trackDetail)"/>
                </div>
                <div class="timecheckbox d-flex align-items-center justify-content-between">
                    <span class="timedispalyImg font-size-13 GunPowder" v-if="trackDetail.screenShotTime">{{trackDetail.screenShotTime._seconds ? getDateType(parseInt(trackDetail.screenShotTime._seconds * 1000)) : getDateType(parseInt(trackDetail.screenShotTime))}}</span>
                    <span v-if="trackDetail.strokes !== undefined"><ScreenShotActivityBar :data="trackDetail" :widthData="57" :heightData="3"/></span>
                </div>
            </div>
            <div class="timelogImage bg-white position-re overflow-hidden" v-if="dataObj.logAddType == 0">
                <img src="@/assets/images/logDetailDefault.png" class="innerImageTimelog default-image-sidebar" alt="timelogImage"/>
                <div class="timecheckbox d-flex align-items-center">
                    <span class="timedispalyImg font-size-13 GunPowder">{{dataObj.time}}</span>
                </div>
            </div>
        </div>
        <!-- <div class="d-flex mainImageDiv flex-wrap" v-if="dataObj.logAddType == 0">
            
        </div> -->
         <PreviewTimelogScreenShot v-if="isScreemnShotOPen === true" :screenShotdetail="screenShotdetail" :userData="userData" :isScreemnShotOPen="isScreemnShotOPen" @isSSopen="(val) => {isScreemnShotOPen = val}" />
    </div>
</template>
<script setup>
    import {inject, ref,watch} from "vue";
    import moment from "moment";
    import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
    import PreviewTimelogScreenShot from '@/components/atom/PreviewTimelogScreenShot/PreviewTimelogScreenShot.vue';
    import { getConvertedTimeString } from '@/composable/commonFunction';
    import ScreenShotActivityBar from '@/components/atom/PreviewTimelogScreenShot/ScreenShotActivityBar'
    import { useGetterFunctions } from '@/composable';
    const {getUser} = useGetterFunctions();
    const userId = inject('$userId');
    const props = defineProps({
        data: {type: Object},
        mainData: {type: Object},
        dataSub: {type: Object},
        isUser: {type: Boolean},
        userData: {type: Object}
    });
    watch(()=> props.data,(newValue) => {
        dataObj.value = newValue;
    })
    watch(()=> props.mainData,(newValue) => {
        mainObject.value = newValue;
    })
    const userData = ref(props.userData);
    watch(()=> props.userData,(newValue) => {
        userData.value = newValue;
    })
    const mainObject = ref(props.mainData);
    const dataObj = ref(props.data);
    const dataSub = ref(props.dataSub);
    const isUser = ref(props.isUser);
    const isScreemnShotOPen = ref(false);
    const screenShotdetail = ref({});
    const getDateType = (seconds) => {
        let userFormat = getUser(userId.value).timeFormat;
        if (userFormat == "12") {
            return moment(new Date(seconds)).format("hh:mm A")
        } else {
            return moment(new Date(seconds)).format("HH:mm")
        }
    }
    const convertedTimeString = (n, type)=>{
        return getConvertedTimeString(n,type);
    }
    const previewScreenShot = (trackshot) => {
        isScreemnShotOPen.value = true;
        let obj = {
            projectName : mainObject.value.projectName,
            projectKey :mainObject.value.projectKey,
            taskName : mainObject.value.taskName,
            isFolderSprint : mainObject.value.isFolderSprint,
            sprintName : mainObject.value.sprintName,
            folderName : mainObject.value.folderName,
            userProfile:  getUser(mainObject.value.userId)?.Employee_profileImageURL,
            userName: getUser(mainObject.value.userId)?.Employee_Name,
        }
        if (isUser.value) {
            obj.projectName = dataSub.value.projectName;
            obj.projectKey = dataSub.value.projectKey;
            obj.taskName = dataSub.value.taskName;
            obj.isFolderSprint = dataSub.value.isFolderSprint;
            obj.sprintName = dataSub.value.sprintName;
            obj.folderName = dataSub.value.folderName;
            obj.userProfile =  getUser(dataSub.value.userId)?.Employee_profileImageURL
            obj.userName =  getUser(dataSub.value.userId)?.Employee_Name
        }
        screenShotdetail.value = {...trackshot , ...obj};
    }
    const checkDateDiff = (time) => {
        let date1 = time ? new Date(time * 1000) : ''
        let date2 = new Date();
        const diffMinutes = moment(date2).diff(moment(date1), 'minutes');
        if(diffMinutes >= 10){
           return true;
        }else{
            return false;
        }
    }
</script>
<style scoped>
.start__hours-lineheight{
    line-height: 24px !important;
}
.start__EndHours-taskkey{
    line-height: 20px !important;
    max-width: 18% !important;
}
.converted__timestring{
    line-height: 27px !important;
}
</style>