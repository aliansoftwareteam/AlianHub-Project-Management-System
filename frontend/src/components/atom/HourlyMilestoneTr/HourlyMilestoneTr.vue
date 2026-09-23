<template>
    <tr class="fixMilestone_wrapper_tr" :class="[{'cursor-pointer':props.permission}]" v-if="props.edithourlyMilestone !== props.hourlyMilestoneIndex">
        <HourlyMilestoneTd
            :permissionData="props.permission"
            :milestoneArray="props.milestoneArray"
            :settingStatus="props.settingMilestoneStatus"
            :currencyMilestone="props.currency"
            :hourlyMilestoneIndex="props.hourlyMilestoneIndex"
            :refundId="props.refundId"
            :focusInputForFix="focusInputForFix"
            :options="options"
            :userArray="props.userArray"
            @editMilestonetd="handleEditEmitMilestone"
            @isVisible="handleStatusVisible"
            @saveRefundEmit="saveRefund"
            @setRefundIdTr="refundIndex"
            @deleteMilestoneEmit="handleDeleteEmit"
            :planCondition="props.planCondition"
        />
    </tr>
    <div :class="[{'cursor-pointer':props.permission}]" class="d-content" v-else>
        <tr>
            <!-- milestoneName -->
            <td>
                <div class="hourly-milestone-input">
                    <InputText v-model.trim="formData.milestoneName.value" type="text" :id="`milestonename${hourlyMilestoneIndex}`" :placeHolder="$t('PlaceHolder.Enter_Milestone_Name')"
                        :inputId="`milestonename`+hourlyMilestoneIndex"
                        @keyup="checkErrors({'field':formData.milestoneName,'name':'name','validations':formData.milestoneName.rules,'type':formData.milestoneName.type,'event':$event.event})"
                    ></InputText>
                    <small class="red" v-if="formData.milestoneName.error">{{formData.milestoneName.error}}</small>
                </div>
            </td>
            <!-- startdate and endDate -->
            <td class="padding_top_cal">{{ $t('Milestone.date_range', { start: convertDateFormat(props.milestoneArray.startDate,'',{showDayName: false}), end: convertDateFormat(props.milestoneArray.endDate,'',{showDayName: false}) }) }}</td>
            <!-- loggedHours -->
            <td class="padding_top_cal">{{props.userArray[props.milestoneArray._id] ? !props.userArray[props.milestoneArray._id].loggedHours ? `0h 0m` : convertMintuesToHours(props.userArray[props.milestoneArray._id].loggedHours):''}}</td>
            <td>
                <div>
                    <div class="d-flex align-items-center">
                    <!-- hours -->
                        <InputText
                            :modelValue="hours"
                            @update:modelValue="val => hours = val.toString()"
                            type="number"
                            :id="`hours`+hourlyMilestoneIndex"
                            :placeHolder="$t('Milestone.hh_placeholder')"
                            :inputId="`hours`+hourlyMilestoneIndex"
                            @input="hours = hours.replace(/^0/g, '')"
                            @keypress="onlyNumberHour($event.event)"
                            @keyup="validationcheck(),calculateAmount()"
                            min="1"
                            @keydown="reverseChange = false"
                            class="hourminutes minutesMilestone"
                        ></InputText>
                        <div>:</div>
                        <!-- minute -->
                        <InputText
                            :modelValue="minute"
                            @update:modelValue="val => minute = val.toString()"
                            type="number"
                            :id="`minute`+hourlyMilestoneIndex"
                            :placeHolder="$t('Milestone.mm_placeholder')"
                            :inputId="`minute`+hourlyMilestoneIndex"
                            @input="minute = minute.replace(/^0/g, '')"
                            @keypress="onlyNumberHour($event.event)"
                            @keyup="validationcheck(),calculateAmount()"
                            min="1"
                            @keydown="reverseChange = false"
                            class="hourminutes minutesMilestone"
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
                        :id="`amountPerHours`+hourlyMilestoneIndex"
                        :placeHolder="$t('PlaceHolder.Enter_Amount')"
                        :inputId="`amountPerHours`+hourlyMilestoneIndex"
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
                        :id="`amount`+hourlyMilestoneIndex"
                        :placeHolder="$t('PlaceHolder.Enter_Amount')"
                        :inputId="`amount`+hourlyMilestoneIndex"
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
                    ></InputText>
                </div>
                <small class="red" v-if="formData.amount.error">{{formData.amount.error}}</small>
                <small class="red" v-if="err">{{$t(`Milestone.${err.replaceAll(' ',"_")}`)}}</small>
            </td>
            <td></td>
            <td></td>
            <!-- action -->
            <td>
                <div class="d-flex align-items-center refund-delete-image">
                    <img :src="saveIcon" alt="save" class="refund_delete" @click="handleFixMilestoneEdit">
                    <img :src="deleteIcon" alt="deleteedit" @click="editMilestoneValue,$emit('editMilestone','clear',hourlyMilestoneIndex,false)">
                </div>
            </td>
        </tr>
        <!-- status -->
        <tr>
            <td colspan="6"></td>
            <td colspan="3" class="border_left_status">
                <div class="clear_status" v-if="props.milestoneArray.statusArray.length">
                    <span @click="$emit('editMilestone','clearStatus',hourlyMilestoneIndex,false,props.milestoneArray)">{{$t('Filters.clearall')}} {{$t('ProjectDetails.status')}}</span>
                </div>
                <div class="hourly_wrapper">
                    <div class="d-flex align-items-center hourly_wrapper_value" v-if="options.length !== 0">
                        <div class="multiple_status padding_status">
                            <InputText v-model="status" type="text" :id="`status${hourlyMilestoneIndex}`" :placeHolder="$t('PlaceHolder.Select')"
                                :inputId="`status`+hourlyMilestoneIndex"
                                isReadonly
                                @click="isVisible = true"
                                @focus="isVisible = true"
                            ></InputText>
                        </div>
                        <div class="multiple_status_date padding_status">
                            <MilestoneDate v-if="status" :id="`statusDate${hourlyMilestoneIndex}`" :inputId="`statusDate`+hourlyMilestoneIndex"
                                :displyDate="statusDate ? statusDate : ''"
                                :isShowDateAndicon="true"
                                :minDate="statusObj.isFuture === true ? statusObj.isFuture === true && statusObj.isPast === true ? '' : new Date() : statusObj.isFuture === false && statusObj.isPast === false ? new Date() : ''"
                                :maxDate="statusObj.isPast === true ? statusObj.isFuture === true && statusObj.isPast === true ? '' : new Date() : statusObj.isPast === false && statusObj.isFuture === false ? new Date() : ''"
                                @SelectedDate="($event) => updateStatusDate($event)"
                                :calenderImage="true"
                                :InputDesign="true"
                            ></MilestoneDate>
                        </div>
                    </div>
                    <div v-if="statusArrayMilestone && statusArrayMilestone.length">
                        <div class="hourly_wrapper_value" v-for="(status,statusindex) in statusArrayMilestone" :key="statusindex">
                            <div class="d-flex align-items-center" v-for="(settingStatusValue ,settingIndex) in settingStatus.filter(info => info.value === status.milestoneStatusColor)" :key="settingIndex">
                                <div class="multiple_status" :style="{backgroundColor:settingStatusValue.backgroundColor,color:'#fff'}">{{settingStatusValue.name}}</div>
                                <MilestoneDate
                                    :id="`allStatus${hourlyMilestoneIndex}`"
                                    :displyDate="status.statusDateValue"
                                    :isShowDateAndicon="true"
                                    :minDate="settingStatusValue.isFuture === true ? settingStatusValue.isFuture === true && settingStatusValue.isPast === true ? '' : new Date() : settingStatusValue.isFuture === false && settingStatusValue.isPast === false ? new Date() : ''"
                                    :maxDate="settingStatusValue.isPast === true ? settingStatusValue.isFuture === true && settingStatusValue.isPast === true ? '' : new Date() : settingStatusValue.isPast === false && settingStatusValue.isFuture === false ? new Date() : ''"
                                    @SelectedDate="($event) => updateStatusDateArray($event,statusindex)"
                                    class="multiple_status_date"
                                    :calenderImage="true"
                                    :InputDesign="true"
                                ></MilestoneDate>
                            </div>
                        </div>
                    </div>
                </div>
            </td>
        </tr>
        <Sidebar className="task-milestone-status-sidebar" v-model:visible="isVisible" :title="$t('Milestone.mileston_status')" :listenKeys="true" :enable-search="true" :options="options" @selected="selectedObj($event)"></Sidebar>
    </div>
