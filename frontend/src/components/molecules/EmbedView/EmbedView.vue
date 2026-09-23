<template lang="">
    <div class="d-flex">
        <div class="view__embed-right">
        <div class="section bg-white d-flex justify-content-center align-items-center border-radius-10-px">
            <img :src="boxes" alt="">
        </div>
        <div class="embed__text mb-20px mt-30px">
            <h3 class="font-size-16 black m-0 mb-5px">{{$t('ViewList.Embed')}}</h3>
            <p class="font-size-13 GunPowder m-0">
                {{$t('ViewListdescription.add_msg1')}}
                {{$t('ViewListdescription.add_msg2')}}
                
            </p>
        </div>
        <div class="d-flex flex-wrap overflow-y-auto overflow-y-auto::-webkit-scrollbar select__embed-div">
            <div v-for="(item, index) in embeds" :key="index" class="embed-item cursor-pointer" @click="() => selectEmbed(item)" :class="{'selected__embed':selectedEmbed.id == item.id}">
                <img :src="selectedEmbed.id == 1 && item.id == 1 ? activeAnything : item.image" :alt="item.image">
                <span class="font-size-11 mt-10px">{{item.title}}</span>
            </div>
        </div>

        <div class="embed-inputs">
            <div class="radio__wrapper">
                <label  for="name-1" class="font-size-13 dark-gray2">{{$t('ViewListdescription.view_name')}} </label>
                    <div class="mt-10px">
                    <InputText inputId="name-1" class="urlText text-capitalize border-gray border-radius-3-px" :placeHolder="$t('PlaceHolder.Enter_View_Name')" @keyup="inputValues.name.error = ''" :modelValue="inputValues.name.value" @update:modelValue="(val)=>{inputValues.name.value  = val.trim() }" />
                    <div class="red error font-size-11 position-ab mb-0" v-if="inputValues.name.error" >{{ inputValues.name.error }}</div>
                </div>
            </div>
            <div class="radio__wrapper">
                <span>
                    <input type="radio" name="type" id="r1" value="url" class="mt-20px"  @change="(e)=> {radioValue = e.target.value,cleanUp()}"  checked>
                    <label  for="r1" class="font-size-13 dark-gray2">{{$t('ViewListdescription.embed_URL')}} </label>
                </span>
                <div class="mt-10px">
                    <InputText class="urlText text-capitalize border-gray border-radius-3-px" :class="{'disabled':radioValue == 'html'}" :placeHolder="$t('PlaceHolder.Enter_URL')" inputId="i1" @keyup="inputValues.url.error = ''" :modelValue="inputValues.url.value" @update:modelValue="(val)=>{inputValues.url.value  = val.trim() }" :isDisabled="radioValue == 'html'"/>
                    <div class="red error font-size-11 position-ab mb-0" v-if="inputValues.url.error" >{{ inputValues.url.error }}</div>
                </div>
            </div>
            <div class="radio__wrapper">
                <span v-if="selectedEmbed.id == 1" class="mt-10px">
                    <input  type="radio"  class="mt-15px" id="r2" name="type" value="html"  @change="(e)=> {radioValue = e.target.value,cleanUp()}">
                    <label  for="r2" class="font-size-13 dark-gray2">{{$t('ViewListdescription.embed_HTML')}}</label>
                </span>
                <div class="mt-10px embed__text-area">
                    <textarea class="textArea w-100 font-roboto-sans font-size-13 p-10px color94 border-gray border-radius-3-px " :class="{'disabled':radioValue == 'url'}" v-if="selectedEmbed.id == 1" @keyup="inputValues.html.error = ''"  :placeHolder="$t('PlaceHolder.Enter_HTML')" v-model="inputValues.html.value" :disabled="radioValue == 'url'"> </textarea>
                    <div class="red error font-size-11 position-ab mb-0" v-if="inputValues.html.error">{{inputValues.html.error}}</div>
                </div>
            </div>
        </div>
        <div class="d-flex justify-content-between align-items-center mt-17px">
            <div class="d-flex justify-content-between private__pinview-wrapper">
                <div class="private__pin-wrapper private__view d-flex align-items-center">
                     <input type="checkbox"  id="c1"  @change="isPrivate = !isPrivate">
                     <label  for="c1" class="font-size-13 dark-gray2 m-0 pl-3px">{{$t('ViewListdescription.private_view')}}</label>
                </div>
                <div class="private__pin-wrapper pin__view d-flex align-items-center">
                    <input type="checkbox"  id="c2" @change="isPin = !isPin" >
                    <label   for="c2" class="font-size-13 pl-3px dark-gray2 m-0">{{$t('Projects.pin')}}{{$t('Projects.view')}}</label>
                </div>
            </div>
            <button class="btn-primary font-roboto-sans d-flex align-items-center justify-content-end font-size-16 ml-15px add__view-btn" @click="HandleSubmit">{{$t('Projects.add_view')}}</button>
        </div>
       </div>
    </div>
