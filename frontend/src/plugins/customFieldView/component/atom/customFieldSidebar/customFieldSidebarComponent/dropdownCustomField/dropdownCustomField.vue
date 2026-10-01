<template>
    <div class="dropdown-custom-field">
        <div v-show="tabIndexCheck === 1" data-field-tab="1">
            <CustomFieldInputComponent
                :label="$t('PlaceHolder.field_label')"
                :type="'text'"
                :placeholder="$t('PlaceHolder.Enter_Field_Label')"
                :validations="'required:trim'"
                :bindValue="props.customFieldObject?.fieldTitle ? props.customFieldObject.fieldTitle :fieldLabel"
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
            <div class="options-area style-scroll" @keydown.enter="onOptionEnter" @paste="onOptionPaste">
                <draggable v-model="options" item-key="id" tag="div" handle=".drag-icon">
                    <template #item="{ element, index }">
                        <RowComponent :key="element.id"
                            :data="element" 
                            :rowIndex="index"
                            @deleteIndex="deleteRow($event)"
                            @editIndex="editRow"
                            :rowIndexs="rowIndexs"
                            :isedit="isEdit"
                            :fieldName="{ color: `option_color_${index}`, option: `option_${index}`}"
                            :isDeletable="options.length > 1"
                        />
                    </template>
                </draggable>
            </div>
            <a class="blue btn-add-new" @click="addRow">+ {{$t('CustomField.add_another_item')}}</a>
            <p v-if="!isEdit" class="options-hint">{{$t('CustomField.options_keyboard_hint')}}</p>
            <div class="mt-20px">
                <h4 class="dark-gray font-size-14 m-0">{{$t('CustomField.predefined_options')}}</h4>
                <div class="dropdown-main mt-10px">
                    <div class="dropdown-select" @click="isVisiblePrededine=true">
                        <span class="select">{{ selectedOption.label || $t('Permissions.None') }}</span>
                        <div class="arrow-dropdown"></div>
                    </div>
                </div>
                <span class="font-size-12 gray">{{$t('CustomField.choose_ready_made_list')}}</span>
            </div>
        </div>
        <div v-show="tabIndexCheck === 3" data-field-tab="3">
            <h4 class="dark-gray font-size-14">{{$t('CustomField.selected_by_default')}}</h4>
            <div class="options-area style-scroll">
                <div v-for="(row, index) in options" :key="index" class="d-flex mb-20px cursor-pointer">
                    <label class="d-flex cursor-pointer">
                        <CheckboxComponent v-model="row.selected" @click="handleCheckRow(row)" :value="row.value" customClasses="border-gray"/>
                        <span class="ml-10px font-size-12 dark-gray2">{{ row.label }}</span>
                    </label>
                </div>
            </div>
        </div>
        <Sidebar
            v-model:visible="isVisiblePrededine"
            :title="$t('CustomField.predefined_options')"
            :enable-search="true"
            :options="predefinedOptions"
            @selected="selectedObj($event)"
            :zIndex="10"
            :listenKeys="true"
        />
    </div>
</template>

<script setup>
import { inject, nextTick, ref, watch } from "vue";
import draggable from 'vuedraggable';
import { Country } from 'country-state-city';
import CustomFieldInputComponent from "../../../customFieldSidebar/customFieldSidebarComponent/customFieldInputComponent/customFieldInputComponent.vue";
import RowComponent from '../dropdownCustomField/rowComponent.vue';
import CheckboxComponent from "@/components/atom/Checkbox/CheckboxComponent.vue";
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';

// Utils
import { useCustomComposable } from "@/composable";
import monthsList from '@/utils/monthsList.json';
import genderList from '@/utils/genders.json';
import daysList from '@/utils/daysList.json';
import timeZoneOption from "@/views/Settings/MySettings/timezoneArray.js";

