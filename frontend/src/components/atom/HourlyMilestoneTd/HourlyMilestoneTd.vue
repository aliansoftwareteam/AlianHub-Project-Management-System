<template>
    <!-- milestoneName -->
    <td @click="permissionData ? emit('editMilestonetd','edit',props.hourlyMilestoneIndex,true) : '',permissionData ? props.focusInputForFix('milestonename',props.hourlyMilestoneIndex):''">
        <span class="dot text-capitalize" :title="props.milestoneArray.milestoneName">{{props.milestoneArray.milestoneName}}</span>
    </td>
    <!-- calendar -->
    <td>
        <div class="position-re">
            {{ $t('Milestone.date_range', { start: convertDateFormat(props.milestoneArray.startDate,'',{showDayName: false}), end: convertDateFormat(props.milestoneArray.endDate,'',{showDayName: false}) }) }}
            <DropDown id="user_detail" class="position-ab user_detail" v-if="props.userArray[props.milestoneArray._id] && props.userArray[props.milestoneArray._id].assigneeArray && props.userArray[props.milestoneArray._id].assigneeArray.length">
                <template #button>
                    <img :src="userinfo" alt="userinfo" />
                </template>
                <template #options>
                    <DropDownOption class="user_detail_mil" v-for="(ele,index) in (props.userArray[props.milestoneArray._id].assigneeArray)" :key="index">
                        <div class="d-flex align-items-center justify-content-between user__detail-miloption">
                            <div class="d-flex align-items-center">
                                <span>
                                    <UserProfile
                                        :data="{
                                            image: getUser(ele.id).Employee_profileImageURL, 
                                            title: getUser(ele.id).Employee_Name
                                        }"
                                        :showDot="false"
                                        width="30px"
                                        :thumbnail="'30x30'"
                                    />
                                </span>
                                <span class="user_name_family">{{getUser(ele.id).Employee_Name}}</span>
                            </div>
                            <div>
                                <span class="user_name_minute_family">{{convertMintuesToHours(ele.individualLogTime)}}</span>
                            </div>
                        </div>
                    </DropDownOption>
                </template>
            </DropDown>
        </div>
    </td>
    <!-- loggedHours -->
    <td @click="permissionData ? emit('editMilestonetd','edit',props.hourlyMilestoneIndex,true) : '',permissionData ? props.focusInputForFix('hours',props.hourlyMilestoneIndex):''">
        {{props.userArray[props.milestoneArray._id] ? !props.userArray[props.milestoneArray._id].loggedHours ? `0h 0m` : convertMintuesToHours(props.userArray[props.milestoneArray._id].loggedHours):'0h 0m'}}
    </td>
    <!-- hours and minute -->
    <td @click="permissionData ? emit('editMilestonetd','edit',props.hourlyMilestoneIndex,true) : '',permissionData ? props.focusInputForFix('hours',props.hourlyMilestoneIndex):''">
        {{props.milestoneArray.hours}}h {{props.milestoneArray.minute}}m
    </td>
    <!-- amountPerHours -->
    <td @click="permissionData ? emit('editMilestonetd','edit',props.hourlyMilestoneIndex,true) : '',permissionData ? props.focusInputForFix('amountperhours',props.hourlyMilestoneIndex):''">
        {{currencyMilestone.symbol}} {{props.milestoneArray.amountPerHours}}
    </td>
    <!-- amount -->
    <td>
        <div>
            <div class="d-flex align-items-center">
                <span @click="permissionData ? $emit('editMilestonetd','edit',props.hourlyMilestoneIndex,true) : '',permissionData ? focusInputForFix('amount',props.hourlyMilestoneIndex) : ''" :class="[{'paymentcancelled':props.milestoneArray.statusArray && props.milestoneArray.statusArray.length > 0 ? props.milestoneArray.statusArray[props.milestoneArray.statusArray.length - 1].milestoneStatusColor.includes('CANCELLED'):''}]">{{currencyMilestone.symbol}} {{getCommaSeperatedNumber(props.milestoneArray.amount)}}</span>
                <DropDown v-if="props.milestoneArray.refundedAmount && props.milestoneArray.refundedAmount.length" id="amonut_history" class="status_change_dropdown">
                    <template #button>
                        <button class="cursor-pointer dot-btn border-0">
                            <img v-if="props.planCondition" :src="detaildropdown" alt="detaildropdown" class="left_space_wrapper" />
                        </button>
                    </template>
                    <template #options>
                        <DropDownOption v-if="props.milestoneArray.refundedAmount && props.milestoneArray.refundedAmount.length">
                            <div>
                                <div class="border-bottom-black">
                                    <span class="d-block dropdown_span" v-for="(temp,ind) in props.milestoneArray.refundedAmount" :key="ind">
                                        {{currencyMilestone.symbol}} {{getCommaSeperatedNumber(temp.amount)}} {{$t('Milestone.partially_refunded')}}
                                    </span>
                                </div>
                                <div class="border-bottom-black">
                                    <span class="d-block dropdown_span">{{currencyMilestone.symbol}} {{getCommaSeperatedNumber(refundedTotalValue(props.milestoneArray.refundedAmount,props.milestoneArray.amount))}}
                                        <span v-if="(props.milestoneArray?.refundedAmount && props.milestoneArray.refundedAmount?.length > 0 ? Number(refundedTotalValue(props.milestoneArray.refundedAmount,props.milestoneArray.amount)) : '') === (props.milestoneArray.amount)">{{$t('Milestone.all_amount_refunded')}}</span>
                                        <span v-else>{{$t('Milestone.total_partially_refunded')}}</span>
                                    </span>
                                </div>
                                <div class="border-bottom-black">
                                    <span class="d-block dropdown_span">{{currencyMilestone.symbol}} {{getCommaSeperatedNumber(props.milestoneArray.amount)}}  ({{$t('Milestone.actual_amount')}})</span>
                                    <span class="d-block dropdown_span">{{currencyMilestone.symbol}} {{'-'}} {{getCommaSeperatedNumber(refundedTotalValue(props.milestoneArray.refundedAmount,props.milestoneArray.amount))}} ({{$t('Milestone.refund_amount')}})</span>
                                </div>
                                <span class="d-block">{{currencyMilestone.symbol}} {{getCommaSeperatedNumber(refundedTotal(props.milestoneArray.refundedAmount,props.milestoneArray.amount))}}</span>
                            </div>
                        </DropDownOption>
                    </template>
                </DropDown>
            </div>
            <div v-if="props.milestoneArray.refundedAmount && props.milestoneArray.refundedAmount.length">{{`( - ${refundedTotalValue(props.milestoneArray.refundedAmount)})`}}</div>
        </div>
        <div class="refund_padding_top webkit_wrapper_milestone" v-if="props.milestoneArray._id === refundId">
            <div class="pr-5px">
                <InputText
                    v-model.number="formDataRefund.refundAmount.value"
                    type="number"
                    :id="`amountvalue${props.hourlyMilestoneIndex}`"
                    :placeHolder="$t('PlaceHolder.Enter_Refund_Amount')"
                    :inputId="`amountvalue`+props.hourlyMilestoneIndex"
                    @keyup="checkErrors({'field':formDataRefund.refundAmount,
                        'name':'refundamount',
                        'validations':formDataRefund.refundAmount.rules,
                        'type':formDataRefund.refundAmount.type,
                        'event':$event.event
                    }),handleValidation(props.milestoneArray.refundedAmount,props.milestoneArray.amount)"
                    @input="handleInputNum()"
                    @keypress="onlyNumber($event.event)"
                    min="1"
                ></InputText>
                <small class="red" v-if="formDataRefund.refundAmount.error">{{formDataRefund.refundAmount.error}}</small>
                <small class="red" v-if="error.amount">{{$t(`Milestone.${error.amount.replaceAll(' ',"_")}`)}}</small>
            </div>
            <div>
                <MilestoneDate :id="`refundDate${props.hourlyMilestoneIndex}`" :inputId="`refundDate`+props.hourlyMilestoneIndex"
                    :displyDate="refundDate"
                    :isShowDateAndicon="true"
                    :minDate="''"
                    :maxDate="''"
                    @SelectedDate="($event) => updateRefundDate($event)"
                    :calenderImage="true"
                    :InputDesign="true" 
                ></MilestoneDate>
            </div>
        </div>
    </td>
    <!-- status -->
    <td>
        <div v-if="props.milestoneArray.statusArray && props.milestoneArray.statusArray.length > 0" class="d-flex align-items-center">
            <template v-for="(statusValue,index) in props.settingStatus" :key="index">
                <div @click="permissionData ? $emit('editMilestonetd','edit',props.hourlyMilestoneIndex,true):'',permissionData ? props.focusInputForFix('status',props.hourlyMilestoneIndex) : '',permissionData ? options.length === 0 ? emit('isVisible',false) : emit('isVisible',true) : ''" v-if="props.milestoneArray.statusArray[props.milestoneArray.statusArray.length - 1].milestoneStatusColor === statusValue.value" :key="index" class="tablelabel status_dot_value" :style="[{'background-color': statusValue.backgroundColor ? statusValue.backgroundColor : 'transparent' , 'color':'white'}]">
                    <span :title="statusValue.name" class="Dot_Change">{{statusValue.name}}</span>
                </div>
            </template>
            <div class="statushistory">
                <DropDown id="fix_milestone_status_dropdown" class="status_change_dropdown">
                    <template #button>
                        <button class="cursor-pointer dot-btn border-0">
                            <img v-if="props.planCondition" :src="statushistory" alt="statushistory" @click="props.planCondition ? $emit('valueBody',true) : $emit('valueBody',false)">
                        </button>
                    </template>
                    <template #options>
                        <DropDownOption class="border_bottom_status" v-for="(name,index) in props.milestoneArray.statusArray" :key="index">
                            <template v-for="(statusValue,index) in props.settingStatus" :key="index">
                                <span v-if="statusValue.value === name.milestoneStatusColor" :style="[{'background-color': statusValue.backgroundColor ? statusValue.backgroundColor : 'transparent' , 'color':'white','padding': '5px','border-radius': '5px'}]" class="Dot_Change">{{statusValue.name}}</span>
                                <span v-if="statusValue.value === name.milestoneStatusColor" class="status_date_value">{{convertDateFormat(name.statusDateValue,'',{showDayName: false})}}</span>
                            </template>
                        </DropDownOption>
                    </template>
                </DropDown>
            </div>
        </div>
        <div class="newstatus" v-else @click="permissionData ? $emit('editMilestonetd','edit',props.hourlyMilestoneIndex,true) : '',permissionData ? props.focusInputForFix('status',props.hourlyMilestoneIndex) : '',permissionData ? emit('isVisible',true) : ''">
            {{$t('Milestone.add_new')}} {{$t('ProjectDetails.status')}}
        </div>
    </td>
    <!-- statusDate -->
    <td @click="permissionData ? $emit('editMilestonetd','edit',props.hourlyMilestoneIndex,true) : '',permissionData ? focusInputForFix('statusDate',props.hourlyMilestoneIndex) : ''">
        {{props.milestoneArray.statusArray && props.milestoneArray.statusArray?.length ?
            convertDateFormat(props.milestoneArray.statusArray[props.milestoneArray.statusArray.length - 1].statusDateValue,'',{showDayName: false}) :
            '-'
        }}
    </td>
    <!-- action -->
    <td>
        <div class="d-flex align-items-center justify-content-end">
            <div>
                <span v-if="props.milestoneArray.statusArray && props.milestoneArray.statusArray.length ? props.milestoneArray.statusArray[props.milestoneArray.statusArray.length - 1].milestoneStatusColor.includes('RELEASED'):''">
                    <span class="refund_cancel_font cancel_refund" v-if="(props.milestoneArray?.refundedAmount && props.milestoneArray.refundedAmount?.length > 0 ? Number(refundedTotalValue(props.milestoneArray.refundedAmount,props.milestoneArray.amount)) : '') !== (props.milestoneArray.amount)" @click="permissionData ? refundIndex(props.milestoneArray._id) : ''">{{$t('Milestone.refund')}}</span>
                </span>
                <span v-else>
                    <span class="refund_cancel_font cancel_refund" v-if="props.milestoneArray.statusArray && props.milestoneArray.statusArray.length > 0 ? !props.milestoneArray.statusArray[props.milestoneArray.statusArray.length - 1].milestoneStatusColor.includes('CANCELLED'):''" @click="permissionData ? props.planCondition ? $emit('editMilestonetd','cancelstatus',props.hourlyMilestoneIndex,true,props.milestoneArray) : '' : ''">{{$t('Projects.cancel')}}</span>
                </span>
            </div>
            <img :src="deleteMilestone" class="cursor-pointer" alt="delete" v-if="permissionData" @click="permissionData ? props.planCondition ? $emit('deleteMilestoneEmit',props.hourlyMilestoneIndex,props.milestoneArray.milestoneName) : '' : ''">
        </div>
        <div :class="[{'refund_amount_empty':!(props.milestoneArray.refundedAmount && props.milestoneArray.refundedAmount.length)}]" class="refund_wrapper" v-if="props.milestoneArray._id === refundId">
            <img :src="saveImage" alt="save" class="refund_delete" @click="permissionData ? handleSaveRefund() : ''">
            <img :src="deleteImage" alt="deleteedit" @click="permissionData ? refundIndex('') : ''">
        </div>
    </td>