</template>
<script setup>
//packages
import { ref,inject,onMounted,computed } from 'vue';

// components
import InputText from '@/components/atom/InputText/InputText.vue'
import {addView} from './helper.js'
import { addPrivateView } from "@/components/molecules/ProjectViews/helper.js"

// UTILS
import { useCustomComposable } from "@/composable";
import { useToast } from 'vue-toast-notification';
import { Embeds } from "./Embeds.js";
import { useStore } from 'vuex';
import { useI18n } from "vue-i18n";
const { t } = useI18n();
// assets
const boxes = require('@/assets/images/svg/embed-boxes.svg')
const activeAnything = require('@/assets/images/svg/active-anything.svg')

const props = defineProps({
    projectData: {
        type: Object,
        default: () => {}
    },
})

const { getters,commit } = useStore();
const companyUserData = computed(()=> { return getters['settings/companyUsers']})
const companyUser = ref()
const isPin = ref(false)
const isPrivate = ref(false)
const toast = useToast()
const companyId = inject('$companyId')
const userId = inject("$userId")
const selectedEmbed = ref({
    id: 1,
    title: "Anything",
    label: "Anything",
    type: "html",
    url: "",
    htmlRegex: "",
    regex: /^(?:(?:(?:https?|ftp):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u00a1-\uffff][a-z0-9\u00a1-\uffff_-]{0,62})?[a-z0-9\u00a1-\uffff]\.)+(?:[a-z\u00a1-\uffff]{2,}\.?))(?::\d{2,5})?(?:[/?#]\S*)?$/i,
    embedType: "url",
    image: require("@/assets/images/svg/anything.svg"),
})
const embeds = ref(Embeds)
const {makeUniqueId} = useCustomComposable();
const radioValue = ref('url')
const inputValues = ref({
    html: {value: '', error: ''},
    url: {value: '', error: ''},
    name: {value: '', error: ''} 
})
const selectEmbed = (item) => {
    selectedEmbed.value = {...item}
    inputValues.value.url.error = ''
    inputValues.value.html.error = ''
    document.getElementById('r1').click()
}

const emits = defineEmits(['closeDropdown'])
onMounted(() =>{
    companyUser.value = (companyUserData.value.filter((item) =>  userId.value === item.userId )[0])
})

function getYouTubeEmbedUrl(url) {
  var urlParams = new URLSearchParams(new URL(url).search);
  var videoId = urlParams.get('v');
  var playlistId = urlParams.get('list');
  var index = urlParams.get('index');

  var embedUrl = 'https://www.youtube.com/embed/' + videoId + '?list=' + playlistId + '&index=' + index;

  return embedUrl;
}

function isPlaylistVideo(url) {
  return new URL(url).searchParams.has('list');
}

