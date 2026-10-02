<template>
    <div :class="props.isProjectDetail ? 'formkit__content-wrapper-project-detail' : 'formkit__content-wrapper'" v-if="renderMask">
        <FormKit
            v-if="maskValue"
            :mask="maskValue"
            :type="'mask'"
            :id="Id"
            v-model="inputValue"
            :label="props.detail?.fieldTitle"
            @blur="handleBlur"
            autocomplete="off"
            :plugins="[inputUpdateValue]"
        >
            <template #label>
                <div class="formkit-label__wrapper">
                    <label class="formkit-label">
                        <img class="custom__field-image" :src="getImageData(props.detail.fieldImageGrey)">
                        <ToolTip :label="props?.detail?.fieldTitle" :text="props?.detail?.fieldDescription" :showReadMore="true" width="150px" />
                    </label>
                    <span>
                        <img @click="handleEdit" :src="editIconImage" class="formkit-label__image pr-22px cursor-pointer" />
                    </span>
                </div>
            </template>
            <template #prefix>
                <DropDown themed mode="listbox" v-if="checkCountrySelect && checkCountrySelect.length" @isVisible="search='',allCountriesArray = allCountries" :id="'security'+makeUniqueId(6)">
                    <template #button>
                        <div class="d-flex align-items-center align-items-center justify-content-between phone_pipeline">
                            <span class="ah-sr-only">{{$t('CustomField.country_code')}}</span>
                            <div class="d-flex align-items-center mr-12px">
                                <div v-if="country" :class="`vti__flag ${flag?.toLowerCase()}`" ></div>
                                <span v-if="clientWidth > 480" class="font-size-14 font-weight-400 pl-3px">{{code}}</span>
                            </div>
                            <div class="w-9">
                                <img class="rotate-z-90" :src="dropDownArrow" alt="">
                            </div>
                        </div>
                    </template>
                    <template #search>
                        <input type="text" class="customfield__form-control" :placeHolder="$t('PlaceHolder.search')" v-model="search" @input="handleInput">
                    </template>
                    <template #options>
                        <div v-if="allCountriesArray && allCountriesArray.length">
                            <DropDownOption v-for="(Country,index) in allCountriesArray" :key="index" :selected="Country.code.toLowerCase() === flag?.toLowerCase()" @click="handleUpdate(Country)">
                                <div class="d-flex align-items-center">
                                    <div :class="`vti__flag ${Country.code.toLowerCase()}`" ></div>
                                    <span class="ownEveryone">{{Country.en}}</span>
                                </div>
                            </DropDownOption>
                        </div>
                        <div class="text-center p-3px" v-else>
                            {{$t('CustomField.no_country_found')}}
                        </div>
                    </template>
                </DropDown>
                <DropDown themed mode="listbox" @isVisible="search='',allCountriesArray = allCountries" v-else-if="!(checkCountrySelect && checkCountrySelect.length) && props?.detail?.fieldCode && countryCode && props?.detail?.fieldCode !== countryCode" :id="'security'+makeUniqueId(6)">
                    <template #button>
                        <div class="d-flex align-items-center align-items-center justify-content-between phone_pipeline">
                            <span class="ah-sr-only">{{$t('CustomField.country_code')}}</span>
                            <div class="d-flex align-items-center mr-12px">
                                <div v-if="country" :class="`vti__flag ${flag?.toLowerCase()}`" ></div>
                                <span class="font-size-14 font-weight-400">{{code}}</span>
                            </div>
                            <div class="w-9">
                                <img class="rotate-z-90" :src="dropDownArrow" alt="">
                            </div>
                        </div>
                    </template>
                    <template #search>
                        <input type="text" class="customfield__form-control" :placeHolder="$t('PlaceHolder.search')" v-model="search" @input="handleInput">
                    </template>
                    <template #options>
                        <div v-if="allCountriesArray && allCountriesArray.length && (allCountriesArray).filter((x)=>x.code === props.detail.fieldFlag || x.code === country?.code).length">
                            <DropDownOption v-for="(Country,index) in (allCountriesArray).filter((x)=>x.code === props.detail.fieldFlag || x.code === country?.code)" :key="index" :selected="Country.code.toLowerCase() === flag?.toLowerCase()" @click="handleUpdate(Country)">
                                <div class="d-flex align-items-center">
                                    <div :class="`vti__flag ${Country.code.toLowerCase()}`" ></div>
                                    <span class="ownEveryone">{{Country.en}}</span>
                                </div>
                            </DropDownOption>
                        </div>
                        <div class="text-center p-3px" v-else>
                            {{$t('CustomField.no_country_found')}}
                        </div>
                    </template>
                </DropDown>
                <div v-else>
                    <div class="d-flex align-items-center align-items-center justify-content-between phone_pipeline">
                        <div class="d-flex align-items-center">
                            <div v-if="country" :class="`vti__flag ${flag?.toLowerCase()}`" ></div>
                            <span class="font-size-14 font-weight-400">{{code}}</span>
                        </div>
                    </div>
                </div>
            </template>
        </FormKit>
        <div v-else class="formkit-wrapper">
            <div class="formkit-label__wrapper">
                <label class="formkit-label" :for="Id">
                    <img class="custom__field-image" :src="getImageData(props.detail.fieldImageGrey)">
                    <ToolTip :label="props?.detail?.fieldTitle" :text="props?.detail?.fieldDescription" :showReadMore="true" width="150px" />
                </label>
                <span>
                    <img @click="handleEdit" :src="editIconImage" class="formkit-label__image pr-22px cursor-pointer" />
                </span>
            </div>
            <div class="formkit-inner">
                <input class="formkit-input" type="tel" inputmode="numeric" autocomplete="off" :id="Id" :value="inputValue" :placeholder="props.detail?.fieldPlaceholder" @input="handleDigits" @blur="handleBlur" />
            </div>
        </div>
    </div>
