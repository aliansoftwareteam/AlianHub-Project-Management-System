<template>
    <td v-if="props.editfixMilestone === 0.1 && permissionData">
        <img :src="draggable" alt="draggableimage" class="image_icon_fix">
    </td>
    <td v-if="props.editfixMilestone !== 0.1 || !permissionData"></td>
    <!-- milestoneName -->
    <td @click="permissionData ? emit('editMilestonetd','edit',fixMilestoneIndex,true) : '',permissionData?focusInputForFix('milestonename',fixMilestoneIndex,'milestonename'):''">
        <span class="Dot_Change text-capitalize milestone__name" :title="fixMilestoneProps.milestoneName">{{fixMilestoneProps.milestoneName}}</span>    
    </td>
    <!-- startDate -->
    <td @click="permissionData ? $emit('editMilestonetd','edit',fixMilestoneIndex,true) : '',permissionData ? focusInputForFix('start',fixMilestoneIndex,'start'):''">
        {{fixMilestoneProps.startDate ? convertDateFormat(fixMilestoneProps.startDate,'',{showDayName: false}) : '-'}}
    </td>
    <!-- endDate -->
    <td @click="permissionData ? $emit('editMilestonetd','edit',fixMilestoneIndex,true) : '',permissionData ? focusInputForFix('end',fixMilestoneIndex,'end') : ''">
        {{fixMilestoneProps.endDate ? convertDateFormat(fixMilestoneProps.endDate,'',{showDayName: false}) : '-'}}
    </td>
    <!-- dueDate -->
    <td @click="permissionData ? $emit('editMilestonetd','edit',fixMilestoneIndex,true):'',permissionData?focusInputForFix('due',fixMilestoneIndex,'due'):''">
        {{fixMilestoneProps.dueDate ? convertDateFormat(fixMilestoneProps.dueDate,'',{showDayName: false}) : '-'}}
    </td>
    <!-- amount -->
    <td>
        <div>
            <div class="d-flex align-items-center">
                <span @click="permissionData ? $emit('editMilestonetd','edit',fixMilestoneIndex,true) : '',permissionData ? focusInputForFix('amount',fixMilestoneIndex,'amount') : ''" :class="[{'paymentcancelled':fixMilestoneProps.statusArray && fixMilestoneProps.statusArray.length > 0 ? fixMilestoneProps.statusArray[fixMilestoneProps.statusArray.length - 1].milestoneStatusColor.includes('CANCELLED'):''}]">{{currencyMilestone.symbol}} {{getCommaSeperatedNumber(fixMilestoneProps.amount)}}</span>
                <DropDown v-if="fixMilestoneProps.refundedAmount && fixMilestoneProps.refundedAmount.length" id="amonut_history" class="status_change_dropdown">
                    <template #button>
                        <button class="cursor-pointer dot-btn border-0">
                            <img v-if="props.planCondition" :src="detaildropdown" alt="detaildropdown" class="left_space_wrapper" />
                        </button>
                    </template>
                    <template #options>
                        <DropDownOption v-if="fixMilestoneProps.refundedAmount && fixMilestoneProps.refundedAmount.length">
                            <div>
                                <div class="border-bottom-black">
                                    <span class="d-block dropdown_span" v-for="(temp,ind) in fixMilestoneProps.refundedAmount" :key="ind">
                                        {{currencyMilestone.symbol}} {{getCommaSeperatedNumber(temp.amount)}} {{$t('Milestone.partially_refunded')}}
                                    </span>
                                </div>
                                <div class="border-bottom-black">
                                    <span class="d-block dropdown_span">{{currencyMilestone.symbol}} {{getCommaSeperatedNumber(refundedTotalValue(fixMilestoneProps.refundedAmount,fixMilestoneProps.amount))}}
                                        <span v-if="(fixMilestoneProps?.refundedAmount && fixMilestoneProps.refundedAmount?.length > 0 ? Number(refundedTotalValue(fixMilestoneProps.refundedAmount,fixMilestoneProps.amount)) : '') === (fixMilestoneProps.amount)">{{ $t('Milestone.all_amount_refunded') }}</span>
                                        <span v-else>{{$t('Milestone.total_partially_refunded')}}</span>    
                                    </span>
                                </div>
                                <div class="border-bottom-black">
                                    <span class="d-block dropdown_span">{{currencyMilestone.symbol}} {{getCommaSeperatedNumber(fixMilestoneProps.amount)}}  ({{$t('Milestone.actual_amount')}})</span>
                                    <span class="d-block dropdown_span">{{currencyMilestone.symbol}} {{'-'}} {{getCommaSeperatedNumber(refundedTotalValue(fixMilestoneProps.refundedAmount,fixMilestoneProps.amount))}} ({{ $t('Milestone.refund_amount') }})</span>
                                </div>
                                <span class="d-block">{{currencyMilestone.symbol}} {{getCommaSeperatedNumber(refundedTotal(fixMilestoneProps.refundedAmount,fixMilestoneProps.amount))}}</span>
                            </div>
                        </DropDownOption>
                    </template>
                </DropDown>
            </div>
            <div v-if="fixMilestoneProps.refundedAmount && fixMilestoneProps.refundedAmount.length">{{`( - ${refundedTotalValue(fixMilestoneProps.refundedAmount)})`}}</div>
        </div>
        <div class="refund_padding_top webkit_wrapper_milestone" v-if="fixMilestoneProps._id === refundId">
            <div class="pr-5px">
                <InputText
                    v-model.number="formDataRefund.refundAmount.value"
                    type="number"
                    :id="`amountvalue${fixMilestoneIndex}`"
                    :placeHolder="$t('PlaceHolder.Enter_Refund_Amount')"
                    :inputId="`amountvalue`+fixMilestoneIndex"
                    @keyup="checkErrors({'field':formDataRefund.refundAmount,
                        'name':'refundamount',
                        'validations':formDataRefund.refundAmount.rules,
                        'type':formDataRefund.refundAmount.type,
                        'event':$event.event
                    }),handleValidation(fixMilestoneProps.refundedAmount,fixMilestoneProps.amount)"
                    @input="handleInputNum()"
                    @keypress="onlyNumber($event.event)"
                    min="1"
                ></InputText>
                <small class="red" v-if="formDataRefund.refundAmount.error">{{formDataRefund.refundAmount.error}}</small>
                <small class="red" v-if="error.amount">{{$t(`Milestone.${error.amount.replaceAll(' ',"_")}`)}}</small>
            </div>
            <div>
                <MilestoneDate :id="`refundDate${fixMilestoneIndex}`" :inputId="`refundDate`+fixMilestoneIndex"
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
        <div v-if="fixMilestoneProps.statusArray && fixMilestoneProps.statusArray.length > 0" class="d-flex align-items-center">
            <template v-for="(statusValue,index) in settingStatus" :key="index">
                <div @click="permissionData ? $emit('editMilestonetd','edit',fixMilestoneIndex,true):'',permissionData ? focusInputForFix('status',fixMilestoneIndex,'status') : '',permissionData ? options.length === 0 ? emit('isVisible',false) : emit('isVisible',true) : ''" v-if="fixMilestoneProps.statusArray[fixMilestoneProps.statusArray.length - 1].milestoneStatusColor === statusValue.value" :key="index" class="tablelabel status_dot_value" :style="[{'background-color': statusValue.backgroundColor ? statusValue.backgroundColor : 'transparent' , 'color':'white'}]">
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
                        <DropDownOption class="border_bottom_status" v-for="(name,index) in fixMilestoneProps.statusArray" :key="index">
                            <template v-for="(statusValue,index) in settingStatus" :key="index">
                                <span v-if="statusValue.value === name.milestoneStatusColor" :style="[{'background-color': statusValue.backgroundColor ? statusValue.backgroundColor : 'transparent' , 'color':'white','padding': '5px','border-radius': '5px'}]" class="Dot_Change">{{statusValue.name}}</span>
                                <span v-if="statusValue.value === name.milestoneStatusColor" class="status_date_value">{{convertDateFormat(name.statusDateValue,'',{showDayName: false})}}</span>
                            </template>
                        </DropDownOption>
                    </template>
                </DropDown>
            </div>
        </div>
        <div class="newstatus" v-else @click="permissionData ? $emit('editMilestonetd','edit',fixMilestoneIndex,true) : '',permissionData ? focusInputForFix('status',fixMilestoneIndex,'status') : '',permissionData ? emit('isVisible',true) : ''">
           {{$t('Milestone.add_new')}} {{$t('ProjectDetails.status')}} 
        </div>
    </td>
    <!-- statusDate -->
    <td @click="permissionData ? $emit('editMilestonetd','edit',fixMilestoneIndex,true) : '',permissionData ? focusInputForFix('statusDate',fixMilestoneIndex,'statusDate') : ''">
        {{fixMilestoneProps.statusArray && fixMilestoneProps.statusArray?.length ?
            convertDateFormat(fixMilestoneProps.statusArray[fixMilestoneProps.statusArray.length - 1].statusDateValue,'',{showDayName: false}) :
            '-'
        }}
    </td>
    <!-- action -->
    <td>
        <div class="d-flex align-items-center justify-content-between">
            <div>
                <span v-if="fixMilestoneProps.statusArray && fixMilestoneProps.statusArray.length ? fixMilestoneProps.statusArray[fixMilestoneProps.statusArray.length - 1].milestoneStatusColor.includes('RELEASED'):''">
                    <span class="refund_cancel_font" v-if="(fixMilestoneProps?.refundedAmount && fixMilestoneProps.refundedAmount?.length > 0 ? Number(refundedTotalValue(fixMilestoneProps.refundedAmount,fixMilestoneProps.amount)) : '') !== (fixMilestoneProps.amount)" @click="permissionData ? refundIndex(fixMilestoneProps._id) : ''">{{ $t('Milestone.refund') }}</span>
                </span>
                <span v-else>
                    <span class="refund_cancel_font" v-if="fixMilestoneProps.statusArray && fixMilestoneProps.statusArray.length > 0 ? !fixMilestoneProps.statusArray[fixMilestoneProps.statusArray.length - 1].milestoneStatusColor.includes('CANCELLED'):''" @click="permissionData ? props.planCondition ? $emit('editMilestonetd','cancelstatus',fixMilestoneIndex,true,fixMilestoneProps) : '' : ''">{{$t('Projects.cancel')}}</span>
                </span>
            </div>
            <img :src="deleteMilestone" class="cursor-pointer" alt="delete" v-if="permissionData" @click="permissionData ? handleDeleteMilestone(fixMilestoneIndex,props.fixMilestoneProps.milestoneName) : ''">
        </div>
        <div :class="[{'refund_amount_empty':!(fixMilestoneProps.refundedAmount && fixMilestoneProps.refundedAmount.length)}]" class="refund_wrapper" v-if="fixMilestoneProps._id === refundId">
            <img :src="saveImage" class="refund_delete" alt="save" @click="permissionData ? handleSaveRefund() : ''">
            <img :src="deleteImage" alt="deleteedit" @click="permissionData ? refundIndex('') : ''">
        </div>
    </td>
