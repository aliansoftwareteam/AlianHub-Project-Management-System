<template>
    <div>
        <div v-show="tabIndexCheck === 1" data-field-tab="1">
            <CustomFieldInputComponent
                :label="$t('PlaceHolder.field_label')"
                :type="'text'"
                :placeholder="$t('PlaceHolder.Enter_Field_Label')"
                :validations="'required:trim'"
                :bindValue="props.customFieldObject?.fieldTitle ? props.customFieldObject.fieldTitle : fieldLabel"
                :validationVisibility="'blur'"
                :className="'custom__field-required'"
                :name="'fieldTitle'"
            />
            <CustomFieldInputComponent
                :label="$t('PlaceHolder.placeholder')"
                :type="'text'"
                :placeholder="$t('PlaceHolder.Enter_Placeholder')"
                :validations="'required:trim'"
                :bindValue="props.customFieldObject?.fieldPlaceholder ? props.customFieldObject.fieldPlaceholder : fieldPlaceholder"
                :validationVisibility="'blur'"
                :className="'custom__field-required'"
                :name="'fieldPlaceholder'"
            />
            <CustomFieldInputComponent
                :label="$t('Description.description')"
                :type="'textarea'"
                :placeholder="$t('PlaceHolder.Enter_Description')"
                :validations="'required:trim|length:10'"
                :bindValue="props.customFieldObject?.fieldDescription ? props.customFieldObject.fieldDescription : fieldDescription"
                :validationVisibility="'blur'"
                :className="'custom__field-required'"
                :name="'fieldDescription'"
            />
            <DropDown themed mode="listbox" :zIndex="10" v-if="isType">
                <template #button>
                    <div class="formkit__form-wrapper" :ref="customFieldTypeUniqueId">
                        <div class="custom__field-required">
                            <div class="formkit-wrapper">
                                <span class="formkit-label">{{$t('Billing.type')}}</span>
                                <div class="d-flex border-gray border-radius-5-px align-items-center justify-content-between">
                                    <div class="d-flex align-items-center">
                                        <span class="formkit-input text-capitalize">{{type?.toLowerCase()}}</span>
                                    </div>
                                    <div class="mr-8px">
                                        <img class="rotate-z-90" :src="dropDownArrow" alt="">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
                <template #options>
                    <DropDownOption :selected="type === 'project'" @click="$refs[customFieldTypeUniqueId].click(),handleType('project')">
                        {{$t('Projects.Project')}}
                    </DropDownOption>
                    <DropDownOption :selected="type === 'task'" @click="$refs[customFieldTypeUniqueId].click(),handleType('task')">
                        {{$t('subProjectRulesNames.Task')}}
                    </DropDownOption>
                </template>
            </DropDown>
        </div>
        <div v-show="tabIndexCheck === 2" data-field-tab="2">
            <div class="formkit__form-wrapper">
                <span class="formkit-help pb-15px d-block" v-if="props.customFieldObject?.fieldCountrySelect">
                    <strong class="black">{{$t('general.note')}} :</strong> {{$t('general.settings_change_no_effect')}}
                </span>
            </div>
            <CustomFieldInputComponent
                :type="'checkbox'"
                :options="entryLimits"
                :bindValue="props.customFieldObject?.fieldCountrySelect ? props.customFieldObject.fieldCountrySelect : entryLimits"
                :validationVisibility="'blur'"
                :name="'fieldCountrySelect'"
                :className="'customCheckbox helpCheckbox'"
                :help="$t('CustomField.countryCode')"
            />
            <div class="formkit__form-wrapper">
                <label class="formkit-label">{{$t('Company.select_default_country')}}</label>
            </div>
            <DropDown themed mode="listbox" @isVisible="search='',allCountriesArray = allCountries" :zIndex="10" :id="customFieldUniqueId" :keepSameWidth="true">
                <template #button>
                    <div class="formkit__form-wrapper" :ref="customFieldUniqueId">
                        <span class="ah-sr-only">{{$t('Company.select_default_country')}}</span>
                        <div class="d-flex border-gray border-radius-5-px align-items-center p-4px justify-content-between">
                            <div class="d-flex align-items-center">
                                <div :class="`vti__flag ${flag?.toLowerCase()}`" ></div>
                                <span class="ml-8px font-size-13 font-weight-400 gray81 d-block">{{code}}</span>
                            </div>
                            <div class="mr-8px">
                                <img class="rotate-z-90" :src="dropDownArrow" alt="">
                            </div>
                        </div>
                    </div>
                </template>
                <template #search>
                    <input type="text" class="customfield__form-control" :placeHolder="$t('PlaceHolder.search')" v-model="search" @input="handleInput">
                </template>
                <template #options>
                    <div v-if="allCountriesArray && allCountriesArray.length">
                        <DropDownOption v-for="(Country,index) in allCountriesArray" :key="index" :selected="Country.code === flag" @click="$refs[customFieldUniqueId].click(),handleUpdate(Country)">
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
        </div>
    </div>
