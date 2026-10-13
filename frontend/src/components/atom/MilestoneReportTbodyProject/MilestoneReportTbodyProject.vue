<template>
    <tr class="project_name_wrapper">
        <td class="project_name_td" :class="[{'td_class_border':props.daysOrMonth && props.daysOrMonth.length ? new Date().getMonth() === 0 && new Date().getDate() === 1 : new Date().getMonth() === 0}]">
            <div class="d-flex justify-content-between">
                <div class="thtitle">
                    <button type="button" class="mr-toggle" :class="{ 'is-open': props.project._id === projectId }" :aria-expanded="props.project._id === projectId" :aria-label="$t('Milestone.toggle_rows', { name: props.project.ProjectName })" @click="handleToogleProject(props.project._id)">
                        <span class="ah-mask-icon" :style="maskOf(arrowToogle)" aria-hidden="true"></span>
                    </button>
                    <span @click="redirectProjectList(props.project)" :class="[{'cursor-pointer':props.project.statusType !== 'close'}]" class="thtitle_currency_family short_name padding_wrapper_left_arrow" :title="props.project.ProjectName">{{props.project.ProjectName}}</span>
                    <span v-if="props.project.isPrivateSpace === false" class="ah-mask-icon mr-public" :style="maskOf(publicFolder)" role="img" :aria-label="$t('Milestone.public_project')"></span>
                </div>
                <div class="thtitle"></div>
                <div class="thtitle thtitle_currency_family padding_wrappper_thtitle">
                    {{props.project.StartDate ? convertDateFormat(props.project.StartDate,'',{showDayName: false}) : ''}}
                </div>
                <div class="thtitle thtitle_currency_family">
                    {{props.project.EndDate ? convertDateFormat(props.project.EndDate,'',{showDayName: false}) : ''}}
                </div>
            </div>
        </td>
        <template v-for="(monthDate,monthIndex) in props.daysOrMonth && props.daysOrMonth.length ? props.daysOrMonth : 12" :key="monthIndex">
            <td :class="[{
                    'border-color-highlight-left':props.daysOrMonth.length === 0 ? new Date().getMonth() === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex + 1,
                    'border-color-highlight-left-next':props.daysOrMonth.length === 0 ? new Date().getMonth() + 1 === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex
                }]"
                class="border_currency totalAmountCurrencyFamily mr-amount--project text-center text-ellipsis"
                :title="`${totalProject(monthDate,monthIndex) === 0 ? '' : `${props.currencySymbol} ${getCommaSeperatedNumber(totalProject(monthDate,monthIndex))}`}`"
            >
                {{totalProject(monthDate,monthIndex) === 0 ? '' : `${props.currencySymbol} ${getCommaSeperatedNumber(totalProject(monthDate,monthIndex))}`}}
            </td>
        </template>
    </tr>
    <template v-if="props.project._id === projectId">
        <template v-for="(milestoneObj,milIndex) in props.project.milestoneArray" :key="milIndex">
            <MilestoneReportTbodyMilestone 
                :milestoneObj="milestoneObj"
                :currencySymbol="props.currencySymbol"
                :daysOrMonth="props.daysOrMonth"
                :yearSelected="props.yearSelected"
                :projectDetail="props.project"
            />
        </template>
    </template>
    <tr class="project_name_wrapper" v-if="props.project._id === projectId">
        <td class="project_name_mil_td" :class="[{'td_class_border':props.daysOrMonth && props.daysOrMonth.length ? new Date().getMonth() === 0 && new Date().getDate() === 1 : new Date().getMonth() === 0}]">
            <div class="d-flex justify-content-between align-items-center">
                <div class="thtitle">
                    <div class="thtitle_currency_family_mil mr-label">
                        {{$t('Milestone.refunded_amount')}}
                    </div>
                </div>
                <div class="thtitle">
                </div>
                <div class="thtitle">
                </div>
                <div class="thtitle">
                </div>
            </div>
        </td>
        <template v-for="(monthDate,monthIndex) in props.daysOrMonth && props.daysOrMonth.length ? props.daysOrMonth : 12" :key="monthIndex">
            <td :class="[{
                    'border-color-highlight-left':props.daysOrMonth.length === 0 ? new Date().getMonth() === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex + 1,
                    'border-color-highlight-left-next':props.daysOrMonth.length === 0 ? new Date().getMonth() + 1 === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex
                }]"
                class="border_currency totalMilestoneCurrencyFamily text-center"
            >
                {{handleRefundedAmount(monthDate,monthIndex) !== 0 ? `${props.currencySymbol} - ${getCommaSeperatedNumber(handleRefundedAmount(monthDate,monthIndex))}` : ''}}
            </td>
        </template>
    </tr>
