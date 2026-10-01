<template>
    <tr class="project_name_wrapper">
        <td class="project_name_mil_td" :class="[{'td_class_border':props.daysOrMonth && props.daysOrMonth.length ? new Date().getMonth() === 0 && new Date().getDate() === 1 : new Date().getMonth() === 0}]">
            <div class="d-flex justify-content-between align-items-center">
                <div class="thtitle">
                    <div class="d-flex align-items-center">
                        <span class="thtitle_currency_family_mil short_name_mil" :class="[{'cursor-pointer':props.projectDetail.statusType !== 'close'}]" @click="redirectProjectDetail(props.projectDetail)" :title="props.milestoneObj.milestoneName">{{props.milestoneObj.milestoneName}}</span>
                        <span
                            v-if="props.milestoneObj.statusId"
                            class="thtitle_currency_family_status short_mil_status mr-status-chip ah-status-ink"
                            :style="chipStyle(settingStatus.find((ele) => {return ele.value === props.milestoneObj.statusId}))"
                            :title="settingStatus.find((ele) => {return ele.value === props.milestoneObj.statusId})?.name"
                        >
                            {{settingStatus.find((ele) => {return ele.value === props.milestoneObj.statusId})?.name}}
                        </span>
                    </div>
                </div>
                <div class="thtitle thtitle_currency_family_mil">
                    {{props.milestoneObj.statusDate ? convertDateFormat((props.milestoneObj.statusDate),'',{showDayName: false}) : ''}}
                </div>
                <div class="thtitle thtitle_currency_family_mil">
                    {{props.milestoneObj.startDate ? convertDateFormat((props.milestoneObj.startDate),'',{showDayName: false}) : ''}}
                </div>
                <div class="thtitle thtitle_currency_family_mil">
                    {{props.milestoneObj.endDate ? convertDateFormat((props.milestoneObj.endDate),'',{showDayName: false}) : ''}}
                </div>
            </div>
        </td>
        <template v-if="props.daysOrMonth && props.daysOrMonth.length > 0">
            <template v-for="(monthDate,monthIndex) in props.daysOrMonth" :key="monthIndex">
                <td :class="[{
                        'border-color-highlight-left':props.daysOrMonth.length === 0 ? new Date().getMonth() === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex + 1,
                        'border-color-highlight-left-next':props.daysOrMonth.length === 0 ? new Date().getMonth() + 1 === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex
                    }]"
                    class="border_currency totalMilestoneCurrencyFamily text-center"
                    v-if="new Date(props.milestoneObj.statusDate).getDate() === monthIndex + 1 && new Date(monthDate.date).getMonth() === new Date(props.milestoneObj.statusDate).getMonth() && `${new Date(props.milestoneObj.statusDate).getFullYear()}` === props.yearSelected"
                >
                    {{props.currencySymbol}} {{getCommaSeperatedNumber(props.milestoneObj.amount)}}
                </td>
                <td :class="[{
                        'border-color-highlight-left':props.daysOrMonth.length === 0 ? new Date().getMonth() === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex + 1,
                        'border-color-highlight-left-next':props.daysOrMonth.length === 0 ? new Date().getMonth() + 1 === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex
                    }]" class="border_currency" v-else
                ></td>
            </template>
        </template>
        <template v-else>
            <template v-for="(monthDate,monthIndex) in 12" :key="monthIndex">
                <td :class="[{
                        'border-color-highlight-left':props.daysOrMonth.length === 0 ? new Date().getMonth() === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex + 1,
                        'border-color-highlight-left-next':props.daysOrMonth.length === 0 ? new Date().getMonth() + 1 === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex
                    }]"
                    class="border_currency totalMilestoneCurrencyFamily text-center"
                    v-if="new Date(props.milestoneObj.statusDate).getMonth() === monthIndex && `${new Date(props.milestoneObj.statusDate).getFullYear()}` === props.yearSelected"
                >
                    {{props.currencySymbol}} {{getCommaSeperatedNumber(props.milestoneObj.amount)}}
                </td>
                <td :class="[{
                        'border-color-highlight-left':props.daysOrMonth.length === 0 ? new Date().getMonth() === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex + 1,
                        'border-color-highlight-left-next':props.daysOrMonth.length === 0 ? new Date().getMonth() + 1 === monthIndex : new Date().getMonth() === new Date(monthDate.date).getMonth() && new Date().getDate() === monthIndex
                    }]"
                    class="border_currency" v-else
                ></td>
            </template>
        </template>
    </tr>
</template>

<script setup>
    // import
    import { useStore } from "vuex";
    import { defineProps,computed,inject } from 'vue';
    import { useConvertDate } from "@/composable";
    import { useRouter } from 'vue-router';
    import {milestoneData} from '@/components/organisms/FixMilestone/helper.js';
    import { statusChipStyle } from '@/utils/statusChipColors';
    const chipStyle = (status) => statusChipStyle({ textColor: status?.textColor, bgColor: status?.backgroundColor });
    const { getCommaSeperatedNumber } = milestoneData();
    const router = useRouter();
    const { getters } = useStore();
    const { convertDateFormat } = useConvertDate();

    // getter
    const settingStatus = computed(() => JSON.parse(JSON.stringify(getters['settings/projectMilestoneStatus'])));
    // props
    const props = defineProps({
        milestoneObj: {type:Object,default: () => {}},
        currencySymbol:{type:String,required:true},
        daysOrMonth:{type:Array,default:()=>[]},
        yearSelected:{type:String,require:true},
        projectDetail:{type:Object,default: () => {}}
    });

    //inject
    const companyId = inject('$companyId');
    const redirectProjectDetail = (data) => {
        if(data.statusType !== 'close'){
            router.push({ name: 'Project', params: {cid: companyId.value, id: data._id},query: {tab:'ProjectDetail'}});
        }
    };

</script>
<style scoped>
.thtitle_currency_family_status{
    padding: 2px 10px;
}
.short_name_mil{
    min-width: 50%;
}
</style>
