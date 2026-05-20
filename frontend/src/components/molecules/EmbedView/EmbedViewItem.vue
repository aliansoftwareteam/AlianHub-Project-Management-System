<template lang="">
    <div v-if="!currentCompany?.planFeature?.embadeVIew">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('Embeded.to_unlock_embed_view')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <div class="embed__view-item" v-else>
        <SpinnerComp :is-spinner="!isVisible" v-if="!isVisible"/>
        <div class="embed__viewshow-visible"  v-show="isVisible">
        <div class="vhtml" v-if="Data?.type == 'Anything_html'"  v-html='sanitizedEmbed'></div>
            <iframe id="frame" v-show="Data?.type != 'Anything_html'" :src=" Data?.type != 'Anything_html' ? URL : '' " height="100%" width="100%" class="border-0"></iframe>
        </div>
    </div>
</template>
<script setup>
import {onMounted, ref , watch ,inject, computed} from 'vue'
import { useRoute } from 'vue-router';
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue'
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import {useStore} from 'vuex'
import { sanitizeHtml } from '@/utils/sanitizeHtml';


const route  = useRoute()
const props = defineProps({
    data:{
        type:Object,
        default:() =>{}
    },
})
const {getters}  = useStore()


const URL = ref('')
const Data = ref('')
const sanitizedEmbed = computed(() => sanitizeHtml(URL.value, {
    allowedTags: ["iframe", "div", "span", "a", "img", "p", "br", "b", "i", "u", "em", "strong"],
    allowedAttr: ["src", "href", "target", "rel", "alt", "title", "class", "style", "id", "width", "height", "frameborder", "allow", "allowfullscreen", "sandbox", "loading", "referrerpolicy"]
}))
const projectData = inject('selectedProject')
const isVisible = ref(false)
const currentCompany = computed(() => getters["settings/selectedCompany"]);

watch(() => props.data ,(newVal,oldVal)=> {
    setTimeout(() => {
        let flag = props?.data?.isPrivate
        let id = props?.data && Object.keys(props.data).length > 0 ? props.data.id : route.query.eid;
        const objValue = !flag ? projectData.value.ProjectRequiredComponent.filter((item) => item.id == id) : props.data;
        Data.value = flag ? objValue :objValue[0]
        if(newVal !== oldVal)
        isVisible.value = false 
        modifyURL()
    });
})

onMounted(() =>{

setTimeout( () => {
    let flag = props?.data?.isPrivate;
    let id = props?.data && Object.keys(props.data).length > 0 ? props.data.id : route.query.eid;
    const objValue = !flag ? projectData.value.ProjectRequiredComponent.filter((item) => item.id == id) : props.data 
    Data.value = flag ? objValue :objValue[0]
    modifyURL()
    });
})

const modifyURL = () =>{
    if(!currentCompany.value?.planFeature?.embadeVIew){
        return;
    }
    if(!Data.value){
        return
    }

    if(Data.value.type === 'Youtube')
    {
        if(Data.value.url.includes('watch')){
            URL.value = "https://www.youtube.com/embed/"+`${Data.value.url.split('watch')[1].split('=')[1]}`
        }
        else{
            let url = Data.value.url.split('/')
            URL.value = "https://www.youtube.com/embed/"+`${url[url.length - 1]}`
        }
    }    
    else if(Data.value.type === 'Figma'){
        URL.value = "https://www.figma.com/embed?embed_host=share&url=" + Data.value.url
    }
    else if(Data.value.type === 'Anything_url'){
        if(Data.value.url.includes('www.youtube.com') || Data.value.url.includes('https://youtu.be')){
            if(Data.value.url.includes('watch')){
                URL.value = "https://www.youtube.com/embed/"+`${Data.value.url.split('watch')[1].split('=')[1]}`
            }
            else{
                let url = Data.value.url.split('/')
                URL.value = "https://www.youtube.com/embed/"+`${url[url.length - 1]}`
            }
        }
        else if(Data.value.url.includes('figma')){
            URL.value = "https://www.figma.com/embed?embed_host=share&url=" + Data.value.url
        }
        else{
            URL.value = Data.value.url
        }
    }
    else{
        if(Data.value.type == 'Anything_html'){
            URL.value = Data.value.html
        }
        else{
            URL.value = Data.value.url
        }
    }

    if(Data.value.type == 'Anything_html'){
        isVisible.value = true
    }
    document.getElementById('frame').onload = function() {
        isVisible.value = true
    }

}

</script>
<style>

.vhtml iframe {
    border-width: 0;
    display: block;
    min-height: 100%;
    min-width: 100%;
    box-sizing: border-box;
}
.embed__view-item, .embed__viewshow-visible{
    width: 100% !important;
    height: 100% !important;
}
.embed__view-item .vhtml{
    height: 100% !important;

}
</style>