const { makeUniqueId } = useCustomComposable();
const dropDownArrow = require('@/assets/images/svg/triangleBlack.svg');
// props
const props = defineProps({
        tabIndex: {
            type: Number,
            default: 1
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

// Emits
const emit = defineEmits(['handleFunction', 'tabIndexUpdate']);

watch(() => props.tabIndex, (val) => {
    tabIndexCheck.value = val;
});

// Variables
const isVisiblePrededine = ref(false);
const fieldLabel = ref('');
const fieldPlaceholder = ref('');
const fieldDescription = ref('');
const tabIndexCheck = ref(props.tabIndex);
const selectedOption = ref({});
const predefinedOptions = ref([
    { label: "None", value: "none" },
    { label: "Gender", value: "gender" },
    { label: "Days", value: "days" },
    { label: "Months", value: "months" },
    { label: "Time Zone", value: "timezone" },
    { label: "Country", value: "country" }
]);
const contriesArray = ref(Country.getAllCountries());
const options = ref(props.customFieldObject.fieldOptions ? JSON.parse(JSON.stringify(props.customFieldObject.fieldOptions)) : [{
    id: makeUniqueId(5),
    color: "#34495E",
    value: "",
    label: "",
    selected: false
}]);
const rowIndexs = ref([]);
const isEdit = Boolean(props.customFieldObject?._id);
const saveFieldForm = inject('saveFieldForm', () => {});
const customFieldTypeUniqueId = ref(makeUniqueId(6));
const type = ref(props?.customFieldObject?.type ? props?.customFieldObject?.type : 'task');

watch(() => props.customFieldObject.fieldOptions, (val) => {
    options.value = val;
});

// This function is used to add new row
const addRow = () => {
    const obj = {
        id: makeUniqueId(5),
        color: "#34495E",
        value: "",
        label: "",
        selected: false
    }
    
    if(isEdit){
        if(options.value.filter((x) => x.label === "").length){
            return;
        }
        rowIndexs.value = [];
        rowIndexs.value.push(obj.id);
        checkOldId.value = obj.id;
        options.value.push(obj);
        setTimeout(()=>{
            const focusCheck = document.getElementById(`focus${obj.id}`);
            if(focusCheck){
                focusCheck.focus();
            }
        });
    }else{
        options.value.push(obj);
    }
}

const deleteRow = (index) => {
    options.value.splice(index, 1);
}

const newRow = (label = "") => ({ id: makeUniqueId(5), color: "#34495E", value: "", label, selected: false });
const rowOfInput = (target) => options.value.findIndex((row) => `focus${row.id}` === target?.id);
const focusRow = (row) => nextTick(() => document.getElementById(`focus${row.id}`)?.focus());

/* A new dropdown is typed without leaving the keyboard: Enter moves to the next option, and on an empty one it saves. */
const onOptionEnter = (event) => {
    const index = rowOfInput(event.target);
    if (isEdit || index === -1 || event.isComposing) return;
    event.preventDefault();
    const label = String(event.target.value || "").trim();
    options.value[index].label = label;
    if (label) {
        const next = options.value[index + 1];
        if (!next || next.label) options.value.splice(index + 1, 0, newRow());
        focusRow(options.value[index + 1]);
        return;
    }
    if (options.value.length > 1) options.value.splice(index, 1);
    nextTick(saveFieldForm);
};

const onOptionPaste = (event) => {
    const index = rowOfInput(event.target);
    const lines = String(event.clipboardData?.getData("text") || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (isEdit || index === -1 || lines.length < 2) return;
    event.preventDefault();
    const rows = lines.map((line) => newRow(line));
    options.value.splice(index, options.value[index].label ? 0 : 1, ...rows);
    focusRow(rows[rows.length - 1]);
};

const selectedObj = (obj) => {
    options.value = [];
    selectedOption.value = obj;
    switch (obj.value) {
        case "none":
            options.value = [];
            addRow();
            break;
        case "gender":
            options.value = genderList.map(x => ({ ...x, id: makeUniqueId(5), color: "#34495E", selected: false }));
            break;
        case "days":
            options.value = daysList.map(x => ({ ...x, id: makeUniqueId(5), color: "#34495E", selected: false }));
            break;
        case "months":
            options.value = monthsList.map(x => ({ ...x, id: makeUniqueId(5), color: "#34495E", selected: false }));
            break;
        case "timezone":
            options.value = timeZoneOption.map(x => ({ label: x, value: "", id: makeUniqueId(5), color: "#34495E", selected: false }));
            break;
        case "country":
            options.value = contriesArray.value.map(x => ({ label: x.name, value: x.isoCode, id: makeUniqueId(5), color: "#34495E", selected: false }));
            break;
        default:
            options.value = [];
            addRow();
            break;
    }
}

// Redirect to the tab where the validation error message is displayed.
const handleTabComp = (node) => {
    if(!node._value.fieldTitle){
        tabIndexCheck.value = 1;
        emit('tabIndexUpdate', tabIndexCheck.value)
    } else if (options.value.length) {
        if (options.value.some(ele => ele.label.trim() === "")) {
            tabIndexCheck.value = 2;
            emit('tabIndexUpdate', tabIndexCheck.value)
        }
    }
};

// submit the form
const handleSubmitComp = (object) => {
    options.value.forEach(ele => {
        delete ele?.preValue;
        ele.value === '' ? ele.value = ele.label.trim().replaceAll(' ', '_').toLowerCase() : { ...ele };
    });

    object.fieldOptions = options.value;
    let length = object.fieldMinimum || object.fieldMaximum ? `length:${`${object.fieldMinimum ? object.fieldMinimum : 0}` + `${object.fieldMaximum ? `,${object.fieldMaximum}` : ''}`}` : ''
    object.fieldValidation = length ? length : ''
    object.fieldType = props.componentDetail.cfType;
    object.fieldMinimum = object.fieldMinimum ? String(object.fieldMinimum) : '';
    object.fieldMaximum = object.fieldMaximum ? String(object.fieldMaximum) : '';
    object.fieldImage = props.componentDetail.cfIcon;
    object.fieldImageGrey = props.componentDetail.cfIconGrey;
    delete object?.entryLimits;
    Object.keys(object).forEach((key) => {
        if (key.startsWith("option_") || key.startsWith("option_color_")) {
            delete object[key];
        }
    });
    if(props.isType === true){
        object.type = type.value;
    }
    emit('handleFunction',object,props.customFieldObject && Object.keys(props.customFieldObject).length ? true : false);
};

const handleCheckRow = (object) => {
    options.value.forEach((x)=>{
        if(x.id !== object.id){
            x.selected = false;
        }
    })
};
const checkOldId = ref('');
const isChecked = ref(false);

watch(()=> checkOldId.value ,(newVal,oldVal) =>{
    if(oldVal){
        const optionArrayValue = options.value.find((x) => x.id === oldVal);
        if(optionArrayValue && newVal?.new !== true){
            if(optionArrayValue?.preValue && !optionArrayValue?.label || (optionArrayValue?.preValue !== optionArrayValue?.label && isChecked.value === false)){
                optionArrayValue.label = optionArrayValue.preValue;
                const index = options.value.findIndex((x) => !x.label);
                if(index > -1){
                    options.value.splice(index,1)
                }
            }
        }
    }
});
const editRow = (boolean,val,old) => {
    checkOldId.value = val;
    const optionArray = options.value.find((x) => x.id === val);
    if(boolean === true){
        optionArray.preValue = old;
        rowIndexs.value = [val];
        isChecked.value = false;
    }
    else if(boolean === null){
        if(options.value.length === 1){
            return;
        }
        if(optionArray?.preValue){
            optionArray.label = optionArray.preValue;
        }else if((!optionArray.preValue && !optionArray.label) || (optionArray.preValue === undefined)){
            const index = options.value.findIndex((x) => x.label === "");
            options.value.splice(index,1)
        }
        rowIndexs.value = [];
        isChecked.value = false;
    }else if(boolean === false){
        if(old){
            isChecked.value = true;
            optionArray.preValue = old;
            rowIndexs.value = [];
        }else{
            isChecked.value = false;
            optionArray.label = "";
        }
    }
};
const handleType = (val) => {
    type.value = val;
};
defineExpose({ handleTabComp, handleSubmitComp });
</script>
<style scoped>
.options-hint { margin: 8px 0 0; color: var(--ink-2); font: var(--text-small); }
</style>
