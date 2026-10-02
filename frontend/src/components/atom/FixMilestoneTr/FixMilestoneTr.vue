<template>
    <tr class="fixMilestone_wrapper_tr" :class="[{'cursor-pointer':permissionData}]" v-if="editfixMilestone !== fixMilestoneIndex">
        <FixMilestoneTd 
            :editfixMilestone="props.editfixMilestone"
            :fixMilestoneProps="props.fixMilestoneProps"
            :fixMilestoneIndex="props.fixMilestoneIndex"
            :currencyMilestone="props.currencyMilestone"
            :settingStatus="props.settingMilestoneStatus"
            :focusInputForFix="focusInputForFix"
            :refundId="props.refundId"
            :options="options"
            :permissionData="props.permissionData"
            @editMilestonetd="handleEditEmitMilestone"
            @saveRefundEmit="saveRefund"
            @setRefundIdTr="refundIndex"
            @deleteMilestoneEmit="handleDeleteEmit"
            @isVisible="handleStatusVisible"
            :planCondition="props.planCondition"
        ></FixMilestoneTd>
    </tr>
    <div :class="[{'cursor-pointer':permissionData}]" class="d-content" v-else>
        <tr>
            <td></td>
            <td>
                <div class="milestone_name">
                    <InputText v-model.trim="formData.fixMilestone.value" type="text" :id="`milestonename${fixMilestoneIndex}`" :placeHolder="$t('PlaceHolder.Enter_Text')"
                        :inputId="`milestonename`+fixMilestoneIndex"
                        @keyup="checkErrors({'field':formData.fixMilestone,'name':'name','validations':formData.fixMilestone.rules,'type':formData.fixMilestone.type,'event':$event.event})"
                    ></InputText>
                    <small class="fix-milestone-tr-red" v-if="formData.fixMilestone.error">{{formData.fixMilestone.error}}</small>
                </div>
            </td>
            <td>
                <MilestoneDate :calenderImage="true" :InputDesign="true" :inputIdProps="`startdate`+fixMilestoneIndex" :id="`startdate${fixMilestoneIndex}`" :displyDate="startDate ? startDate : ''" :isShowDateAndicon="true" @SelectedDate="($event) => updateStartDate($event)"></MilestoneDate>
            </td>
            <td>
                <MilestoneDate :calenderImage="true" :InputDesign="true" :inputIdProps="`enddate${fixMilestoneIndex}`" :id="`enddate${fixMilestoneIndex}`" :displyDate="endDate ? endDate : ''" :isShowDateAndicon="true" :minDate="startDate ? startDate : ''" @SelectedDate="($event) => updateEndDate($event)"></MilestoneDate>
            </td>
            <td>
                <MilestoneDate :calenderImage="true" :InputDesign="true" :inputIdProps="`duedate${fixMilestoneIndex}`" :id="`duedate${fixMilestoneIndex}`" :displyDate="dueDate ? dueDate : ''" :isShowDateAndicon="true" :minDate="startDate ? startDate : ''" @SelectedDate="($event) => updateDueDate($event)"></MilestoneDate>
            </td>
            <td>
                <div class="milestone_name">
                    <div class="d-flex position-re">
                        <span class="currency">{{props.currencyMilestone.symbol}}</span>
                        <InputText
                            v-model.number="formData.amount.value"
                            type="number"
                            :id="`amount${fixMilestoneIndex}`"
                            :placeHolder="$t('PlaceHolder.Enter_Amount')"
                            :inputId="`amount`+fixMilestoneIndex"
                            @input="handleInputNum()"
                            @keypress="onlyNumber($event.event)"
                            @keyup="checkErrors({'field':formData.amount,'name':'amount','validations':formData.amount.rules,'type':formData.amount.type,'event':$event.event})"
                            min="1"
                            class="amountCurr"
                        ></InputText>
                    </div>
                    <small class="fix-milestone-tr-red" v-if="formData.amount.error">{{formData.amount.error}}</small>
                    <small class="fix-milestone-tr-red" v-if="err">{{$t(`Milestone.${err.replaceAll(' ',"_")}`)}}</small>
                </div>
            </td>
            <td></td>
            <td></td>
            <td>
                <div class="d-flex align-items-center refund-delete-image">
                    <img :src="saveIcon" alt="save" class="refund_delete" @click="handleFixMilestoneEdit">
                    <img :src="deleteIcon" alt="deleteedit" @click="editMilestoneValue,$emit('editMilestone','clear',fixMilestoneIndex,false)">
                </div>
            </td>
        </tr>
        <tr>
            <td colspan="6"></td>
            <td colspan="3" class="border_left_status">
                <div class="clear_status" v-if="fixMilestoneProps.statusArray.length">
                    <span @click="$emit('editMilestone','clearStatus',fixMilestoneIndex,false,fixMilestoneProps)">{{$t('Filters.clearall')}} {{$t('ProjectDetails.status')}}</span>
                </div>
                <div class="hourly_wrapper">
                    <div class="d-flex align-items-center hourly_wrapper_value" v-if="options.length !== 0">
                        <div class="multiple_status padding_status">
                            <InputText v-model="status" type="text" :id="`status${fixMilestoneIndex}`" :placeHolder="$t('PlaceHolder.Select')"
                                :inputId="`status`+fixMilestoneIndex"
                                isReadonly
                                @click="isVisible = true"
                                @focus="isVisible = true"
                            ></InputText>
                        </div>
                        <div class="multiple_status_date padding_status">
                            <MilestoneDate v-if="status" :id="`statusDate${fixMilestoneIndex}`" :inputId="`statusDate`+fixMilestoneIndex"
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
                                    :id="`allStatus${fixMilestoneIndex}`"
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
        <Sidebar className="task-milestone-status-sidebar" v-model:visible="isVisible" :title="$t('Milestone.mileston_status')" :enable-search="true" :options="options" @selected="selectedObj($event)" :listenKeys="true"></Sidebar>
    </div>
