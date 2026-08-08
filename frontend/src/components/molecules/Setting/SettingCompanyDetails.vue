<template>
<div class="position-re">
    <SpinnerComp :is-spinner="isSpinner" class="setting_spinner" />
    <div class="mySettingSection box-shadow-2 main-company-section" :class="[{ 'Company-pointer-event-none': isSpinner }]">
        <div class="row vs-con-loading__container" id="div-with-loading-profile">
            <div class="col-md-2 settingProfileCol">
                <div class="settingProfileWrapper">
                    <img :src="formData.companyprofileImage" alt="" class="image-input company-settings-image-input"
                    :style="{'pointer-events': !props.editPermission ? 'none' : ''}"
                    @click="openCropperTool()" v-if="isTempPreview && isImgeChange"/>
                    <WasabiImage
                        v-if="(!isTempPreview && formData.companyprofileImage) || (!isImgeChange && formData.companyprofileImage)"
                        class="setting__wasabi-image" :data="{ url: formData.companyprofileImage }" @click="openCropperTool()"
                        thumbnail="180x180"/>
                    <span class="noimg-uploadImage cursor-pointer"
                    v-if="(!isTempPreview && !formData.companyprofileImage) || (!isImgeChange && !formData.companyprofileImage)"
                    @click="openCropperTool()">
                        {{selectedCompany?.Cst_CompanyName?.charAt(0)?.toUpperCase()}}
                    </span>
                </div>
            </div>
            <div class="col-md-10 settingProfileFormCol">
                <div class="settingProfileFormSubmission settingProfileFormSubmission_info">
                    <form>
                        <div class="row">
                            <div class="col-md-6">
                                <div class="inputFieldDiv">
                                    <label for="Company Name">
                                        {{$t('general.company_individual')}}
                                    </label>
                                    <InputText :readonly="!props.editPermission" class="form-control login-input"
                                        v-model.trim="formData.companyName.value" :placeHolder="$t('general.enter_company_individual')"
                                        type="text" id="Company Name" tabindex="1" @keyup="checkErrors({
                                                'field': formData.companyName,
                                                'name': formData.companyName.name,
                                                'validations': formData.companyName.rules,
                                                'type': formData.companyName.type,
                                                'event': $event.event
                                            })" inputId="refCompanyName" />
                                        <div class="invalid-feedback red">{{ formData.companyName.error }}</div>
                                    </div>
                                </div>
                            <div class="col-md-6">
                                <div class="inputFieldDiv">
                                    <label>
                                        {{$t('Settings.phone')}}
                                    </label>
                                    <div class="teaminput-sidebar">
                                        <div class="d-flex position-re">
                                            <PhoneCountry class="phone" @onSelect="(val) =>{onSelect(val),phoneValidation(String(formData.phoneNumber.value))}"
                                                :preferredCountries="[countryCodeObj?.isoCode ,'US']" :enabledCountryCode="true"
                                                :enabledFlags="true"
                                                :style="{ 'border-radius': '6px 0px 0px 6px ', 'pointer-events': !props.editPermission ? 'none' : '' }"  
                                                :enabledArrowIcon="true"/>

                                            <InputText :readonly="!props.editPermission" class="form-control login-input border-topbottom-right-6-px"
                                                v-model="formData.phoneNumber.value" placeHolder="eg. 000-000-0000"
                                                tabindex="1" @keypress="isNumber($event.event)"
                                                @keyup="checkErrors({
                                                'field': formData.phoneNumber,
                                                'name': formData.phoneNumber.name,
                                                'validations': formData.phoneNumber.rules,
                                                'type': formData.phoneNumber.type,
                                                'event': $event.event}),phoneValidation(String(formData.phoneNumber.value))" 
                                                />
                                            </div>
                                            <div class="invalid-feedback red">{{ formData.phoneNumber.error }}</div>
                                            <div v-if="!formData.phoneNumber.error" class="invalid-feedback red">{{ phoneError }}</div>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="inputFieldDiv">
                                        <label for="Country">
                                            {{$t('Settings.country')}}
                                        </label>
                                        <InputText :readonly="true" :style="{ 'pointer-events': !props.editPermission ? 'none' : '' }"  type="text" class="form-control login-input cursor-pointer" v-model="formData.country.value"
                                            placeHolder="Country" @click="setfocus('country'), visible = !visible"
                                            @focus="setCurrentSidebarValue('country'), setfocus('country')" @keyup="checkErrors({
                                                'field': formData.country,
                                                'name': formData.country.name,
                                                'validations': formData.country.rules,
                                                'type': formData.country.type,
                                                'event': $event.event
                                            })" />
                                        <div class="invalid-feedback red">{{ formData.country.error }}</div>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="inputFieldDiv">
                                        <label for="State">
                                            {{ $t('Settings.state') }}
                                        </label>
                                        <InputText :disabled="locationObj['state'].isStateVal" :readonly="true" :style="{ 'pointer-events': !props.editPermission ? 'none' : '' }" type="text" class="form-control login-input" v-model="formData.state.value"
                                            :placeHolder="locationObj['state'].isStateVal == false ? 'State' : 'No States'" 
                                            inputId="refState" @click="setfocus('state')"
                                            :class="[{'cursor-pointer': locationObj['state'].isStateVal == false}]"
                                            @focus="setCurrentSidebarValue('state'), setfocus('state')" @keyup="checkErrors({
                                                'field': formData.state,
                                                'name': formData.state.name,
                                                'validations': formData.state.rules,
                                                'type': formData.state.type,
                                                'event': $event.event
                                            })" />
                                    <div class="invalid-feedback red">{{ formData.state.error }}</div>

                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="inputFieldDiv">
                                        <label for="City">
                                            {{ $t('Settings.city') }}
                                        </label>
                                        <InputText :disabled="(locationObj['state']?.isStateVal || locationObj['city']?.isCityVal)" :style="{ 'pointer-events': !props.editPermission ? 'none' : '' }" type="text" class="form-control login-input" v-model="formData.city.value"
                                            :placeHolder="!(locationObj['state']?.isStateVal || locationObj['city']?.isCityVal) ? 'City' : 'No Cities'" 
                                            inputId="refCity"
                                            :class="[{'cursor-pointer': !(locationObj['state']?.isStateVal || locationObj['city']?.isCityVal)}]"
                                            @keyup="checkErrors({
                                                'field': formData.city,
                                                'name': formData.city.name,
                                                'validations': formData.city.rules,
                                                'type': formData.city.type,
                                                'event': $event.event
                                            })" />
                                        <div class="invalid-feedback red">{{ formData.city.error }}</div>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="inputFieldDiv drop-arrow">
                                        <label for="Date">
                                            {{$t('Settings.select_date_format')}}
                                        </label>

                                        <div class="con-select selectExample autocompletex">
                                            <div class="input-select-con">
                                                <DropDown :id="formatdate"
                                                    :style="{ 'pointer-events': !props.editPermission ? 'none' : '' }">
                                                    <template #button>
                                                        <div class=" cursor-pointer text-capitalize" :ref="formatdate">
                                                            {{ formData.format_date }}
                                                        </div>
                                                    </template>
                                                    <template #options>
                                                        <DropDownOption
                                                            @click="formData.format_date = date, $refs[formatdate].click()"
                                                            v-for="(date, index) in dateArray" :key="index"
                                                            :item="{ label: date }">
                                                        </DropDownOption>
                                                    </template>
                                                </DropDown>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Whether the desktop tracker is capped by a task's estimate.
                                 A company-wide switch, so it sits with the other company-wide
                                 time settings rather than on a project or a person. -->
                            <div class="row">
                                <div class="col-md-12">
                                    <div class="company__setting-toggle">
                                        <div class="company__setting-toggle-copy">
                                            <label for="trackerEstimateLimit">{{ $t('Settings.tracker_estimate_limit') }}</label>
                                            <p>{{ $t('Settings.tracker_estimate_limit_hint') }}</p>
                                        </div>
                                        <!-- Toggle sizes itself inline from `width` (track = width,
                                             height = width/2), overriding its stylesheet. 20 gave a
                                             20x10 pill with an 8px knob, which reads as a dot rather
                                             than a switch. 40 is a normal switch at this scale. -->
                                        <Toggle
                                            id="trackerEstimateLimit"
                                            :width="40"
                                            class="company__setting-switch"
                                            :class="{ 'is-disabled': !props.editPermission }"
                                            :modelValue="formData.trackerEstimateLimit"
                                            :disabled="!props.editPermission"
                                            @update:modelValue="(v) => formData.trackerEstimateLimit = v"
                                        />
                                    </div>
                                </div>
                            </div>

                            <button v-if="props.editPermission" :disabled="isSpinner" ref="refButton"
                                @click.prevent="SaveChangeToDb()" class="blue_btn" id="blue-btn-savecompany">{{ $t('Settings.save_changes') }}</button>
                        </form>

                        <Sidebar :title="sidebarTitle" v-model:visible="visible" :enable-search="true"
                            :options="dataArray" :listenKeys="true" @selected="getSubSidebarData" width="337px"/>
                    </div>
                </div>
            </div>
        </div>
        <CroppingTool :image="{ url: formData.companyprofileImage, name: fileName }" :isVisible="isCropper"
            title="Company Profile"
            :stencilSize='stencilSize'
            :stencilProps="stencilProps"
            @updateVisible="(val) => isCropper = val"
            @getEditedImage="(val) => { formData.companyprofileImage = val.url, fileName = val.fileName, base64Image = val.base64Image }" 
        />
    </div>
