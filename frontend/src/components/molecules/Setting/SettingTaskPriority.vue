<template>
<div class="position-re">
    <SpinnerComp :is-spinner="isSpinner" />
        <div :class="[{'pointer-event-none':isSpinner}]" v-if="currentCompany?.planFeature?.projectProjectApp">
            <h2 class="task_priority_wrapper_value">{{ $t('Settings.task_priority') }}</h2>
            <div class="mySettingSection priorityWrapper">
                <div class="tasktype_main">
                    <form v-if="props.editPermission" class="pb-20px"  @submit.prevent="savedata">
                        <div class="img_uploadpriority_wrapper align-items-center d-flex justify-content-between">
                            <div class="vs-component vs-con-input-label vs-input inputx vs-input-primary d-flex justify-content-between">
                                <div class="vs-con-input">
                                    <input type="text" v-model.trim="formData.priorityname.value"
                                        class="vs-inputx vs-input--input normal" name="priorityName"
                                        :placeholder="$t('PlaceHolder.Enter_Priority_Name')" @keyup="checkErrors({
                                                'field': formData.priorityname,
                                                'name': formData.priorityname.name,
                                                'validations': formData.priorityname.rules,
                                                'type': formData.priorityname.type,
                                                'event': $event.event
                                            })" @input="confirmationErr=''"/>
                                    <div class="invalid-feedback red" v-if="confirmationErr">{{ confirmationErr }}</div>
                                    <div class="invalid-feedback red" v-else>{{ formData.priorityname.error }}</div>
                                </div>
                                <div class="from-group d-flex align-items-center" @click="$refs.fileInputUser.click()">
                                    <label class="cursor-pointer Upload_icon">
                                        <img :src="previewImage ? previewImage : Upload_icon" alt="Upload_icon">
                                    </label>
                                    <input type="file" ref="fileInputUser" @change="(e) => onSelectFile(e)" class="form-control-file d-none"
                                        id="priority_upload_img" @input="confirmationErr=''"/>
                                </div>
                            </div>
                            <div>
                                <span class="Upload_img_span">
                                        {{$t('Settings.maximum_image_size')}} <span class="black"><b>250x250px</b></span>.
                                </span>
                            </div>
                        </div>
                        <div class="d-flex">
                            <button type="submit" class="blue_btn" id="blue_btn" :disabled="isDisabled">{{$t('Projects.save')}}</button>
                            <button type="button" name="button"
                                class="vs-component vs-button white_btn vs-button-primary vs-button-filled" @click="emptyfileds()">
                                {{$t('Projects.cancel')}}
                            </button>
                        </div>
                    </form>
                    <div class="milestone_status_button" v-for="(item, index) in arrayobject " :key="index">
                        <div class="con-vs-chip vs-chip-null">
                            <span class="text-chip vs-chip--text">
                                <div class="priorityWrapper d-flex align-items-center">
                                    <img v-if="isBundledPriorityImage(item.image)" :src="companyPrioritiesIcons(item.value)?.statusImage" alt="priority_img">
                                    <WasabiImage v-else :data="{ url: item?.statusImage }" class="wasabi__priority-image"/>
                                    <span class="font_family_status">{{ item.name }}</span>
                                    <img class="cursor-pointer" :src="cancel_icon" alt="cancel" @click="deleteTaskPriority(index,item)" v-if="item.isDeleted && props.editPermission">
                                </div>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <ConfirmModal
            :modelValue="showConfirmModal"
            acceptButtonText="Confirm"
            :cancelButtonText="allowDeletePriority ? $t('Projects.cancel') : `ok`"
            maxlength="150"
            :header="true"
            :showCloseIcon="false"
            @accept="removedata"
            @close="showConfirmModal = false"
            :acceptButton="allowDeletePriority"
            :className="allowDeletePriority ? '': 'setting_task_priority'"
        >
            <template #header>
                <h3 class="m-0" v-if="allowDeletePriority">{{ $t('Home.Confirm') }}</h3>
                <h3 class="m-0" v-else>{{$t('Settings.warning')}}</h3>
            </template>
            <template #body>
                <span v-if="allowDeletePriority">{{$t('Filters.are_you_sure')}}?</span>
                <div v-else class="d-flex align-items-center flex-column px-2">
                    <img :src="warnImage" alt="warnImage" class="warning__yellow-img" />
                    <span class="pb-15px">{{ $t('Settings.priority_in_use').replace('PRIORITY_NAME',prioritieName) }}</span>
                </div>
            </template>
        </ConfirmModal>
</div>
</template>

