<!-- =========================================================================================
    Created By : Dipsha Kalariya
    Commnet : This component is used to display project profile detail for blank project form as step-2 in create project module.
========================================================================================== -->
<template>
<div class="createprojectproject-usetemplateclass">
    <div class="form-group ProjectShareGraphicColorWrapper d-flex">
        <div v-if="theModel.previewImage.value && Object.keys(theModel.previewImage.value).length > 0" class="project-icon-img-preview">
            <WasabiImage class="border-radius-10-px project__graphic-img" v-if="!theModel.previewImage.value.includes('http') && !theModel.previewImage.value.includes('data:image/')" :data="{url: theModel.previewImage.value, filename: theModel.previewImage.value.split('/').pop(), extension: theModel.previewImage.value.split('/').pop().split('.').pop()}"/>
            <img v-else :src="theModel.previewImage.value" class="border-radius-10-px project__graphic-img"/>
        </div> 
        <div v-else class="backgroundcolor d-flex align-items-center justify-content-center project_background-color" :style="{'background-color':theModel.selectedColor.value ? theModel.selectedColor.value : '#7c828d'}">
            <h4 class="fontFamilyChanges">{{name.value && name.value !== "" ? name.value.charAt(0).toUpperCase() : "H"}}</h4>
        </div>
        <div class="ProjectShareGraphicColorContent">
            <div class="imageColorPickerDiv">
                <h5 class="projectColor" :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}">{{$t("Projects.project_color")}}</h5>
                <ul class="ul-colors" :style="{'display': 'flex', 'list-style-type':'none','flex-wrap': 'wrap','align-items': 'center'}">
                    <li class="border-radius-2-px d-inline-block project__selected-color"  @click="selectedColor('#7c828d'), theModel.previewImage.value = ''"><button class="cursor-pointer" type="button"><span><img :src="disableIcon" /></span></button></li>
                    <li class="status_square" v-for="(color, index) in colorsList" :key="index" @click="selectedColor(color), theModel.previewImage.value = ''" :style="{'cursor':'pointer', 'background-color': color, 'padding':'4px', 'margin': '0 7px 10px 7px'}">
                        <span></span>
                    </li>
                </ul>
            </div>
        </div>
    </div>
    <div class="orDiv">
        <span>{{ $t('Channel.or') }}</span>
    </div>
    <div class="form-group mb-10px mr-10px">
        <div class="imagePicker position-re">
            <input v-if="theModel.previewImage.value!==''" type="text" :placeholder="$t('Channel.choose_to_upload')" class="form-control" v-model.trim="theModel.previewImage.name" readonly/>
            <input v-else type="text" class="form-control" :placeholder="$t('Channel.choose_to_upload')" readonly/>
            <label class="button-primary" for="upload-photo">{{ $t('Templates.upload') }}</label>
            <input type="file" ref="fileInputUser" name="img" @change="previewImage" accept="image/x-png,image/jpeg,image/jpg" id="upload-photo"/>
        </div>
    </div>
</div>
</template>
<script setup>
import { ref, defineProps, onMounted, defineComponent, watch, inject } from "vue";
import { useToast } from 'vue-toast-notification';

import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import { useCustomComposable } from "@/composable";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
const { t } = useI18n();

    defineComponent({
        name: "CreateProject-Component",

        components: {
            WasabiImage
        }
    })
    const props = defineProps({
        modelValue: {
            type: Object,
            default: () => ({}),
        },
        name : {
            type : Object,
            default : ()=>({})
        }
    });
    const disableIcon = require("@/assets/images/disableImage.png");
    const theModel = ref(props.modelValue);
    const $toast = useToast();
    const fileInputUser = ref(null);    
    const clientWidth = inject("$clientWidth");
    const { checkBucketStorage } = useCustomComposable();
    const { getters } = useStore();
    watch(()=> props.modelValue ,(val)=>{
        theModel.value = val;
    })
    const emit = defineEmits([
        'update:modelValue',
        'update:image'
    ]);
    const colorsList = ref([]);
    function generateColor(){
        colorsList.value = [];
        if(theModel.value.selectedColor.value !== ''){
            colorsList.value.push(theModel.value.selectedColor.value);
        }
        function getRandomColor() {
            var letters = '0123456789ABCDEF';
            var color = '#';
            for (var i = 0; i < 6; i++) {
                color += letters[Math.floor(Math.random() * 16)];
            }
            return color;
        }
        for(let d=0;d<20;d++){
            let randomColor = getRandomColor();
            while(randomColor === "#FFFFFF" || colorsList.value.includes(randomColor)) {
                randomColor = getRandomColor();
            }
            colorsList.value.push(randomColor);
        }
        if(colorsList.value && colorsList.value.length>0 && theModel.value.selectedColor.value === ''){
            theModel.value.selectedColor.value = '#7c828d';
        }
        emit('update:modelValue', theModel.value);
    }
    onMounted(()=>{
        // if(theModel.value.selectedColor.value === ''){
            generateColor();
        // }
    })
    function selectedColor(val){
        theModel.value.selectedColor.value = val;
        theModel.value.uploadedImage.value = '';
        theModel.value.previewImage.value = '';
        theModel.value.previewImage.name = '';
        emit('update:modelValue', theModel.value)
    }
    function previewImage(){
        const input = fileInputUser.value;
        let fileList = Array.from(input.files);
        if(checkBucketStorage(fileList.map(file => file?.size),{gettersVal: getters}) !== true){
            return;
        }
        theModel.value.uploadedImage.value = input.files;
        if (theModel.value.uploadedImage.value && theModel.value.uploadedImage.value[0]) {
            const ext = theModel.value.uploadedImage.value[0].name.substring(theModel.value.uploadedImage.value[0].name.lastIndexOf(".") + 1);
            const extArray = ['jpg', 'png', 'jpeg', 'JPEG'];
            if (!extArray.includes(ext.toLowerCase())) {
                $toast.error(t('Toast.Select_image_only_and_image_file_format_should_be_FILE_FORMATS').replace('FILE_FORMATS', extArray), { position: 'top-right' })
                return;
            }
            var reader = new FileReader();
            reader.onload = (e) => {
                theModel.value.previewImage.value = e.target.result;
            }
            reader.readAsDataURL(input.files[0]);
            theModel.value.previewImage.value = input.files[0];
            theModel.value.previewImage.name = input.files[0].name
        }
        emit('update:modelValue', theModel.value)
        emit('update:image', input.files)
        fileInputUser.value.value = null;
    }
</script>
<style>
.project__graphic-img{
    width: 64px; 
    height: 64px; 
    object-fit: cover;
}
.project_background-color{
    width:62px;
    height:62px; 
    border-radius:10px;
    text-align: center;
    line-height: 62px;
}
.project__selected-color{
    margin: 0px 7px 11px 7px;
    width: 8px;
}
</style>