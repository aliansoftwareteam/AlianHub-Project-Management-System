<template>
  <div>
    <div class="d-flex container" :style="{'width': `${widthData}px`, 'height': `${heightData}px`}">
        <div class="progress-bar" :style="{'width': `${percentage}%`}"></div>
        <div class="progress-box box1"></div>
        <div class="progress-box box2"></div>
        <div class="progress-box box3"></div>
        <div class="progress-box box4"></div>
        <div class="progress-box box5"></div>
        <div class="progress-box box6"></div>
        <div class="progress-box box7"></div>
        <div class="progress-box box8"></div>
        <div class="progress-box box9"></div>
        <div class="progress-box box10"></div>
    </div>
  </div>
</template>

<script setup>
    import { inject,onMounted, ref } from "vue";
    import { useGetterFunctions } from "@/composable";
    const userId = inject('$userId');
    const {getUser} = useGetterFunctions()
    const percentage = ref(0);
    import * as helper from './helper'
    const props = defineProps({
        data: {
            type: Object,
            default: () => {}
        },
        widthData: {
            type: Number,
        },
        heightData: {
            type: Number
        }
    })
    onMounted(() => {
        helper.prepareData(props.data,getUser(userId.value)).then((respo)=>{
            let ActiveMinute = 0;
            let totalTrack = 0;
            respo.forEach((element) => {
                let actviMinCriteria = element.keyBoard + element.mouse;
                totalTrack += actviMinCriteria;
                if (actviMinCriteria >= 40) {
                    ActiveMinute+=1
                }
            });
            if (totalTrack >= (respo.length * 40)) {
                ActiveMinute = respo.length
            }
            percentage.value = Math.round(100 * ActiveMinute / respo.length);
        }).catch((error)=>{
            console.error(error);
        })
    })
</script>

<style>
 .container {
    position: relative;
    height: 3px;
    background-color: var(--track);
}

.progress-bar {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background-color: var(--brand);
    opacity: 1;
    z-index: 1;
}
.progress-box {
    position: relative;
    height: 100%;
    width: 50%;
    background-color: var(--track);
}
.progress-box:after {
    content: '';
    position: absolute;
    height: inherit;
    width: inherit;
    background-color: var(--surface);
    z-index: 7;
}
.box1 { width: 10%; }
.box2 { width: 10%; }
.box3 { width: 10%; }
.box4 { width: 10%; }
.box5 { width: 10%; }
.box6 { width: 10%; }
.box7 { width: 10%; }
.box8 { width: 10%; }
.box9 { width: 10%; }
.box10 { width: 10%; }
</style>