<template>
    <div class="audiowasabi_comp">
        <audio :id="`audioattachment_${props.audioSrc?.id}`" v-if="!isFetching" :src="imageUrl" controls @play="pauseOthers(props.audioSrc.type, `audioattachment_${props.audioSrc?.id}`)" @pause="(e) => {e.preventDefault()}"></audio>
        <SkelatonVue class="border-radius-10-px h-35px" :style="clientWidth >= 767?'width: 300px;':'width: 250px;'" v-else/>
    </div>
</template>

<script setup>
import {defineProps,inject,onMounted,ref} from 'vue';
import * as env from '@/config/env';
import { apiRequest } from '../../../services';
import SkelatonVue from '../../atom/Skelaton/Skelaton.vue';
import { storageQueryBuilder } from '@/utils/storageQueryBuild';
const companyId = inject('$companyId');
const clientWidth = inject('$clientWidth');
const isFetching = ref(false);
const imageUrl = ref('');
const props = defineProps({
    audioSrc:{
        type:Object,
        default:() => ({})
    },
})
onMounted(()=>{
    isFetching.value = true;
    getWasabiAudioFile(props.audioSrc.attached)
})
function getWasabiAudioFile(path) {
    if(env.STORAGE_TYPE && env.STORAGE_TYPE == 'server') {
        let bucketId = companyId.value;
        let axiousObject = storageQueryBuilder('get',bucketId,path);
        apiRequest(axiousObject.method,axiousObject.route).then((res)=>{
            imageUrl.value = res.data.url;
            isFetching.value = false;
        }).catch((error) => {
            isFetching.value = false;
            console.error(error,"error in get image data");
        });
        return;
    }
    const formData = {
        companyId: companyId.value,
        path: path
    }
    apiRequest("post", env.WASABI_RETRIVE_OBJECT, formData).then((response)=>{
        if(response.data.status === true){
            imageUrl.value = response.data.statusText
            isFetching.value = false;
        }
    }).catch((err)=>{
        console.error(err,"error in get image data");
    })
}
function pauseOthers(type = 'audio', id) {
    let items = Array.from(document.getElementsByTagName(`${type}`))

    items.forEach((item) => {
        if(!item.id || item.id !== id) {
            item.pause();
        } else {
            item.play();
        }
    })
}
</script>
<style>
.audiowasabi_comp audio{
    max-height: 100%;
    max-width: 100%;
    margin: auto;
    object-fit: contain;
    height: 40px !important;
}
@media(max-width: 767px){
    .audiowasabi_comp audio{width: 715px !important;}
}
</style>