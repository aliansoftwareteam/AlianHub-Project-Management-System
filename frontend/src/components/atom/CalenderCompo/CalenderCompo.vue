<template>
    <div>
        <VueDatePicker
            ref="datePicker"
            input-class="hidden"
            :hide-navigation="hideExtraLayouts"
            :close-on-auto-apply="false"
            :disabled-dates="disabledDates"
            :highlight="highlightDisabledDate == true ? disabledDates : []"
            :highlight-disabled-days="highlightDisabledDate"
            :min-date="minDate"
            :modelValue="dateValue"
            :menu-class-name="menuClass"
            :auto-apply="showTimeFormate ? false : !range"
            :max-date="maxDate"
            :range="range"
            :format="range === true ? 'MMM dd, yyyy' : ''"
            :partial-range="false"
            :position="position ? position : 'center'"
            :auto-position="autoposition"
            :hide-input-icon="hideCalenderIcon"
            :hide-clear-button="hideClearButton"
            :clearable="clearable"
            :action-row="{ showPreview: false }"
            @click-outside="onCLickOutSideOrCansal"
            @update:modelValue="handleDate"
            :teleport="true"
            :disabled-week-days="props.daysWeekDisable"
            :is-24="timeFormate"
            :placeholder="$t('errorPage.select_a_date')"
            @range-end="onRangeEnd"
            @range-start="onRangeStart"
            @open="handleOpen"
            :title="dateValue ? dateValue.length === 2 ? `${convertDateFormat(dateValue[0],props.format ? props.format : '',{showDayName: false})} - ${convertDateFormat(dateValue[1],props.format ? props.format : '',{showDayName: false})}` : convertDateFormat(dateValue,props.format ? props.format : '',{showDayName: false}) : ''"
        >
            <!-- for range picker -->
            <template #clear-icon="{ clear }" v-if="clearable">
                <img :src="closeIcon" alt="closeIcon" class="close_icon" @click="clear"> 
            </template>

            <template #left-sidebar v-if="range === true">
                <ul class="WrapperPresetRange">
                    <li @click="weekCall(0)" class="cursor-pointer" :class="isActive == 0 ? 'isActive' : ''">
                        {{$t('general.current_week')}}
                    </li>
                    <li @click="monthCall(1)" class="cursor-pointer" :class="isActive == 1 ? 'isActive' : ''">
                        {{$t('general.current_month')}}
                    </li>
                </ul>
            </template>

            <!-- for calender action buttons -->
            <template #action-buttons v-if="range === true">
                <p class="btn btn-cansal cursor-pointer" @click="onCLickOutSideOrCansal">{{$t('Projects.cancel')}}</p>
                <p class="btn" :class="[startDateVal && endDateVal ? 'btn-success cursor-pointer' : 'btn-disabled-calendar']" @click="onSubmitVal">{{$t('general.apply')}}</p>
            </template>
            <!-- for simple date picker -->
            <template #trigger v-if="range === false">
                <div v-if="!isShowDateAndicon" class="d-flex">
                    <span :title="convertDateFormat(dateValue,props.format ? props.format : '',{showDayName: false})" v-if="dateValue != ''" class="cursor-pointer due_date-listing" :style="[{'color':(typeof dateValue == 'string' ? new Date(dateValue).getTime() < new Date().setHours(0, 0, 0, 0) : dateValue < new Date().setHours(0, 0, 0, 0)) && overdue ? 'red' :'black'}]">
                        {{convertDateFormat(dateValue,props.format ? props.format : '',{showDayName: false})}}
                    </span>
                    <img v-else :src="isWithoutBorderImage ? withoutBorderImageIcon : dateImage" class="cursor-pointer" alt="dateImage">
                </div>
                <div v-if="isShowDateAndicon">
                    <div v-if="!showTimeFormate">
                        <input
                            v-if="dateValue != ''"
                            readonly 
                            class="date_format_cal font-roboto-sans"
                            :class="[{'calendar-comp':!calenderImage,'calendar-comp-white':calenderImage}]"
                            type="text"
                            :placeholder="convertDateFormat(dateValue,props.format ? props.format : '',{showDayName: false})"
                            :id="inputId"
                        >
                        <input
                            v-else
                            class="date_format_cal font-roboto-sans"
                            readonly
                            type="text"
                            :class="[{'calendar-comp':!calenderImage,'calendar-comp-white':calenderImage}]"
                            :placeholder="props.format ? props.format : settingDateFormat"
                            :id="inputId"
                        >
                    </div>
                    <div v-else>
                        <input
                            v-if="dateValue != ''"
                            readonly 
                            class="date_format_cal font-roboto-sans"
                            :class="[{'bg-transparent border-0 cursor-pointer':!calenderImage,'calendar-comp-white':calenderImage,'text-ellipse':isEllipsis,'d-block':isEllipsis,'mw-150px':isEllipsis,'date_mw':isTask}]"
                            type="text"
                            :placeholder="convertDateAndTime(timeFormate,dateValue,props.format)"
                            :id="inputId"
                        >
                        <input
                            v-else
                            class="date_format_cal font-roboto-sans"
                            readonly
                            type="text"
                            :class="[{'bg-transparent border-0 cursor-pointer':!calenderImage,'calendar-comp-white':calenderImage,'text-ellipse':isEllipsis,'d-block':isEllipsis,'mw-150px':isEllipsis,'date_mw':isTask}]"
                            :placeholder="`${props.format} , ${timeFormate?'24 Hour':'AM/PM'}`"
                            :id="inputId"
                        >
                    </div>
                </div>
            </template>
        </VueDatePicker>
        <!-- <VueDatePicker
            time-picker
            text-input
            v-model="time"
            :clearable="false"
            :hide-input-icon="true"
            @text-submit="handleTime"
        >

        </VueDatePicker> -->
    </div>
