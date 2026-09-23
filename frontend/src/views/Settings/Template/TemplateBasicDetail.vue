<!-- =========================================================================================
    Created By : Dipsha Kalariya
    Commnet : This component is used to display template bacis detail for template create module.
========================================================================================== -->
<template>
<div>
    <div id="project-step-container">
        <div class="createprojectContent whitebodyContent_v2 templateSidebar">
            <div class="col-md-2 company_img">
                <div v-if="theModel.templateDetail.previewImage.value ==''" class="image-input create-workspace-sidebar-image" @click="openCropperTool()">
                    <span class="placeholder" > {{$t('Templates.upload_image')}} </span>
                    <img :src="upload" class="upload_image"  :height="12" :width="13">
                </div>
                <img v-else :src="previewImageSrc"  class="create-workspace-sidebar-image" @click="openCropperTool()">
            </div>
            <div class="template__desc-wrapperform">
                <div class="form-group">
                    <label class="dark-gray">{{$t('Templates.template_name')}}<span class="text-red asterisk">*</span></label>
                    <div class="input-field-group">
                            <InputText
                                class="form-control login-input template__input"
                                :placeholder="$t('PlaceHolder.Enter_Template_Name')"
                                autocomplete="off"
                                v-model.trim="theModel.templateDetail.templateName.value"
                                @keyup="isUniqueProjectKey(theModel.templateDetail.templateName.value),checkErrors({'field':theModel.templateDetail.templateName,
                                'name':theModel.templateDetail.templateName.name,
                                'validations':theModel.templateDetail.templateName.rules,
                                'type':theModel.templateDetail.templateName.type,
                                'event':$event.event})"
                                maxlength="50"
                                height="29px"
                                type="text"
                            />
                            <div class="text-red font-size-11">{{theModel.templateDetail.templateName.error === 'The templatename field is required' ? 'The template name field is required' : theModel.templateDetail.templateName.error}}</div>
                            <div class="text-red font-size-11" v-if="errorMsg.isUniqueProjectCode">{{`errorPage.${errorMsg.isUniqueProjectCode.replaceAll('.','').replaceAll(' ','_')}`}}</div>
                    </div>
                </div>
                <div class="form-group textareaWrapper flex-column">
                    <div class="d-flex" :class="{'flex-column' :clientWidth <= 767}">
                        <label class="dark-gray">{{$t('ProjectDetails.description')}}<span class="text-red asterisk">*</span></label>
                        <textarea :placeholder="$t('PlaceHolder.Enter_Description')" @keyup="checkErrors({'field':theModel.templateDetail.description,
                                'name':theModel.templateDetail.description.name,
                                'validations':theModel.templateDetail.description.rules,
                                'type':theModel.templateDetail.description.type,
                                'event':$event})" maxlength="2000" class="form-control" v-model="theModel.templateDetail.description.value">
                        </textarea>
                    </div>
                    <div class="d-flex mt-1px" :style="[{'margin-left': clientWidth <= 767 ? '0' : '28%'}]">
                        <span class="text-red font-size-11 red">{{theModel.templateDetail.description.error}}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <CroppingTool
        :image="{url:previewImageSrc,name:''}"
        @updateVisible="(val) => isCropperVisible = val"
        :title="$t('Templates.create_template')"
        @getEditedImage="(val) => getImageData(val)"
        :isCheckStorage="true"
        :stencilType="'square'"
    />
</div>
</template>
<script setup>
import { ref,inject } from "vue";
import InputText from "@/components/atom/InputText/InputText.vue";
import CroppingTool from '@/components/atom/CroppingTool/CroppingTool.vue'
import { useValidation } from "@/composable/Validation.js";
import { ValidationFunction } from "@/composable/DefaultValidationFunction";
const upload = require("@/assets/images/svg/crop-cloud.svg")
import { useI18n } from "vue-i18n";
const { t } = useI18n();

    const  { checkErrors } = useValidation();
    const isCropperVisible = ref(false)
    const props = defineProps({
        modelValue: {
            type: Object,
            default: () => ({}),
        },
        defaultMainTemplate : {
            type : Array,
            default : ()=>([])
        }
    });
    const templateArr = ref([]);
    props.defaultMainTemplate.forEach(itemVal=>{
        templateArr.value.push(itemVal.TemplateName);
    })
    const theModel = ref(props.modelValue);
    const errorMsg = ref({isUniqueProjectCode : ''});
    const previewImageSrc = ref("");
    const clientWidth = inject("$clientWidth");
    function isUniqueProjectKey(value) {
        const val = value;
        ValidationFunction.isValueExistInArray(templateArr.value, val, (result) => {
            if (result == true) {
                errorMsg.value.isUniqueProjectCode = t('errorPage.template_name_already_exists');
            } else {
                errorMsg.value.isUniqueProjectCode = "";
            }
        })
        return;
    }

    const openCropperTool = () => {
        isCropperVisible.value = true
        document.getElementById('cropping-input').click()
    }

    function getImageData (val) {
        previewImageSrc.value = val.url, 
        theModel.value.templateDetail.previewImage.value = val.base64Image;
        theModel.value.templateDetail.previewImage.name = val.fileName;
    }
</script>
<style scoped>
@import "./style.css";
</style>