</template>
<script setup>
    import { defineProps,ref,computed,defineEmits,onUnmounted,onMounted } from 'vue';
    import InputText from '@/components/atom/InputText/InputText.vue';
    import '@/components/atom/FixMilestoneTr/FixMilestoneTr.css';
    import MilestoneDate from '@/components/molecules/FixMilestoneDate/FixMilestoneDate.vue';
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    import { useValidation } from "@/composable/Validation";
    import FixMilestoneTd from '../FixMilestoneTd/FixMilestoneTd.vue';
    const emit = defineEmits(['editMilestone','deleteMilestone', 'setRefundId']);
    import { ValidationFunction } from "@/composable/DefaultValidationFunction";
    const  { checkErrors,checkAllFields } = useValidation();
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();
    const props = defineProps({
        refundId: {type: String,default: ""},
        fixMilestoneProps: {type: Object,required: true},
        fixMilestoneIndex :{type:Number,required:true},
        editfixMilestone : {type:Number,required:true},
        currencyMilestone : {type:Object,required:true},
        settingMilestoneStatus : {type:Array,required:true},
        itemKey : {type:String,required:true},
        permissionData : {type:Boolean,default: false},
        planCondition : {type:Boolean,default: false}
    });
    const deleteIcon = require("@/assets/images/delete1.png");
    const saveIcon = require("@/assets/images/save.png");
    const settingStatus = ref(props.settingMilestoneStatus);
    const milestoneStatusArray = ref(props.settingMilestoneStatus);
    const startDate = ref('');
    const endDate = ref('');
    const dueDate = ref('');
    const status = ref('');
    const statusDate = ref(new Date());
    const isVisible = ref(false);
    const statusObj = ref({});
    const statusArrayMilestone = ref([]);
    const milestoneId = ref('');
    const refundedAmount = ref('');
    const formData = ref({
        fixMilestone: {type: 'text',name: 'name',value: '',rules: "required|min:3|"},
        amount: {type: 'number',name: 'amount',value: '',rules: "required"}
    });
    const err = ref('');
    // sidebar options
    const options = computed(() => {
        if(props.fixMilestoneProps.statusArray && props.fixMilestoneProps.statusArray.length){
            const filteredStatusValues = props.fixMilestoneProps.statusArray.map(element => element.milestoneStatusColor);
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
    // edit milestone value
    const editMilestoneValue = (() => {
        formData.value.fixMilestone.error = '';
        formData.value.amount.error = '';
        formData.value.fixMilestone.value = (props.fixMilestoneProps.milestoneName);
        startDate.value = (props.fixMilestoneProps.startDate ? props.fixMilestoneProps.startDate.seconds ? new Date(props.fixMilestoneProps.startDate.seconds * 1000) : new Date(props.fixMilestoneProps.startDate) : '');
        endDate.value = (props.fixMilestoneProps.endDate ? props.fixMilestoneProps.endDate.seconds ? new Date(props.fixMilestoneProps.endDate.seconds * 1000) : new Date(props.fixMilestoneProps.endDate) : props.fixMilestoneProps.endDate);
        dueDate.value = (props.fixMilestoneProps.dueDate ? props.fixMilestoneProps.dueDate.seconds ? new Date(props.fixMilestoneProps.dueDate.seconds * 1000) : new Date(props.fixMilestoneProps.dueDate) : props.fixMilestoneProps.dueDate);
        formData.value.amount.value = (props.fixMilestoneProps.amount).toString();
        statusArrayMilestone.value = JSON.parse(JSON.stringify(props.fixMilestoneProps.statusArray));
        milestoneId.value = props.fixMilestoneProps._id;
        refundedAmount.value = props.fixMilestoneProps.refundedAmount;
        status.value = '';
        statusObj.value = {};
        err.value = '';
    });
    // check only number
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
    }
    const handleInputNum = () => {
        if(props.fixMilestoneProps?.refundedAmount && props.fixMilestoneProps.refundedAmount.length){
            var refundedValue = 0;
            props.fixMilestoneProps.refundedAmount.forEach(element => {
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
    };
    // on click status value
    const selectedObj = (val) => {
        statusObj.value = val;
        status.value = val.name;
        statusDate.value = new Date();
    };
    // on click focus on particular input
    const focusInputForFix = (value,index) => {
        if(props?.planCondition){
            editMilestoneValue();
            if(value === 'milestonename'){
                setTimeout(() => {document.getElementById(`milestonename${index}`).focus();});
            }
            if(value === 'start'){
                startDate.value=props.fixMilestoneProps.startDate ?
                props.fixMilestoneProps.startDate.seconds ?
                new Date(props.fixMilestoneProps.startDate.seconds * 1000) :
                new Date(props.fixMilestoneProps.startDate) : '';
                setTimeout(() => {document.getElementById(`startdate${index}`).focus();});
            }
            if(value === 'end'){
                endDate.value=props.fixMilestoneProps.endDate ?
                props.fixMilestoneProps.endDate.seconds ?
                new Date(props.fixMilestoneProps.endDate.seconds * 1000) :
                new Date(props.fixMilestoneProps.endDate) : '';
                setTimeout(() => {document.getElementById(`enddate${index}`).focus();});
            }
            if(value === 'due'){
                dueDate.value=props.fixMilestoneProps.dueDate ?
                props.fixMilestoneProps.dueDate.seconds ?
                new Date(props.fixMilestoneProps.dueDate.seconds * 1000) :
                new Date(props.fixMilestoneProps.dueDate.seconds) : '';
                setTimeout(() => {document.getElementById(`duedate${index}`).focus();});
            }
            if(value === 'amount'){
                setTimeout(() => {document.getElementById(`amount${index}`).focus()});
            }
            if(value === 'status' && options.value.length !== 0){
                setTimeout(() => {document.getElementById(`status${index}`).focus()});
            }
        }
    };
    // refund index
    const refundIndex = (index) => {
        emit("setRefundId", index);
    };
    const updateStartDate = (val) => {
        startDate.value = val.dateVal;
    };
    const updateEndDate = (val) => {
        endDate.value = val.dateVal;
    };
    const updateDueDate = (val) => {
        dueDate.value = val.dateVal;
    };
    const updateStatusDate = (val) => {
        statusDate.value = val.dateVal;
    };
    const updateStatusDateArray = (val,index) => {
        statusArrayMilestone.value[index].statusDateValue = val.dateVal;
    };
    // clear milestone value
    const handleClearMilestone = () => {
        formData.value.amount.value ='';
        formData.value.fixMilestone.value = '';
        startDate.value = '';
        endDate.value = '';
        dueDate.value = '';
        status.value = '';
        statusDate.value = '';
    };
    // save milestone value emit
    const saveRefund = (type,index,edit,date) => {
        emit('editMilestone',type,index,edit,date);
        refundIndex('');
        handleClearMilestone();
    };
    // edit milestone value emit
    const handleFixMilestoneEdit = () =>{
        checkAllFields(formData.value).then((valid)=>{
            if(valid && err.value === ''){
                if(status.value){
                    delete statusObj.value.milestoneStatusDate;
                    statusArrayMilestone.value.push({
                        statusDateValue: statusDate.value,
                        milestoneStatusColor:statusObj.value.value
                    });
                }
                const obj = {
                    milestoneName: formData.value.fixMilestone.value,
                    startDate: startDate.value,
                    endDate: endDate.value,
                    dueDate: dueDate.value,
                    amount: Number(formData.value.amount.value),
                    statusArray:statusArrayMilestone.value,
                    id:milestoneId.value,
                    refundedAmount:refundedAmount.value,
                    createdAt:props.fixMilestoneProps.createdAt,
                    order:props.fixMilestoneProps.order,
                    minRefundDate:props.fixMilestoneProps.minRefundDate ? props.fixMilestoneProps.minRefundDate : '',
                    maxRefundDate:props.fixMilestoneProps.maxRefundDate ? props.fixMilestoneProps.maxRefundDate : ''
                };
                emit('editMilestone','editMil',obj,props.fixMilestoneIndex,status.value ? {...statusObj.value,statusDate: statusDate.value} : '',props.fixMilestoneProps);
                handleClearMilestone();
            }
        })
    };
    const handleEditEmitMilestone = (type,index,edit,value) => {
        emit('editMilestone',type,index,edit,value);
    };
    const handleDeleteEmit = (type,index) => {
        emit('deleteMilestone',type,index);    
    };
    const handleStatusVisible = (value) => {
        isVisible.value = value;
    };
    const handleEnter = (event) => {
        if (event.keyCode === 13 && props.editfixMilestone !== 0.1){
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

<style scoped>
.fix-milestone-tr-red {
    color: var(--danger-ink);
}
</style>
