<template>
    <div class="position-re">
    <SpinnerComp :is-spinner="isSpinner" class="setting_spinner"/>
    <div>
        <h2 class="task_priority_wrapper_value">{{ $t('Milestone.file_extensions') }}</h2>
        <div class="mySettingSection priorityWrapper">
            <div class="overflow-hidden">
                <form v-if='props.editPermission' @submit.prevent="saveData">
                    <div v-if='props.editPermission'  class="vs-component vs-con-input-label vs-input inputx vs-input-primary">
                        <div class="vs-con-input">
                            <input type="text" class="vs-inputx vs-input--input normal" name="fileExtention"
                                :placeholder="$t('PlaceHolder.Enter_File_Extensions_Name')" v-model="formData.fileExtention.value" @keyup="checkErrors({
                                                'field': formData.fileExtention,
                                                'name': formData.fileExtention.name,
                                                'validations': formData.fileExtention.rules,
                                                'type': formData.fileExtention.type,
                                                'event': $event.event
                                            })" @input="confirmationErr=''" />
                            <div class="invalid-feedback red" v-if="confirmationErr">{{ confirmationErr }}</div>
                            <div class="invalid-feedback red" v-else>{{ formData.fileExtention.error }}</div>
                        </div>
                    </div>
                    <div class="d-flex">
                        <button type="button" class="blue_btn ml-0px" id="blue_btn" @click="saveData">{{ $t('Projects.save') }}</button>
                        <button type="button" name="button"
                        @click="cancel()" class="vs-component vs-button white_btn vs-button-primary vs-button-filled">
                        {{ $t('Projects.cancel') }}
                        </button>
                    </div>
                </form>
                <div class="addExtentionWrapper d-flex flex-wrap" role="group" tabindex="0" :aria-label="$t('Milestone.file_extensions')">
                    <div v-for="(object, index) in arrayobj" :key="index">
                        <div class="con-vs-chip vs-chip-null">
                            <span class="text-chip vs-chip--text">
                                <div class="priorityWrapper d-flex align-items-center">
                                    <span class="font_family_status">{{ object.name }}</span>
                                    <img  class="cursor-pointer" :src="cancel_icon" alt="cancel" @click="deletetask(index)" v-if="!object.systemGenerated && props.editPermission">
                                </div>
                            </span>
                        </div>
                    </div>
                    <ConfirmModal
                        :modelValue="showConfirmModal"
                        :acceptButtonText="$t('Home.Confirm')"
                    :cancelButtonText="$t('Projects.cancel')"
                        maxlength="150"
                        :header="true"
                        :showCloseIcon="false"
                        @accept="removeData"
                        @close="showConfirmModal = false"
                    >
                        <template #header>
                            <h3 class="m-0">{{ $t('Home.Confirm') }}</h3>
                        </template>
                        <template #body>
                            <span>{{$t('Filters.are_you_sure')}}?</span>
                        </template>
                    </ConfirmModal>
                </div>
            </div>
        </div>
    </div>
</div>
</template>

<script setup>
import { ref, computed, watchEffect, defineComponent,defineProps } from "vue";
import { useToast } from 'vue-toast-notification';
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import { useValidation } from "@/composable/Validation.js";
// import Swal from 'sweetalert2';
import { useStore } from "vuex";
import ConfirmModal from '@/components/atom/Modal/Modal.vue';
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from '@/config/env';
const { t } = useI18n();
const showConfirmModal = ref(false);
const selectedvalue=ref('');
const { getters,commit } = useStore();
const $toast = useToast();
const isSpinner = ref(false);
const confirmationErr = ref('')
const { checkErrors,checkAllFields } = useValidation();
const arrayobj = ref([])
const cancel_icon =require('@/assets/images/svg/cancel_icon.svg')
const notsupportfile = ref([])
defineComponent({
    name: 'File-Extensions',
    SpinnerComp
})
const props = defineProps({
    editPermission: {
        type: [Boolean],
        default: false
    }
})
const formData = ref({

    fileExtention: {
    value: "",
    rules:
        "required | min:2",
    name: "File Extension",
    error: ""
}
})
const extensions = computed(() => getters['settings/restrictedExtensions'])
const file = computed(() => getters['settings/fileExtentions'])
watchEffect(() => {
    arrayobj.value = file.value.map((x) => ({ ...x, systemGenerated: x.systemGenerated, name: x.name }));
    notsupportfile.value = extensions.value.map((x) => x)
});

