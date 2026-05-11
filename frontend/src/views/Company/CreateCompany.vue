<template>
    <div v-if="mainSpinner" class="d-flex align-items-center justify-content-center lds-roller h-100dvh">
        <img :src="logo" alt="logo" class="position-ab z-index-1 company__logo">
        <div class="spinner"></div>
    </div>
    <Template v-else>
        <div class="ah-rightside" :class="[{'disableInputField':isSpinner}]">
            <div class="sinup-login-title-wrapper">
                <h3 class="font-weight-bold dark-gray text-capitalize">{{$t('Company.set_up_company')}}</h3>
                <p class="GunPowder">{{$t('Company.fill_company_details')}}</p>
            </div>
            <form action="#" @submit.prevent="handleSubmit">
                <div class="form-group">
                    <label class="font-roboto-sans gray">{{$t('general.company_individual')}}<span class="red">*</span></label>
                    <InputText
                        class="form-control login-input"
                        :placeHolder="$t('general.enter_company_individual')"
                        v-model.trim="formData.companyName.value"
                        :max-length="60"
                        tabindex="1"
                        height="56px"
                        width="100%"
                        @keyup="checkErrors({'field':formData.companyName,
                        'name':formData.companyName.name,
                        'validations':formData.companyName.rules,
                        'type':formData.companyName.type,
                        'event':$event.event})"
                        inputId="refCompanyName"
                    />
                    <div class="invalid-feedback red" >{{ formData.companyName.error }}</div>
                </div>
                <div class="form-group">
                    <label class="font-roboto-sans gray">{{$t('Settings.country')}}<span class="red">*</span></label>
                    <InputText
                        class="form-control login-input"
                        placeHolder="eg. India"
                        v-model="formData.country.value"
                        :max-length="50"
                        tabindex="3"
                        height="56px"
                        width="100%"
                        @click="setFocus('country')"
                        @focus="setFocus('country')"
                        :isReadonly="true"
                    />
                <div class="invalid-feedback red" >{{ formData.country.error }}</div>
                </div>
                <div class="row align-items-start d-flex">
                    <div class="col-md-6 pl-0">
                        <div class="form-group">
                            <label class="font-roboto-sans gray">{{$t('Settings.state')}}<span class="red">*</span></label>
                            <InputText
                                class="form-control login-input"
                                :placeHolder="locationObj['state'].isStateVal == false ? 'eg. Gujarat' : 'No States'"
                                :disabled="locationObj['state'].isStateVal"
                                v-model="formData.state.value"
                                :max-length="50"
                                tabindex="4"
                                height="56px"
                                width="100%"
                                @click="setFocus('state')"
                                @focus="setFocus('state')"
                                :isReadonly="true"
                                inputId="refState"
                            />
                            <div class="invalid-feedback red">{{ formData.state.error }}</div>
                        </div>
                    </div>
                    <div class="col-md-6 pr-0">
                        <div class="form-group">
                            <label class="font-roboto-sans gray">{{$t('Settings.city')}}<span class="red">*</span></label>
                            <InputText
                                class="form-control login-input"
                                :placeHolder="!(locationObj['state']?.isStateVal || locationObj['city']?.isCityVal) ? 'eg. Anand' : 'No Cities'"
                                v-model="formData.city.value"
                                :disabled="(locationObj['state']?.isStateVal || locationObj['city']?.isCityVal)"
                                :max-length="50"
                                tabindex="5"
                                height="56px"
                                width="100%"
                                inputId="refCity"
                                @keyup="checkErrors({'field':formData.city,
                                'name':formData.city.name,
                                'validations':formData.city.rules,
                                'type':formData.city.type,
                                'event':$event.event})"
                            />
                            <div class="invalid-feedback red" >{{ formData.city.error }}</div>
                        </div>
                    </div>
                </div>
                <div class="form-group country-code-main">
                    <label class="font-roboto-sans gray">{{$t('Auth.phoneNumber')}}<span class="red">*</span></label>
                    <div class="d-flex phone-country-wrapper">
                        <PhoneCountry  
                            @onSelect="onSelect,phoneValidation(String(formData.phoneNumber.value))" 
                            :preferredCountries="['IN', 'US']" 
                            :enabledCountryCode="true" 
                            :enabledFlags="true"
                            :phoneObj="phoneObj"
                        />
                        <InputText
                        class="form-control login-input border-radius-0 company-phno"
                        placeHolder="eg. 000-000-0000"
                        v-model.trim="formData.phoneNumber.value"
                        :max-length="13"
                        tabindex="1"
                        height="56px"
                        width="100%"
                        @keyup="checkErrors({'field':formData.phoneNumber,
                        'name':formData.phoneNumber.name,
                        'validations':formData.phoneNumber.rules,
                        'type':formData.phoneNumber.type,
                        'event':$event.event}),phoneValidation(String(formData.phoneNumber.value))"
                        @keypress="isNumber($event.event)"
                    />
                    </div>
                    <div class="invalid-feedback red" >{{ formData.phoneNumber.error }}</div>
                    <div v-if="!formData.phoneNumber.error" class="invalid-feedback red" >{{ phoneError }}</div>
                </div>
                <div class="form-group" v-if="env.AFFILITAION_ON == 'true'">
                    <label class="font-roboto-sans gray">{{$t('Affiliate.refferal_code_label')}}</label>
                    <InputText
                        class="form-control login-input"
                        :placeHolder="$t('Affiliate.refferal_code_placeholder')"
                        v-model.trim="formData.refferalCode.value"
                        :max-length="60"
                        tabindex="1"
                        height="56px"
                        width="100%"
                        @keyup="checkErrors({'field':formData.refferalCode,
                        'name':formData.refferalCode.name,
                        'validations':formData.refferalCode.rules,
                        'type':formData.refferalCode.type,
                        'event':$event.event});referalCodeInput();"
                        inputId="refrefferalCode"
                    />
                    <div class="invalid-feedback red" >{{ formData.refferalCode.error }}</div>
                </div>
                <div class="form-group mt-10px">
                    <button v-if="!isSpinner" ref="refButton" type="submit" class="btn btn-blue btn-login font-roboto-sans bg-blue white font-weight-500 cursor-pointer" tabindex="6">{{$t('Projects.create_compnay')}}</button>
                    <button v-else type="button" class="btn btn-blue btn-login btn-disabled font-roboto-sans bg-blue white font-weight-500 opacity-7" disabled><span id="btn-spinner"></span>{{$t('Auth.loading')}}...</button>
                </div>
                <div class="text-center cursor-pointer light-purple font-weight-500" @click="logOut()">{{$t('Auth.backlogin')}}</div>
            </form>
        </div>
        <Sidebar
            :title="sidebarTitle"
            v-model:visible="visible"
            :enable-search="true"
            :options="dataArray"
            @selected="getSubSidebarData"
            width="337px"
            top="0px"
            :listenKeys="true"
            :value="currentSidebarValue"
            :className="visible === true ? 'sidebar__scroll' : ''"
        />

        <Modal v-model="isCompanyProcess" :header="false" :footer="false" >
            <template #body>
                <div>
                    <div class="pr-2 pl-2 pt-5 pb-5 text-center">
                        {{stepCompanyProcessMessage}}
                        <div class="mt-3">
                            <div class="custom-loader">
                                <div class="loaderBar bg-blue"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </template>
        </Modal>
    </Template>