</template>

<script setup>
import PhoneCountry from "@/components/molecules/CountryPhoneNumberDropdown/PhoneCountry.vue"
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import InputText from "@/components/atom/InputText/InputText.vue";
import Toggle from "@/components/atom/Toggle/Toggle.vue";
import { computed, defineComponent, inject, onMounted, ref, watchEffect,defineProps, nextTick, watch } from "vue";
import { useStore } from "vuex";
import DropDown from "@/components/molecules/DropDown/DropDown.vue";
import DropDownOption from "@/components/molecules/DropDownOption/DropDownOption.vue";
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import { useValidation } from "@/composable/Validation.js";
import { apiRequest, apiRequestWithoutCompnay } from '../../../services';
import { setFocus } from './helper.js'
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import * as env from '@/config/env';
import {storageQueryBuilder,generateFileName} from '@/utils/storageQueryBuild.js';
import CroppingTool from "@/components/atom/CroppingTool/CroppingTool.vue";
import { useI18n } from "vue-i18n";
import phone from "phone";
const { t } = useI18n();
const customerUpdate = inject("customerUpdate");

//// import Commons Function///
const { setfocus, formData, visible, sidebarTitle, dataArray, $toast,
    getSubSidebarData, isImgeChange, locationObj } = setFocus()
defineComponent({
    name: 'Company-Details',
    components: {
        Sidebar,
        PhoneCountry,
        DropDown,
        DropDownOption,
        InputText,
        SpinnerComp
    }
})
const props = defineProps({
    editPermission: {
        type: [Boolean],
        default: false
    }
})
const companyId = inject("$companyId");
const { checkErrors, checkAllFields } = useValidation();
const { getters,commit } = useStore();
const dateArray = ref(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY/MM/DD', 'DD-MM-YYYY', 'MM-DD-YYYY',
    'YYYY-MM-DD', 'DD MMM[,] YYYY', 'MMMM Do[,] YYYY', 'MMMM DD[,] YYYY',
    'DD MMMM[,] YYYY', 'Do MMMM[,] YYYY']);

