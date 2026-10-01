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
        <DropDown mode="listbox" :zIndex="10" v-if="isType">
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
</template>

<script setup>
    // import
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

    // watch
    watch(() => props.tabIndex, (val) =>{
        tabIndexCheck.value = val;
    });

    // ref
    //FIRST Tab
    const fieldLabel = ref('');
    const fieldPlaceholder = ref('');
    const fieldDescription = ref('');
    const tabIndexCheck = ref(props.tabIndex);
    const customFieldTypeUniqueId = ref(makeUniqueId(6));
    const type = ref(props?.customFieldObject?.type ? props?.customFieldObject?.type : 'task');

    //function
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
    // submit the form
    const handleSubmitComp = (object) => {
        object.fieldType = props.componentDetail.cfType;
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
    const handleType = (val) => {
        type.value = val;
    };

    defineExpose({handleTabComp,handleSubmitComp});
</script>