const HandleSubmit = () => {
    if(handleValidation()){
        let { title, id } = selectedEmbed.value;
        let addObj = {};
        if(radioValue.value == 'url') {
            let uid = makeUniqueId(6);
            let Type = '';

            if(id === 1) {
                if((/^https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]{44}|[a-zA-Z0-9-_]{19})(\/.*)?$/).test(inputValues.value.url.value))
                { Type = 'Sheets' }
                if((/^https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]{44}|[a-zA-Z0-9-_]{19})(\/.*)?$/).test(inputValues.value.url.value))
                { Type = 'Docs' }
                if((/^(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/).test(inputValues.value.url.value))
                { Type = 'Youtube' }
                if((/^(?:https:\/\/)?(?:www\.)?figma\.com\/(file|proto)\/([0-9a-zA-Z]{22,128})(?:\/?([^]+)?(.*))?$/).test(inputValues.value.url.value))
                { Type = 'Figma' }
            }
            if(selectedEmbed.value.title === 'Youtube' || Type === 'Youtube'){
                if(isPlaylistVideo(inputValues.value.url.value)){
                    let url = getYouTubeEmbedUrl(inputValues.value.url.value);
                    inputValues.value.url.value = url;
                }
            }
            addObj = {name: inputValues.value.name.value, url: inputValues.value.url.value, type: id===1 ? (Type ? Type :"Anything_url") : title, id: uid, isPin: isPin.value, isPrivate: isPrivate.value }
            if(!isPrivate.value) {
                addView({cid: companyId.value, pid: props.projectData._id }, addObj ).then((res) => {
                    commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: props.projectData._id,key:"ProjectView",subKey:"add",userId: ''});
                    toast.success(res.statusText,{position:'top-right'})
                    emits('closeDropdown')
                }).catch((err) =>{
                    toast.error(err.statusText,{position: "top-right"})
                })
            } else {
                addPrivateView({cid: companyId.value, uid: companyUser.value._id, uniqueId: addObj.id}, {...addObj, projectId: props.projectData._id }).then((res) => {
                    toast.success(t(`Toast.${res.statusText}`), {position:'top-right'})
                }).catch((err) =>{
                    console.error(err.statusText)
                })
            }
        }
        if(radioValue.value == 'html')
        {
            let uid = makeUniqueId(6);
            addObj = { name: inputValues.value.name.value, html: inputValues.value.html.value, type: id==1 ? "Anything_html" : title, id: uid, isPin: isPin.value, isPrivate: isPrivate.value }
            if(!isPrivate.value) {
                addView({cid: companyId.value, pid: props.projectData._id }, addObj ).then((res) => {
                    commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: props.projectData._id,key:"ProjectView",subKey:"add",userId: ''});
                    toast.success(res.statusText, {position:'top-right'})
                    emits('closeDropdown')
                }).catch((err) => {
                    toast.error(err.statusText,{position: "top-right"})
                })
            } else {
                addPrivateView({cid: companyId.value, uid: companyUser.value._id, uniqueId: addObj.id },{...addObj, projectId: props.projectData._id }).then((res) => {
                    toast.success(t(`Toast.${res.statusText}`) , {position:'top-right'})
                }).catch((err) =>{
                    console.error(err.statusText)
                })
            }
        }

        emits('closeDropdown')
    }
}
  
const cleanUp = () =>{
    inputValues.value.html = {value:'',error:''}
    inputValues.value.url = {value:'',error:''}
}

const isKeyInArray = (array, key) => {
    return array.some(obj => Object.prototype.hasOwnProperty.call(obj, key)); 
}

const handleValidation = () =>{
    let componentArray = props.projectData.ProjectRequiredComponent;
    if(!inputValues.value.name.value.trim()){
        inputValues.value.name.error = t('Embeded.The_name_is_required');
        return false
    }
    if(inputValues.value.name.value.trim().length < 3){
        inputValues.value.name.error = t('Embeded.The_name_should_be_at_least_3_characters_long');
        return false
    }
    const itemName = inputValues.value.name.value.toLowerCase().replaceAll(' ', '_').trim();
    if(componentArray.some((item) => item.name.toLowerCase().replaceAll(' ', '_').trim() === itemName)) {
        inputValues.value.name.error = t('Embeded.name_already_exists');
        return false
    }

    if(radioValue.value == 'url'){
        if(!inputValues.value.url.value.trim()){
            inputValues.value.url.error = t('Embeded.The_url_is_required');
            return false
        }
        if(!selectedEmbed.value.regex.test(inputValues.value.url.value)){
            inputValues.value.url.error = t('Embeded.Please_enter_valid_url');
            return false
        }
        let url = isPlaylistVideo(inputValues.value.url.value) ? getYouTubeEmbedUrl(inputValues.value.url.value) : inputValues.value.url.value;
        if(isKeyInArray(componentArray, 'url') && componentArray.some((item) => item?.url?.trim() === url.trim())) {
            inputValues.value.url.error = t('Embeded.URL_already_exists');
            return false
        }
        return true
    }
    if(radioValue.value == 'html'){
        if(!inputValues.value.html.value.trim()){
            inputValues.value.html.error = t('Embeded.The_Html_code_is_required');
            return false
        }
        return true
    }

}

</script>
<style >
@import './style.css'

</style>