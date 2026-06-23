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
        <!-- Rollup function -->
        <div class="formkit__form-wrapper">
            <label class="formkit-label">{{ $t('CustomField.rollup_function') }}</label>
        </div>
        <DropDown :zIndex="10" :id="rollupFunctionUniqueId" :keepSameWidth="true">
            <template #button>
                <div class="formkit__form-wrapper" :ref="rollupFunctionUniqueId">
                    <div class="d-flex border-gray border-radius-5-px align-items-center p-4px justify-content-between">
                        <div class="d-flex align-items-center">
                            <span class="ml-8px font-size-13 font-weight-400 gray81 d-block text-capitalize">{{ rollupFunction }}</span>
                        </div>
                        <div class="mr-8px">
                            <img class="rotate-z-90" :src="dropDownArrow" alt="triangleBlack">
                        </div>
                    </div>
                </div>
            </template>
            <template #options>
                <DropDownOption v-for="(fn, index) in rollupFunctions" :key="index" @click="$refs[rollupFunctionUniqueId].click(),handleFunction(fn)">
                    <span class="text-capitalize">{{ fn }}</span>
                </DropDownOption>
            </template>
        </DropDown>
        <!-- Rollup source field (not needed for the count function) -->
        <div v-show="rollupFunction !== 'count'">
            <div class="formkit__form-wrapper">
                <label class="formkit-label">{{ $t('CustomField.rollup_source_field') }}</label>
            </div>
            <DropDown :zIndex="10" :id="rollupSourceUniqueId" :keepSameWidth="true">
                <template #button>
                    <div class="formkit__form-wrapper" :ref="rollupSourceUniqueId">
                        <div class="d-flex border-gray border-radius-5-px align-items-center p-4px justify-content-between">
                            <div class="d-flex align-items-center">
                                <span class="ml-8px font-size-13 font-weight-400 gray81 d-block">{{ rollupSourceLabel }}</span>
                            </div>
                            <div class="mr-8px">
                                <img class="rotate-z-90" :src="dropDownArrow" alt="triangleBlack">
                            </div>
                        </div>
                    </div>
                </template>
                <template #options>
                    <div v-if="sourceFields.length">
                        <DropDownOption v-for="field in sourceFields" :key="field._id" @click="$refs[rollupSourceUniqueId].click(),handleSource(field)">
                            <span>{{ field.fieldTitle }}</span>
                        </DropDownOption>
                    </div>
                    <div class="text-center p-3px" v-else>
                        {{ $t('CustomField.no_numeric_field_found') }}
                    </div>
                </template>
            </DropDown>
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
    import { useI18n } from "vue-i18n";
    import { useCustomComposable } from '@/composable';
    import DropDown from '@/components/molecules/DropDown/DropDown.vue';
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    import CustomFieldInputComponent from "../../customFieldSidebar/customFieldSidebarComponent/customFieldInputComponent/customFieldInputComponent.vue";
    import { ROLLUP_FUNCTIONS } from '@/plugins/customFieldView/formulaEngine.js';

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
    const { t } = useI18n();
    const {makeUniqueId} = useCustomComposable();
    const dropDownArrow = require('@/assets/images/svg/triangleBlack.svg');

    watch(() => props.tabIndex, (val) =>{
        tabIndexCheck.value = val;
    });
    // ref
    const fieldLabel = ref('');
    const fieldDescription = ref('');
    const rollupFunctions = ref(ROLLUP_FUNCTIONS);
    const rollupFunction = ref(props?.customFieldObject?.rollupFunction ? props.customFieldObject.rollupFunction : 'sum');
    const rollupSourceFieldId = ref(props?.customFieldObject?.rollupSourceFieldId ? props.customFieldObject.rollupSourceFieldId : '');
    const customFieldTypeUniqueId = ref(makeUniqueId(6));
    const rollupFunctionUniqueId = `rollup-fn-${makeUniqueId(6)}`;
    const rollupSourceUniqueId = `rollup-src-${makeUniqueId(6)}`;
    const type = ref(props?.customFieldObject?.type ? props?.customFieldObject?.type : 'task');
    const tabIndexCheck = ref(props.tabIndex);

    // Numeric task custom fields available as the rollup source.
    const sourceFields = computed(() => {
        const list = getters['settings/finalCustomFields'] || [];
        return list.filter((f) =>
            f &&
            f.type === 'task' &&
            ['number', 'money', 'formula', 'rollup'].includes(f.fieldType) &&
            (!props.customFieldObject || f._id !== props.customFieldObject._id)
        );
    });

    const rollupSourceLabel = computed(() => {
        const match = sourceFields.value.find((f) => String(f._id) === String(rollupSourceFieldId.value));
        return match ? match.fieldTitle : t('CustomField.select_source_field');
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
        object.rollupFunction = rollupFunction.value;
        object.rollupSourceFieldId = rollupFunction.value === 'count' ? '' : (rollupSourceFieldId.value || '');
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
    const handleFunction = (val) => {
        rollupFunction.value = val;
    };
    const handleSource = (field) => {
        rollupSourceFieldId.value = field._id;
    };

    defineExpose({handleTabComp,handleSubmitComp});
</script>
