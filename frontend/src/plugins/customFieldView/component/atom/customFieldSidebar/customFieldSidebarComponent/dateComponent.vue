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
            :label="$t('CustomField.separator')"
            :type="'radio'"
            :validations="''"
            :options="fieldSeparator"
            :validationVisibility="'blur'"
            @inputUpdate="handleSeparator"
            :name="'fieldSeparator'"
            :bindValue="props.customFieldObject?.fieldSeparator ? props.customFieldObject.fieldSeparator : fieldSeparatorSelected"
            :className="'custom__field-radio custom__field-Separator'"

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
    <div v-show="tabIndexCheck === 2" data-field-tab="2">
        <CustomFieldInputComponent
            :label="$t('CustomField.date_format')"
            :type="'radio'"
            :validations="''"
            :options="fieldDateFormate"
            :validationVisibility="'blur'"
            :name="'fieldDateFormate'"
            :bindValue="fieldDateFormate.find((e) => e === props.customFieldObject?.fieldDateFormate) ? fieldDateFormate.find((e) => e === props.customFieldObject?.fieldDateFormate) : fieldDateFormate[0]"
            :className="'custom__field-radio custom__field-radio-help'"
            :help="$t('CustomField.select_date_format')"
        />
    </div>
    <div v-show="tabIndexCheck === 3" data-field-tab="3">
        <CustomFieldInputComponent
            :type="'checkbox'"
            :options="liteMode"
            :bindValue="props.customFieldObject?.fieldLiteMode ? props.customFieldObject.fieldLiteMode : liteMode"
            :validationVisibility="'blur'"
            :name="'fieldLiteMode'"
            :className="'customCheckbox helpCheckbox'"
            :help="$t('CustomField.allow_time_with_date')"
            @inputUpdate="handleInput"
        />
        <div v-if="liteModeToggle && liteModeToggle.length">
            <CustomFieldInputComponent
                :label="$t('CustomField.time_format')"
                :type="'radio'"
                :options="fieldTimeFormate"
                :bindValue="props.customFieldObject?.fieldTimeFormate ? props.customFieldObject.fieldTimeFormate : fieldTimeFormate[0]"
                :validationVisibility="'blur'"
                :name="'fieldTimeFormate'"
                :help="$t('CustomField.select_time_format')"
                :className="'custom__field-radio custom__field-radio-time-formate'"
            />
        </div>
    </div>
    <div v-show="tabIndexCheck === 4" data-field-tab="4">
        <CustomFieldInputComponent
            :label="$t('CustomField.past_and_future')"
            :type="'checkbox'"
            :options="pastFutureOptions"
            :bindValue="pastFutureValue"
            :validationVisibility="'blur'"
            :name="'fieldPastFuture'"
            :help="$t('CustomField.select_dates_past_future')"
            :className="'custom__field-checkbox'"
        />
        <CustomFieldInputComponent
            :label="$t('CustomField.days_of_week')"
            :type="'checkbox'"
            :options="fieldDaysDisable"
            :bindValue="props.customFieldObject?.fieldDaysDisable && props.customFieldObject?.fieldDaysDisable.length ? fieldDaysDisable.map((e)=> !(props.customFieldObject.fieldDaysDisable.includes(e.bindValue)) ? e.bindValue : null) : fieldDaysDisable.map((e)=>e.bindValue)"
            :validationVisibility="'blur'"
            :name="'fieldDaysDisable'"
            :help="$t('CustomField.unchecking_day_calendar')"
            :className="'custom__field-checkbox'"
        />
    </div>
</template>

