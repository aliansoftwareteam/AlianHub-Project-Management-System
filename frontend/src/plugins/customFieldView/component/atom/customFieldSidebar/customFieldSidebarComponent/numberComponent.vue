<template>
    <div v-show="tabIndexCheck === 1" data-field-tab="1">
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
            :validations="''"
            :bindValue="props.customFieldObject?.fieldPlaceholder ? props.customFieldObject.fieldPlaceholder : fieldPlaceholder"
            :validationVisibility="'blur'"
            :name="'fieldPlaceholder'"
        />
        <CustomFieldInputComponent
            :label="$t('Description.description')"
            :type="'textarea'"
            :placeholder="$t('PlaceHolder.Enter_Description')"
            :validations="''"
            :bindValue="props.customFieldObject?.fieldDescription ? props.customFieldObject.fieldDescription : fieldDescription"
            :validationVisibility="'blur'"
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
        <CustomFieldInputComponent
            :type="'checkbox'"
            :options="entryLimits"
            :bindValue="props.customFieldObject?.fieldEntryLimits ? props.customFieldObject.fieldEntryLimits : entryLimitsToggle"
            :validationVisibility="'blur'"
            :name="'fieldEntryLimits'"
            :className="'customCheckbox helpCheckbox'"
            :help="$t('CustomField.limit_minimum_or_maximum_value')"
            @inputUpdate="handleInput"
        />
        <div v-show="entryLimitsToggle && entryLimitsToggle.length">
           <CustomFieldInputComponent
                :label="$t('CustomField.enter_minimum_limit')"
                :type="'text'"
                :placeholder="$t('PlaceHolder.Enter_Number')"
                :validations="fieldMinimum && fieldMaximum ? Number(fieldMinimum) > Number(fieldMaximum) ? 'is' : 'matches:/^[-]?[0-9]+([.]?[0-9]+)?$/' : 'matches:/^[-]?[0-9]+([.]?[0-9]+)?$/'"
                :bindValue="props.customFieldObject?.fieldMinimum ? props.customFieldObject?.fieldMinimum : fieldMinimum"
                :validationVisibility="'blur'"
                :name="'fieldMinimum'"
                @inputUpdate="(val) => fieldMinimum = val ? val : ''"
                :customValidationMessage="fieldMinimum && fieldMaximum ? Number(fieldMinimum) > Number(fieldMaximum) ? {is:$t('CustomField.minimum_value_should_not_be_greater_than_maximum_value')} : {is: $t('CustomField.minimum_limit_type_not_allowed_value'),matches: $t('CustomField.minimum_limit_type_not_allowed_value')} : {is: $t('CustomField.minimum_limit_type_not_allowed_value'),matches: $t('CustomField.minimum_limit_type_not_allowed_value')}"
            />
            <CustomFieldInputComponent
                :label="$t('CustomField.enter_maximum_limit')"
                :type="'text'"
                :placeholder="$t('PlaceHolder.Enter_Number')"
                :validations="fieldMinimum && fieldMaximum ? Number(fieldMinimum) > Number(fieldMaximum) ? 'is' : 'matches:/^[-]?[0-9]+([.]?[0-9]+)?$/' : 'matches:/^[-]?[0-9]+([.]?[0-9]+)?$/'"
                :bindValue="props.customFieldObject?.fieldMaximum ? props.customFieldObject.fieldMaximum : fieldMaximum"
                :validationVisibility="'blur'"
                :name="'fieldMaximum'"
                @inputUpdate="(val) => fieldMaximum = val ? val : ''"
                :customValidationMessage="fieldMinimum && fieldMaximum ? Number(fieldMinimum) > Number(fieldMaximum) ? {is:$t('CustomField.maximum_value_should_be_greater_than_minimum_value')} : {is: $t('CustomField.maximum_limit_type_not_allowed_value'),matches: $t('CustomField.maximum_limit_type_not_allowed_value')} : {is: $t('CustomField.maximum_limit_type_not_allowed_value'),matches: $t('CustomField.maximum_limit_type_not_allowed_value')}"
            />
        </div>
    </div>
</template>

<script setup>
    import { ref, watch } from "vue";
    import { useCustomComposable } from '@/composable';
    import DropDown from '@/components/molecules/DropDown/DropDown.vue';
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    import CustomFieldInputComponent from "../../customFieldSidebar/customFieldSidebarComponent/customFieldInputComponent/customFieldInputComponent.vue";
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
    const dropDownArrow = require('@/assets/images/svg/triangleBlack.svg');
    
    watch(() => props.tabIndex, (val) =>{
        tabIndexCheck.value = val;
    });
    // ref
    //FIRST Tab
    const fieldLabel = ref('');
    const fieldPlaceholder = ref('');
    const entryLimits = ref(['Entry Limits']);
    const entryLimitsToggle = ref([]);
    const fieldDescription = ref('');
    //SECOND Tab
    const fieldMaximum = ref();
    const fieldMinimum = ref();
    const customFieldTypeUniqueId = ref(makeUniqueId(6));
    const type = ref(props?.customFieldObject?.type ? props?.customFieldObject?.type : 'task');
    
    const tabIndexCheck = ref(props.tabIndex);

    const handleInput = (val) => {
        entryLimitsToggle.value = val;
        fieldMaximum.value = null;
        fieldMinimum.value = null;
    };
    // Redirect to the tab where the validation error message is displayed.
    const handleTabComp = (node) => {
        if(!node._value.fieldTitle){
            tabIndexCheck.value = 1;
            emit('tabIndexUpdate',tabIndexCheck.value)
        }else if(node._value.fieldMinimum || node._value.fieldMaximum){
            if((Number(node._value.fieldMinimum) > Number(node._value.fieldMaximum))){
                tabIndexCheck.value = 2;
                emit('tabIndexUpdate',tabIndexCheck.value)
            }
        }
    };
    // submit the form
    const handleSubmitComp = (object) => {
            if(!(object.fieldEntryLimits && object.fieldEntryLimits.length)){
                object.fieldMinimum = '';
                object.fieldMaximum = '';
            }
            object.fieldValidation = "";
            object.fieldValidation += object.fieldMinimum ? `min:${object.fieldMinimum}` : "";
            object.fieldValidation += object.fieldMaximum ? object.fieldMinimum ? `|max:${object.fieldMaximum}` : `max:${object.fieldMaximum}` : "";
            object.fieldMinimum = object.fieldMinimum ? String(object.fieldMinimum) : '';
            object.fieldMaximum = object.fieldMaximum ? String(object.fieldMaximum) : '';
            object.fieldType = props.componentDetail.cfType;
            object.fieldImage = props.componentDetail.cfIcon;
            object.fieldImageGrey = props.componentDetail.cfIconGrey;
            object.fieldPlaceholder = (object.fieldPlaceholder || '').trim();
            object.fieldTitle = object.fieldTitle.trim();
            object.fieldDescription = (object.fieldDescription || '').trim();
            if(props.isType === true){
                object.type = type.value;
            }
            emit('handleFunction',object,props.customFieldObject && Object.keys(props.customFieldObject).length ? true : false)
    };
    const handleType = (val) => {
        type.value = val;
    };

    defineExpose({handleTabComp,handleSubmitComp});
</script>
