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
            <table class="table-responsive fix-milestone">
                <SpinnerComp :is-spinner="isSpinner" />
                <thead :class="[{'pointer-event-none':isSpinner}]">
                    <tr>
                        <th></th>
                        <th>{{$t('Milestone.milestone_name')}}</th>
                        <th>{{$t('ProjectDetails.start_date')}}</th>
                        <th>{{$t('ProjectDetails.end_date')}}</th>
                        <th>{{$t('Projects.due_date')}}</th>
                        <th>{{$t('ProjectDetails.amount')}}</th>
                        <th>{{$t('Projects.status') }}</th>
                        <th>{{$t('Milestone.status_date')}}</th>
                        <th></th>
                    </tr>
                </thead>
                <draggable v-if="milestoneArray && milestoneArray.length" :class="[{'pointer-event-none':isSpinner}]" v-model="milestoneArray" item-key="Milestone" tag="tbody" draggable=".items" @change="handleDraggable">
                    <template #item="{ element, index }">
                        <FixMilestoneTr :fixMilestoneProps="element" :editfixMilestone="props.planCondition ? editfixindex : 0.1" :fixMilestoneIndex="index" :key="index" :itemKey="`fix${index}`"
                            :class="{'items': !isDraggableFix ? props.planCondition ? true : false : false}"
                            @editMilestone="handleEditMilestone"
                            :currencyMilestone="props.currency"
                            :settingMilestoneStatus="settingStatus"
                            @deleteMilestone="deleteMilestone"
                            :refundId="refundId"
                            @setRefundId="refundId = $event,editfixindex=0.1,addNew=false"
                            :permissionData="props.permissionData"
                            :planCondition="props.planCondition"
                        />
                    </template>
                </draggable>
                <tfoot v-if="addNew" :class="[{'pointer-event-none':isSpinner}]"><FixMilestoneInput :currencyMilestone="props.currency" :settingMilestoneStatusAdd="settingStatus" @addMilestone="handleAddMilestone"/></tfoot>
            </table>
            <div :class="[{'pointer-event-none':isSpinner}]">
                <div class="d-flex align-items-center justify-content-between wrapper_add_amount">
                    <div class="add_new_width" v-if="props.permissionData">
                        <button type="button" @click="handleAddNew" class="add_new cursor-pointer" :disabled="isSpinner">{{$t('Milestone.add_new')}}</button>
                    </div>
                    <div class="add_new_width" v-if="!props.permissionData"></div>
                    <div class="total_amount_width">
                        <span class="total_amount">{{$t('Milestone.total_amount')}} :- {{totalAmountRefundedForFix ? `${getCommaSeperatedNumber(fixAmountTotal)} - ${getCommaSeperatedNumber(totalAmountRefundedForFix)} =` : '' }} {{props?.currency?.symbol}} {{getCommaSeperatedNumber(totalDiffernece)}}</span>
                    </div>
                </div>
            </div>
            <ConfirmModal :modelValue="showConfirmModal" :acceptButtonText="$t('Home.Confirm')"
                    :cancelButtonText="$t('Projects.cancel')" maxlength="150" :header="true" :showCloseIcon="false"
                @accept="handleConfirm"
                @close="showConfirmModal = false"
            >
                <template #header><h3 class="m-0">{{$t('Home.Confirm')}}</h3></template>
                <template #body><span>{{$t('Milestone.are_you_sure')}} ?</span></template>
            </ConfirmModal>
        </div>
    </div>
</template>