</template>

<script setup>
    // import
    import { ref, watch } from "vue";
    import { useCustomComposable } from '@/composable';
    import DropDown from '@/components/molecules/DropDown/DropDown.vue';
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    import allCountries from "../../../../../../components/molecules/PhoneComponent/allCountry.js";
    import CustomFieldInputComponent from "../../customFieldSidebar/customFieldSidebarComponent/customFieldInputComponent/customFieldInputComponent.vue";
    const {makeUniqueId} = useCustomComposable();
    // props
    const props = defineProps({
            tabIndex:{
                type: Number,
                default:1
            },
            componentDetail:{
                type: Object,
                default:() => {}
            },
            customFieldObject:{
                type: Object,
                default:() => {}
            },
            isType:{
                type:Boolean,
                default:false
            }
        }
    );
    // emit
    const emit = defineEmits(['handleFunction','tabIndexUpdate']);

    // watch
    watch(() => props.tabIndex, (val) =>{
        tabIndexCheck.value = val;
    });

    // ref
    //FIRST Tab
    const search = ref('');
    const fieldLabel = ref('');
    const fieldPlaceholder = ref('');
    const fieldDescription = ref('');
    const customFieldUniqueId = `custom-field${makeUniqueId(6)}`
    const customFieldTypeUniqueId = ref(makeUniqueId(6));
    const type = ref(props?.customFieldObject?.type ? props?.customFieldObject?.type : 'task');
    //SECOND Tab
    const countryObject = ref(props?.customFieldObject?.fieldCountryObject ? props?.customFieldObject?.fieldCountryObject : {
        "ru": "Соединенные Штаты",
        "lt": "Jungtinės Valstijos",
        "tr": "Amerika Birleşik Devletleri",
        "en": "United States",
        "flag": "🇺🇸",
        "code": "US",
        "dialCode": "+1",
        "mask": "(999) 999-9999",
        "maskWithDialCode": "(###) ###-####"
    });
    const entryLimits = ref(['Country Code']);
    const tabIndexCheck = ref(props.tabIndex);
    const flag = ref(props?.customFieldObject?.fieldCountryObject?.code ? props?.customFieldObject?.fieldCountryObject?.code : 'US');
    const code = ref(props?.customFieldObject?.fieldCountryObject?.dialCode ? props?.customFieldObject?.fieldCountryObject?.dialCode : '+1');
    const allCountriesArray = ref(allCountries);
    // image
    const dropDownArrow = require('@/assets/images/svg/triangleBlack.svg');
    //function
    // Redirect to the tab where the validation error message is displayed.
    const handleTabComp = (node) => {
        if(!(node._value.fieldDescription && node._value.fieldTitle && node._value.fieldPlaceholder)){
            tabIndexCheck.value = 1;
            emit('tabIndexUpdate',tabIndexCheck.value)
        }
    };
    // submit the form
    const handleSubmitComp = (object) => {
        object.fieldValidation = '';
        object.fieldType = props.componentDetail.cfType;
        object.fieldImage = props.componentDetail.cfIcon;
        object.fieldImageGrey = props.componentDetail.cfIconGrey;
        object.fieldDescription = object.fieldDescription.trim();
        object.fieldPlaceholder = object.fieldPlaceholder.trim();
        object.fieldTitle = object.fieldTitle.trim();
        object.fieldCountryObject = countryObject.value;
        object.fieldCountryCode = code.value;
        if(props.isType === true){
            object.type = type.value;
        }
        emit('handleFunction',object,props.customFieldObject && Object.keys(props.customFieldObject).length ? true : false);
    };
    const handleUpdate = (val) => {
        countryObject.value = val;
        code.value = val.dialCode;
        flag.value = val.code;
    };
    const handleType = (val) => {
        type.value = val;
    };
    const handleInput = () => {
        allCountriesArray.value = allCountries;
        if(search.value){
            const filters = allCountriesArray.value.filter(x => x.en.toLowerCase().includes(search.value.toLowerCase()) || x.dialCode.includes(search.value));
            allCountriesArray.value = filters;
        }
    };
    defineExpose({handleTabComp,handleSubmitComp});
</script>
<style scoped>
    @import '@/components/molecules/CountryPhoneNumberDropdown/style.css';
</style>