<script setup>
    import { computed, ref, watch } from "vue";
    import { useCustomComposable } from '@/composable';
    import DropDown from '@/components/molecules/DropDown/DropDown.vue';
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    import CustomFieldInputComponent from "../../customFieldSidebar/customFieldSidebarComponent/customFieldInputComponent/customFieldInputComponent.vue";
    const {makeUniqueId} = useCustomComposable();
    import { useI18n } from "vue-i18n";
    import { PAST, FUTURE } from '@datePastFuture';
    import { storedPastFuture } from '@/plugins/customFieldView/dateFieldLimits';
    const { t } = useI18n();
    const dropDownArrow = require('@/assets/images/svg/triangleBlack.svg');

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

    //FIRST Tab
    const fieldLabel = ref('');
    const fieldSeparatorSelected = ref('-');
    const pastFutureOptions = [{ value: PAST, label: t('CustomField.past') }, { value: FUTURE, label: t('CustomField.future') }];
    /* The input resets to its bound value whenever that changes identity, so the ticks are computed once per field. */
    const pastFutureValue = computed(() => storedPastFuture(props.customFieldObject));
    const fieldDescription = ref('');
    const fieldSeparator = ref(['-', '/', '.']);
    const fieldDateFormate = ref(['MM-DD-YYYY','DD-MM-YYYY','YYYY-MM-DD']);
    const fieldTimeFormate = ref(['24 Hour','AM/PM']);
    const fieldDaysDisable = ref([
        {
            value: 0,
            label: t('weekName.sundays'),
            bindValue:0
        },
        {
            value: 1,
            label: t('weekName.mondays'),
            bindValue:1
        },
        {
            value: 2,
            label: t('weekName.tuesdays'),
            bindValue:2
        },
        {
            value: 3,
            label: t('weekName.wednesdays'),
            bindValue:3
        },
        {
            value: 4,
            label: t('weekName.thursdays'),
            bindValue:4
        },
        {
            value: 5,
            label: t('weekName.fridays'),
            bindValue:5
        },
        {
            value: 6,
            label: t('weekName.saturdays'),
            bindValue:6
        }
    ]);
    const liteModeToggle = ref(['Lite Mode']);
    const liteMode = ref(['Lite Mode']);
    const customFieldTypeUniqueId = ref(makeUniqueId(6));
    const type = ref(props?.customFieldObject?.type ? props?.customFieldObject?.type : 'task');

    // emit
    const emit = defineEmits(['handleFunction','tabIndexUpdate']);
    

    watch(() => props.tabIndex, (val) =>{
        tabIndexCheck.value = val;
    });
    watch (()=> fieldSeparatorSelected.value,() => {
        if(fieldSeparatorSelected.value === '-'){
            fieldDateFormate.value = ['MM-DD-YYYY','DD-MM-YYYY','YYYY-MM-DD'];
        }else if(fieldSeparatorSelected.value === '/'){
            fieldDateFormate.value = ['MM/DD/YYYY','DD/MM/YYYY','YYYY/MM/DD'];
        }else{
            fieldDateFormate.value = ['MM.DD.YYYY','DD.MM.YYYY','YYYY.MM.DD'];
        }
    });
    const tabIndexCheck = ref(props.tabIndex);

    const handleSeparator = (val) => {
        fieldSeparatorSelected.value = val;
    };
    const handleInput = (val) => {
        liteModeToggle.value = val;
    };
    // Redirect to the tab where the validation error message is displayed.
    const handleTabComp = (node) => {
        if(!(node._value.fieldDescription && node._value.fieldTitle)){
            tabIndexCheck.value = 1;
            emit('tabIndexUpdate',tabIndexCheck.value)
        }
    };
    // submit the form
    const handleSubmitComp = (object) => {
        let fieldDaysDisables = [0,1,2,3,4,5,6];
        let newFieldDaysDisable = fieldDaysDisables.filter((e)=> !object.fieldDaysDisable.includes(e));
        object.fieldDaysDisable = newFieldDaysDisable;
        object.fieldValidation = '';
        object.fieldType = props.componentDetail.cfType;
        object.fieldTitle = object.fieldTitle.trim();
        if(!(object.fieldLiteMode && object.fieldLiteMode.length)){
            object.fieldTimeFormate = '';
        }
        object.fieldImage = props.componentDetail.cfIcon;
        object.fieldImageGrey = props.componentDetail.cfIconGrey;
        object.fieldDescription = object.fieldDescription.trim();
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
