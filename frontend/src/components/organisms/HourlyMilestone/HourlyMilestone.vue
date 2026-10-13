<template>
    <div :class="[{'position-re':!props.planCondition}]">
        <div v-if="!props.planCondition">
            <UpgradePlan
                :isImage="false"
                :buttonText="$t('Upgrades.upgrade_your_plan')"
                :lastTitle="$t('Upgrades.to_unlock_milestone')"
                :secondTitle="$t('Upgrades.unlimited')"
                :firstTitle="$t('Upgrades.upgrade_to')"
                :message="$t('Upgrades.the_feature_not_available')"
            />
        </div>
        <div class="fix-milestone-wrapper" :class="[{'is-locked pointer-event-none opacity-5 blur-3-px':!props.planCondition}]">
            <table class="table-responsive hourly_milestone">
                <SpinnerComp :is-spinner="isSpinner" />
                <thead :class="[{'pointer-event-none':isSpinner}]">
                    <tr>
                        <th>{{$t("Milestone.milestone")}}<br>{{$t('Projects.Name')}}</th>
                        <th>{{$t('Projects.date')}}</th>
                        <th>{{$t('UserTimesheet.logged')}} {{ $t('UserTimesheet.users')}}</th>
                        <th>{{$t('Milestone.billing')}}<br>{{$t('UserTimesheet.hours')}}</th>
                        <th>{{$t('Billing.amount')}}<br>({{$t('Milestone.per_hour')}})</th>
                        <th>{{$t('Billing.amount')}}</th>
                        <th>{{$t('Billing.status')}}</th>
                        <th>{{$t('Milestone.status_date')}}</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody v-if="milestoneArray && milestoneArray.length">
                    <template v-for="(element,index) in milestoneArray" :key="index">
                        <HourlyMilestoneTr
                            :permission="props.permissionData"
                            :projectId="projectId"
                            :currency="currency"
                            :billingPeriod="billingPeriod"
                            :milestoneArray="element"
                            :settingMilestoneStatus="settingStatus"
                            :edithourlyMilestone="props.planCondition ? edithourlyindex : 0.1" 
                            :hourlyMilestoneIndex="index"
                            :refundId="refundId"
                            @editMilestone="handleEditMilestone"
                            @setRefundId="refundId = $event,edithourlyindex=0.1,addNew=false"
                            @deleteMilestone="deleteMilestone"
                            :userArray="userArray"
                            :planCondition="props.planCondition"
                        />
                    </template>
                </tbody>
                <tfoot @click.stop.prevent v-if="addNew" :class="[{'pointer-event-none':isSpinner}]">
                    <HourlyMilestoneInput @sidebar="handleSidebar" :currency="currency" @addHourlyMilestone="handleAddMilestone" :billingPeriod="billingPeriod" :rangeObject="rangeObject" :disableStartEndDate="rangeArrayWeekly" :startDate="startDate" :settingMilestoneStatusAdd="settingStatus" :companyId="companyId" :projectId="projectId" />
                </tfoot>
            </table>
            <div :class="[{'pointer-event-none':isSpinner}]">
                <div class="d-flex align-items-center justify-content-between wrapper_add_amount">
                    <div class="add_new_width monthly-calendar-add" v-if="props.permissionData">
                        <button type="button" @click="handleAddNew" class="add_new cursor-pointer" :disabled="isSpinner">{{$t('Milestone.add_new')}}</button>
                    </div>
                    <div class="add_new_width" v-if="!props.permissionData"></div>
                    <div class="total_amount_width">
                        <span class="total_amount">{{$t('Milestone.total_amount')}} :- {{totalAmountRefundedForFix ? `${getCommaSeperatedNumber(fixAmountTotal)} - ${getCommaSeperatedNumber(totalAmountRefundedForFix)} =` : '' }} {{props?.currency?.symbol}} {{getCommaSeperatedNumber(totalDiffernece)}}</span>
                    </div>
                </div>
            </div>
            <ConfirmModal :modelValue="showConfirmModal" :acceptButtonText="$t('Home.Confirm')"
                    :cancelButtonText="$t('Projects.cancel')" maxlength="150" :header="true" :showCloseIcon="false" @accept="handleConfirm" @close="showConfirmModal = false">
                <template #header><h3 class="m-0">{{$t('Home.Confirm')}}</h3></template>
                <template #body><span>{{$t('Milestone.are_you_sure')}} ?</span></template>
            </ConfirmModal>
        </div>
    </div>