</template>
<script setup>
    import { FormKit } from '@/plugins/customFieldView/lazyFormKit';
    import { computed, inject, onMounted, ref, watch } from "vue";
    import { useStore } from "vuex";
    import { useCustomComposable } from "@/composable";
    import ToolTip from "@/components/molecules/ToolTip/ToolTip.vue";
    import DropDown from '@/components/molecules/DropDown/DropDown.vue';
    import allCountries from "@/components/molecules/PhoneComponent/allCountry.js";
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    import useCustomFieldImage from '@/composable/customFieldIcon.js';
    const { getImageData } = useCustomFieldImage();

    const {makeUniqueId} = useCustomComposable();
    const { getters } = useStore();

    // props
    const props = defineProps({
        detail:{
            type:Object,
            default:() => {}
        },
        isProjectDetail:{
            type: String,
            default: ''
        }
    });
    
    //EMIT
    const emit = defineEmits(['blurUpdate','inputUpdate','handleEdit','handleUpdate']);

    // ref
    const code = ref('');
    const prev = ref('');
    const flag = ref('');
    const search = ref('');
    const renderMask = ref(true);
    const Id = ref(makeUniqueId(5));
    const allCountriesArray = ref(allCountries);
    const maskValue = ref('');
    const inputValue = ref('');
    const checkCountrySelect = ref([]);
    const clientWidth = inject("$clientWidth");

    // Image
    const editIconImage = require("@/assets/images/editing.png");
    const dropDownArrow = require('@/assets/images/svg/triangleBlack.svg');

    /* A field saved through the API has no country of its own, so it takes the company's; with neither, the input is plain digits. */
    const companyCountry = computed(() => {
        const company = getters['settings/selectedCompany'] || {};
        return allCountries.find((entry) => entry.code === company.Cst_countryCode) || allCountries.find((entry) => entry.en === company.Cst_Country) || null;
    });
    const country = computed(() => (props.detail?.fieldCountryObject?.maskWithDialCode ? props.detail.fieldCountryObject : companyCountry.value));
    const countryCode = computed(() => props.detail?.fieldCountryCode || country.value?.dialCode || '');

    /* The save handlers of the task panel and the project page read the country off the field they are handed. */
    const fieldToSave = () => (props.detail?.fieldCountryObject ? props.detail : { ...props.detail, fieldCountryObject: country.value || {}, fieldCountryCode: countryCode.value });

    watch(()=> country.value?.maskWithDialCode,(val) =>{
        if(!props.detail?.fieldCode){
            renderMask.value = false;
            setTimeout(()=>{
                maskValue.value = val;
                code.value = props?.detail?.fieldCode ? props?.detail?.fieldCode : countryCode.value;
                flag.value = props.detail?.fieldFlag ? props?.detail?.fieldFlag?.toLowerCase() : country.value?.code?.toLowerCase() ;
                renderMask.value = true;
            });
        }
    });

    watch(()=> props?.detail?.fieldValue, (newValue) => {
        prev.value = newValue
    }, { deep: true });

    watch(()=> props.detail?.fieldPattern, (newValue) => {
        maskValue.value = newValue ? newValue : country.value?.maskWithDialCode;
    }, { deep: true });

    watch(()=> props?.detail?.fieldCountrySelect, (newValue) => {
        checkCountrySelect.value = newValue
    }, { deep: true });

    //onMounted
    onMounted(()=>{
        renderMask.value = false;
        setTimeout(()=>{
            maskValue.value = props.detail?.fieldPattern ? props.detail?.fieldPattern : country.value?.maskWithDialCode;
            inputValue.value = props?.detail?.fieldValue || '';
            code.value = props?.detail?.fieldCode ? props?.detail?.fieldCode : countryCode.value;
            flag.value = props.detail?.fieldFlag ? props?.detail?.fieldFlag?.toLowerCase() : country.value?.code?.toLowerCase() ;
            checkCountrySelect.value = props?.detail?.fieldCountrySelect && props?.detail?.fieldCountrySelect.length ? props?.detail?.fieldCountrySelect : [];
            renderMask.value = true;
        });
    });

    // function
    const handleEdit = () => {
        emit('handleEdit',props?.detail)
    };

    const handleUpdate = (val) => {
        emit('handleUpdate',val,fieldToSave(),Id.value);
        renderMask.value = false;
        setTimeout(()=>{
            maskValue.value = val.maskWithDialCode;
            inputValue.value = "";
            prev.value = "";
            code.value = val.dialCode;
            flag.value = val.code;
            search.value = "";
            renderMask.value = true;
        });   
    };
    
    const handleBlur = () => {
        if(prev.value){
            emit('blurUpdate',prev.value,fieldToSave(),Id.value)
        }
    };

    const handleDigits = (event) => {
        const digits = event.target.value.replace(/\D/g, '');
        event.target.value = digits;
        inputValue.value = digits;
        prev.value = digits;
        emit('inputUpdate',digits);
    };

    const inputUpdateValue = (node) => {
        node.hook.input((value,next)=>{
            emit('inputUpdate',next(value))
            return next(value);
        });
    };
    const handleInput = () => {
        allCountriesArray.value = allCountries;
        if(search.value){
            const filters = allCountriesArray.value.filter(x => x.en.toLowerCase().includes(search.value.toLowerCase()) || x.dialCode.includes(search.value));
            allCountriesArray.value = filters;
        }
    }
</script>