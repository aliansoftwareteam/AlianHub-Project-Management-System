<template>
    <tr class="mr-row--total">
        <td class="fixed" :class="[{'td_class_border':props.daysOrMonth && props.daysOrMonth.length ? new Date().getMonth() === 0 && new Date().getDate() === 1 : new Date().getMonth() === 0}]">
            <div class="d-flex justify-content-between">
                <div class="thtitle padding_wrapper_arrow">
                    <button type="button" class="mr-toggle" :class="{ 'is-open': toogleTotalDropDown }" :aria-expanded="toogleTotalDropDown" :aria-label="$t('Milestone.toggle_rows', { name: $t('TimeTracker.total') })" @click="handleToogleTotal()">
                        <span class="ah-mask-icon" :style="maskOf(arrowToogle)" aria-hidden="true"></span>
                    </button>
                    <span class="thtitle_currency_family padding_wrapper_left_arrow">{{$t("TimeTracker.total")}}</span>
                </div>
                <div class="thtitle"></div>
                <div class="thtitle"></div>
                <div class="thtitle">
                    <span class="thtitle_currency_family text-ellipsis d-block" :title="`${props.currencySymbol} ${props.daysOrMonth && props.daysOrMonth.length === 0 ? getCommaSeperatedNumber(calculateTotalAmount()) : getCommaSeperatedNumber(calculateTotalAmountDate())}`">
                        {{props.currencySymbol}} {{props.daysOrMonth && props.daysOrMonth.length === 0 ? getCommaSeperatedNumber(calculateTotalAmount()) : getCommaSeperatedNumber(calculateTotalAmountDate())}}
                    </span>
                </div>
            </div>
        </td>
        <template v-for="(monthDate,monthIndex) in props.daysOrMonth && props.daysOrMonth.length ? props.daysOrMonth : 12" :key="monthIndex">
            <td :class="[{
                    'border-color-highlight-left':props.daysOrMonth.length === 0 ? new Date().getMonth() === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex + 1,
                    'border-color-highlight-left-next':props.daysOrMonth.length === 0 ? new Date().getMonth() + 1 === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex
                }]"
                class="border_currency totalAmountCurrencyFamily text-center text-ellipsis" :title="`${totalProjectCurrency(monthDate,monthIndex) === 0 ? '' : `${props.currencySymbol} ${getCommaSeperatedNumber(totalProjectCurrency(monthDate,monthIndex))}`}`">
                {{totalProjectCurrency(monthDate,monthIndex) === 0 ? '' : `${props.currencySymbol} ${getCommaSeperatedNumber(totalProjectCurrency(monthDate,monthIndex))}`}}
            </td>
        </template>
    </tr>
    <template v-if="toogleTotalDropDown">
        <tr class="mr-row--total">
            <td class="fixed" :class="[{'td_class_border':props.daysOrMonth && props.daysOrMonth.length ? new Date().getMonth() === 0 && new Date().getDate() === 1 : new Date().getMonth() === 0}]">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="thtitle">
                    </div>
                    <div class="thtitle_wrapper">
                        <span class="thtitle_currency_family_status short_mil_status_wrapper mr-label" :title="$t('Milestone.refunded_amount')">
                            {{$t('Milestone.refunded_amount')}}
                        </span>
                    </div>
                    <div class="thtitle thtitle_currency_family mr-amount--muted pl-5px text-ellipsis d-block" :title="`${props.currencySymbol} ${totalAmountRefund(released) === 0 ? '' : `-`} ${props.daysOrMonth && props.daysOrMonth.length === 0 ? getCommaSeperatedNumber(totalAmountRefund(released)) : getCommaSeperatedNumber(totalAmountRefund(released))}`">
                        {{props.currencySymbol}} {{totalAmountRefund(released) === 0 ? '' : `-`}} {{props.daysOrMonth && props.daysOrMonth.length === 0 ? getCommaSeperatedNumber(totalAmountRefund(released)) : getCommaSeperatedNumber(totalAmountRefund(released))}}
                    </div>
                </div>
            </td>
            <template v-for="(monthDate,monthIndex) in props.daysOrMonth && props.daysOrMonth.length ? props.daysOrMonth : 12" :key="monthIndex">
                <td :class="[{
                        'border-color-highlight-left':props.daysOrMonth.length === 0 ? new Date().getMonth() === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex + 1,
                        'border-color-highlight-left-next':props.daysOrMonth.length === 0 ? new Date().getMonth() + 1 === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex
                    }]"
                    class="border_currency totalAmountCurrencyFamily text-center text-ellipsis"
                    :title="`${totalProjectMonthYearRefund(monthDate,monthIndex,released) === 0 ? '' : `${props.currencySymbol} - ${getCommaSeperatedNumber(totalProjectMonthYearRefund(monthDate,monthIndex,released))}`}`"
                >
                    {{totalProjectMonthYearRefund(monthDate,monthIndex,released) === 0 ? '' : `${props.currencySymbol} - ${getCommaSeperatedNumber(totalProjectMonthYearRefund(monthDate,monthIndex,released))}`}}
                </td>
            </template>
        </tr>
        <tr class="mr-row--total" v-for="(statusName,indexStatus) in statusObj" :key="indexStatus">
            <td class="fixed" :class="[{'td_class_border':props.daysOrMonth && props.daysOrMonth.length ? new Date().getMonth() === 0 && new Date().getDate() === 1 : new Date().getMonth() === 0}]">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="thtitle">
                    </div>
                    <div class="thtitle_wrapper">
                        <span
                            class="thtitle_currency_family_status short_mil_status_wrapper mr-status-chip ah-status-ink"
                            :style="chipStyle(settingStatus.filter((ele) => {return ele.value === indexStatus})[0])"
                            :title="settingStatus.filter((ele) => {return ele.value === indexStatus})[0].name"
                        >
                            {{settingStatus.filter((ele) => {return ele.value === indexStatus})[0].name}}
                        </span>
                    </div>
                    <div class="thtitle thtitle_currency_family mr-amount--muted pl-5px text-ellipsis d-block" :title="`${props.currencySymbol} ${props.daysOrMonth && props.daysOrMonth.length === 0 ? getCommaSeperatedNumber(totalAmount(statusName.multipleStatus)) : getCommaSeperatedNumber(totalAmountFilterMonth(statusName.multipleStatus))}`">
                        {{props.currencySymbol}} {{props.daysOrMonth && props.daysOrMonth.length === 0 ? getCommaSeperatedNumber(totalAmount(statusName.multipleStatus)) : getCommaSeperatedNumber(totalAmountFilterMonth(statusName.multipleStatus))}} 
                    </div>
                </div>
            </td>
            <template v-for="(monthDate,monthIndex) in props.daysOrMonth && props.daysOrMonth.length ? props.daysOrMonth : 12" :key="monthIndex">
                <td 
                :class="[{
                    'border-color-highlight-left':props.daysOrMonth.length === 0 ? new Date().getMonth() === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex + 1,
                    'border-color-highlight-left-next':props.daysOrMonth.length === 0 ? new Date().getMonth() + 1 === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex
                }]"
                class="border_currency totalAmountCurrencyFamily text-center text-ellipsis"
                :title="`${totalProjectMonthYear(monthDate,monthIndex,statusName.multipleStatus) === 0 ? '' : `${props.currencySymbol} ${getCommaSeperatedNumber(totalProjectMonthYear(monthDate,monthIndex,statusName.multipleStatus))}`}`"
                >{{totalProjectMonthYear(monthDate,monthIndex,statusName.multipleStatus) === 0 ? '' : `${props.currencySymbol} ${getCommaSeperatedNumber(totalProjectMonthYear(monthDate,monthIndex,statusName.multipleStatus))}`}}</td>
            </template>
        </tr>
    </template>

