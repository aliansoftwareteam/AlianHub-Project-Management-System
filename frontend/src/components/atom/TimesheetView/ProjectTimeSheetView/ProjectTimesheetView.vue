<template>
    <div class="timesheet_table_wrapper" @scroll="checkScroll">
        <table
            class="table timesheet_table"
            v-bind:class="[{
                'isWeeked': activeWeekObj.isWeeked,
                'isOneday': activeWeekObj.isOneday,
                'isTwoday': activeWeekObj.isTwoday,
                'isThreeday': activeWeekObj.isThreeday,
                'isFourday': activeWeekObj.isFourday,
                'isFiveday': activeWeekObj.isFiveday,
                'isSixday': activeWeekObj.isSixday}]"
            :style="[{'width': tableStyle.tableWidth}]"
        >
        <thead>
            <tr>
                <th class="fixed">
                    <div class="d-flex">
                        <div>{{$t('Projects.projects')}}</div>
                        <div>{{$t('ProjectDetails.key')}}</div>
                        <div> {{$t('UserTimesheet.logged')}} <p class="mt-0px">{{$t('UserTimesheet.hours')}}</p></div>
                        <div> {{$t('UserTimesheet.planned')}} <p class="mt-0px">{{$t('UserTimesheet.hours')}}</p></div>
                    </div>
                </th>
                <th v-for="(colName, index) in theModel" :key="index" v-bind:class="[{ 'weekoff': colName.day == 'Sat' || colName.day == 'Sun', 'current_date': colName.fullDate == colName.currentDate}]">
                    <p>
                        <span class="color47 mr-4px">{{colName.day}},</span>
                        <strong class="m-0" v-if="colName.arabiDay != undefined && colName.arabiMonth != undefined">{{colName.date}}<sup>{{colName.arabiDay}}</sup> {{colName.arabiMonth}}</strong>
                        <strong class="m-0" v-else>{{colName.date}} {{colName.dateMonth}}</strong>
                    </p>
                    <div class="inner_div displayRate d-flex">
                        <span>{{$t('UserTimesheet.logged')}}<br/> {{$t('UserTimesheet.hours')}}</span>
                        <span>{{$t('UserTimesheet.planned')}} <br/> {{$t('UserTimesheet.hours')}}</span>
                    </div>
                </th>
            </tr>
        </thead>
        <tbody v-for="row in projectData" :key="row.id">
            <ProjectTimeSheetTrComponent
                @update:getTaskData="getTask"
                :fullLoggedData="fullLoggedData"
                :fullEstimatedData="fullEstimatedData"
                :projectTrData="row"
                v-model="theModel"
                :activeWeekObj="activeWeekObj"
                :tableStyle="tableStyle"
                :projectTimesheetPermission="projectTimesheetPermission"
                :filterUserIds="filterUserIds"
                :filterProjectIds="filterProjectIds"
            />
        </tbody>
        <tfoot v-if="projectData.length">
            <tr class="total_hours_row">
                <td class="fixed">
                    <div class="d-flex">
                        <div>{{$t("TimeTracker.total")}}</div>
                        <div></div>
                        <div>{{ convertedTimeString(finalTotalLoggedHrs,'update') ? convertedTimeString(finalTotalLoggedHrs,'update') : "" }}</div>
                        <div>{{ convertedTimeString(finalTotalEstimatedHrs,'update') ? convertedTimeString(finalTotalEstimatedHrs,'update') : "" }}</div>
                    </div>
                </td>
                <td v-for="(colName, index) in theModel" :key="index" 
                    v-bind:class="[{ 'weekoff': colName.day == 'Sat' || colName.day == 'Sun', 'current_date': colName.fullDate == colName.currentDate}]"
                    >
                    <div class="inner_div displayRate d-flex">
                        <span class="total__project-logs"> {{ getTotalDateRowLog(colName, 'totalProjectLogs') && getTotalDateRowLog(colName, 'totalProjectLogs') > 0 ? convertedTimeString(getTotalDateRowLog(colName, 'totalProjectLogs'),'update') : ''}}</span>
                        <span class="total__project-logs"> {{ getTotalDateRowLog(colName, 'totalProjectETALogs') && getTotalDateRowLog(colName, 'totalProjectETALogs') > 0 ? convertedTimeString(getTotalDateRowLog(colName, 'totalProjectETALogs'),'update') : ''}} </span>
                    </div>
                </td>
            </tr>
        </tfoot>
    </table>
    <div v-if="!projectData.length && !isManinSpinner" class="ts-empty text-center mt-15px">{{$t('UserTimesheet.no_records_found')}}</div>
</div>
</template>
<script setup>
    import { watch, ref, computed, defineEmits } from 'vue';
    import { getConvertedTimeString, totalDateProjectRowLog } from '@/composable/commonFunction';
    import ProjectTimeSheetTrComponent from '@/components/atom/TimesheetView/ProjectTimeSheetView/ProjectTimesheetTrComponent';
    const props = defineProps({
        modelValue : { type : Array, default : ()=>([]) },
        projectData : { type : Array, default : ()=>([]) },
        activeWeekObj : { type : Object, default:()=>({}) },
        tableStyle : { type : Object, default : ()=>({}) },
        fullLoggedData: { type : Array, default : ()=>([]) },
        fullEstimatedData: { type : Array, default : ()=>([]) },
        isManinSpinner: { type : Boolean, default : ()=>(false) },
        projectTimesheetPermission: { type : Boolean, default : ()=>(false) },
        filterUserIds: { type : Array, default : ()=>([]) },
        filterProjectIds: { type : Array, default : ()=>([]) }
    });
    const theModel = ref(props.modelValue);
    const emit = defineEmits(["update:getTaskData"]);
    watch(()=> props.modelValue ,(val)=>{
        theModel.value = val;
    })
    const finalTotalLoggedHrs = computed(()=>{
        return props.projectData.reduce((acc, item) => acc + item.projectLoggedHours, 0);
    })
    const finalTotalEstimatedHrs = computed(()=>{
        return props.projectData.reduce((acc, item) => acc + item.projectEstimatedHours, 0);
    })
    function convertedTimeString(n, type){
        return getConvertedTimeString(n,type);
    }
    function getTotalDateRowLog(colName, key) {
        return totalDateProjectRowLog(colName, props.projectData, key)
    }
    const getTask = (cbd) => {
        emit("update:getTaskData",cbd)
    }
    let minimized = false;
    function checkScroll(e) {
        if(minimized && e.target.scrollLeft <= 150) {
            minimized = false;
            document.querySelectorAll(".fixed").forEach((x) => {
                x.classList.remove('make-width-small')
            })
        } else if(!minimized && e.target.scrollLeft >= 150) {
            minimized = true;
            document.querySelectorAll(".fixed").forEach((x) => {
                x.classList.add('make-width-small')
            })
        }
    }
</script>
<style src="../style.css"></style>
<!-- <style src="../"></style> -->
