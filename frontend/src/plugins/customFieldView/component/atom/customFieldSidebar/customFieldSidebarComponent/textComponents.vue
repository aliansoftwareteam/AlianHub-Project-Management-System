<template>
    <div v-show="tabIndexCheck === 1">
        <CustomFieldInputComponent
            :label="$t('PlaceHolder.field_label')"
            :type="'text'"
            :placeholder="$t('PlaceHolder.Enter_Field_Label')"
            :validations="'required:trim|length:0,25'"
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
        <DropDown :zIndex="10" v-if="isType">
            <template #button>
                <div class="formkit__form-wrapper" :ref="customFieldTypeUniqueId">
                    <div class="custom__field-required">
                        <div class="formkit-wrapper">
                            <label class="formkit-label" for="text">{{$t('Billing.type')}}</label>
                            <div class="d-flex border-gray border-radius-5-px align-items-center justify-content-between">
                                <div class="d-flex align-items-center">
                                    <span class="formkit-input text-capitalize">{{type?.toLowerCase()}}</span>
                                </div>
                                <div class="mr-8px">
                                    <img class="rotate-z-90" :src="dropDownArrow" alt="triangleBlack">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </template>
            <template #options>
                <DropDownOption @click="$refs[customFieldTypeUniqueId].click(),handleType('project')">
                    {{$t('Projects.Project')}}
                </DropDownOption>
                <DropDownOption @click="$refs[customFieldTypeUniqueId].click(),handleType('task')">
                    {{$t('subProjectRulesNames.Task')}}
                </DropDownOption>
            </template>
        </DropDown>
    </div>
    <div v-show="tabIndexCheck === 2">
        <CustomFieldInputComponent
            :type="'checkbox'"
            :options="entryLimits"
            :bindValue="props.customFieldObject?.fieldEntryLimits ? props.customFieldObject.fieldEntryLimits : entryLimitsToggle"
            :validationVisibility="'blur'"
            :name="'fieldEntryLimits'"
            :className="'customCheckbox helpCheckbox'"
            :help="$t('CustomField.limit_minimum_or_maximum_text_allowed')"
            @inputUpdate="handleInput"
        />
        <div v-show="entryLimitsToggle && entryLimitsToggle.length" class="position-re">
            <CustomFieldInputComponent
                :label="$t('CustomField.enter_minimum_limit_type')"
                :type="'number'"
                :placeholder="$t('PlaceHolder.Enter_Number')"
                :validations="fieldMinimum && fieldMaximum ? Number(fieldMinimum) > Number(fieldMaximum) ? $t('CustomField.min_should_be_less_than_max') : '' : ''"
                :bindValue="props.customFieldObject?.fieldMinimum ? props.customFieldObject?.fieldMinimum : fieldMinimum"
                :validationVisibility="'blur'"
                :name="'fieldMinimum'"
                @inputUpdate="(val) => fieldMinimum = val ? Number(val) : ''"
                :preventDefault="true"
            />
            <CustomFieldInputComponent
                :label="$t('CustomField.enter_maximum_limit_type')"
                :type="'number'"
                :placeholder="$t('PlaceHolder.Enter_Number')"
                :validations="fieldMinimum && fieldMaximum ? Number(fieldMinimum) > Number(fieldMaximum) ? $t('CustomField.max_should_be_greater_than_min') : '' : ''"
                :bindValue="props.customFieldObject?.fieldMaximum ? Number(props.customFieldObject.fieldMaximum) : fieldMaximum"
                :validationVisibility="'blur'"
                :name="'fieldMaximum'"
                @inputUpdate="(val) => fieldMaximum = val ? Number(val) : ''"
                :preventDefault="true"
            />
            <small class="red position-ab textCustomField__error_msg" v-if="fieldMinimum && fieldMaximum && Number(fieldMinimum) > Number(fieldMaximum)">{{$t('CustomField.maximum_value_should_be_greater_than_minimum_value')}}</small>
        </div>
    </div>
</template>

<script setup>
    // import
    import { ref, watch } from "vue";
    import { useCustomComposable } from '@/composable';
    import DropDown from '@/components/molecules/DropDown/DropDown.vue';
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    import CustomFieldInputComponent from "./customFieldInputComponent/customFieldInputComponent.vue";

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
    const {makeUniqueId} = useCustomComposable();

    // watch
    watch(() => props.tabIndex, (val) =>{
        tabIndexCheck.value = val;
    });
    const dropDownArrow = require('@/assets/images/svg/triangleBlack.svg');

    // ref
    //FIRST Tab
    const fieldLabel = ref('');
    const fieldPlaceholder = ref('');
    const fieldDescription = ref('');
    const entryLimits = ref(['Entry Limits']);
    const entryLimitsToggle = ref([]);
    const customFieldTypeUniqueId = ref(makeUniqueId(6));
    const type = ref(props?.customFieldObject?.type ? props?.customFieldObject?.type : 'task');
    //SECOND Tab
    const fieldMaximum = ref();
    const fieldMinimum = ref();
    const tabIndexCheck = ref(props.tabIndex);
    //function
    // toggle max and min field
    const handleInput = (val) => {
        entryLimitsToggle.value = val;
        fieldMaximum.value = null;
        fieldMinimum.value = null;
    };
    // Redirect to the tab where the validation error message is displayed.
    const handleTabComp = (node) => {
        if(!(node._value.fieldDescription && node._value.fieldTitle && node._value.fieldPlaceholder)){
            tabIndexCheck.value = 1;
            emit('tabIndexUpdate',tabIndexCheck.value)
        }else if(node._value.fieldMinimum || node._value.fieldMaximum){
            if((Number(node._value.fieldMinimum) > Number(node._value.fieldMaximum))){
                tabIndexCheck.value = 2;
                emit('tabIndexUpdate',tabIndexCheck.value)
            }
        }
    };
    const handleType = (val) => {
        type.value = val;
    };
    // submit the form
    const handleSubmitComp = (object) => {
        if(!(object.fieldEntryLimits && object.fieldEntryLimits.length)){
            object.fieldMinimum = '';
            object.fieldMaximum = '';
        }
        let length = object.fieldMinimum || object.fieldMaximum ? `length:${`${object.fieldMinimum ? object.fieldMinimum : 0}` + `${object.fieldMaximum ? `,${object.fieldMaximum}` : ''}`}` :''
        object.fieldValidation = length ? length : '';
        object.fieldType = props.componentDetail.cfType;
        object.fieldMinimum = object.fieldMinimum ? String(object.fieldMinimum) : '';
        object.fieldMaximum = object.fieldMaximum ? String(object.fieldMaximum) : '';
        object.fieldImage = props.componentDetail.cfIcon;
        object.fieldImageGrey = props.componentDetail.cfIconGrey;
        object.fieldDescription = object.fieldDescription.trim();
        object.fieldPlaceholder = object.fieldPlaceholder.trim();
        object.fieldTitle = object.fieldTitle.trim();
        if(props.isType === true){
            object.type = type.value;
        }
        emit('handleFunction',object,props.customFieldObject && Object.keys(props.customFieldObject).length ? true : false);
    };

    defineExpose({handleTabComp,handleSubmitComp});
</script>
<style scoped>
.textCustomField__error_msg {
    bottom: -25px !important;
    font-family: var(--font-ui);
    font-size: 12px;
    font-style: normal;
    font-weight: 400;
    line-height: 17.76px;
    margin-bottom: 0px !important;
}
@media(max-width:340px){
    .textCustomField__error_msg {
        bottom: -30px !important;
        line-height: 12.76px !important;
        font-size: 11px;
    }
}
</style>
