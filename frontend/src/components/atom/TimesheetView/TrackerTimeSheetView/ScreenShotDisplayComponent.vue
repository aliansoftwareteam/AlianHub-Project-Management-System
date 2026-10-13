<template>
    <div>
        <div class="screenShotDisplay" @mouseenter.stop="startLoadComponent" @mouseleave.stop="clearTimeout" :class="{'isSelectedImage': isBorder}">
            <div v-if="trackshotI?.trackShots?.deleted">
                <img class="screenShotDisplay__innerImageTimelog" src='@/assets/images/svg/deleted-placeholder.svg' @click="previewScreenShot()">
            </div>
            <div v-else>
                <img :src="trackshotI.image" class="screenShotDisplay__innerImageTimelog"  v-if="trackshotI.image.includes('http')" alt="timelogImage"  @click="previewScreenShot()"/>
                <WasabiImage v-else class="screenShotDisplay__innerImageTimelog" :data="{url: trackshotI.image} " :thumbnail='thumbnailSize' @click="previewScreenShot()"/>
            </div>
            <div class="screenShotDisplay__timecheckbox">
                <span class="screenShotDisplay__timedispalyImg screen-shot-display-component-GunPowder d-flex align-items-center justify-content-between" v-if="trackshotI.time">{{trackshotI.time?._seconds ? getDateType(parseInt(trackshotI.time._seconds * 1000)) : getDateType(parseInt(trackshotI.time))}}</span>
                <span class="screenShotDisplay__screenshotActivity"><ScreenShotActivityBar v-if="trackshotI.trackShots.strokes !== undefined" :data="trackshotI.trackShots" :widthData="57" :heightData="3"/></span>
                <UserProfile
                    :showDot="false"
                    :data="{
                        id: trackshotI.userId,
                        image: trackshotI.userProfile,
                        title: trackshotI.userName
                    }"
                    width="20px"
                    :thumbnail="'20x20'"
                    class="screenShotDisplay__timedispalyImg--profileImage"
                />
                <!-- <img :src="trackshotI.userProfile ? trackshotI.userProfile : '@/assets/images/default_user.png'" :alt="trackshotI.userId" class="screenShotDisplay__timedispalyImg--profileImage"/> -->
            </div>
        </div>
        <PreviewTimelogScreenShot v-if="isScreemnShotOPen === true" :screenShotdetail="screenShotdetail" :isScreemnShotOPen="isScreemnShotOPen" @isSSopen="(val) => {isScreemnShotOPen = val}" />
    </div>
</template>
<script setup>
import {ref,defineEmits, inject} from "vue";
import { useGetterFunctions } from "@/composable";
import ScreenShotActivityBar from '@/components/atom/PreviewTimelogScreenShot/ScreenShotActivityBar'
import moment from 'moment';
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import PreviewTimelogScreenShot from '@/components/atom/PreviewTimelogScreenShot/PreviewTimelogScreenShot.vue';
const {getUser} = useGetterFunctions()
const userId = inject('$userId');
const props = defineProps({
    trackshotData: {type: Object},
    index: {type: Number},
    isBorder: {type: Boolean}
})
const getDateType = (seconds) => {
    if ((getUser(userId.value).timeFormat) == "12") {
        return moment(new Date(seconds)).format("hh:mm A");
    } else {
        return moment(new Date(seconds)).format("HH:mm");
    }
}
const screenShotdetail = ref({});
const isScreemnShotOPen = ref(false);
const trackshotI = ref(props.trackshotData)
const time = trackshotI.value.time?._seconds ? (parseInt(trackshotI.value.time._seconds * 1000)) : (parseInt(trackshotI.value.time))
const thumbnailSize = ref("")
const isSendEmit = ref(false);
const emit = defineEmits(["MouseEnter", "MouseLeave","update:getScreenShotForSidebar"]);
if (time >= 1690741800000) {
    thumbnailSize.value = '210x118'
}else {
    thumbnailSize.value = ''
}
const previewScreenShot = async() => {
    emit("update:getScreenShotForSidebar",trackshotI.value,props.index,(cb)=>{
        let obj = cb;
        obj.screenShotTime = cb.time;
        screenShotdetail.value = obj
        isScreemnShotOPen.value = true;
    })
}
const startLoadComponent = () => {
    isSendEmit.value = true;
    setTimeout(() => {
        if (isSendEmit.value) {
            sendEmit();
        }
    }, 1000);
}
const sendEmit = () => {
    emit("MouseEnter",props.index)
    isSendEmit.value = false;
}
const clearTimeout = () => {
    emit("MouseLeave",props.index);
    isSendEmit.value = false
}
</script>
<style scoped src="./ScreenShotDisplayComponent.css"></style>

<style scoped>
.screen-shot-display-component-GunPowder {
    color: var(--ink-2);
}
</style>