</template>

<script setup>
    import Template from "@/components/templates/Authentication/index.vue";
    import { useCustomComposable } from "@/composable";
    import InputText from "@/components/atom/InputText/InputText.vue";
    import { useValidation } from "@/composable/Validation.js";
    import Swal from 'sweetalert2';
    import { ref , defineComponent , onMounted , computed , inject, nextTick} from "vue";
    import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue"
    import { Country, State, City }  from 'country-state-city';
    import { useStore } from "vuex";
    import { useRouter, useRoute } from 'vue-router'
    import * as env from '@/config/env';
    import {useToast} from 'vue-toast-notification';
    import PhoneCountry from "@/components/molecules/CountryPhoneNumberDropdown/PhoneCountry.vue";
    import { useGetterFunctions } from "@/composable";
    import Modal from "@/components/atom/Modal/Modal.vue";
    import { apiRequestWithoutCompnay,useAuth } from "../../services";
    import { useI18n } from "vue-i18n";
    import Cookies from "js-cookie";
    import { tokenStore } from '@/services/tokenStore';
    import phone from "phone";
    const {makeUniqueId,debounce} = useCustomComposable();
    const { t } = useI18n();
    const router = useRouter();
    const route = useRoute();
    const { logOut } = useAuth();
    const  { checkErrors , checkAllFields } = useValidation();
    const {getters, commit} = useStore();
    const $toast = useToast();
    const {getUser} = useGetterFunctions();
    defineComponent({
        name: 'Create-Company',
        components: {
            Sidebar,
            PhoneCountry
        }
    })
    const userId = inject("$userId");
    const companyId = inject('$companyId');
    const formData = ref({
        companyName:{
            value: "",
            rules:
            "required | min:3",
            name: "company name",
            error: ""
        },
        phoneNumber:{
            value:"",
            rules:
            "required | regex:^[0-9]+$",
            name: "phone number",
            error:""
        },
        country:{
            value:"",
            rules:
            "required",
            name: "country",
            error:""
        },
        state:{
            value:"",
            rules:
            "required",
            name: "state",
            error:""
        },
        city:{
            value:"",
            rules:
            "required",
            name: "city",
            error:""
        },
        refferalCode:{
            value:"",
            rules:"",
            name: "refferalCode",
            error:""
        },
    });
    const isCompanyProcess = ref(false);
    const stepCompanyProcessMessage = ref("");
    const visible = ref(false);
    const contriesArray = ref([]);
    const dataArray = ref([]);
    const statesArray = ref([]);
    const sidebarTitle = ref("");
    const fieldType = ref("");
    const refButton = ref("");
    const countryCodeObj = ref({});
    const phoneObj = ref({});
    const isSpinner = ref(false);
    const mainSpinner = ref(true);
    const locationObj = ref({
        state:{isStateVal: false},
        city:{isCityVal: false}
    })
    const countryCode = ref("");
    const stateCode = ref("");
    const userEmail = ref('');
    const phoneError = ref('')

    function changeCompany(cid) {
        let userCompany = getUser(userId.value).assigneeCompany;
        let checkCompany = getters['settings/companies'].filter((user) => userCompany.includes(user._id)).find((x) => x._id === cid)?.isDisable || false;
        if(checkCompany === false){
            companyId.value = cid;
            if(userCompany.includes(cid)){
                commit("settings/mutateSelectedCompany", companyId.value);
    
                localStorage.setItem('selectedCompany', cid);
                if(cid){
                    let routeObj = {name: 'Projects', params: {cid: cid}};
                    if(route?.params?.cid) {
                        routeObj.params.cid = cid;
                    }
                    router.replace(routeObj)
                    .then(() => {
                        // window.location.reload();
                    })
                    .catch((error) => {
                        console.error("ERROR in change company: ", error);
                    })
                }
            }else{
                router.push({name : 'Create_Company'});
                localStorage.removeItem('selectedCompany');
            }
        }else{
            $toast.error(t("Toast.Company_is_disable"),{position: 'top-right'});
            let availableCompany = getters['settings/companies'].find((x) => !x.isDisable);
            if(availableCompany){
                router.push({name: 'Projects', params: {cid: cid}});
            }else{
                router.push({name : 'Create_Company'});
            }
        }
    }

    onMounted(() => {        
        mainSpinner.value = true;
        if (env.AFFILITAION_ON == 'true' && Cookies.get('refferCode')) {
            formData.value.refferalCode.value = Cookies.get('refferCode');
        }
        (async() => {
            try {
                const localUserId = localStorage.getItem("userId");
                const token = tokenStore.getAccessToken();
                if(companyId.value && token){
                    router.push({name : 'dashboard'});
                    return;
                }
                if (localUserId) {
                    userId.value = localUserId
                }else{
                    router.push({ name: "Log-in" });
                    return;
                }
    
                await apiRequestWithoutCompnay('get',`${env.USER_UPATE}/${userId.value}`)
                .then((result) => {
                    if(result.status === 200) {
                        userEmail.value = result?.data?.Employee_Email;
                        return result?.data?.isProductOwner;
                    } 
                    else{
                        return false;
                    }
                })
                .catch((error) => {
                    console.error("ERROR: ", error);
                    return false;
                })

                // if(!(isProductOwner || (env?.CANYONLICENSETYPE === "Extended License" && env?.CANYON_IS_SINGLE_APP == 'false'))) {
                //     $toast.error(t("Toast.Only_product_owner_can_create_a_company"), {position: "top-right"})
                //     logOut();
                //     return;
                // }
                mainSpinner.value = false;
                
                nextTick(() => {
                    const companyRef = document.getElementById("refCompanyName");
                    companyRef?.focus();
                    contriesArray.value = Country.getAllCountries();
                    statesArray.value = State.getStatesOfCountry('IN');
                    if(getUser(userId.value).assigneeCompany?.length > 0 && companyId.value !== ''){
                        changeCompany(companyId.value);
                    }else{
                        changeCompany(companyId.value);
                    }
                })
            } catch (error) {
                mainSpinner.value = false;
            }
        })()
    });

    const companies = computed(() => {
        return getters["settings/companies"];
    })

    const currentSidebarValue = ref([]);
    function setCurrentSidebarValue(type) {
        const key = type
        currentSidebarValue.value = [JSON.parse(JSON.stringify(formData.value[key]))]
    }

    const setFocus = (type) =>{
        visible.value = true;
        if(type == 'country'){
            dataArray.value = contriesArray.value;
            sidebarTitle.value = (type == 'country') ? t('PlaceHolder.Select_Country') : "";
            fieldType.value = 'country';
        }
        if(type == 'state'){
            dataArray.value = statesArray.value;
            sidebarTitle.value = (type == 'state') ? t('PlaceHolder.Select_State') : "";
            fieldType.value = 'state';
        }
        dataArray.value.map((x)=>{
            x["label"] = x.name;
            x["value"] = x.name;
        })

        setCurrentSidebarValue(type);
    }

    const handleDisabled = async (key, val) => {
        const country = val.isoCode;
        const state = val.countryCode;
        const noStates = (await State.getStatesOfCountry(country)).length === 0;
        const noCities = (await City.getCitiesOfState(state, country)).length === 0;
        if (key === 'country') {
            locationObj.value['state'].isStateVal = noStates;
            formData.value.state.rules = noStates ? '' : 'required';
            formData.value.city.rules = noStates ? '' : 'required';
            formData.value.state.error = '';
            formData.value.city.error = '';
        } else if (key === 'state') {
            locationObj.value['city'].isCityVal = noCities;
            formData.value.city.rules = noCities ? '' : 'required';
            formData.value.city.error = '';
        }
    };

    const getSubSidebarData  = (val) => {
        if(fieldType.value === "country"){
            handleDisabled('country',val)
            formData.value.country.value = val.name;
            checkErrors({'field':formData.value.country,
            'name':formData.value.country.name,
            'validations':formData.value.country.rules,
            'type':formData.value.country.type})
            formData.value.state.value = "";
            countryCodeObj.value = {
                "name": val.name,
                "isoCode": val.isoCode,
                "dialCode": val.phonecode
            }
            phoneObj.value = {
                name : val.name,
                isoCode: val.isoCode,
                dialCode: val.phonecode
            }
            phoneValidation(String(formData.value.phoneNumber.value))
            statesArray.value = State.getStatesOfCountry(val.isoCode);
            countryCode.value = val.isoCode;
            if(statesArray.value.length > 0) {
                setTimeout(() => { 
                    const ele = document.getElementById("refState");
                    ele.focus();
                }, 1000);
            } else {
                setTimeout(() => { refButton.value.focus() }, 1000);
            }
        }
        if(fieldType.value === "state"){
            handleDisabled('state',val)
            formData.value.state.value = val.name;
            checkErrors({'field':formData.value.state,
            'name':formData.value.state.name,
            'validations':formData.value.state.rules,
            'type':formData.value.state.type})
            stateCode.value = val.isoCode;
            setTimeout(() => { 
                const refcity = document.getElementById("refCity");
                refcity.focus();
            }, 1000);
        }
        if(fieldType.value === "city") {
            formData.value.city.value = val.name;
            checkErrors({'field':formData.value.city,
            'name':formData.value.city.name,
            'validations':formData.value.city.rules,
            'type':formData.value.city.type})
            setTimeout(() => { refButton.value.focus() }, 1000);
        }
    }

    const isNumber = (evt) => {
        const char = String.fromCharCode(evt.keyCode)
        if (!/[0-9]/.test(char)) {
            evt.preventDefault()
        }
    }

    const handleSubmit = () => {
        checkAllFields(formData.value).then((valid)=>{
            if(valid && phoneError.value === ''){
                if(companies.value.filter((x) => x.Cst_CompanyName.toLowerCase().trim() === formData.value.companyName.value.toLowerCase().trim()).length) {
                    $toast.error(t("Toast.Company_name_must_be_unique"),{position: 'top-right'});
                    return ;
                }
                let isREfferValid = true;
                if (env.AFFILITAION_ON == 'true') {
                    const valid = isRefferalCodeValidate()
                    if (formData.value.refferalCode.error !== '' || !valid) {
                        isREfferValid = false;
                    }
                }
                if (!isREfferValid) {
                    Swal.fire({
                        title: t('Affiliate.invalid_refferal_model_title'),
                        text: t('Affiliate.invalid_refferal_model_text'),
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonColor: '#3085d6',
                        cancelButtonColor: '#d33',
                        confirmButtonText: t('Affiliate.invalid_refferal_model_confirm_text')
                    }).then((result)=>{
                        if (result.isConfirmed) {
                            createCompanyAPiFun();
                        }
                    }).catch((error)=>{
                        console.error(error,"It is error")
                    })
                } else {
                    createCompanyAPiFun();
                }
            }
        })
    }

    const createCompanyAPiFun = async() => {
        const evId = `ev_${makeUniqueId(12)}`;
        const source = new EventSource(`${env.API_URI}/company-create/events/${evId}`);

        source.onmessage = function(event) {
            // Parse the event data (the progress update)
            if (!isCompanyProcess.value) {
                isCompanyProcess.value = true;
            }
            const data = JSON.parse(event.data)?.data;

            if (data?.step === 1) {
                stepCompanyProcessMessage.value = t('Company.creating_company');
            } else if (data?.step === 2) {
                stepCompanyProcessMessage.value = t('Company.company_created');
            } else {
                source.close(); // Close the connection when the progress reaches 100%
                if (data?.error) {
                    stepCompanyProcessMessage.value = t('companyErrorMessage.Something_went_wrong_Please_contact_to_admin');
                    setTimeout(() => {
                        isCompanyProcess.value = false;
                    }, 1500)
                    return;
                }
                stepCompanyProcessMessage.value = t('Company.good_to_go');
                setTimeout(() => {
                    isCompanyProcess.value = false;
                    isSpinner.value = false;
                    router.push({name: 'Home',params:{cid: data?.companyId || ''}}).then(() => { 
                        window.location.reload();
                    })
                }, 1500);
            }
        };
        source.onerror = function(error) {
            console.error('EventSource failed1:', error);
            setTimeout(() => {
                isCompanyProcess.value = false;
            }, 2000);
            source.close(); // Close the connection in case of error
        };
        let subscriptionData = {
            storage : 0,
            trackers: 0,
            users :5
            }
        let totalData = {
            storage: 0,
            trackers: 0,
            users:1
        }
        const companyData = {
            userId : userId.value,
            email: userEmail.value || "",
            companyName : formData.value.companyName.value,
            phoneNumber : formData.value.phoneNumber.value,
            country : formData.value.country.value,
            refferalCode: formData.value.refferalCode.value,
            city : formData.value.city.value,
            state : formData.value.state.value,
            countryCodeObj : countryCodeObj.value,
            logtimeDays : 8,
            totalProjects : 0,
            isInactive : false,
            isFree : true ,
            subscriptionData : subscriptionData,
            totalData : totalData,
            eventId : evId,
            Cst_countryCode: countryCode.value,
            Cst_stateCode: stateCode.value
        }
        try {
            isSpinner.value = true;
            apiRequestWithoutCompnay("post", env.CREATE_COMPANY, companyData).then(async(res)=>{
                if(res.data.status === true){
                    // if (res.data?.paymentObj?.data?.subscription?.id) {
                    //     commit("settings/mutateCompanies", {
                    //         data: {...res.data?.companyData?.data, SubcriptionId: res.data?.paymentObj?.data?.subscription?.id},
                    //         op: "added",
                    //     })
                    // }
                    localStorage.setItem('selectedCompany', res.data.companyId);
                    Cookies.remove('refferCode');
                }else{
                    source.close(); // Close the connection when the progress reaches 100%
                    if(res.data?.freeCompanyLimitReached === true) {
                        stepCompanyProcessMessage.value = t('Toast.free_company_limit_reached');
                    } else {
                        stepCompanyProcessMessage.value = t('companyErrorMessage.Something_went_wrong_Please_contact_to_admin');
                    }
                    setTimeout(() => {
                        isCompanyProcess.value = false;
                    }, 1500)
                    if(res.data?.freeCompanyLimitReached === true) {
                        $toast.warning(t('Toast.free_company_limit_reached'),{position: 'top-right'})
                    } else {
                        $toast.error(t('Toast.something_went_wrong'),{position: 'top-right'})
                    }
                    isSpinner.value = false;
                }
                localStorage.removeItem('isLogging');
            }).catch((err)=>{
                source.close(); // Close the connection when the progress reaches 100%
                stepCompanyProcessMessage.value = t('companyErrorMessage.Something_went_wrong_Please_contact_to_admin');
                setTimeout(() => {
                    isCompanyProcess.value = false;
                }, 1500)
                isSpinner.value = false;
                console.error("ERROR IN CREATE COMPANY",err)
            })
        } catch (error) {
            source.close(); // Close the connection when the progress reaches 100%
            stepCompanyProcessMessage.value = t('companyErrorMessage.Something_went_wrong_Please_contact_to_admin');
            setTimeout(() => {
                isCompanyProcess.value = false;
            }, 1500)
            isSpinner.value = false;
            $toast.error(error,{position: 'top-right'})    
        }
    }

    const onSelect = ({name, isoCode, dialCode}) => {
        countryCodeObj.value = {
            "name": name,
            "dialCode": dialCode,
            "isoCode": isoCode
        }
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

    const isRefferalCodeValidate = () => {
        if(formData.value.refferalCode.value === "") {
            formData.value.refferalCode.error = '';
            return true;
        }
       return apiRequestWithoutCompnay("post", env.VALIDATECOMPANYREFFERCODE, {refferalCode: formData.value.refferalCode.value,userId: userId.value}).then(()=>{
            formData.value.refferalCode.error = '';
            return true;
        }).catch((error)=>{
            console.error(error);
            formData.value.refferalCode.error = t('Affiliate.refferal_code_error');
            return false;
        })
    }

    const referalCodeInput = debounce(async () => {
        if (env.AFFILITAION_ON == 'true') {
            if(formData.value.refferalCode.value === "") {
                formData.value.refferalCode.error = '';
                return;
            }
            await isRefferalCodeValidate();
        }
    }, 500)
</script>
<style src="../Authentication/Login/style.css">

</style>