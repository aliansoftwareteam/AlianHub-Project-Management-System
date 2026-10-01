<template>
    <div class="mainScreenShotPreview">
        <Sidebar 
            width="923px"
            :top="clientWidth > 767 ? '46px' : '0px'"
        >
        <template #head-left>
            <div class="blue font-ui screenShotPreview">{{$t('TimeTracker.screenshot_preview')}}</div>
        </template>
        <template #head-right>
            <span><img :src="closeScreenshotPreview" @click="closeSidebar()" class="close_icon_sidebar"/></span>
        </template>
        <template #body>
            <div class="screnshotpreviewMain bg-white overflow-auto style-scroll h-100">
                <div class="projectAndTasknamekeyDiv bg-light-gray text-ellipsis w-100 d-inline-block">
                    <div class="d-inline-block projectDetailkeyScreenshotPreview align-items-center justify-content-center font-ui gray text-ellipsis w-100 text-center pr-10px pl-10px">{{screenShotdetail.projectKey}}  |  {{screenShotdetail.projectName}}  / <img class="folderIconImg" v-if="screenShotdetail.isFolderSprint === true" src="@/assets/images/folder.png"> {{screenShotdetail.folderName}} {{screenShotdetail.isFolderSprint === true ? '/' : ''}} {{screenShotdetail.sprintName}}</div>
                    <div class="d-block tasknameScreenshotpreview justify-content-around black font-ui text-ellipsis font-size-16 font-weight-500 w-100 text-center pr-10px pl-10px">{{screenShotdetail.taskName}}</div>
                </div>
                <div class="d-flex startEndMaidiv justify-content-between align-items-center">
                    <span class="starttoEndTime font-ui black font-weight-500">{{(screenShotdetail.screenShotTime.seconds || screenShotdetail.screenShotTime._seconds) ? getDateType(screenShotdetail.screenShotTime.seconds ? screenShotdetail.screenShotTime.seconds : screenShotdetail.screenShotTime._seconds * 1000) : getDateType(parseInt(screenShotdetail.screenShotTime))}}</span>
                    <span class="d-flex align-items-center">
                        <UserProfile decorative
                            :showDot="false"
                            :data="{
                                image: screenShotdetail.userProfile,
                                title: screenShotdetail.userName
                            }"
                            width="25px"
                            class="cursor-pointer timelog-user-status"
                            :thumbnail="'25x25'"
                        />
                        <!-- <img :src="screenShotdetail.userProfile ? screenShotdetail.userProfile : '@/assets/images/default_user.png'" :alt="screenShotdetail.userId" style="width:20px;height:20px;border-radius:50%;"/> -->
                        <span class="font-size-12 gray ml-10px">{{screenShotdetail.userName}}</span>
                    </span>
                </div>
                <div class="d-flex commentsidebarMaindiv">
                    <span class="commentinSidebar font-ui GunPowder font-size-16 text-ellipsis mw-70">{{screenShotdetail.memoName}}</span>
                </div>
                <div class="fullImgDiv" v-if="!screenShotdetail.deleted">
                    <img class="selectedOPenImgTimeSheet" v-if="screenShotdetail.image.includes('http')" :src="screenShotdetail.image">
                    <WasabiImage v-else :data="{url: screenShotdetail.deleted ? '@/assets/images/svg/deleted-placeholder.svg' :screenShotdetail.image}"/>
                </div>
                <div class="fullImgDiv" v-else>
                    <img class="selectedOPenImgTimeSheet" :src="deletedSvg">
                </div>
                <div v-if="screenShotdetail.strokes !== undefined">
                    <ScreenShotActivity :data="screenShotdetail"/>
                </div>
            </div>
        </template>
        </Sidebar>
    </div>
</template>

<script setup>
    import moment from 'moment';
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    import ScreenShotActivity from '@/components/atom/PreviewTimelogScreenShot/ScreenShotActivity'
    import { useGetterFunctions } from "@/composable";
    import { defineProps, ref, inject } from 'vue';
    import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
    import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
    const deletedSvg = require('@/assets/images/svg/deleted-placeholder.svg')
    const {getUser} = useGetterFunctions()
    const userId = inject('$userId');
    const props = defineProps({
        screenShotdetail: {
            type: Object,
            required: true
        },
        isScreemnShotOPen :{
            type: Boolean,
            required: false
        }
    })
    
    const clientWidth = inject("$clientWidth");
    const emit = defineEmits(["isSSopen"])
    const closeScreenshotPreview = require('@/assets/images/svg/Close_screenshotview.svg');
    const isScreenOpen = ref(props.isScreemnShotOPen)

    const getDateType = (seconds) => {
        if ((getUser(userId.value).timeFormat) == "12") {
            return moment(new Date(seconds)).format("hh:mm A");
        } else {
            return moment(new Date(seconds)).format("HH:mm");
        }
    }

    const closeSidebar = () => {
        isScreenOpen.value = false;
        emit("isSSopen",isScreenOpen.value)
    }
</script>

<style src="./style.css"></style>