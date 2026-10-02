<template>
    <div>
        <div class="screenShotTime__header">
            <div class="screenShotTime__header--time" :class="{'screenShotTime__header--activeTime': active}" @click="getTime">
                <span>{{getTimeName(logRange.time)}}</span>
                <span class="cursor-pointer"><span class="ah-mask-icon taable_arrow position-re screen__table-arrow" :class="{'screenShotTime__header-open': active}" :style="maskOf(table_arrow)" aria-hidden="true"></span></span>
            </div>
            <div class="screenShotTime__screenshot" v-if="active && trackShots?.length">
                <div class="screenShotTime__screenshot--mainImage"  v-for="(track,index) in trackShots " :key="index" :id="`screenShotTime${index}`">
                    <ScreenShotDisplayComponent :trackshotData="track" :isBorder="borderIndex === index ? true : false" :index="index" @MouseEnter="startLoadComponent(track,index)" @MouseLeave="clearTimeout" @update:getScreenShotForSidebar="getScreenShotDetailFForSidebarFun"/>
                    <div v-if="showComponentId === index">
                        <teleport to="#my-dropdown">
                            <ScreenShotViewHover :index="index"  :id="`hoverContainer${index}`" :data="hoverData" class="screenShotTime__screenshot--hovercomponent"/>
                        </teleport>
                    </div>
                </div>
            </div>
            <div class="screenShotTime__screenshot" v-if="active && trackShots?.length === 0">
                <div class="screenShotTime__screenshot--mainImage screenShotTime__none">
                   {{$t('TimeTracker.log_time_found_no_screenshot')}}  
                </div>
            </div>
        </div>
    </div>
</template>
<script setup>
    import {ref ,defineEmits, inject} from 'vue';
    import { timeArray } from './TimeArray.js';
    import ScreenShotDisplayComponent from '@/components/atom/TimesheetView/TrackerTimeSheetView/ScreenShotDisplayComponent'
    import ScreenShotViewHover from '@/components/atom/TimesheetView/TrackerTimeSheetView/ScreenShotViewHover'
    import { maskOf } from '@/utils/iconMask';
    import { useGetterFunctions } from "@/composable";
    import moment from 'moment';

    const props = defineProps({
        trackShots: {type: Array},
        active: {type: Boolean, default: false},
        logRangeData: {type: Object},
    })
    const {getUser} = useGetterFunctions()
    const userId = inject('$userId');
    const emit = defineEmits(["update:getScreenShotDetail", "toggle"]);
    const table_arrow = ref(require("@/assets/images/table_arrow.png"))
    const logRange = ref(props.logRangeData)
    const showComponentId = ref(null);
    const hoverData = ref({});
    const borderIndex = ref(null);
    const getTimeName = (time) => {
        let ind = timeArray.findIndex((x) => x.value === time)
        const userFormat = getUser(userId.value).timeFormat
        if (userFormat == "24") {
           return `${moment(timeArray[ind].from,"hh:mm A").format("HH:mm")} - ${moment(timeArray[ind].to,"hh:mm A").format("HH:mm")}`
        } else {
            return `${timeArray[ind].from} - ${timeArray[ind].to}`
        }
    }
    const getTime = () => {
        borderIndex.value = null;
        emit("toggle", props.active ? null : logRange.value.time);
    }

    const startLoadComponent = (track,index) => {
        getHoverData(track,index);
    };

    const clearTimeout = () => {
        showComponentId.value = null;
        hoverData.value = {};
    };

    const getHoverData = (track,index) => {
        emit("update:getScreenShotDetail",track,(cb)=>{
            let obj = cb;
            obj.screenShotTime = cb.time;
            hoverData.value = obj;
            showComponentId.value = index;
            const imgElement = document.getElementById(`screenShotTime${index}`);
            const imgRect = imgElement.getBoundingClientRect();
            setTimeout(() => {
                const hoverContainer = document.getElementById(`hoverContainer${index}`);
                if (hoverContainer!==null) {      
                    if (imgRect.top+230+356 < document.documentElement.clientHeight) {
                        hoverContainer.style.top = `${imgRect.top+180}px`;
                    } else {
                        if (imgRect.top-356 < 0) {
                            hoverContainer.style.top = imgRect.top;
                        } else {
                            hoverContainer.style.top = `${imgRect.top-356}px`;
                        }
                    }
                    if (imgRect.left+410 >= document.documentElement.clientWidth) {
                        hoverContainer.style.left = `${imgRect.left+230-410}px`;
                    } else {
                        hoverContainer.style.left = `${imgRect.left}px`; 
                    }
                }
            }, 500);
        });
    }

    const getScreenShotDetailFForSidebarFun = (obj,index,cbd) => {
        borderIndex.value = index
        emit("update:getScreenShotDetail",obj,(cb)=>{
            cbd(cb)
        });
    }
</script>
<style scoped src="./ScreenshotTime.css"></style>