</template>

<script setup>
    import { defineProps,defineEmits,ref,onUnmounted,onMounted } from 'vue';
    import { useConvertDate } from "@/composable";
    import { useValidation } from "@/composable/Validation";
    import DropDown from '@/components/molecules/DropDown/DropDown.vue';
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    import InputText from '@/components/atom/InputText/InputText.vue';
    import { ValidationFunction } from "@/composable/DefaultValidationFunction";
    import MilestoneDate from '@/components/molecules/FixMilestoneDate/FixMilestoneDate.vue';
    const props = defineProps({
        editfixMilestone : {type:Number,required:true},
        fixMilestoneProps : {type:Object,required:true},
        focusInputForFix : {type:Function,required:true},
        fixMilestoneIndex :{type:Number,required:true},
        currencyMilestone : {type:Object,required:true},
        settingStatus : {type:Array,required:true},
        refundId : {type:String,default:''},
        options : {type:Array,required:true},
        permissionData: {type: Boolean,default: false},
        planCondition: {type: Boolean,default: false}
    });
    const draggable = require('@/assets/images/svg/draggableimage.svg');
    const detaildropdown = require('@/assets/images/svg/detaildropdown.svg');
    const statushistory = require('@/assets/images/svg/statushistory.svg');
    const deleteMilestone = require('@/assets/images/svg/DeleteMilestone.svg');
    const deleteImage = require('@/assets/images/delete1.png');
    const saveImage = require('@/assets/images/save.png');
    const refundDate = ref(new Date());
    const  { checkErrors,checkAllFields } = useValidation();
    const formDataRefund = ref({refundAmount: {type: 'number',name: 'refundamount',value: '',rules: "required"}});
    const error = ref({amount: ''});
    const emit = defineEmits(['editMilestonetd','saveRefundEmit','setRefundIdTr','deleteMilestoneEmit','isVisible','valueBody']);
    const { convertDateFormat } = useConvertDate();
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();
    const getCommaSeperatedNumber = (n)=> {
        let numVal = Number(n)
        return numVal.toLocaleString('en-US', {maximumFractionDigits: 2, minimumFractionDigits: 2, useGrouping: true});
    };
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
    const handleValidation = (refund,amount) =>{
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
                    emit('saveRefundEmit','refund',props.fixMilestoneIndex,formDataRefund.value.refundAmount.value,refundDate.value);
                    formDataRefund.value.refundAmount.value = '';
                    refundDate.value = new Date();
                }
            });
        }
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
    // calendar 
    const updateRefundDate = (value) => {
        refundDate.value = value.dateVal;
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
    const handleDeleteMilestone = (val,name) => {
        if(props.planCondition){
            emit('deleteMilestoneEmit',val,name);
        }
    }
    onMounted(() => {
        addKeyUpListener();
    });
    onUnmounted(() => {
        removeKeyUpListener();
    });
</script>
<style scoped>
.milestone__name{
    max-width: 140px !important;
}
</style>