</template>

<script setup>
    import HourlyMilestoneTd from "../HourlyMilestoneTd/HourlyMilestoneTd.vue";
    import { ValidationFunction } from "@/composable/DefaultValidationFunction";
    import InputText from '@/components/atom/InputText/InputText.vue';
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    import { useValidation } from "@/composable/Validation";
    import { defineProps,ref,defineEmits,computed,onUnmounted,onMounted } from 'vue';
    import MilestoneDate from '@/components/molecules/FixMilestoneDate/FixMilestoneDate.vue';
    import { useConvertDate } from "@/composable";
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();

    const { convertDateFormat } = useConvertDate();
    const  { checkErrors,checkAllFields } = useValidation();

    // emit
    const emit = defineEmits(['editMilestone','deleteMilestone', 'setRefundId']);

    // props
    const props = defineProps({
        permission:{type: Boolean,default: false},
        milestoneArray:{type:Object,required:true},
        settingMilestoneStatus:{type:Array,required:true},
        edithourlyMilestone : {type:Number,required:true},
        hourlyMilestoneIndex:{type:Number,required:true},
        currency:{type:Object,required:true},
        refundId: {type: String,default: ''},
        userArray:{type:Object,default:(()=>{})},
        planCondition : {type:Boolean,default: false}
    });

    // variable
    const settingStatus = ref(props.settingMilestoneStatus);
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
    const hours = ref('');
    const minute = ref('');
    const reverseChange = ref(false);
    const error = ref('');
    const isVisible = ref(false);
    const deleteIcon = require("@/assets/images/delete1.png");
    const saveIcon = require("@/assets/images/save.png");
    const milestoneStatusArray = ref(props.settingMilestoneStatus);
    const status = ref('');
    const statusArrayMilestone = ref([]);
    const statusObj = ref({});
    const startDate = ref('');
    const endDate = ref('');
    const milestoneId = ref('')
    const statusDate = ref(new Date());
    const refundedAmount = ref('');
    const err = ref('');
    const errAmountPer = ref('');
    // focus input
    const focusInputForFix = (value,index) => {
        if(props?.planCondition){
            editMilestoneValue();
            if(value === 'milestonename'){
                setTimeout(() => {document.getElementById(`milestonename${index}`).focus();});
            }
            if(value === 'hours'){
                setTimeout(() => {document.getElementById(`hours${index}`).focus();});
            }
            if(value === 'amountperhours'){
                setTimeout(() => {document.getElementById(`amountPerHours${index}`).focus();});
            }
            if(value === 'amount'){
                setTimeout(() => {document.getElementById(`amount${index}`).focus();});
            }
            if(value === 'status' && options.value.length !== 0){
                setTimeout(() => {document.getElementById(`status${index}`).focus();});
            }
        }
    };
    const handleEditEmitMilestone = (type,index,edit,value) => {
        emit('editMilestone',type,index,edit,value);
    };
    const onlyNumberHour = (event) => {
        let keyCode = event.keyCode ? event.keyCode : event.which;
        if ((keyCode < 48 || keyCode > 57)) {
            event.preventDefault();
        }
    };
    const totalHours = ()=>{
        return Number(hours.value) * Number(formData.value.amountPerHours.value);
    };
    const totalminutes = () => {
        return Number(minute.value/60) * Number(formData.value.amountPerHours.value)
    };
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
        handleInputNumValidation('')
        return formData.value.amount.value;
    };
    const reverseTotal = () => {
        return Number(formData.value.amount.value)/Number(hours.value);
    };
    const reverseMintueTotal = () => {
        let minuteConvert = Number(minute.value/60)
        let totalAmountValue = Number(hours.value) + Number(minuteConvert) 
        let reverseTotalNum = Number(formData.value.amount.value)/Number(totalAmountValue)
        return reverseTotalNum
    };
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
    const onlyNumber = (event) => {
        ValidationFunction.onlyNumberMilestone(event);
    };
    const handleInputVal = () => {
        if(formData.value.amount.value){
            const value = Number(formData.value.amount.value);
            let val = String(value).split(".");
            if(val[1]?.length > 2){
                err.value = t('Milestone.Max_2_decimal_places_allowed');
            }else{
                err.value = "";
            }
        }
    };
    const handleInputNumValidation = () => {
        if(props.milestoneArray?.refundedAmount && props.milestoneArray.refundedAmount.length){
            var refundedValue = 0;
            props.milestoneArray.refundedAmount.forEach(element => {
                refundedValue += Number(element.amount)
            });
            Number(refundedValue);
            if(refundedValue > formData.value.amount.value){
                err.value = t('Milestone.field_should_not_be_smaller_than_refund_amount');
            }else{
                err.value = ""
            }
        }
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
            if(props.milestoneArray?.refundedAmount && props.milestoneArray.refundedAmount.length){
                var refundedValue = 0;
                props.milestoneArray.refundedAmount.forEach(element => {
                    refundedValue += Number(element.amount)
                });
                Number(refundedValue);
                if(refundedValue > formData.value.amount.value){
                    err.value = t('Milestone.field_should_not_be_smaller_than_refund_amount');
                }else{
                    err.value = ""
                    handleInputVal();
                }
            }else if(formData.value.amount.value){
                handleInputVal();
            }
            if(formData.value.amount.value === 0 || formData.value.amount.value === ''){
                formData.value.amount.value = '';
                err.value = "";
            }
        }
    };
    const validationcheck = () => {
        if (((hours.value === '' && minute.value) && (hours.value && minute.value === '')) || (hours.value === '' && minute.value === '')) {
            error.value = t('Milestone.The_hours_field_is_required');
        } else if (minute.value > 59){
            error.value = t('Milestone.The_minute_field_must_be_59_or_less');
        } else {
            error.value = '';
        }
    };
    // sidebar options
    const options = computed(() => {
        if(props.milestoneArray.statusArray && props.milestoneArray.statusArray.length){
            const filteredStatusValues = props.milestoneArray.statusArray.map(element => element.milestoneStatusColor);
            return milestoneStatusArray.value.filter(status => !filteredStatusValues.includes(status.value) && status.value !== 'CANCELLED' && status.value !== 'REFUNDED').map(status => ({
                ...status,
                label: status.name
            }));
        }else{
            return milestoneStatusArray.value.filter(status => status.value !== 'CANCELLED' && status.value !== 'REFUNDED').map((status) => {
                return {
                    ...status,
                    label: status.name
                }
            });
        }
    });
    const selectedObj = (val) => {
        statusObj.value = val;
        status.value = val.name;
        statusDate.value = new Date();
    };
    const updateStatusDate = (val) => {
        statusDate.value = val.dateVal;
    };
    // edit milestone value
    const editMilestoneValue = (() => {
        formData.value.milestoneName.error = '';
        formData.value.amount.error = '';
        formData.value.amountPerHours.error = '';
        formData.value.milestoneName.value = (props.milestoneArray.milestoneName);
        startDate.value = (props.milestoneArray.startDate ? props.milestoneArray.startDate.seconds ? new Date(props.milestoneArray.startDate.seconds * 1000) : new Date(props.milestoneArray.startDate) : '');
        endDate.value = (props.milestoneArray.endDate ? props.milestoneArray.endDate.seconds ? new Date(props.milestoneArray.endDate.seconds * 1000) : new Date(props.milestoneArray.endDate) : props.milestoneArray.endDate);
        formData.value.amount.value = (props.milestoneArray.amount).toString();
        statusArrayMilestone.value = JSON.parse(JSON.stringify(props.milestoneArray.statusArray));
        milestoneId.value = props.milestoneArray._id;
        refundedAmount.value = props.milestoneArray.refundedAmount;
        formData.value.amountPerHours.value = (props.milestoneArray.amountPerHours).toString();
        hours.value = props.milestoneArray.hours ? props.milestoneArray.hours !== 0 ? (props.milestoneArray.hours).toString() : '':'';
        minute.value = props.milestoneArray.minute ? props.milestoneArray.minute !== 0 ? (props.milestoneArray.minute).toString() : '':'';
        status.value = '';
        statusObj.value = {};
        errAmountPer.value = "";
        err.value = "";
    });
    // clear milestone value
    const handleClearMilestone = () => {
        formData.value.amount.value ='';
        formData.value.milestoneName.value = '';
        formData.value.amountPerHours.value ='';
        startDate.value = '';
        endDate.value = '';
        status.value = '';
        statusDate.value = '';
        minute.value='';
        hours.value='';

    };
    // edit milestone value emit
    const handleFixMilestoneEdit = () =>{
        checkAllFields(formData.value).then((valid)=>{
            if(valid && err.value === '' && errAmountPer.value === ''){
                if(status.value){
                    delete statusObj.value.milestoneStatusDate;
                    statusArrayMilestone.value.push({
                        statusDateValue: statusDate.value,
                        milestoneStatusColor:statusObj.value.value
                    });
                }
                const obj = {
                    milestoneName: formData.value.milestoneName.value,
                    startDate: startDate.value,
                    endDate: endDate.value,
                    amount: Number(formData.value.amount.value),
                    amountPerHours: Number(formData.value.amountPerHours.value),
                    hours:Number(hours.value),
                    minute:Number(minute.value),
                    statusArray:statusArrayMilestone.value,
                    id:milestoneId.value,
                    refundedAmount:refundedAmount.value,
                    createdAt:props.milestoneArray.createdAt,
                    minRefundDate:props.milestoneArray.minRefundDate ? props.milestoneArray.minRefundDate : '',
                    maxRefundDate:props.milestoneArray.maxRefundDate ? props.milestoneArray.maxRefundDate : ''
                };
                emit('editMilestone','editMil',obj,props.hourlyMilestoneIndex,status.value ? {...statusObj.value,statusDate: statusDate.value} : '',props.milestoneArray);
                handleClearMilestone();
            }
        })
    };
    const handleStatusVisible = (value) => {
        isVisible.value = value;
    };
    // save milestone value emit
    const saveRefund = (type,index,edit,date) => {
        emit('editMilestone',type,index,edit,date);
        refundIndex('');
        handleClearMilestone();
    };
    const refundIndex = (index) => {
        emit("setRefundId", index);
    };
    const handleDeleteEmit = (type,index) => {
        emit('deleteMilestone',type,index);    
    };
    const updateStatusDateArray = (val,index) => {
        statusArrayMilestone.value[index].statusDateValue = val.dateVal;
    };
    // convertMintuesToHours
    const convertMintuesToHours = (sum) => {
        var num = sum;
        var hours = (num / 60);
        var rhours = Math.floor(hours);
        var minutes = (hours - rhours) * 60;
        var rminutes = Math.round(minutes);
        return rhours.toString().padStart(1, '0') + 'h ' + rminutes.toString().padStart(2, '0') + 'm';
    };
    const handleEnter = (event) => {
        if (event.keyCode === 13 && props.edithourlyMilestone !== 0.1){
            handleFixMilestoneEdit();
        }
    };
    const addKeyUpListener = () => {
        document.addEventListener("keyup", handleEnter);
    };
    const removeKeyUpListener = () => {
        document.removeEventListener("keyup", handleEnter);
    };
    onMounted(() => {
        addKeyUpListener();
    });
    onUnmounted(() => {
        removeKeyUpListener();
    });
</script>