</template>

<script setup>
//Imports
import { defineComponent,defineProps,ref,defineEmits,onMounted,watch, nextTick } from 'vue';
import VueDatePicker from '@vuepic/vue-datepicker';
import { useToast } from 'vue-toast-notification';
import '@vuepic/vue-datepicker/dist/main.css';
import {useConvertDate} from '@/composable/index';
import { useStore } from "vuex";
const { getters } = useStore();
import moment from 'moment';
import { useI18n } from "vue-i18n";
const { t } = useI18n();
//Define Emits, Props, & Refs
const {convertDateFormat} = useConvertDate();
defineComponent({
    components: { VueDatePicker }
})
const $toast = useToast();
const settingDateFormat = ref(getters['settings/companyDateFormat'].dateFormat)
const emit = defineEmits(['update:modelValue','outsideClick','handleSubmit'])
const closeIcon = require("@/assets/images/svg/CloseSidebar.svg");
const props = defineProps({
    hideExtraLayouts: {
        type: Array,
        default: () => ['time' ,'minutes' , 'hours' , 'seconds']
    },
    modelValue: {
        default: () => new Date().toLocaleString()
    },
    disabledDates: {
        type: [Array , Function],
        default: () => []
    },
    highlightDisabledDate: {
        type: Boolean,
        default: false
    },
    minDate: {
        type: [Date , String],
        default: ''
    },
    maxDate: {
        type: [Date, String],
        default: ''
    },
    isShowDateAndicon: {
        type: Boolean,
        default: false
    },
    menuClass: {
        type: String,
        default: ''
    },
    range: {
        type: Boolean,
        default: false
    },
    position: {
        type: String,
        default: ''
    },
    autoposition: {
        type: Boolean,
        default: true
    },
    hideClearButton: {
        type: Boolean,
        default: false
    },
    hideCalenderIcon: {
        type: Boolean,
        default: false
    },
    calenderImage: {
        type: Boolean,
        default: false
    },
    inputId: {
        type: String,
        default: 'inputId'
    },
    overdue: {
        type: Boolean,
        default: false
    },
    format: {
        type: String,
        default: ''
    },
    daysWeekDisable: {
        type: [Array],
        default: () => []
    },
    timeFormate:{
        type: Boolean,
        default: false
    },
    showTimeFormate:{
        type: Boolean,
        default: false
    },
    clearable: {
        type: Boolean,
        default: false
    },
    isEllipsis: {
        type: Boolean,
        default: false
    },
    isTask: {
        type: Boolean,
        default: false
    },
    preSelectable: {
        type: Boolean,
        default: true
    },
    preSelectType: {
        type: String,
        default: "month"
    },
    isWithoutBorderImage: {
        type: Boolean,
        default: false
    },
    message: {
        type: String,
        default: ''
    }
})
const dateValue = ref(props.modelValue);
const prevaldate = ref(null);
const datePicker = ref('');
const startDateVal = ref('');
const endDateVal = ref('');
const dateImage = require('@/assets/images/svg/date_cion.svg');
const withoutBorderImageIcon = require('@/assets/images/svg/component-inactive-icons/comp_calender_inactive.svg');
watch(() => props.modelValue, (newval,oldVal) => {
    if (newval != null && newval != '' && newval != oldVal) {
        dateValue.value = newval;
    }else{
        if(newval == '') {
            dateValue.value = '';
        }
    }
})
const handleOpen = () => {
    if(!dateValue.value){
        startDateVal.value = '';
        endDateVal.value = '';
    } else if(dateValue.value && dateValue.value.length) {
        endDateVal.value=dateValue.value?.[1] || ''
        startDateVal.value=dateValue.value?.[0] || ''
    }
    
}
//Define Methods
const handleDate = (modelData) => {
    if(props.range === true) {
        if(modelData?.length){
            if(modelData?.includes(null) || modelData?.[0] == null || modelData?.[1] == null){
                $toast.error(props?.message ? props?.message : t('Toast.Please_select_start_end_date'),{position: 'top-right'});
                return;
            }
        } else {
            endDateVal.value = "";
            startDateVal.value = "";
        }
    }
    if(props.showTimeFormate){
        dateValue.value = modelData;
        datePicker.value.closeMenu();
        emit('update:modelValue',modelData);
    }else{
        if (new Date(modelData).toLocaleDateString() == new Date(dateValue.value).toLocaleDateString() && props.range == false) {
            return;
        }
        dateValue.value = modelData;
        datePicker.value.closeMenu();
        emit('update:modelValue',modelData);
    }
    emit('handleSubmit')
}
const isActive = ref(0);
function startOfWeek(date) {
  const dayOfWeek = date.getDay();
  const diff = date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  return new Date(date.getFullYear(), date.getMonth(), diff);
}