</template>
<script setup>
    import { useStore } from "vuex";
    import { useI18n } from "vue-i18n";
    import * as env from '@/config/env';
    import { apiRequest } from "@/services";
    import {useToast} from 'vue-toast-notification';
    import { useGetterFunctions } from "@/composable";
    import ConfirmModal from '@/components/atom/Modal/Modal.vue';
    import '@/components/organisms/HourlyMilestone/HourlyMilestone.css';
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import { calendar } from '@/components/organisms/HourlyMilestone/helper.js';
    import { milestoneData } from '@/components/organisms/FixMilestone/helper.js';
    import HourlyMilestoneTr from '@/components/atom/HourlyMilestoneTr/HourlyMilestoneTr.vue';
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
    import HourlyMilestoneInput from '@/components/atom/HourlyMilestoneInput/HourlyMilestoneInput.vue';
    import { ref,defineProps,computed,inject,onMounted,onUnmounted, watch } from 'vue';
    const { t } = useI18n();

    const $toast = useToast();
    const { getters,commit } = useStore();
    const {getUser} = useGetterFunctions();
    const { calendarRange,calendarRangeWeekly,gettingTotalHours } = calendar();
    const { 
        addMilestoneHelper,
        editMilestoneHelper,
        cancelMilestoneHelper,
        refundMilestoneHelper,
        deleteMilestoneHelper,
        clearMilestoneHelper 
    } = milestoneData();

    const emit = defineEmits(['updateTotalDifference']);
    
    //props
    const props = defineProps({
        projectDataMilestone: {type: Object,required: true},
        permissionData:{type: Boolean,default: false},
        billingPeriodHourly:{type: String,required:true},
        startDate:{type:Object,required:false},
        planCondition:{type: Boolean,default: false},
        currencyValue:{type: String,default: ''},
        currency: {type: Object,required: true}
    });
    // computed
    const settingStatus = computed(() => getters['settings/projectMilestoneStatus']);
    const companyOwner = computed(() => {return getters["settings/companyOwnerDetail"]});
    const milestoneWeeklyRange = computed(() => getters["settings/milestoneweeklyrange"]);
        
    // total for refundamount
    const totalAmountRefundedForFix = computed(() =>{
        var totalRefunded = null;
        if(milestoneArray.value.length > 0){
            milestoneArray.value.forEach((val)=>{
                if(val?.refundedAmount && val.refundedAmount?.length > 0 && val.statusArray[val.statusArray.length - 1]?.milestoneStatusColor !== "CANCELLED"){
                    val.refundedAmount.forEach((temp)=>{
                        return totalRefunded += temp.amount
                    })
                }
            })
        }
        return totalRefunded 
    });
    // total amount for milestone
    const fixAmountTotal = computed(()=>{
        var sum = 0;
        if(milestoneArray.value && milestoneArray.value.length){
            milestoneArray.value.forEach(e => {
                let cancelValue = e.statusArray && e.statusArray.length > 0 ? e.statusArray[e.statusArray.length - 1].milestoneStatusColor.includes('CANCELLED') : ''
                if(cancelValue !== true){
                    sum += Number(e.amount);
                }
            });
            return (sum);
        }
        return (sum);
    });
    // total Differnece between totalamount and refundamount
    const totalDiffernece = computed(()=>{return (fixAmountTotal.value - totalAmountRefundedForFix.value)});
    // variable
    const refundId = ref('');
    const addNew = ref(false);
    const userArray = ref([]);
    const rangeObject = ref({});
    const deleteIndex = ref(0.1);
    const isSpinner = ref(false);
    const milestoneArray = ref([]);
    const rangeArrayWeekly = ref({});
    const userId = inject("$userId");
    const edithourlyindex = ref(0.1);
    const sidebarPrevent = ref(false);
    const user = getUser(userId.value);
    const showConfirmModal = ref(false);
    const deleteMilestoneName = ref('');
    const milestoneObjForDelete = ref({});
    const companyId = inject('$companyId');
    const projectId = ref(props.projectDataMilestone._id ? props.projectDataMilestone._id : "");
    const startDate = ref(props.projectDataMilestone.StartDate ? props.projectDataMilestone.StartDate : '');
    const projectName = ref(props.projectDataMilestone.ProjectName ? props.projectDataMilestone.ProjectName : "");
    const billingPeriod = ref(props.billingPeriodHourly ? props.billingPeriodHourly : props.projectDataMilestone.BillingPeriod ? props.projectDataMilestone.BillingPeriod : '');    
    // watch
    watch(()=> props.billingPeriodHourly,(newValue) =>{
        if(newValue){
            billingPeriod.value = newValue;
        }
    });
    watch([() => fixAmountTotal.value , () => totalAmountRefundedForFix.value], ([newFix, newTotalAmount]) => {
        emit("updateTotalDifference", newFix - newTotalAmount);
    });
    // watch
    watch(()=> props.startDate,(newValue) =>{
        if(newValue){
            startDate.value = newValue;
        }
    });
    watch(() => props?.projectDataMilestone?._id ,(newValue,oldValue) =>{
        if(newValue !== oldValue){
            projectId.value = newValue;
            getHourlyMilestoneData();
            document.body.addEventListener('click', handleClickOutside);
        }
    })
    onMounted(() => {
        getHourlyMilestoneData();
        document.body.addEventListener('click', handleClickOutside);}
    );
    onUnmounted(() => {
        document.body.removeEventListener('click', handleClickOutside);
    });
    
    // getting data for hourly milestone
    const getHourlyMilestoneData = async () => {
        milestoneArray.value = [];
        await apiRequest("get",`${env.MILESTONE_PROJECT}/${projectId.value}`).then((res) => {
            if(res.status === 200){
                if(res?.data && res?.data?.length){
                    res?.data.forEach((e) => {
                        e.startDate = e.startDate !== 0 ? new Date(e.startDate) : '';
                        e.endDate = e.endDate !== 0 ? new Date(e.endDate) : '';
                        milestoneArray.value.push(e);
                    });
                    milestoneArray.value.sort((a, b) => {
                        if (a.milestoneName < b.milestoneName) return -1;
                        if (a.milestoneName > b.milestoneName) return 1;
                        return 0;
                    });
                    gettingTotalHours(milestoneArray.value,projectId.value).then((value)=>{
                        userArray.value = value;
                    });
                }
            }
        });
    };
    // add new click
    const handleAddNew = () => {
        if(!props?.planCondition){
            return;
        }else{
            let projectStartDate = startDate.value ? new Date(startDate.value) : '';
            if(projectStartDate){
                if(projectStartDate.getTime() > new Date().getTime()){
                    $toast.error(t("Toast.Start_date_of_project_should_be_smaller_than_current_date"),{position: 'top-right'});
                    addNew.value = false;
                }else{
                    addNew.value = true;
                    edithourlyindex.value = 0.1;
                    refundId.value = '';
                    if(billingPeriod.value === "Monthly"){
                        calendarRange(projectStartDate,milestoneArray.value,billingPeriod.value,false,'').then((value)=>{
                            if(Object.keys(value).length){
                                rangeObject.value = value;
                            }else{
                                addNew.value = false;
                                $toast.error(t("Toast.All_the_range_is_included_in_milestone"),{position: 'top-right'});
                                rangeObject.value = {};
                            }
                        }).catch((err)=>{
                            console.error('err',err);
                        });
                    }else{
                        calendarRangeWeekly(projectStartDate,milestoneArray.value,milestoneWeeklyRange.value).then((value)=>{
                            if(Object.keys(value.monthlyOrweeklyRanges).length){
                                rangeArrayWeekly.value = value;
                            }else{
                                addNew.value = false;
                                $toast.error(t("Toast.All_the_range_is_included_in_milestone"),{position: 'top-right'});
                                rangeArrayWeekly.value = {};
                            }
                        }).catch((err)=>{
                            console.error('err',err);
                        })
                    }
                }
            }else if(!projectStartDate){
                $toast.error(t("Toast.Please_enter_start_date_of_project"),{position: 'top-right'});
                addNew.value = false;
            }
        }
    };
    const handleSidebar = (action) => {
        sidebarPrevent.value = action
    }
    const handleAddMilestone = (action,milestoneObj,statusObj) => {
        if(action === 'clear'){
            addNew.value = false;
        }
        if (action === 'add') {
            addNew.value = false;
            isSpinner.value = true;
            user.companyOwnerId = companyOwner.value.userId
            addMilestoneHelper(projectId.value,companyId.value,user,projectName.value,milestoneObj,statusObj,true,props.currencyValue).then((res) => {
                let ind = milestoneArray.value.findIndex((x) => (x._id === res._id));
                if(ind === -1){
                    milestoneArray.value.push(res);
                    milestoneArray.value.sort((a, b) => {
                        if (a.milestoneName < b.milestoneName) return -1;
                        if (a.milestoneName > b.milestoneName) return 1;
                        return 0;
                    });
                }
                commit("settings/mutateProjectMilestoneStatus", {data:{...statusObj},op:'modified',countType:'increment'});
                getHourlyMilestoneData();
                isSpinner.value = false;
            });
        }
    };
    
    const getCommaSeperatedNumber = (n)=> {
        let numVal = Number(n)
        return numVal.toLocaleString('en-US', {maximumFractionDigits: 2, minimumFractionDigits: 2, useGrouping: true});
    };
    // delete mielstone emit
    const deleteMilestone = (index,name) =>{
        showConfirmModal.value = true;
        deleteIndex.value = index;
        deleteMilestoneName.value = name;
        milestoneObjForDelete.value = milestoneArray.value[index];
    };
    // api for delete milestone
    const handleConfirm = () => {
        let amount = 0;
        isSpinner.value = true;
        user.companyOwnerId = companyOwner.value.userId;
        showConfirmModal.value = false;
        if(milestoneObjForDelete.value.statusArray && milestoneObjForDelete.value.statusArray.length && milestoneObjForDelete.value.statusArray[milestoneObjForDelete.value.statusArray.length -1].milestoneStatusColor === 'CANCELLED'){
            amount = 0;
        }else if(milestoneObjForDelete.value.refundedAmount && milestoneObjForDelete.value.refundedAmount.length){
            let refundAmount = 0;
            milestoneObjForDelete.value.refundedAmount.forEach((temp)=>{
                refundAmount += temp.amount;
            });
            amount = milestoneObjForDelete.value.amount - refundAmount;
        }else{
            amount = milestoneObjForDelete.value.amount;
        }
        deleteMilestoneHelper(projectId.value,companyId.value,user,milestoneObjForDelete.value,projectName.value,true,amount).then(()=>{
            let ind = milestoneArray.value.findIndex((x) => (x._id === milestoneObjForDelete.value._id));
            if(ind > -1){
                milestoneArray.value.splice(ind,1);
            }
            if(milestoneObjForDelete.value?.statusArray && milestoneObjForDelete.value?.statusArray?.length){
                milestoneObjForDelete.value?.statusArray.forEach((e) => {
                    commit("settings/mutateProjectMilestoneStatus", {data:{value:e.milestoneStatusColor},op:'modified',countType:'decrement'});
                })
            }
            isSpinner.value = false
        }).catch((err)=>{
            console.error("ERROR",err)
        });
    };
    const handleEditMilestone = (action,val,data,status,prevMilestoneName) => {
        if(props.planCondition){
            if(action === 'edit'){
                edithourlyindex.value = val;
                addNew.value = false;
                refundId.value = '';
            }
            // edit milestone api
            if(action === 'editMil'){
                let diffamount = 0;
                let amount = 0;
                edithourlyindex.value = 0.1;
                isSpinner.value = true;
                user.companyOwnerId = companyOwner.value.userId
                let obj = [];
                let settingKey = '';
                if(status && milestoneArray.value[data].statusArray && milestoneArray.value[data].statusArray.length){
                    settingKey = milestoneArray.value[data].statusArray[milestoneArray.value[data].statusArray.length - 1].milestoneStatusColor;
                    obj = settingStatus.value.filter((e)=>{
                        return e.value === settingKey
                    });
                }else{
                    if(val.statusArray.length){
                        settingKey = val.statusArray[0].milestoneStatusColor;
                        obj = settingStatus.value.filter((e)=>{
                            return e.value === settingKey
                        });
                    }
                }
                if(val.statusArray && val.statusArray.length && val.statusArray[val.statusArray.length - 1].milestoneStatusColor === "CANCELLED"){
                    amount = 0;
                }else if(milestoneArray.value[data].statusArray && milestoneArray.value[data].statusArray.length && milestoneArray.value[data].statusArray[milestoneArray.value[data].statusArray.length - 1].milestoneStatusColor !== val.statusArray[val.statusArray.length - 1].milestoneStatusColor && milestoneArray.value[data].statusArray[milestoneArray.value[data].statusArray.length - 1].milestoneStatusColor === "CANCELLED"){
                    let refundAmount = 0;
                    val.refundedAmount.forEach((temp)=>{
                        refundAmount += temp.amount;
                    });
                    amount = val.amount - refundAmount;
                }else{
                    diffamount = milestoneArray.value[data].amount - val.amount;
                    amount = -(diffamount);
                }
                editMilestoneHelper(projectId.value,companyId.value,user,projectName.value,val,status,prevMilestoneName,obj,true,amount,props.currencyValue).then(() => {
                    let ind = milestoneArray.value.findIndex((x) => (x._id === val.id));
                    if(ind > -1){
                        const object = {
                            "_id": val.id,
                            "milestoneName": val.milestoneName,
                            "amount": val.amount,
                            "amountPerHours": val.amountPerHours,
                            "createdAt": val?.createdAt,
                            "endDate": val.endDate,
                            "hours":val.hours,
                            "maxRefundDate": val.maxRefundDate,
                            "minRefundDate": val.minRefundDate,
                            "minute":val.minute,
                            "refundedAmount": val.refundedAmount,
                            "startDate": val.startDate,
                            "statusArray": val.statusArray,
                            "projectId": props.projectId,
                            "statusDate": val?.statusArray?.length ? new Date(val?.statusArray?.[val.statusArray.length - 1]?.statusDateValue).getTime() || 0: 0,
                            "statusId": val?.statusArray?.length ? val?.statusArray?.[val.statusArray.length - 1]?.milestoneStatusColor || '' : '',
                            "billingPeriod":billingPeriod.value,
                            "updatedAt": new Date()
                        }
                        milestoneArray.value[ind] = {...object};
                    }
                    if(status){
                        commit("settings/mutateProjectMilestoneStatus", {data:{value:status},op:'modified',countType:'increment'});
                    }
                    isSpinner.value = false;
                });
            }
            if(action === 'clear') {
                edithourlyindex.value = 0.1;
            }
            // cancelstatus milestone api
            if(action === 'cancelstatus'){
                let amount = 0;
                isSpinner.value = true;
                user.companyOwnerId = companyOwner.value.userId
                let obj = settingStatus.value.filter((e)=>{
                    return e.value === 'CANCELLED'
                });
                status.statusArray.forEach((ele,index)=>{
                    if(ele.milestoneStatusColor === 'CANCELLED'){
                        status.statusArray.splice(index,1);
                    }
                });
                status.statusArray.push({
                    statusDateValue: new Date(),
                    milestoneStatusColor:obj[0].value
                });
                if(status.refundedAmount && status.refundedAmount.length){
                    let refundAmount = 0;
                    status.refundedAmount.forEach((temp)=>{
                        refundAmount += temp.amount;
                    });
                    amount = status.amount - refundAmount;
                }else{
                    amount = status.amount;
                }
                cancelMilestoneHelper(projectId.value,companyId.value,user,projectName.value,status,obj,true,amount).then(() => {
                    let ind = milestoneArray.value.findIndex((x) => (x._id === status._id));
                    if(ind > -1){
                        const object = {
                            "statusDate": status?.statusArray?.length ? new Date(status?.statusArray[status?.statusArray?.length - 1]?.statusDateValue).getTime() || 0: 0,
                            "statusId": status?.statusArray?.length ? status?.statusArray[status?.statusArray?.length - 1]?.milestoneStatusColor || '' : '' ,
                            "statusArray": status.statusArray
                        }
                        milestoneArray.value[ind] = {...milestoneArray.value[ind], ...object};
                    }
                    isSpinner.value = false;
                });
            }
            // api for refund milestone
            if(action === "refund"){
                isSpinner.value = true;
                user.companyOwnerId = companyOwner.value.userId
                milestoneArray.value[val].refundedAmount.push({
                    'amount':Number(data),
                    'date':status
                });
                refundMilestoneHelper(projectId.value,companyId.value,milestoneArray.value[val],true,data,user,props?.currency?.symbol).then(() => {
                    isSpinner.value = false;
                });
            }
            // api for clear milestone status
            if(action === "clearStatus"){
                edithourlyindex.value = 0.1;
                isSpinner.value = true;
                user.companyOwnerId = companyOwner.value.userId;
                clearMilestoneHelper(projectId.value,companyId.value,user,projectName.value,status).then(() => {
                    let ind = milestoneArray.value.findIndex((x) => (x._id === status._id));
                    if(ind > -1){
                        const object = {
                            "statusDate": 0,
                            "statusId": '',
                            "statusArray": []
                        }
                        milestoneArray.value[ind] = {...milestoneArray.value[ind], ...object};
                    }
                    if(status?.statusArray && status?.statusArray?.length){
                        status.statusArray.forEach((e) => {
                            commit("settings/mutateProjectMilestoneStatus", {data:{value:e.milestoneStatusColor},op:'modified',countType:'decrement'});
                        });
                    }
                    isSpinner.value = false;
                });
            }
        }
    }
    const handleClickOutside = (event) => {
        if(addNew.value && !event.target.closest('.monthly-calendar-add') && !sidebarPrevent.value) {
            addNew.value = false;
        }else{
            sidebarPrevent.value = false;
        }
    };
</script>