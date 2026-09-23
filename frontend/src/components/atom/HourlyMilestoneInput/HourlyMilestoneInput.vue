<template>
    <tr>
        <td>
            <!-- milestoneName -->
            <div class="hourly-milestone-input">
                <InputText
                    v-model.trim="formData.milestoneName.value"
                    type="text"
                    :id="`milestonename`"
                    :placeHolder="$t('PlaceHolder.Enter_Text')"
                    :inputId="`milestonename`"
                    @keyup="checkErrors({'field':formData.milestoneName,
                        'name':'name',
                        'validations':formData.milestoneName.rules,
                        'type':formData.milestoneName.type,
                        'event':$event.event})"
                ></InputText>
                <small class="red" v-if="formData.milestoneName.error">{{formData.milestoneName.error}}</small>
            </div>
        </td>
        <!-- Calendar -->
        <td v-if="billingPeriodHourly === 'Monthly'" class="position-re">
            <InputText
                type="text"
                :id="`milestonename`"
                :placeHolder="Object.keys(hourlyCalendarModel).length ? `${hourlyCalendarModel.start} to ${hourlyCalendarModel.end}` : `${t('Permissions.select')} ${t('Milestone.range')}`"
                :inputId="`milestonename`"
                @click="toggleCalendar"
                isReadonly
                class="cursor-pointer monthly-calendar"
            ></InputText>
            <MonthlyCalendarMilestone
                v-if="calendartoggle && Object.keys(rangeObjectWatch).length"
                :startDate="startDateCheck"
                :rangeObject="rangeObjectWatch"
                @startEndDate="handleStartEndDate"
            />
        </td>
        <td v-else>
            <VDatePicker
                :model-config="modelConfig"
                v-model="selectedRange"
                is-required
                @dayclick="dateUpdate"
                :attributes="attributes"
                :min-date="startDateCheck.seconds ? new Date(startDateCheck.seconds * 1000) : new Date(startDateCheck)"
                :max-date="new Date()"
                :popover="{ visibility: 'click' }"
            >
                <template v-slot="{ togglePopover,inputEvents }">
                    <button
                        class="border-0 p-0 hourly__togglepophover-btn"
                        @click="togglePopover()"
                    >
                        <input
                            maxlength="10"
                            class="form-control focusinput date_input_value cursor-pointer"
                            v-on="inputEvents"
                            :placeholder="selectedRange !== null ? `${convertDateFormat(attributes[0].dates.start,'',{showDayName: false})} to ${convertDateFormat(attributes[0].dates.end,'',{showDayName: false})}`: `select Range`"
                            readonly
                        />
                    </button>
                </template>
            </VDatePicker>
        </td>
        <!-- loggedHours -->
        <td >
            <span v-if="isSpinner === false">{{hourMinutetotal ? hourMinutetotal : `0h 0m`}}</span>
            <Skelaton v-else class="border-radius-8-px" style="height: 25px;marginRight: 10px;" /> 
        </td>
        <!-- billinghours -->
        <td>
            <div>
                <div class="d-flex align-items-center">
                    <InputText
                        :modelValue="hours"
                        @update:modelValue="val => hours = val.toString()"
                        type="number"
                        :id="`hours`"
                        :placeHolder="$t('Milestone.hh_placeholder')"
                        :inputId="`hours`"
                        @input="hours = hours.replace(/^0/g, '')"
                        @keypress="onlyNumberHour($event.event)"
                        @keyup="validationcheck(),calculateAmount()"
                        min="1"
                        @keydown="reverseChange = false"
                        class="hourminutes hoursMilestone"
                        :isDisabled="isSpinner"
                    ></InputText>
                    <div>:</div>
                    <InputText
                        :modelValue="minute"
                        @update:modelValue="val => minute = val.toString()"
                        type="number"
                        :id="`minute`"
                        :placeHolder="$t('Milestone.mm_placeholder')"
                        :inputId="`minute`"
                        @input="minute = minute.replace(/^0/g, '')"
                        @keypress="onlyNumberHour($event.event)"
                        @keyup="validationcheck(),calculateAmount()"
                        min="1"
                        @keydown="reverseChange = false"
                        class="hourminutes minutesMilestone"
                        :isDisabled="isSpinner"
                    ></InputText>
                </div>
                <small class="red" v-if="error">{{$t(`Milestone.${error.replaceAll(' ',"_")}`)}}</small>
            </div>
        </td>
        <!-- amountPerHours -->
        <td>
            <div class="d-flex position-re">
                <span class="currency">{{props.currency.symbol}}</span>
                <InputText
                    v-model.number="formData.amountPerHours.value"
                    type="number"
                    :id="`amountPerHours`"
                    :placeHolder="$t('PlaceHolder.Enter_Amount')"
                    :inputId="`amountPerHours`"
                    @input="handleInputNum('amountper')"
                    @keypress="onlyNumber($event.event)"
                    @keydown="reverseChange = false"
                    @keyup="checkErrors({'field':formData.amountPerHours,
                        'name':'amount per hours',
                        'validations':formData.amountPerHours.rules,
                        'type':formData.amountPerHours.type,
                        'event':$event.event}),calculateAmount()"
                    min="1"
                    class="amountCurr amountperhours"
                    :isDisabled="isSpinner"
                ></InputText>
            </div>
            <small class="red" v-if="formData.amountPerHours.error">{{formData.amountPerHours.error}}</small>
            <small class="red" v-if="errAmountPer">{{$t(`Milestone.${errAmountPer.replaceAll(' ',"_")}`)}}</small>
        </td>
        <!-- amount -->
        <td>
            <div class="d-flex position-re">
                <span class="currency">{{props.currency.symbol}}</span>
                <InputText
                    v-model.number="formData.amount.value"
                    type="number"
                    :id="`amount`"
                    :placeHolder="$t('PlaceHolder.Enter_Amount')"
                    :inputId="`amount`"
                    @input="handleInputNum('')"
                    @keypress="onlyNumber($event.event)"
                    @keyup="checkErrors({'field':formData.amount,
                        'name':'amount',
                        'validations':formData.amount.rules,
                        'type':formData.amount.type,
                        'event':$event.event}),totalamountremove()"
                    @keydown="reverseChange = true"
                    min="1"
                    class="amountCurr amountperhours"
                    :isDisabled="isSpinner"
                ></InputText>
            </div>
            <small class="red" v-if="formData.amount.error">{{formData.amount.error}}</small>
            <small class="red" v-if="err">{{$t(`Milestone.${err.replaceAll(' ',"_")}`)}}</small>
        </td>
        <!-- status -->
        <td>
            <div class="hourly-milestone-input-status">
                <InputText
                    v-model="status"
                    type="text"
                    :id="`status`"
                    :placeHolder="$t('PlaceHolder.Select')"
                    :inputId="`status`"
                    isReadonly
                    @click="isVisible = true"
                ></InputText>
            </div>
        </td>
        <!-- statusDate -->
        <td>
            <MilestoneDate
                v-if="status"
                id="AddstatusDate"
                :displyDate="statusDate ? statusDate : ''"
                :isShowDateAndicon="true"
                :minDate="statusObj.isFuture === true ? statusObj.isFuture === true && statusObj.isPast === true ? '' : new Date() : statusObj.isFuture === false && statusObj.isPast === false ? new Date() : ''"
                :maxDate="statusObj.isPast === true ? statusObj.isFuture === true && statusObj.isPast === true ? '' : new Date() : statusObj.isPast === false && statusObj.isFuture === false ? new Date() : ''"
                @SelectedDate="($event) => updateStatusDate($event)"
                :calenderImage="true"
                :InputDesign="true"
            ></MilestoneDate>
        </td>
        <!-- action -->
        <td>
            <img :src="saveImage" alt="save" @click="handleHourlyMilestone" class="cursor-pointer refund_delete">
            <img :src="deleteImage" alt="deleteedit" @click="emit('addHourlyMilestone','clear'),handleClearMilestone"  class="cursor-pointer">
        </td>
        <Sidebar
            className="task-milestone-status-sidebar"
            v-model:visible="isVisible"
            :title="$t('Milestone.mileston_status')"
            :enable-search="true"
            :options="options"
            @selected="selectedObj($event)"
            :listenKeys="true"
        >
        </Sidebar>
    </tr>