<script setup>
import { onMounted, computed, ref, inject, defineComponent,defineProps, nextTick, watch } from "vue";
import { useToast } from 'vue-toast-notification';
import { useStore } from "vuex";
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import { useValidation } from "@/composable/Validation.js";
import ConfirmModal from '@/components/atom/Modal/Modal.vue';
import { companyPrioritiesIcons, isBundledPriorityImage } from '@/composable/commonFunction';
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import { apiRequest, apiRequestWithoutCompnay } from '../../../services';
import { useCustomComposable } from "@/composable";
import { useI18n } from "vue-i18n";
const { t } = useI18n();
import {storageQueryBuilder,generateFileName} from '@/utils/storageQueryBuild.js';
import * as env from '@/config/env';

const showConfirmModal = ref(false);
const selectedvalue=ref(0);
const { checkErrors,checkAllFields } = useValidation();
const fileInputUser = ref();
const selectFile = ref();
const isImgeChange = ref(false);
const previewImage = ref();
const $toast = useToast();
const { getters,commit } = useStore();
let arrayobject = ref([]);
const companyId = inject("$companyId");
const isSpinner = ref(false);
const confirmationErr = ref('')
const isDisabled=ref(false)
const cancel_icon =require('@/assets/images/svg/cancel_icon.svg')
const Upload_icon = require('@/assets/images/svg/Upload_blue-icon.svg')
const isValidIcon = ref(true)
const allowDeletePriority = ref(true);
const prioritieName = ref('');
const warnImage = require('@/assets/images/gif/warning-yellow.gif')
const formData = ref({

    priorityname: {
        value: "",
        rules:
            "required | min:3 | max:20",
        name: "Priority Name",
        error: ""
    }
})
const ImageDimensions = '250 x 250';
defineComponent({
    name: 'Task-prioritie',
    SpinnerComp
})
const { checkBucketStorage } = useCustomComposable();
const props = defineProps({
    editPermission: {
        type: [Boolean],
        default: false
    }
})
const priorities = computed(() => getters["settings/companyPriority"]);
const currentCompany = computed(() => getters['settings/selectedCompany']);

watch(() => getters["settings/companyPriority"], (newVal) => {
    arrayobject.value = newVal;
});
onMounted(() => {
    arrayobject.value = priorities.value;
});

//// image select function ////
function onSelectFile() {
    const input = fileInputUser.value;
    let fileList = Array.from(input.files);
    if(checkBucketStorage(fileList.map(file => file?.size),{gettersVal: getters}) !== true){
        return;
    }
    selectFile.value = input.files;
    if (selectFile.value && selectFile.value[0]) {
        const ext = selectFile.value[0].name.substring(selectFile.value[0].name.lastIndexOf(".") + 1);
        const extArray = ['jpg', 'png', 'jpeg', 'JPEG'];
        // Check valid image extension validation
        if (!extArray.includes(ext.toLowerCase())) {
            $toast.error(t('Toast.Select_file_only_image_and_image_file_format_should_be_FILE_FORMATS').replace('FILE_FORMATS', extArray), { position: 'top-right' })
            fileInputUser.value.value = null;
            return;
        }
        isValidIcon.value = true
        isImgeChange.value = true;
        var reader = new FileReader();
        reader.onload = (e) => {
            const image = new Image();
            image.src = e.target.result;
            previewImage.value = e.target.result
            image.onload = () => {
                const width = image.width;
                const height = image.height;
                if (width > 250 || height > 250) {
                    $toast.error(t('Toast.Image_dimensions_should_not_exceed_ImageDimensions_pixels').replace('ImageDimensions', ImageDimensions), { position: 'top-right' });
                    isValidIcon.value = false
                    previewImage.value = null
                    fileInputUser.value.value = null;
                    return
                }
        }}
        reader.readAsDataURL(input.files[0]);

    } else {
        fileInputUser.value.value = null;
    }
}

