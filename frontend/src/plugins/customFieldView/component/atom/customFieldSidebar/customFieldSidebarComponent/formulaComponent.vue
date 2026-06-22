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
            :label="$t('Description.description')"
            :type="'textarea'"
            :placeholder="$t('PlaceHolder.Enter_Description')"
            :validations="'required:trim|length:10'"
            :bindValue="props.customFieldObject?.fieldDescription ? props.customFieldObject.fieldDescription : fieldDescription"
            :validationVisibility="'blur'"
            :className="'custom__field-required'"
            :name="'fieldDescription'"
        />
        <CustomFieldInputComponent
            :label="$t('CustomField.formula_expression')"
            :type="'textarea'"
            :placeholder="$t('CustomField.formula_expression_placeholder')"
            :bindValue="props.customFieldObject?.formulaExpression ? props.customFieldObject.formulaExpression : formulaExpression"
            :validationVisibility="'blur'"
            :name="'formulaExpression'"
            @inputUpdate="(val) => formulaExpression = val ? val : ''"
        />
        <div class="formkit__form-wrapper" v-if="referenceableFields.length">
            <label class="formkit-label">{{ $t('CustomField.referenceable_fields') }}</label>
            <p class="font-size-12 font-weight-400 gray81 m-0">
                <span v-for="(field, index) in referenceableFields" :key="field._id">
                    {{ '{' + field.fieldTitle + '}' }}<span v-if="index !== referenceableFields.length - 1">, </span>
                </span>
            </p>
        </div>
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
</template>

<script setup>
    import { ref, watch, computed } from "vue";
    import { useStore } from "vuex";
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
    const { getters } = useStore();
    const {makeUniqueId} = useCustomComposable();
    const dropDownArrow = require('@/assets/images/svg/triangleBlack.svg');

    watch(() => props.tabIndex, (val) =>{
        tabIndexCheck.value = val;
    });
    // ref
    const fieldLabel = ref('');
    const fieldDescription = ref('');
    const formulaExpression = ref(props?.customFieldObject?.formulaExpression ? props.customFieldObject.formulaExpression : '');
    const customFieldTypeUniqueId = ref(makeUniqueId(6));
    const type = ref(props?.customFieldObject?.type ? props?.customFieldObject?.type : 'task');
    const tabIndexCheck = ref(props.tabIndex);

    // List of existing numeric task custom fields that a formula may reference by {Title}.
    const referenceableFields = computed(() => {
        const list = getters['settings/finalCustomFields'] || [];
        return list.filter((f) =>
            f &&
            f.type === 'task' &&
            ['number', 'money', 'formula', 'rollup'].includes(f.fieldType) &&
            (!props.customFieldObject || f._id !== props.customFieldObject._id)
        );
    });

    // Redirect to the tab where the validation error message is displayed.
    const handleTabComp = (node) => {
        if(!(node._value.fieldDescription && node._value.fieldTitle)){
            tabIndexCheck.value = 1;
            emit('tabIndexUpdate',tabIndexCheck.value)
        }
    };
    // submit the form
    const handleSubmitComp = (object) => {
        object.fieldType = props.componentDetail.cfType;
        object.fieldImage = props.componentDetail.cfIcon;
        object.fieldImageGrey = props.componentDetail.cfIconGrey;
        object.formulaExpression = object.formulaExpression ? String(object.formulaExpression).trim() : '';
        object.fieldTitle = object.fieldTitle.trim();
        object.fieldDescription = object.fieldDescription.trim();
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