</template>

<script setup>
    import { defineEmits,ref,defineProps,computed,watch,onUnmounted,onMounted,nextTick } from 'vue';
    import InputText from '@/components/atom/InputText/InputText.vue';
    import { ValidationFunction } from "@/composable/DefaultValidationFunction";
    import MilestoneDate from '@/components/molecules/FixMilestoneDate/FixMilestoneDate.vue';
    import { useValidation } from "@/composable/Validation";
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    import MonthlyCalendarMilestone from '@/components/atom/MonthlyCalendarMilestone/MonthlyCalendarMilestone.vue';
    import { useConvertDate } from "@/composable";
    import { useStore } from "vuex";
    import moment from 'moment';
    import { calendar } from '@/components/organisms/HourlyMilestone/helper.js';
    import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';
    const { UserArray } = calendar();
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();
    // props
    const props = defineProps({
        startDate: {type: [String, Object],required: true},
        settingMilestoneStatusAdd: {type: Array,required: true},
        billingPeriod:{type:String,required:true},
        rangeObject:{type:Object,required:true},
        currency:{type:Object,required:true},
        disableStartEndDate:{type:Object,default: () => {}},
        projectId:{type:String,required:false},
        companyId:{type:String,required:false},
    });
    watch(() => props.billingPeriod,(newValue) =>{billingPer.value = newValue});
    watch(() => props.rangeObject,(newValue) =>{
        if(Object.keys(newValue).length){
            rangeObjectWatch.value = newValue;
            hourlyCalendarModel.value = rangeObjectWatch.value.hourlyCalendarModel;
            hourlyCalendarModelStartDate.value = new Date(rangeObjectWatch.value.hourlyCalendarModel.start);
            hourlyCalendarModelEndDate.value = new Date(rangeObjectWatch.value.hourlyCalendarModel.end);
            isSpinner.value = true;
            UserArray(hourlyCalendarModelStartDate.value,hourlyCalendarModelEndDate.value,props.projectId,props.companyId).then((obj)=>{
                if(obj && Object.keys(obj).length){
                    userArray.value = obj.userArray;
                    individualLogTime.value = obj.totalSumValue;
                    convertHours(obj.totalSumValue);
                    convertMintues(obj.totalSumValue);
                    hourMinutetotal.value = `${hours.value}h ${minute.value}m`;
                }else{
                    hours.value = "";
                    minute.value = "";
                    hourMinutetotal.value = "";
                }
                isSpinner.value = false;
            }).catch(()=>{
                isSpinner.value = false;
            });
            formData.value.milestoneName.value = `${rangeObjectWatch.value.selectedmonth} ${rangeObjectWatch.value.monthValueRange}`;
            formData.value.milestoneName.error = "";
        }
    });
    watch(()=> props.disableStartEndDate,(newValue) => {
                if(Object.keys(newValue).length){
            attributes.value.push({
                key: 'disabled', 
                dates: newValue.disableStartEndDate
            });
            dateUpdate({id:newValue.monthlyOrweeklyRanges[0].start});
        }
    })
    onMounted(() => {
        document.body.addEventListener('click', handleClickOutside);
        addKeyUpListener();
    });
    onUnmounted(() => {
        document.body.removeEventListener('click', handleClickOutside);
        removeKeyUpListener();
    });
    nextTick(() => {
        document.getElementById(`milestonename`).focus();
    });
    
    const { getters } = useStore();
    const { convertDateFormat } = useConvertDate();
    const { checkErrors,checkAllFields } = useValidation();
    const milestoneWeeklyRange = computed(() => getters["settings/milestoneweeklyrange"]);
    
    //calendar
    const modelConfig = ref({type: 'string',mask: 'YYYY-MM-DD'});
    // emits
    const emit = defineEmits(['addHourlyMilestone','sidebar']);

    // variable 
    const saveImage = require('@/assets/images/save.png');
    const deleteImage = require('@/assets/images/delete1.png');
    const billingPer = ref('');
    const rangeObjectWatch = ref({});
    const selectedRange = ref(null);
    const billingPeriodHourly = ref(billingPer.value ? billingPer.value : props.billingPeriod ? props.billingPeriod : '');
    const minute = ref('');
    const hours = ref('');
    const status = ref('');
    const isVisible = ref(false);
    const statusObj = ref({});
    const statusDate = ref('');
    const statusArrayMilestone = ref([]);
    const reverseChange = ref(false);
    const calendartoggle = ref(false);
    const hourlyCalendarModel = ref({});
    const hourlyCalendarModelStartDate = ref({});
    const hourlyCalendarModelEndDate = ref({});
    const months = ref(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
    const formData = ref({
        milestoneName: {
            type: 'text',
            name: 'name',
            value: '',
            rules: "required|min:3|"
        },
        amountPerHours: {
            type: 'number',
            name: 'amount per hours',
            value: '',
            rules: "required|min:1|"
        },
        amount: {
            type: 'number',
            name: 'amount',
            value: '',
            rules: "required|min:1|"
        }
    });
    const milestoneStatusArray = ref(props.settingMilestoneStatusAdd);
    const startDateCheck = ref(props.startDate);
    const error = ref('');
    const err = ref('');
    const errAmountPer = ref('');
    const attributes = ref([
        {
            highlight: {
                start: { fillMode: 'outline' },
                base: { fillMode: 'light' },
                end: { fillMode: 'outline' },
            },
            dates: { start: null, end: null },
        }
    ]);
    const userArray = ref([]);
    const individualLogTime = ref('');
    const hourMinutetotal = ref('');
    const isSpinner = ref(false);
    //calculation of hours
    const totalHours = ()=>{
        return Number(hours.value) * Number(formData.value.amountPerHours.value);
    };
    //calculation of minutes
    const totalminutes = () => {
        return Number(minute.value/60) * Number(formData.value.amountPerHours.value)
    };
    //calculation for amountPerHours
    const calculateAmount = () => {
        let amount = 0;
        if (reverseChange.value === false && formData.value.amountPerHours.value && (hours.value || minute.value)) {
            if (minute.value === '') {
                amount = totalHours();
            } else {
                amount = totalHours() + totalminutes();
            }
            formData.value.amount.error = '';
            formData.value.amount.value = amount.toFixed(2);
        }
        if(formData.value.amountPerHours.value === '' || formData.value.amountPerHours.value === 0 || (hours.value === '' && minute.value === '')){
            formData.value.amount.value = '';
        }
        return formData.value.amount.value;
    };
    //reverse calculation of hours
    const reverseTotal = () => {
        return Number(formData.value.amount.value)/Number(hours.value);
    };
    //reverse calculation of minutes
    const reverseMintueTotal = () => {
        let minuteConvert = Number(minute.value/60)
        let totalAmountValue = Number(hours.value) + Number(minuteConvert) 
        let reverseTotalNum = Number(formData.value.amount.value)/Number(totalAmountValue)
        return reverseTotalNum
    };
    //reverse calculation of amount
    const totalamountremove = () => {
        if(reverseChange.value === true && (hours.value || minute.value)){
            if(minute.value === ''){
                formData.value.amountPerHours.error = '';
                return formData.value.amountPerHours.value = reverseTotal().toString() !== '0' ? reverseTotal().toFixed(2).toString() : '';
            } 
            if(minute.value !== ''){
                formData.value.amountPerHours.error = '';
                return formData.value.amountPerHours.value = reverseMintueTotal().toString() !== '0' ? reverseMintueTotal().toFixed(2).toString() : '' ;
            }
        }
    };
    // sidebar data
    const options = computed(() => {
        return milestoneStatusArray.value.filter(status => status.value !== 'CANCELLED' && status.value !== 'REFUNDED').map((status) => {
            return {
                ...status,
                label: status.name
            }
        });
    });
    const selectedObj = (val) => {
        statusObj.value = val;
        status.value = val.name;
        statusDate.value = new Date();
        emit('sidebar',true)
    };
    const updateStatusDate = (val) => {
        statusDate.value = val.dateVal;
    };
    // validation for hours and minute fields
    const validationcheck = () => {
        if (((hours.value === '' && minute.value) && (hours.value && minute.value === '')) || (hours.value === '' && minute.value === '')) {
            error.value = t('Milestone.The_hours_field_is_required');
        } else if (minute.value > 59){
            error.value = t('Milestone.The_minute_field_must_be_59_or_less');
        } else {
            error.value = '';
        }
    };
    const onlyNumber = (event) => {
        ValidationFunction.onlyNumberMilestone(event);
    };
    const handleInputNum = (action) => {
        if(action === "amountper"){
            if(formData.value.amountPerHours.value === 0 || formData.value.amountPerHours.value === ''){
                formData.value.amountPerHours.value = '';
                errAmountPer.value = "";
            }
            if(formData.value.amountPerHours.value){
                const value = Number(formData.value.amountPerHours.value);
                let val = String(value).split(".");
                if(val[1]?.length > 2){
                    errAmountPer.value = t('Milestone.Max_2_decimal_places_allowed');
                }else{
                    errAmountPer.value = "";
                }
            }
        }else{
            if(formData.value.amount.value === 0 || formData.value.amount.value === ''){
                formData.value.amount.value = '';
                err.value = "";
            }
            if(formData.value.amount.value){
                const value = Number(formData.value.amount.value);
                let val = String(value).split(".");
                if(val[1]?.length > 2){
                    err.value = t('Milestone.Max_2_decimal_places_allowed');
                }else{
                    err.value = "";
                }
            }
        }
    };
    const onlyNumberHour = (event) => {
        let keyCode = event.keyCode ? event.keyCode : event.which;
        if ((keyCode < 48 || keyCode > 57)) {
            event.preventDefault();
        }
    };
    // clear variable
    const handleClearMilestone = () => {
        formData.value.milestoneName.value = '';
        formData.value.amountPerHours.value = '';
        formData.value.amount.value = '';
        status.value = '';
        statusDate.value = '';
        statusObj.value = {};
        hours.value = '';
        minute.value = '';
    };
    // edit emit
    const handleHourlyMilestone = () => {
        validationcheck();
        checkAllFields(formData.value).then((valid)=>{
            if(valid && error.value === '' && err.value === '' && errAmountPer.value === ''){
                statusArrayMilestone.value = [];
                if(status.value){
                    statusArrayMilestone.value.push({
                        statusDateValue: statusDate.value,
                        milestoneStatusColor:statusObj.value.value
                    });
                }
                const obj = {
                    milestoneName: formData.value.milestoneName.value,
                    startDate: new Date(hourlyCalendarModelStartDate.value),
                    endDate: new Date(hourlyCalendarModelEndDate.value),
                    amountPerHours: Number(formData.value.amountPerHours.value),
                    amount: Number(formData.value.amount.value),
                    refundedAmount:[],
                    statusArray:statusArrayMilestone.value,
                    hours: Number(hours.value),
                    minute: Number(minute.value),
                    billingPeriod:props.billingPeriod ? props.billingPeriod :'',
                    statusId:statusObj.value && Object.keys(statusObj.value).length ? statusObj.value.value : '',
                    statusDate:statusDate.value ? statusDate.value : '',
                    minRefundDate:'',
                    maxRefundDate:''
                };
                emit('addHourlyMilestone','add',obj,statusObj.value && Object.keys(statusObj.value).length ? statusObj.value : '');
                handleClearMilestone();
            }
        });
    };
    const toggleCalendar = () => {
        calendartoggle.value = !calendartoggle.value;
    };
    const handleClickOutside = (event) => {
        if(calendartoggle.value && !event.target.closest('.monthly-calendar')) {
            calendartoggle.value = false;
        }
    };
    // monthly calendar emit
    const handleStartEndDate = (value) => {
        const startEndObj = value;
        const getYear = new Date(startEndObj.start).getFullYear();
        const getMonth = new Date(startEndObj.start);
        const month = getMonth.toLocaleString('default', { month: 'short' });
        hourlyCalendarModel.value = startEndObj;
        hourlyCalendarModelEndDate.value = new Date(startEndObj.end);
        hourlyCalendarModelStartDate.value = new Date(startEndObj.start);
        formData.value.milestoneName.value = `${month} ${getYear}`;
        rangeObjectWatch.value.monthValueRange = `${getYear}`;
        rangeObjectWatch.value.selectedmonth = `${month}`;
        rangeObjectWatch.value.rangeValueMonthly = rangeObjectWatch.value.monthlyOrweeklyRangesValue[`${getYear}`];
        calendartoggle.value = false;
        isSpinner.value = true;
        UserArray(hourlyCalendarModelStartDate.value,hourlyCalendarModelEndDate.value,props.projectId,props.companyId).then((obj)=>{
            if(obj && Object.keys(obj).length){
                userArray.value = obj.userArray
                individualLogTime.value = obj.totalSumValue
                convertHours(obj.totalSumValue);
                convertMintues(obj.totalSumValue);
                hourMinutetotal.value = `${hours.value}h ${minute.value}m`;
            }else{
                hours.value = "";
                minute.value = "";
                hourMinutetotal.value = "";
            }
            isSpinner.value = false;
        }).catch(() =>{
            isSpinner.value = false;
        });
    };
    const convertHours = (sum) => {
        if(sum){
            let num = sum;
            let hoursval = (num / 60);
            let rhours = Math.floor(hoursval);
            hours.value = rhours !== 0 ? rhours : '';
        }else{
            hours.value = '';
        }
    };
    const convertMintues = (sum) =>{
        if(sum){
            let num = sum;
            let hours = (num / 60);
            let rhours = Math.floor(hours);
            let minutesval = (hours - rhours) * 60;
            let rminutes = Math.round(minutesval);
            minute.value = rminutes !== 0 ? rminutes : '';
        }else{
            minute.value = '';
        }
    };
    // weekly calendar
    const dateUpdate = (value) => {
        let currentDate = null;
        let startDate = value.id ? new Date(value.id) : new Date(value);
        selectedRange.value = new Date(startDate)
        currentDate = new Date(startDate);
        if(milestoneWeeklyRange.value === 'Mon - Sun'){
            if(startDate.getDay() === 0){
                currentDate.setDate(startDate.getDate() - 7);
            }else{
                currentDate.setDate(startDate.getDate() - (startDate.getDay()));
            }
        } else{
            currentDate.setDate(startDate.getDate() - (startDate.getDay()) - 1);
        }
        currentDate.setDate(currentDate.getDate() + 7);
        let weekStart = new Date(currentDate);
        weekStart.setDate(currentDate.getDate() - 6);
        let weekEnd = new Date(Math.min(currentDate));
        nextTick(() => {
            attributes.value[0].dates = {
                start:weekStart,
                end:weekEnd
            }
            hourlyCalendarModelEndDate.value = attributes.value[0].dates.end;
            hourlyCalendarModelStartDate.value = attributes.value[0].dates.start;
            weekCount(hourlyCalendarModelStartDate.value,hourlyCalendarModelEndDate.value);
            isSpinner.value = true;
            UserArray(hourlyCalendarModelStartDate.value,hourlyCalendarModelEndDate.value,props.projectId,props.companyId).then((obj)=>{
                if(obj && Object.keys(obj).length){
                    userArray.value = obj.userArray;
                    individualLogTime.value = obj.totalSumValue;
                    convertHours(obj.totalSumValue);
                    convertMintues(obj.totalSumValue);
                    hourMinutetotal.value = `${hours.value}h ${minute.value}m`;
                }else{
                    hours.value = "";
                    minute.value = "";
                    hourMinutetotal.value = "";
                }
                isSpinner.value = false;
            }).catch(() => {
                isSpinner.value = false;
            });
        });
    };
    const weekCount = (start,end) => {
        const currentMonth = moment(start);
        // Get the number of weeks in the current month
        let getYear = new Date(start).getFullYear()
        let numOfWeeksInMonth = null
        let lastMonthYear = moment(`${getYear}-12-31`)._i
        if(milestoneWeeklyRange.value === 'Mon - Sun'){
            if(new Date(end).setHours(0,0,0,0) === new Date(lastMonthYear).setHours(0,0,0,0)){
                const year = getYear;
                const firstDayOfYear = moment().year(year).startOf('year');
                const lastDayOfYear = moment().year(year).endOf('year');
                const daysInYear = lastDayOfYear.diff(firstDayOfYear, 'days') + 1;
                const weeksInYear = Math.floor(daysInYear / 7);
                numOfWeeksInMonth = weeksInYear + 1;
                let isLeapYear = (getYear % 4 === 0 && getYear % 100 !== 0) || (getYear % 400 === 0);
                if(moment(`${getYear}-01-01`).format('dddd') === 'Sunday' && isLeapYear){
                    numOfWeeksInMonth = weeksInYear + 2
                }
                formData.value.milestoneName.value = end.getMonth() === start.getMonth() ? `${months.value[start.getMonth()]} week ${numOfWeeksInMonth}` : `${months.value[start.getMonth()]} - ${months.value[end.getMonth()]} week ${numOfWeeksInMonth}`;
            }else{
                if(moment(`${getYear}-01-01`).format('dddd') === 'Sunday'){
                    if(moment(start).format('dddd') === 'Sunday'){
                        numOfWeeksInMonth = currentMonth.week();
                    }else{
                        numOfWeeksInMonth = currentMonth.week() + 1;
                    }
                }else{
                    numOfWeeksInMonth = currentMonth.week();
                }
                formData.value.milestoneName.value = end.getMonth() === start.getMonth() ? `${months.value[start.getMonth()]} week ${numOfWeeksInMonth}` : `${months.value[start.getMonth()]} - ${months.value[end.getMonth()]} week ${numOfWeeksInMonth}`;
            }
        }else{
            if(new Date(end).setHours(0,0,0,0) === new Date(lastMonthYear).setHours(0,0,0,0)){
                const year = getYear;
                const firstDayOfYear = moment().year(year).startOf('year');
                const lastDayOfYear = moment().year(year).endOf('year');
                const daysInYear = lastDayOfYear.diff(firstDayOfYear, 'days') + 1;
                const weeksInYear = Math.floor(daysInYear / 7);
                numOfWeeksInMonth = weeksInYear + 1;
                let isLeapYear = (getYear % 4 === 0 && getYear % 100 !== 0) || (getYear % 400 === 0);
                if(moment(`${getYear}-01-01`).format('dddd') === 'Saturday' && isLeapYear){
                    numOfWeeksInMonth = weeksInYear + 2
                }
                formData.value.milestoneName.value = end.getMonth() === start.getMonth() ? `${months.value[start.getMonth()]} week ${numOfWeeksInMonth}` : `${months.value[start.getMonth()]} - ${months.value[end.getMonth()]} week ${numOfWeeksInMonth}`;
                
            }else{
                if(moment(`${getYear}-01-01`).format('dddd') === 'Sunday'){
                    if(moment(start).format('dddd') === 'Sunday'){
                        numOfWeeksInMonth = currentMonth.week();
                    }else{
                        numOfWeeksInMonth = currentMonth.week() + 1;
                    }
                }else{
                    numOfWeeksInMonth = currentMonth.week();
                }
                formData.value.milestoneName.value = end.getMonth() === start.getMonth() ? `${months.value[start.getMonth()]} week ${numOfWeeksInMonth}` : `${months.value[start.getMonth()]} - ${months.value[end.getMonth()]} week ${numOfWeeksInMonth}`;
            }
        }
    };
    const handleEnter = (event) => {
        if (event.keyCode === 13){
            handleHourlyMilestone();
        }
    };
    const addKeyUpListener = () => {
        document.addEventListener("keyup", handleEnter);
    };
    const removeKeyUpListener = () => {
        document.removeEventListener("keyup", handleEnter);
    };
</script>
<style scoped>
.hourly__togglepophover-btn{
    width: 202px !important;
}
</style>