///UPDATE DATA IN DATABASE///
async function savedata() {
    const nameExists = arrayobject.value.some((item) => {
        return item.name.replaceAll(" ","").toLowerCase() === formData.value.priorityname.value.replaceAll(" ","").toLowerCase();
    });
    if (formData.value.priorityname.value.trim() === "") {
        confirmationErr.value = t('Settings.The_priority_name_field_is_required');
        return
    }
    if (formData.value.priorityname.value.length < 3) {
        confirmationErr.value =(t('Settings.The_priority_name_field_must_be_at_least'));
        return
    }
    if(selectFile.value == null || isValidIcon.value == false)
    {
        confirmationErr.value = t('Settings.The_priority_image_field_is_required');
        return
    }
    if (nameExists) {
        confirmationErr.value= t('Settings.Priorities_already_Exists');
    } else {
        checkAllFields(formData.value).then(async(valid)=>{
            if(valid && confirmationErr.value === ''){
        if (isImgeChange.value) {
            isSpinner.value = true;
            isDisabled.value =true
            let name = generateFileName(selectFile.value[0].name,env.STORAGE_TYPE);
            const filePath = `taskPriorities/${name}`
            // let storageFolder = `${companyId.value}/taskPriorities/`;
            // await firebaseUpload(selectFile.value[0], storageFolder, name).then((imgURL) => {
            //     previewImage.value = imgURL;
            //     confirmationErr.value ='';
            //     selectFile.value = null
            // });

            const apiFormData = new FormData();
            apiFormData.append("path", filePath);
            apiFormData.append("companyId", companyId.value);
            apiFormData.append("file", selectFile.value[0]);
            await apiRequestWithoutCompnay("post", storageQueryBuilder('upload').route, apiFormData, "form").then((res)=>{
                if(res.data.status){
                    previewImage.value = res.data.statusText;
                } else {
                    previewImage.value = "";
                }
            })
            if(!previewImage.value){
                isSpinner.value = false;
                isDisabled.value = false;
                $toast.error(t('Toast.error_in_uploading_image_please_try_it_again'), { position: 'top-right' });
                return;
            }
            let obj = {
                name: formData.value.priorityname.value,
                image: previewImage.value,
                statusImage: previewImage.value,
                value: formData.value.priorityname.value.toUpperCase(),
                isDeleted: true,
                isExpanded: true
            };
            const queryUpdate = {
                key: '$push',
                updateObject:{settings: {...obj}}
            };
            try {
                const result = await apiRequest("put",env.TASK_PRIORITY,queryUpdate);
                if(result.status === 200){
                    $toast.success(t("Toast.Task_priority_updated_successfully"), { position: 'top-right' });
                    nextTick(() => {
                        commit("settings/mutateCompanyPriority",{
                            data: {...obj},
                            op: "added"
                        });
                    });
                }else{
                    $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });    
                }
                isSpinner.value = false;
                isDisabled.value =false;
                previewImage.value=''
                fileInputUser.value.value = null;
            } catch (error) {
                console.error('Error in updating the task priority');
                fileInputUser.value.value = null;
                isSpinner.value = false;
                console.error('Error in updating the task priority',error);
                $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
            }

            formData.value.priorityname.value = '',
            formData.value.priorityname.error = ''
            confirmationErr.value ='';
        }
        else {
            confirmationErr.value =('please select image ');
            fileInputUser.value.value = null;
        }
    }})
    }
    
}

///Delete Selected Data function ///
function emptyfileds(){
    isImgeChange.value = false;
        formData.value.priorityname.value = ''
        previewImage.value = ''
        formData.value.priorityname.error=''
        confirmationErr.value ='';
}
function deleteTaskPriority(value,detail) {
    let query = [
        {
            "$match": {
                "$and": [
                    {           
                        "Task_Priority": {
                            "$in": [detail.value]
                        }       
                    },
                    {
                        "deletedStatusKey":{ $nin: [1] }
                    }
                ]
            }
        },
        {
            "$count": "count"
        }
    ];

    apiRequest('post', `${env.TASK}/find`, { findQuery: query }).then((response) => {
        const res = response.data[0];
        if(res && res?.count > 0){
            allowDeletePriority.value = false;
            prioritieName.value = detail.name;
        }else{
            allowDeletePriority.value = true;
            selectedvalue.value = value;
            prioritieName.value = "";
        }
        showConfirmModal.value = true;
    })
    .catch((error) => {
        console.error("Error in deleteTaskPriority hook: ", error);
    })
}
async function removedata() {
    try {
        let obj = arrayobject.value[selectedvalue.value];
        if(obj && Object.keys(obj).length){
            const queryUpdate = {
                key: '$pull',
                updateObject:{settings: {...obj}}
            };
            const result =  await apiRequest("put",env.TASK_PRIORITY,queryUpdate);
            if(result.status === 200){
                $toast.success(t("Toast.Task_priority_Remove_successfully"), { position: 'top-right' });
                nextTick(() => {
                    commit("settings/mutateCompanyPriority",{
                        data: {...obj},
                        op: "removed"
                    });
                });
            }else{
                $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
            }
            isSpinner.value = false;
            isImgeChange.value = false;
            formData.value.priorityname.value = ''
            previewImage.value = ''
            formData.value.priorityname.error=''
            confirmationErr.value ='';
            showConfirmModal.value = false;
            selectedvalue.value = 0;
        }else{
            $toast.error(t('Toast.error_in_deleting_priority_please_try_it_again'), { position: 'top-right' });
            isSpinner.value = false;
        }
    } catch (error) {
        console.error('Error in removing the task priority');
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        isSpinner.value = false;
    }
}
</script>

<style scoped>
.warning__yellow-img{
    width: 100px;
    height: 100px;
}
@import './style.css'
</style>