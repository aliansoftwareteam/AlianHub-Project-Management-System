<template>
    <li class="list-style-none">
        <div class="d-flex flex-column align-items-start webkit-box-align w-100">
            <div v-if="Object.keys(audioObject).length">
                <AudioComp :audioSrc="audioObject" :key="audioObject.id"/>
            </div>
            <div class="d-flex audio_files-wave justify-content-between w-100">
                <span v-if="audioObject.getFrom == 'comments'" class="text-ellipsis" :title="audioObject.fileName"><a :href='audioObject.attached' target=”_blank” class="audio-file-comp-font-size-14 audio-file-comp-font-weight-500 text-decoration-none w-100 d-inline-block text-ellipsis audio-file-comp-black pr-5px">{{audioObject.fileName}}</a></span>
                <span class="text-ellipsis" v-else><a href='javascript:void(0)' :title="audioObject.fileName" class="audio-file-comp-font-size-14 audio-file-comp-font-weight-500 text-ellipsis text-decoration-none w-100 d-inline-block audio-file-comp-black pr-5px">{{audioObject.fileName}}</a></span>
                <span class="audio-file-comp-font-size-14 audio-file-comp-font-weight-500 audio-file-comp-gray81">{{audioObject.size}}</span>
            </div>
            <div class="d-flex align-items-end justify-content-between w-100 pb-2px">
                <h4 class="audio-file-comp-font-size-14 audio-file-comp-font-weight-500 m-0 audio-file-comp-gray81">{{audioObject.userDetail.Employee_Name}}</h4>
                <span class="audio-file-comp-font-size-13 audio-file-comp-gray81 audio-file-comp-font-weight-400">{{getDateAndTime(audioObject.createTime)}}</span>
            </div>
        </div>
    </li>
</template>
<script setup>
import {defineProps} from 'vue';
import AudioComp from "./AudioWasabiComp.vue";
import { useProjects } from '@/composable/projects';
const {getDateAndTime} = useProjects();
defineProps({
    audioObject: {
        type: Object,
        default: () => {}
    },
})
</script>
<style scoped>
.audio-file-comp-font-size-13 {
    font-size: 13px;
}
.audio-file-comp-font-size-14 {
    font-size: 14px;
}
.audio-file-comp-font-weight-400 {
    font-weight: 400 !important;
}
.audio-file-comp-font-weight-500 {
    font-weight: 500 !important;
}
.audio-file-comp-gray81 {
    color: var(--ink-2);
}
.audio-file-comp-black {
    color: var(--ink);
}
</style>

<style scoped>
.list-style-none{
    list-style: none;
}
</style>