</template>

<script setup>
    const deleteMilestone = require('@/assets/images/svg/DeleteMilestone.svg');
    import { defineProps, ref,defineEmits,onMounted,onUnmounted } from 'vue';
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    import DropDown from '@/components/molecules/DropDown/DropDown.vue';
    import { useConvertDate } from "@/composable";
    import { useValidation } from "@/composable/Validation";
    import { ValidationFunction } from "@/composable/DefaultValidationFunction";
    import InputText from '@/components/atom/InputText/InputText.vue';
    import { useGetterFunctions } from "@/composable";
    import MilestoneDate from '@/components/molecules/FixMilestoneDate/FixMilestoneDate.vue';
    import UserProfile from '../UserProfile/UserProfile.vue';
    const {getUser} = useGetterFunctions();
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();
    const  { checkErrors,checkAllFields } = useValidation();
    const { convertDateFormat } = useConvertDate();
    const statushistory = require('@/assets/images/svg/statushistory.svg');
    // props
    const props = defineProps({
        permissionData:{type: Boolean,default: false},
        milestoneArray:{type:Object,required:true},
        settingStatus : {type:Array,required:true},
        hourlyMilestoneIndex:{type:Number,required:true},
        focusInputForFix : {type:Function,required:true},
        refundId : {type:String,default:''},
        currencyMilestone:{type:Object,required:true},
        options : {type:Array,required:true},
        userArray:{type:Object,default:(()=>{})},
        planCondition : {type:Boolean,default: false}
    });

    // variable
    const deleteImage = require('@/assets/images/delete1.png');
    const saveImage = require('@/assets/images/save.png');
    const detaildropdown = require('@/assets/images/svg/detaildropdown.svg');
    const userinfo = require('@/assets/images/userinfo.png');
    const formDataRefund = ref({refundAmount: {type: 'number',name: 'refundamount',value: '',rules: "required"}});
    const error = ref({amount: ''});
    const refundDate = ref(new Date());

    //emit
    const emit = defineEmits(['editMilestonetd','saveRefundEmit','setRefundIdTr','deleteMilestoneEmit','isVisible','valueBody']);
    const getCommaSeperatedNumber = (n)=> {
        let numVal = Number(n)
        return numVal.toLocaleString('en-US', {maximumFractionDigits: 2, minimumFractionDigits: 2, useGrouping: true});
    };
    // total refund amount calculation
    const refundedTotalValue = (refunded) =>{
        var refundedValue = 0;
        if(refunded && refunded.length > 0){
            refunded.forEach(element => {
                refundedValue += Number(element.amount)
            });
            return Number(refundedValue);
        }else{
            return Number(refundedValue);
        }
    };
    // individual milestone refund amount calculation 
    const refundedTotal = (refunded,totalamount) => {
        var refundedValue = 0
        if(refunded){
            refunded.forEach(element => {
                refundedValue += Number(element.amount)
            });
            return Number(totalamount - refundedValue)
        }
    };
    // Only Number
    const onlyNumber = (event) => {
        ValidationFunction.onlyNumberMilestone(event);
    };
    const handleInputNum = () => {
        if(formDataRefund.value.refundAmount.value === 0 || formDataRefund.value.refundAmount.value === ''){
            formDataRefund.value.refundAmount.value = '';
        }
    };
    // validation
    const handleValidation = (refund,amount) => {
        let refundedAmount = 0
        refundedAmount = Number(refundedTotalValue(refund)) + Number(formDataRefund.value.refundAmount.value);
        const value = Number(refundedAmount);
        let val = String(value).split(".");
        if(refundedAmount > amount){
            return error.value.amount = t('Milestone.refunded_amount_should_not_exceed_amount');
        }
        else if(val[1]?.length > 2){
            return error.value.amount = t('Milestone.Max_2_decimal_places_allowed');
        }
        else{
            return error.value.amount = ''
        }
    };
    // save refund
    const handleSaveRefund = () =>{
        if(props.planCondition){
            checkAllFields(formDataRefund.value).then((valid)=>{
                if(valid && error.value.amount === ''){
                    emit('saveRefundEmit','refund',props.hourlyMilestoneIndex,formDataRefund.value.refundAmount.value,refundDate.value);
                    formDataRefund.value.refundAmount.value = '';
                    refundDate.value = new Date();
                }
            });
        }
    };
    // calendar 
    const updateRefundDate = (value) => {
        refundDate.value = value.dateVal;
    };
    // refund index
    const refundIndex = (index) => {
        if(props.planCondition){
            emit("setRefundIdTr", index);
            formDataRefund.value.refundAmount.error = '';
            formDataRefund.value.refundAmount.value = '';
            error.value.amount = '';
        }
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
        if(props.planCondition){
            if (event.keyCode === 13){
                handleSaveRefund();
            }
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
<style>
.user_detail{
   right: 10px !important;
   top: 0 !important;
}
.user__detail-miloption{
   width:322px !important;
}
</style>