</template>

<script setup>
    // import 
    import { useStore } from "vuex";
    import { defineProps,computed, ref,watch } from 'vue';
    import {milestoneData} from '@/components/organisms/FixMilestone/helper.js';
    import { statusChipStyle } from '@/utils/statusChipColors';
    import { maskOf } from '@/utils/iconMask';
    const chipStyle = (status) => statusChipStyle({ textColor: status?.textColor, bgColor: status?.backgroundColor });
    const { getCommaSeperatedNumber } = milestoneData();
    // store
    const { getters } = useStore();
    // getter
    const settingStatus = computed(() => getters['settings/projectMilestoneStatus']);
    // variable
    const arrowToogle = require("@/assets/images/table_arrow.png");
    const statusObj = ref({});
    const toogleTotalDropDown = ref(false);
    const released = ref([]);
    // props
    const props = defineProps({
        daysOrMonth:{type:Array,default:()=>[]},
        allMilestoneArray:{type:Array,default:()=>[]},
        currencySymbol:{type:String,default:''},
        yearSelected:{type:String,require:true}
    });
    watch(() => props.allMilestoneArray, (newValue,oldValue) => {
        if(newValue !== oldValue) {
            milestoneStatus();
        }
    });
    // milestonestatus
    const milestoneStatus = () => {
        const uniqueValues = new Set();
        statusObj.value = {};
        released.value = [];
        props.allMilestoneArray.forEach((obj)=>{
            const fieldValue = obj.statusId;
            if (!uniqueValues.has(fieldValue)) {
                statusObj.value = {
                    ...statusObj.value,
                    [`${obj.statusId}`]: {
                        'multipleStatus':[{
                            'statusDate':obj.statusDate,
                            'amount':obj.amount
                        }]
                    }
                }
                if(obj.statusId === "RELEASED"){
                    if(obj.refundedAmount && obj.refundedAmount.length){
                        obj.refundedAmount.forEach((value)=>{
                            released.value.push({'amount':value.amount,'date':value.date,'statusDate':obj.statusDate})
                        });
                    }else{
                        released.value = [];
                    }
                }
                uniqueValues.add(fieldValue);
            }else{
                if(obj.statusId === "RELEASED"){
                    if(obj.refundedAmount && obj.refundedAmount.length){
                        obj.refundedAmount.forEach((value)=>{
                            released.value.push({'amount':value.amount,'date':value.date,'statusDate':obj.statusDate})
                        });
                    }else{
                        released.value = [];
                    }
                }
                statusObj.value[`${obj.statusId}`].multipleStatus.push({'statusDate':obj.statusDate,'amount':obj.amount});
            }
        });
    };
    milestoneStatus();
    // total currency
    const totalProjectCurrency = (value,ele) => {
        let total = 0
        if(props.daysOrMonth && props.daysOrMonth.length){
            props.allMilestoneArray.filter((filterELe) => {return (filterELe.refundedAmount && filterELe.refundedAmount.length) ? filterELe : new Date(filterELe.statusDate).getDate() === ele + 1 && new Date(value.date).getMonth() === new Date(filterELe.statusDate).getMonth()}).forEach((element) => {
                if(element.refundedAmount && element.refundedAmount.length){
                    if(new Date(element.statusDate).getDate() === ele + 1 && new Date(value.date).getMonth() === new Date(element.statusDate).getMonth() && `${new Date(element.statusDate).getFullYear()}` === props.yearSelected){
                        total += element.amount
                        element.refundedAmount.filter((filteramonut) => new Date(filteramonut.date).getDate() === ele + 1 && new Date(filteramonut.date).getMonth() === new Date(value.date).getMonth() && `${new Date(filteramonut.date).getFullYear()}` === props.yearSelected).forEach((e)=>{
                            total -= e.amount
                        });
                    }else{
                        element.refundedAmount.filter((filteramonut) => new Date(filteramonut.date).getDate() === ele + 1 && new Date(filteramonut.date).getMonth() === new Date(value.date).getMonth() && `${new Date(filteramonut.date).getFullYear()}` === props.yearSelected).forEach((e)=>{
                            total -= e.amount
                        });
                    }
                }else{
                    total += element.amount;
                }
            });
        }else{
            props.allMilestoneArray.filter((filterELe) => {return (filterELe.refundedAmount && filterELe.refundedAmount.length) ? filterELe : new Date(filterELe.statusDate).getMonth() === ele}).forEach((element) => {
                if(element.refundedAmount && element.refundedAmount.length){
                    if(new Date(element.statusDate).getMonth() === ele && `${new Date(element.statusDate).getFullYear()}` === props.yearSelected){
                        total += element.amount
                        element.refundedAmount.filter((filteramonut) => new Date(filteramonut.date).getMonth() === ele && `${new Date(filteramonut.date).getFullYear()}` === props.yearSelected).forEach((e)=>{
                            total -= e.amount
                        });
                    }else{
                        element.refundedAmount.filter((filteramonut) => new Date(filteramonut.date).getMonth() === ele && `${new Date(filteramonut.date).getFullYear()}` === props.yearSelected).forEach((e)=>{
                            total -= e.amount
                        });
                    }
                }else{
                    total += element.amount; 
                }
            });
        }
        return total
    };
    // total Month and Year other then refund amount
    const totalProjectMonthYear = (value,ele,statusArray) => {
        let total = 0
        if(props.daysOrMonth && props.daysOrMonth.length){
            statusArray.filter((filterELe)=> new Date(filterELe.statusDate).getDate() === ele + 1 && new Date(value.date).getMonth() === new Date(filterELe.statusDate).getMonth() && `${new Date(filterELe.statusDate).getFullYear()}` === props.yearSelected).forEach((element) => {
                total += element.amount;
            });
        }else{
            statusArray.filter((filterELe) => new Date(filterELe.statusDate).getMonth() === ele && `${new Date(filterELe.statusDate).getFullYear()}` === props.yearSelected).forEach((element) => {
                total += element.amount;
            });
        }
        return total
    };
    const totalProjectMonthYearRefund = (value,ele,statusArray) => {
        let total = 0
        if(props.daysOrMonth && props.daysOrMonth.length){
            statusArray.filter((filterELe) => new Date(filterELe.date).getDate() === ele + 1 && new Date(value.date).getMonth() === new Date(filterELe.date).getMonth() && `${new Date(filterELe.date).getFullYear()}` === props.yearSelected).forEach((element) => {
                total += element.amount;
            });
        }else{
            statusArray.filter((filterELe) => new Date(filterELe.date).getMonth() === ele && `${new Date(filterELe.date).getFullYear()}` === props.yearSelected).forEach((element) => {
                total += element.amount;
            });
        }
        return total
    };
    const handleToogleTotal = () => {
        toogleTotalDropDown.value = !toogleTotalDropDown.value;
    };
    const totalAmount = (value) => {
        let filterMile = value.filter((ele)=>{
            return `${new Date(ele.statusDate).getFullYear()}` === props.yearSelected
        });
        return filterMile.reduce((accumulator, currentValue) => {
            return accumulator + currentValue.amount;
        }, 0);
    };
    const totalAmountRefund = (value) => {
        if(props.daysOrMonth && props.daysOrMonth.length){
            let start = new Date(props.daysOrMonth[0].date).setHours(0,0,0)
            return value.reduce((accumulator, currentValue) => {
                if (new Date(currentValue.date).getMonth() === new Date(start).getMonth() && `${new Date(currentValue.date).getFullYear()}` === props.yearSelected) {
                    return accumulator + currentValue.amount;
                } else {
                    return accumulator;
                }
            }, 0);
        }else{
            return value.reduce((accumulator, currentValue) => {
                if (`${new Date(currentValue.date).getFullYear()}` === props.yearSelected) {
                    return accumulator + currentValue.amount;
                } else {
                    return accumulator;
                }
            }, 0);
        }
    };
    const totalAmountFilterMonth = (value) => {
        let start = new Date(props.daysOrMonth[0].date).setHours(0,0,0)
        let filterMile = value.filter((ele)=>{
            return new Date(ele.statusDate).getMonth() === new Date(start).getMonth() && `${new Date(ele.statusDate).getFullYear()}` === props.yearSelected
        });
        return filterMile.reduce((accumulator, currentValue) => {
            return accumulator + currentValue.amount;
        }, 0);
    };
    // all milesetoneCalculation
    const calculateTotalAmount = () => {
        return props.allMilestoneArray.reduce((accumulator, currentValue) => {
            let totalAmount = accumulator;
            if (currentValue.refundedAmount && currentValue.refundedAmount.length) {
                if(`${new Date(currentValue.statusDate).getFullYear()}` === props.yearSelected){
                    totalAmount += currentValue.amount;
                    currentValue.refundedAmount.filter((filteramonut) => `${new Date(filteramonut.date).getFullYear()}` === props.yearSelected).forEach((e) => {
                        totalAmount -= e.amount;
                    });
                }else{
                    currentValue.refundedAmount.filter((filteramonut) => `${new Date(filteramonut.date).getFullYear()}` === props.yearSelected).forEach((e) => {
                        totalAmount -= e.amount;
                    });
                }
                
            } else {
                totalAmount += currentValue.amount;
            }
            return totalAmount;
        },0);
    };
    const calculateTotalAmountDate = () => {
        let start = new Date(props.daysOrMonth[0].date).setHours(0,0,0)
        let filterMile = props.allMilestoneArray.filter((ele)=>{
            return ele.refundedAmount && ele.refundedAmount.length ? ele : new Date(ele.statusDate).getMonth() === new Date(start).getMonth()
        });
        return filterMile.reduce((accumulator, currentValue) => {
            let totalAmount = accumulator;
            if (currentValue.refundedAmount && currentValue.refundedAmount.length) {
                if(new Date(currentValue.statusDate).getMonth() === new Date(start).getMonth()){
                    totalAmount += currentValue.amount;
                    currentValue.refundedAmount.filter((filteramonut) => new Date(filteramonut.date).getMonth() === new Date(start).getMonth() && `${new Date(filteramonut.date).getFullYear()}` === props.yearSelected).forEach((e) => {
                        totalAmount -= e.amount;
                    });
                }else{
                    currentValue.refundedAmount.filter((filteramonut) => new Date(filteramonut.date).getMonth() === new Date(start).getMonth() && `${new Date(filteramonut.date).getFullYear()}` === props.yearSelected).forEach((e) => {
                        totalAmount -= e.amount;
                    });
                }
            } else {
                totalAmount += currentValue.amount;
            }
            return totalAmount;
        }, 0);
    };
</script>