function saveData() {
    if (isSpinner.value == true) {
        return 
    }
    if (formData.value.fileExtention.value == '') {
        confirmationErr.value =(t('Settings.The_file_extension_field_is_required'));
        return
    }
    if (formData.value.fileExtention.value.length < 3) {
        confirmationErr.value =(t('Settings.The_file_extension_field_must_be_at_least'));
        return
    }
    if (!formData.value.fileExtention.value.startsWith('.')) {
        formData.value.fileExtention.value = '.' + formData.value.fileExtention.value
    }
    const notallow = notsupportfile.value.some((item) => {
        return item === formData.value.fileExtention.value.toLowerCase();
    });

    if (notallow) {
       confirmationErr.value = (`'${formData.value.fileExtention.value}' ${t('Settings.file_extension_is_not_supported')}`)
        return;
    }
    const nameExists = arrayobj.value.some((item) => {
        return item.name.replaceAll(" ","").toLowerCase() === formData.value.fileExtention.value.replaceAll(" ","").toLowerCase();
    });

    if (nameExists) {
       confirmationErr.value = (t('Settings.file_extension_already_Exists'));
        isSpinner.value = false;
        // formData.value.fileExtention.value = ''
        return;
    }

    checkAllFields(formData.value).then(async(valid)=>{
        if(valid && confirmationErr.value === ''){
            try {
                isSpinner.value = true;
                formData.value.fileExtention.error = '';
                confirmationErr.value = '';
                let obj = {
                        name: formData.value.fileExtention.value, systemGenerated: false 
                }
    
                const queryUpdate = {
                    key: '$push',
                    updateObject:{settings: obj}
                };
                const result =  await apiRequest("put",env.FILE_EXTENSIONS,queryUpdate);
                if(result.status === 200){
                    $toast.success(t("Toast.File_extension_update_successfully"), { position: 'top-right' });
                    commit("settings/mutateFileExtentions", {data: obj,op: "added"});
                }else{
                    $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });    
                }
                isSpinner.value = false;
                formData.value.fileExtention.error = '';
                formData.value.fileExtention.value = '';
                confirmationErr.value = '';
            } catch (error) {
                isSpinner.value = false;
                formData.value.fileExtention.error = '';
                formData.value.fileExtention.value = ''
                confirmationErr.value = '';
                $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
                console.error("ERROR in delete sprint: ", error);
            }
        }
    })
}
function cancel() {
    formData.value.fileExtention.value = ''
    formData.value.fileExtention.error = ''
    confirmationErr.value = '';
}
function deletetask(index){
    showConfirmModal.value = true;
    selectedvalue.value =index
}

async function removeData() {
    try {
        isSpinner.value = true;
        let obj = arrayobj.value[selectedvalue.value];
        const queryUpdate = {
            key: '$pull',
            updateObject:{settings: obj}
        };
        const result =  await apiRequest("put",env.FILE_EXTENSIONS,queryUpdate);
        if(result.status === 200){
            $toast.success(t("Toast.File_extension_remove_successfully").replace('FILE_EXTENSION',(obj.name)), { position: 'top-right' });
            commit("settings/mutateFileExtentions", {data: obj,op: "removed"});
        }else{
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
        isSpinner.value = false;
        showConfirmModal.value = false;
    } catch (error) {
        isSpinner.value = false;
        showConfirmModal.value = false;
        console.error('Error in deleting the files extensions',error);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });    
    }
}
</script>

<style scoped>
@import './style.css';
.invalid-feedback{
    width: 350px;
}
.vs-con-input-label .vs-con-input{
    margin-bottom: 10px;
}
.vs-con-input-label {
    width: 250px !important;
}

.priorityWrapper form {
    position: relative;
}

.font_family_status {
    margin: 0px 0px 0px 10px !important;
}
@media (max-width: 480px) {
    .vs-con-input-label {
    width: 100% !important;
}
}
</style>