function endOfWeek(date) {
  const start = startOfWeek(date);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return end;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function weekCall(value,preSelect = false) {
    isActive.value = value;
    const date1 = startOfWeek(new Date());
    const date2 = endOfWeek(new Date());
    dateValue.value = [date1, date2];
    prevaldate.value = dateValue.value;
    if(preSelect){
        emit('update:modelValue',dateValue.value)
    }
}

function monthCall(value,preSelect = false) {
    isActive.value = value;
    const date1 = startOfMonth(new Date());
    const date2 = endOfMonth(new Date());
    dateValue.value = [date1, date2];
    prevaldate.value = dateValue.value;
    if(preSelect){
        emit('update:modelValue',dateValue.value)
    }
}
function onCLickOutSideOrCansal() {
    if (props.range == true) {
        if(dateValue.value === null){
            datePicker.value.closeMenu();
            return;
        }
        if(dateValue?.value[0] != prevaldate.value[0] || dateValue?.value[1] != prevaldate.value[1]){
            dateValue.value = prevaldate.value;
            if(new Date(dateValue.value[0]).getTime() == startOfWeek(new Date()).getTime() && new Date(dateValue.value[1]).getTime() == endOfWeek(new Date()).getTime()) {
                isActive.value = 0;
            } else if(new Date(dateValue.value[0]).getTime() == startOfMonth(new Date()).getTime() && new Date(dateValue.value[1]).getTime() == endOfMonth(new Date()).getTime()) {
                isActive.value = 1;
            } else {
                isActive.value = 3;
            }
        }
        datePicker.value.closeMenu();
    } else {
        datePicker.value.closeMenu();
    }
    emit('outsideClick')
}
async function onSubmitVal(){
    if(!startDateVal.value || !endDateVal.value){
        return;
    }
    await datePicker.value.selectDate();
    if(new Date(dateValue?.value[0]).getTime() == startOfWeek(new Date()).getTime() && new Date(dateValue?.value[1]).getTime() == endOfWeek(new Date()).getTime()) {
        isActive.value = 0;
    } else if(new Date(dateValue?.value[0]).getTime() == startOfMonth(new Date()).getTime() && new Date(dateValue?.value[1]).getTime() == endOfMonth(new Date()).getTime()) {
        isActive.value = 1;
    } else {
        isActive.value = 3;
    }
    prevaldate.value = dateValue.value;
}
onMounted(() => {
    if (props.range == true) {
        nextTick(() => {
            if (props.preSelectable) {
                if(props.preSelectType === "month") {
                    monthCall(1,true);
                } else {
                    weekCall(0,true);
                }
            }
        })
        prevaldate.value = dateValue.value;
        document.addEventListener('mouseover', function (event) {
            if (event.target.classList.contains('dp__date_hover_end') || event.target.classList.contains('dp__date_hover_start')) {
                if(document.getElementsByClassName('isActive')[0] && document.getElementsByClassName('isActive')[0].classList){
                    document.getElementsByClassName('isActive')[0].classList.remove('isActive');
                }
            }
        });
    }
    // const ele = document.getElementById(props.inputId);
    // if(ele){
    //     ele.focus();
    // }
})
function convertDateAndTime(timeformat,seconds,dateFormat) {
    try {
        if (!timeformat) {
            return `${convertDateFormat(seconds,dateFormat,{showDayName: false})} , ${moment(new Date(seconds)).format(`hh:mm A`)}`;
        } else {
            return `${convertDateFormat(seconds,dateFormat,{showDayName: false})} , ${moment(new Date(seconds)).format(`HH:mm`)}`;
        }
    } catch (error) {
        console.error("Error",error)
    }
}
const onRangeStart = (value) => {
    if(props.range === true){
        endDateVal.value = '';
        startDateVal.value = value;
    }
}
const onRangeEnd = (value) => {
    if(props.range === true){
        endDateVal.value = value;
    }
}
</script>
<style src="./style.css"></style>