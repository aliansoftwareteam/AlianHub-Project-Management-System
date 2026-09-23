<template>
  <div class="screenshotActivity">
    <div class="screenshotActivity__header">
        <div class="screenshotActivity__header-Title">
            <div class="activity_title">{{$t('ViewList.Activity')}}</div>
            <div class="activity_discription">{{ $t('ViewList.active_of_min', { active: activeMinutes, total: displayActivity.length }) }}</div>
        </div>
        <div class="actvity_bar">
            <ScreenShotActivityBar :data="data" :widthData="218" :heightData="11"/>
        </div>
    </div>
    <div class="screenshotActivity__body">
        <table class="activity_table">
            <tr class="actvity_table--header">
                <td class="actvity_table_time">{{$t('Projects.time')}}</td>
                <td>{{$t('general.keyboard')}}</td>
                <td>{{$t('general.mouse')}}</td>
            </tr>
            <tr class="actvity_table--body" v-for="(stroke,index) in displayActivity" :key="index">
                <td class="actvity_table_time">{{stroke.time}}</td>
                <td>{{stroke.keyBoard}}</td>
                <td>{{stroke.mouse}}</td>
            </tr>
        </table>
    </div>
  </div>
</template>

<script setup>
    import { inject,onMounted, ref } from "vue";
    import { useGetterFunctions } from "@/composable";
    import * as helper from './helper'
    import ScreenShotActivityBar from '@/components/atom/PreviewTimelogScreenShot/ScreenShotActivityBar'
    const userId = inject('$userId');
    const {getUser} = useGetterFunctions()
    const displayActivity = ref([]);
    const activeMinutes = ref(0);
    const props = defineProps({
        data: {
            type: Object,
            default: () => {}
        }
    })
    onMounted(() => {
        helper.prepareData(props.data,getUser(userId.value)).then((respo)=>{
            displayActivity.value = respo;
            activeMinutes.value = 0;
            let totalTrack = 0;
            respo.forEach((element) => {
                let actviMinCriteria = element.keyBoard + element.mouse;
                totalTrack += actviMinCriteria;
                if (actviMinCriteria >= 40) {
                    activeMinutes.value+=1
                }
            });
            if (totalTrack >= (respo.length * 40)) {
                activeMinutes.value = respo.length
            }

        }).catch((error)=>{
            console.error(error);
        })
    })
</script>

<style>
.screenshotActivity{
    margin-top: 30px;
}
.activity_title{
    font-weight: 700;
    font-size: 16px;
}
.activity_discription{
    color: #535358;
}
.actvity_table--header{
    font-weight: 500;
    font-size: 16px;
    color: #000000;
    border-radius: 4px;
    border: 1px solid #CFCFCF;
    background: #DFE1E6;
    height: 44px;
    justify-content: space-between;
    align-items: center;
}
.actvity_table--body{
    border: 1px solid #CFCFCF;
    height: 38px;
    font-weight: 400;
    font-size: 16px;
    color: #535358;
}
.actvity_table_time{
    padding-left: 30px;
}
.actvity_bar{
    margin-top: 12px;
}
.actvity_table--data{
    justify-content: space-between;
    align-items: center;
}
.screenshotActivity__header{
    margin-bottom: 20px;
    display: flex;
    justify-content: space-between;
}
</style>