const countryCodeObj = ref({});
const refButton = ref("");
const formatdate = ref("")
const fileName = ref("")
const isSpinner = ref(false);
const oldFileValue = ref();
const selectedCompany = ref("");
const isTempPreview = ref(false);
const isCropper = ref(false);
const base64Image = ref();
const phoneError = ref("");

const stencilSize = {
    width: 180,
    height: 180
}

const stencilProps = {
    handlers: {},
    movable: false,
    resizable: false,
    aspectRatio: 1
}

const companies = computed(() => {
    return getters["settings/companies"];
})
const companyDate=computed(()=>{
    return getters['settings/companyDateFormat']
})
watchEffect(() => {

    selectedCompany.value = companies.value.find((company) => company._id === companyId.value) 
})
watch(() => getters['settings/companyDateFormat'], (newVal) => {
    formData.value.format_date = newVal?.dateFormat;
})
//// Only Number Input Function///
const isNumber = (evt) => {
    const char = String.fromCharCode(evt.keyCode)
    if (!/[0-9]/.test(char)) {
        evt.preventDefault()
    }
}

const currentSidebarValue = ref([]);
function setCurrentSidebarValue(type) {
    const key = type
    currentSidebarValue.value = [JSON.parse(JSON.stringify(formData.value[key]))]
}