</template>

<script setup>
    import { ref,defineProps,watch,inject } from 'vue';
    import { useConvertDate } from "@/composable";
    import MilestoneReportTbodyMilestone from '@/components/atom/MilestoneReportTbodyMilestone/MilestoneReportTbodyMilestone.vue'
    import { useRouter } from 'vue-router';
    import {milestoneData} from '@/components/organisms/FixMilestone/helper.js';
    import { maskOf } from '@/utils/iconMask';
    const { getCommaSeperatedNumber } = milestoneData();
    const router = useRouter();
    const { convertDateFormat } = useConvertDate();

    // Variable
    const prevProjectId = ref('');
    const projectId = ref('');

    // image
    const arrowToogle = require("@/assets/images/table_arrow.png");
    const publicFolder = require("@/assets/images/public_folder.png");
    //inject
    const companyId = inject('$companyId');
    // watch
    watch(()=> projectId.value,(newValue) =>{
        prevProjectId.value = newValue;
    });
    // props
    const props = defineProps({
        project: {type:Object,default: () => {}},
        currencySymbol: {type:String,required:true},
        daysOrMonth:{type:Array,default:()=>[]},
        yearSelected:{type:String,require:true}
    });

    // function start
    // toogle event for project
    const handleToogleProject = (value) => {
        if(prevProjectId.value && prevProjectId.value === projectId.value ){
            projectId.value = "";
        }else{
            projectId.value = value;
        }
    };
    const totalProject = (value,ele) => {
        let total = 0
        if(props.daysOrMonth && props.daysOrMonth.length){
            props.project.milestoneArray.filter((filterELe) => {return (filterELe.refundedAmount && filterELe.refundedAmount.length) ? filterELe : new Date(filterELe.statusDate).getDate() === ele + 1 && new Date(value.date).getMonth() === new Date(filterELe.statusDate).getMonth()}).forEach((element) => {
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
            props.project.milestoneArray.filter((filterELe) => {return (filterELe.refundedAmount && filterELe.refundedAmount.length) ? filterELe : new Date(filterELe.statusDate).getMonth() === ele}).forEach((element) => {
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
    // refund amount
    const handleRefundedAmount = (value,ele) => {
        let total = 0;
        if(props.daysOrMonth && props.daysOrMonth.length){
            props.project.milestoneArray.filter((filterELe) => {return (filterELe.refundedAmount && filterELe.refundedAmount.length) ? filterELe : new Date(filterELe.statusDate).getDate() === ele + 1 && new Date(value.date).getMonth() === new Date(filterELe.statusDate).getMonth()}).forEach((element)=>{
                element.refundedAmount.filter((filteramonut) => new Date(filteramonut.date).getDate() === ele + 1 && new Date(value.date).getMonth() === new Date(filteramonut.date).getMonth() && `${new Date(filteramonut.date).getFullYear()}` === props.yearSelected).forEach((e)=>{
                    total += e.amount
                });
            });
        }else{
            props.project.milestoneArray.filter((filterELe) => {return (filterELe.refundedAmount && filterELe.refundedAmount.length) ? filterELe : new Date(filterELe.statusDate).getMonth() === ele}).forEach((element) => {
                element.refundedAmount.filter((filteramonut) => new Date(filteramonut.date).getMonth() === ele && `${new Date(filteramonut.date).getFullYear()}` === props.yearSelected).forEach((e)=>{
                    total += e.amount
                });
            });
        }
        return total
    };
    const redirectProjectList = (data) => {
        if(data.statusType !== 'close'){
            router.push({ name: 'Project', params: {cid: companyId.value, id: data._id},query: {tab: 'ProjectDetail'}});
        }
    };
</script>