<script setup>
    import { useStore } from "vuex";
    import * as env from '@/config/env';
    import draggable from 'vuedraggable';
    import { apiRequest } from "@/services";
    import { useGetterFunctions,draggble } from "@/composable";
    import ConfirmModal from '@/components/atom/Modal/Modal.vue';
    import '@/components/organisms/FixMilestone/FixMilestone.css';
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import {milestoneData} from '@/components/organisms/FixMilestone/helper.js';
    import FixMilestoneTr from '@/components/atom/FixMilestoneTr/FixMilestoneTr.vue';
    import FixMilestoneInput from '@/components/atom/FixMilestoneInput/FixMilestoneInput.vue';
    import { computed, defineProps,ref,inject, onMounted, watch } from 'vue';
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
    const { 
        deleteMilestoneHelper,
        addMilestoneHelper,
        editMilestoneHelper,
        clearMilestoneHelper,
        cancelMilestoneHelper,
        refundMilestoneHelper,
        handleDraggableMilestone 
    } = milestoneData();

    const { getters,commit } = useStore();
    const { generateOrder } = draggble();
    const {getUser} = useGetterFunctions();

    const emit = defineEmits(['updateTotalDifference']);
    
    //props
    const props = defineProps({
        currency: {type: Object,required: true},
        projectId: {type: String,required: true},
        ProjectName: {type: String,required: true},
        permissionData:{type: Boolean,default: false},
        planCondition:{type: Boolean,default: false},
        currencyValue:{type: String,default: ''}
    });

    // computed
    const companyOwner = computed(() => {return getters["settings/companyOwnerDetail"]});
    const settingStatus = computed(() => getters['settings/projectMilestoneStatus']);
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
    const totalDiffernece = computed(()=>{return (fixAmountTotal.value - totalAmountRefundedForFix.value)});

    // variable
    const refundId = ref('');
    const addNew = ref(false);
    const deleteIndex = ref(0.1);
    const isSpinner = ref(false);
    const editfixindex = ref(0.1);
    const milestoneArray = ref([]);
    const userId = inject("$userId");
    const user = getUser(userId.value);
    const showConfirmModal = ref(false);
    const deleteMilestoneName = ref('');
    const milestoneObjForDelete = ref({});
    const companyId = inject('$companyId');
    const isDraggableFix = ref(props.permissionData ? false : true);
    watch(()=> props.projectId ,(newValue,oldValue) =>{
        if(newValue !== oldValue){
            getFixMilestoneData();
        }
    });
    watch([() => fixAmountTotal.value , () => totalAmountRefundedForFix.value], ([newFix, newTotalAmount]) => {
        emit("updateTotalDifference", newFix - newTotalAmount);
    });
    onMounted(() => {
        getFixMilestoneData();
    });

    const getFixMilestoneData = async () => {
        try {
            milestoneArray.value = [];
            await apiRequest("get",`${env.MILESTONE_PROJECT}/${props.projectId}`).then((res) => {
                if(res.status === 200){
                    if(res?.data && res?.data?.length){
                        res?.data?.forEach((e) => {
                            e.startDate = e.startDate !== 0 ? new Date(e.startDate) : '';
                            e.endDate = e.endDate !== 0 ? new Date(e.endDate) : '';
                            e.dueDate = e.dueDate !== 0 ? new Date(e.dueDate) : '';
                            milestoneArray.value.push(e);
                        });
                        milestoneArray.value.sort((a, b) => {if (a.order < b.order) return -1;if (a.order > b.order) return 1;return 0;});
                    }
                }
            }).catch((error) => {
                console.error("Error in getFixMilestoneData",error);
            });
        } catch (error) {
            console.error("Error in getFixMilestoneData",error);
        }
    };
    
    const getCommaSeperatedNumber = (n)=> {
        let numVal = Number(n)
        return numVal.toLocaleString('en-US', {maximumFractionDigits: 2, minimumFractionDigits: 2, useGrouping: true});
    };
    //api for edit milestone
    const handleEditMilestone = (action,val,data,status,prevMilestoneName) => {
        if(props.planCondition){
            if(action === 'edit'){
                editfixindex.value = val;
                isDraggableFix.value = data;
                addNew.value = false;
                refundId.value = '';
            }
            if(action === 'clear' || action === 'editMil' || action === 'clearStatus'){
                isDraggableFix.value = action === 'editMil' ? false :data;
                editfixindex.value = 0.1;
            }
            // api for edit milestone
            if(action === 'editMil'){
                let diffamount = 0;
                let amount = 0;
                isSpinner.value = true;
                user.companyOwnerId = companyOwner.value.userId
                let obj = [];
                let settingKey = '';
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
                editMilestoneHelper(props.projectId,companyId.value,user,props.ProjectName,val,status,prevMilestoneName,obj,false,amount,props.currencyValue).then(() => {
                    let ind = milestoneArray.value.findIndex((x) => (x._id === val.id));
                    if(ind > -1){
                        const object = {
                            "_id": val.id,
                            "milestoneName": val.milestoneName,
                            "amount": val.amount,
                            "projectId": props.projectId,
                            "startDate": val.startDate,
                            "endDate": val.endDate,
                            "dueDate": val.dueDate,
                            "statusDate": val?.statusArray?.length ? new Date(val?.statusArray?.[val.statusArray.length - 1]?.statusDateValue).getTime() || 0: 0,
                            "statusId": val?.statusArray?.length ? val?.statusArray?.[val.statusArray.length - 1]?.milestoneStatusColor || '' : '',
                            "refundedAmount": val.refundedAmount,
                            "statusArray": val.statusArray,
                            "order": val.order,
                            "maxRefundDate": val.maxRefundDate,
                            "minRefundDate": val.minRefundDate,
                            "createdAt": val?.createdAt,
                            "updatedAt": new Date()
                        }
                        milestoneArray.value[ind] = {...object};
                    }
                    if(status){
                        commit("settings/mutateProjectMilestoneStatus", {data:{value:status},op:'modified',countType:'increment'});
                    }
                    isSpinner.value = false;
                }).catch((err)=>{
                    console.error("ERR",err)
                });
            }
            // api for clear milestone status
            if(action === "clearStatus"){
                isSpinner.value = true;
                user.companyOwnerId = companyOwner.value.userId;
                clearMilestoneHelper(props.projectId,companyId.value,user,props.ProjectName,status).then(() => {
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
                }).catch((err)=>{
                    console.error("ERROR",err)
                });
            }
            // api for cancel milestone status
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
                cancelMilestoneHelper(props.projectId,companyId.value,user,props.ProjectName,status,obj,false,amount).then(() => {
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
                user.companyOwnerId = companyOwner.value.userId;
                milestoneArray.value[val].refundedAmount.push({
                    'amount':Number(data),
                    'date':status
                });
                refundMilestoneHelper(props.projectId,companyId.value,milestoneArray.value[val],false,data,user,props.currencyValue).then(() => {
                    isSpinner.value = false;
                });
            }
        }
    };
    // api for add milestone
    const handleAddMilestone = (action,value,statusObj) => {
        addNew.value = false;
        editfixindex.value = 0.1;
        isDraggableFix.value = false;
        if(action === 'add'){
            isSpinner.value = true;
            user.companyOwnerId = companyOwner.value.userId
            if(milestoneArray.value.length){
                let prevOrder = milestoneArray.value[milestoneArray.value.length - 1].order;
                value.order = generateOrder(prevOrder,'');
            }else{
                value.order = generateOrder('','');
            }
            addMilestoneHelper(props.projectId,companyId.value,user,props.ProjectName,value,statusObj,false,props.currencyValue).then((res) => {
                let ind = milestoneArray.value.findIndex((x) => (x._id === res._id));
                if(ind === -1){
                    milestoneArray.value.push(res);
                }
                commit("settings/mutateProjectMilestoneStatus", {data:{...statusObj},op:'modified',countType:'increment'});
                isSpinner.value = false;
            }).catch((err)=>{
                console.error("err",err);
                isSpinner.value = false;
            })
        }
    };
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
        deleteMilestoneHelper(props.projectId,companyId.value,user,milestoneObjForDelete.value,props.ProjectName,false,amount).then(() => {
            let ind = milestoneArray.value.findIndex((x) => (x._id === milestoneObjForDelete.value._id));
            if(ind > -1){
                milestoneArray.value.splice(ind,1);
            }
            if(milestoneObjForDelete.value?.statusArray && milestoneObjForDelete.value?.statusArray?.length){
                milestoneObjForDelete.value?.statusArray.forEach((e) => {
                    commit("settings/mutateProjectMilestoneStatus", {data:{value:e.milestoneStatusColor},op:'modified',countType:'decrement'});
                })
            }
            isSpinner.value = false;
        }).catch((err)=>{
            console.error("err",err);
            isSpinner.value = false;
        });
    };
    const handleAddNew = () => {
        if(!props?.planCondition){
            return;
        }else{
            addNew.value = true;
            editfixindex.value = 0.1;
            isDraggableFix.value = false;
            refundId.value = '';
        }
    };
    // api for draggable milestone
    const handleDraggable = (value) => {
        isSpinner.value = true;
        let newIndex = value.moved.newIndex;
        let upperIndex = newIndex - 1;
        let lowerIndex = newIndex + 1;
        milestoneArray.value[newIndex].order = generateOrder(upperIndex >= 0 ? milestoneArray.value[upperIndex].order : '', lowerIndex === milestoneArray.value.length ? '' : milestoneArray.value[lowerIndex].order);
        user.companyOwnerId = companyOwner.value.userId;
        handleDraggableMilestone(props.projectId,companyId.value,user,props.ProjectName,milestoneArray.value[newIndex]).then(() => {
            isSpinner.value = false;
        });
    };
    </script>