const openCropperTool = () => {
    setTimeout(() => {
        isCropper.value = true;
        document.getElementById('cropping-input').click()
    })
}

const onSelect = (val) => {
    countryCodeObj.value = val
}
onMounted(() => {
    formData.value.companyprofileImage = selectedCompany.value?.Cst_profileImage == undefined ? '' : selectedCompany.value?.Cst_profileImage;
    formData.value.companyName.value = selectedCompany.value?.Cst_CompanyName;
    formData.value.phoneNumber.value = selectedCompany.value?.Cst_Phone;
    formData.value.country.value = selectedCompany.value?.Cst_Country;
    formData.value.state.value = selectedCompany.value?.Cst_State;
    formData.value.Cst_DialCode = selectedCompany.value?.Cst_DialCode;
    formData.value.city.value = selectedCompany.value?.Cst_City;
    formData.value.day.value = selectedCompany.value?.Cst_LogTimeDays;
    // Absent means a company that predates the setting, which has the cap today — so it
    // reads as ON. Only an explicit false turns it off.
    formData.value.trackerEstimateLimit = selectedCompany.value?.trackerEstimateLimit !== false;
    formData.value.format_date = companyDate.value.dateFormat;
    oldFileValue.value = selectedCompany.value?.Cst_profileImage;
    formData.value.Cst_countryCode.value = selectedCompany.value?.Cst_countryCode || 'IN';
    formData.value.Cst_stateCode.value = selectedCompany.value?.Cst_stateCode || 'GJ';

    if(selectedCompany.value.Cst_State == '') {
        locationObj.value['state'].isStateVal = true;
    }
    if(selectedCompany.value.Cst_City == '') {
        locationObj.value['city'].isCityVal = true;
    }
    countryCodeObj.value = selectedCompany.value?.Cst_DialCode
}
);

///UPDATE DATA IN DATABASE///
const SaveChangeToDb = async () => {
    checkAllFields(formData.value).then(async (valid) => {
        if (valid && phoneError.value === '') {
            if (formData.value.companyprofileImage == selectedCompany.value?.Cst_profileImage && formData.value.companyName.value == selectedCompany.value?.Cst_CompanyName
                && formData.value.phoneNumber.value == selectedCompany.value?.Cst_Phone && countryCodeObj.value.name == selectedCompany.value?.Cst_DialCode.name
                && formData.value.country.value == selectedCompany.value?.Cst_Country && formData.value.state.value == selectedCompany.value?.Cst_State
                && formData.value.city.value == selectedCompany.value?.Cst_City && formData.value.format_date == companyDate.value.dateFormat
                // Compared the same way it is read — absent counts as ON — or flipping only
                // this switch would be judged "nothing to update" and silently not save.
                && formData.value.trackerEstimateLimit === (selectedCompany.value?.trackerEstimateLimit !== false)) {
                return $toast.error(t('Toast.Nothing_to_update'), { position: 'top-right' });
            }
            isSpinner.value = true;

            if (fileName.value || isImgeChange.value && (!oldFileValue.value || oldFileValue.value !== formData.value.companyprofileImage)) {
                let name = generateFileName(fileName.value,env.STORAGE_TYPE);
                const filePath = `companyIcon/${name}`;
                // <!-- Start Remove Section Storage -->
                if(env.STORAGE_TYPE && env.STORAGE_TYPE === 'server' && oldFileValue.value) {
                    let axiosConfig = {
                        method : 'delete',
                        url : env.REMOVE_FILE + '/' + companyId.value + '?filepath=' + oldFileValue.value + "&thubmkey=companyIcon",
                    }
                    await apiRequestWithoutCompnay(axiosConfig.method, axiosConfig.url, axiosConfig.data).catch((e)=>{
                        console.error(e)
                    })
                }
                // <!-- End Remove Section Storage -->

                const apiFormData = {
                    "path": filePath,
                    "companyId": companyId.value,
                    "key": "companyIcon",
                    "base64String": formData.value.companyprofileImage,
                };
                await apiRequestWithoutCompnay("post", storageQueryBuilder('upload_64').route, apiFormData).then((res) => {
                    if (res.data.status) {
                        if(env.STORAGE_TYPE && env.STORAGE_TYPE==='server') {
                            formData.value.companyprofileImage = res.data.statusText;
                            oldFileValue.value = res.data.statusText;
                        } else {
                            formData.value.companyprofileImage = res.data.statusText[0];
                            oldFileValue.value = res.data.statusText[0];
                        }
                        isTempPreview.value = false;
                    } else {
                        formData.value.companyprofileImage = "";
                    }
                })
            }

            let object = {
                Cst_profileImage: formData.value.companyprofileImage,
                Cst_CompanyName: formData.value.companyName.value,
                Cst_Phone: formData.value.phoneNumber.value,
                Cst_Country: formData.value.country.value,
                Cst_DialCode: countryCodeObj.value,
                Cst_State: formData.value.state.value,
                Cst_City: formData.value.city.value,
                Cst_LogTimeDays: formData.value.day.value,
                trackerEstimateLimit: formData.value.trackerEstimateLimit !== false,
                Cst_countryCode: formData.value.Cst_countryCode.value,
                Cst_stateCode: formData.value.Cst_stateCode.value,
                updatedAt: new Date()
            };

            apiRequest("put",`${env.COMPANYACTIONS}`,{updateObject:object})
                .then(async(res) => {
                let obj = {
                    dateFormat: formData.value.format_date
                }

                const queryUpdate = {
                    key: '$set',
                    updateObject:{settings: [obj]}
                };

                const result =  await apiRequest("put",env.COMMON_DATE_FORMATE,queryUpdate);
                if(result.status === 200){
                    const data = res.data;
                    if(data){
                        commit('settings/mutateCompanies',{ data: {...data, _id: data._id}, op: "modified"});
                    }
                    nextTick(() => {
                        commit("settings/mutateCompanyDateFormat", {data: [obj],op: "added"});
                    })
                    try {
                        customerUpdate("companyName");
                    } catch (error) {
                        console.log("Silence Is Golden");
                    }
                    $toast.success(t("Toast.Company_details_saved_successfully"), { position: 'top-right' });
                }else{
                    $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });    
                }
                isSpinner.value = false;
            })
            .catch((error) => {
                isSpinner.value = false;
                $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
                console.error("ERROR in delete sprint: ", error);
            })
        }
    })
}

function phoneValidation (number) {
    if(number === ""){
        return;
    }
    let code = countryCodeObj.value.isoCode;
    const result = phone(number, { country: code, validateMobilePrefix: false });

    if (result.isValid) {
        phoneError.value = '';
    } else {
        phoneError.value = "Please enter valid number";
    }

    return result.isValid;
}

</script>
<style scoped>
@import './style.css';

.invalid-feedback{
    top: unset !important;
}

.setting__wasabi-image {
    width: 120px !important;
    height: 120px !important;
    border-radius: 50%;
    border: 2px solid #102a83;
}
</style>