<template>
    <tr class="white-row" v-bind:class="[{ 'cursor-pointer': trData?.trackdLoggedHours?.time || trData?.manuallyLoggedHours?.time}]">
        <td class="fixed" @click="toggle(trData.id, trData)">
            <img :style="{'opacity': (trData?.trackdLoggedHours?.time || trData?.manuallyLoggedHours?.time)?1:0.1}" alt="" :src="table_arrow" class="taable_arrow" v-bind:class="[{'row-open': isOpen && (trData?.trackdLoggedHours?.time || trData?.manuallyLoggedHours?.time)}]"/>
            <div class="d-flex align-items-center">
                <div class="d-flex align-items-center">
                    <p class="user_hrs_name" :title="trData.projectName">{{ trData.projectName }}</p>
                    <!-- AHE — red dot: a task in this project had its estimated hours re-updated. -->
                    <span v-if="trData.hasEstimateChanged" title="A task in this project had its estimated hours changed" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#E5484D;margin-left:6px;flex:none;"></span>
                    <img v-if="trData.status == 'close' || !(trData.deletedStatusKey == 0 || trData.deletedStatusKey == undefined)" :src="logk_icon" alt="loclIcon" class="ml-5px"/>
                </div>
                <div>
                    <span class="blue text-decoration-underline cursor-pointer p-0" @click="projectPush(trData.id)">{{trData.projectCode}}  </span>
                </div>
                <div class="inner_div displayRate d-flex">
                    <span class="bg-transparent position-re pt-5px project__log-hours">
                        <p>{{ trData.projectLoggedHours != undefined ? convertedTimeString(trData.projectLoggedHours,'update') ? convertedTimeString(trData.projectLoggedHours,'update') : ""  : ''}}</p>
                        <div class="logType__Img--show p-0" v-if="trData?.trackdLoggedHours?.time || trData?.manuallyLoggedHours?.time">
                            <img v-if="trData?.trackdLoggedHours?.time ? trData?.trackdLoggedHours?.time : ''" :src="green_line" />&nbsp;
                            <img v-if="trData?.manuallyLoggedHours?.time ? trData?.manuallyLoggedHours?.time : ''" :src="purple_line" /> 
                        </div>
                        <DropDown v-if="trData?.trackdLoggedHours?.time && trData?.manuallyLoggedHours?.time" class="p-0 tracktime_dropdown" :bodyClass="{'tracktime_dropdown_wrapper' : true}" :hover="true">
                            <template #button>
                                <div class="logType__Img--show p-0">
                                    <img v-if="trData?.trackdLoggedHours?.time ? trData?.trackdLoggedHours?.time : ''" :src="green_line" />&nbsp;
                                    <img v-if="trData?.manuallyLoggedHours?.time ? trData?.manuallyLoggedHours?.time : ''" :src="purple_line" /> 
                                </div>
                            </template>
                            <template #options>
                                <div class="d-flex track-option-wrapper">
                                    <DropDownOption class="font-weight-700 font-size-12 d-block m0-auto track__dropdownoption">
                                        {{trData?.trackdLoggedHours?.time ? convertedTimeString(trData?.trackdLoggedHours?.time,'update') : ""}}
                                        <img class="d-block m3px-auto" v-if="trData?.trackdLoggedHours?.time" :src="green_line" />
                                    </DropDownOption>
                                    <DropDownOption class="font-weight-700 font-size-12 d-block m0-auto track__dropdownoption-noborder">
                                        {{trData?.manuallyLoggedHours?.time ? convertedTimeString(trData?.manuallyLoggedHours?.time,'update') : ""}}
                                        <img class="d-block m3px-auto" v-if="trData?.manuallyLoggedHours?.time" :src="purple_line"/>
                                    </DropDownOption>
                                </div>
                            </template>
                        </DropDown>
                    </span>
                </div>
                <div class="inner_div displayRate">
                    <p>{{ trData.projectEstimatedHours != undefined ? convertedTimeString(trData.projectEstimatedHours,'update') ? convertedTimeString(trData.projectEstimatedHours,'update') : ""  : ''}}</p>
                </div>
            </div>
        </td>
        <td v-for="(colName, index) in theModel" :key="index" class="parent_data_div" v-bind:class="[{ 'weekoff': colName.day == 'Sat' || colName.day == 'Sun', 'current_date': colName.fullDate == colName.currentDate}]">
            <div class="inner_div displayRate d-flex">
                <span class="total__project-title pt-5px position-re" @click="openLogSetailSideBar(trData.id, Object.keys(colName.totalProjectLogs).includes(trData.id), colName,'project')">
                    {{ Object.keys(colName.totalProjectLogs).includes(trData.id)==true ? convertedTimeString(colName.totalProjectLogs[`${trData.id}`],'update') : ''}}
                    <div class="logType__Img--show p-0" v-if="colName.totalLogsType[`${trData.id}`]?.trackdLoggedHours || colName.totalLogsType[`${trData.id}`]?.manuallyLoggedHours">
                        <img v-if="colName.totalLogsType[`${trData.id}`]?.trackdLoggedHours ? colName.totalLogsType[`${trData.id}`]?.trackdLoggedHours : ''" :src="green_line" />&nbsp;
                        <img v-if="colName.totalLogsType[`${trData.id}`]?.manuallyLoggedHours ? colName.totalLogsType[`${trData.id}`]?.manuallyLoggedHours : ''" :src="purple_line" /> 
                    </div>
                    <DropDown v-if="colName.totalLogsType[`${trData.id}`]?.trackdLoggedHours && colName.totalLogsType[`${trData.id}`]?.manuallyLoggedHours" class="p-0 tracktime_dropdown" :bodyClass="{'tracktime_dropdown_wrapper' : true}" :hover="true">
                        <template #button>
                            <div class="logType__Img--show p-0">
                                <img v-if="colName.totalLogsType[`${trData.id}`]?.trackdLoggedHours ? colName.totalLogsType[`${trData.id}`]?.trackdLoggedHours : ''" :src="green_line" />&nbsp;
                                <img v-if="colName.totalLogsType[`${trData.id}`]?.manuallyLoggedHours ? colName.totalLogsType[`${trData.id}`]?.manuallyLoggedHours : ''" :src="purple_line" /> 
                            </div>
                        </template>
                        <template #options>
                            <div class="d-flex track-option-wrapper">
                                <DropDownOption class="font-weight-700 font-size-12 d-block  m0-auto track__dropdownoption">
                                    {{colName.totalLogsType[`${trData.id}`]?.trackdLoggedHours ? convertedTimeString(colName.totalLogsType[`${trData.id}`]?.trackdLoggedHours,'update') : ""}}
                                    <img class="d-block m3px-auto" v-if="colName.totalLogsType[`${trData.id}`]?.trackdLoggedHours" :src="green_line" />
                                </DropDownOption>
                                <DropDownOption class="font-weight-700 font-size-12 d-block m0-auto track__dropdownoption-noborder">
                                    {{colName.totalLogsType[`${trData.id}`]?.manuallyLoggedHours ? convertedTimeString(colName.totalLogsType[`${trData.id}`]?.manuallyLoggedHours,'update') : ""}}
                                    <img class="d-block m3px-auto" v-if="colName.totalLogsType[`${trData.id}`]?.manuallyLoggedHours" :src="purple_line"/>
                                </DropDownOption>
                            </div>
                        </template>
                    </DropDown>
                </span>
                <span class="pt-5px total__project-etalogs">
                    {{ Object.keys(colName.totalProjectETALogs).includes(trData.id)==true ? convertedTimeString(colName.totalProjectETALogs[`${trData.id}`],'update') : ''}}
                </span>
            </div>
        </td>
    </tr>
    <tr class="data-row" v-if="isOpen">
        <td :colspan="tableStyle.colspanCount" class="p-0">
            <table
                class="table open_project_table"
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
                <tbody v-for="taskObject in projectTaskArray" :key="taskObject.id">
                    <tr class="data-row">
                        <td class="fixed p-0">
                            <div class="d-flex align-items-center">
                                
                                <div class="d-flex align-items-center">
                                    <!-- AHE — red task name when this task's estimate was re-updated. -->
                                    <p class="user_hrs_name" :style="taskObject.estimateChangedFlag ? 'color:#E5484D;font-weight:600;' : ''" :title="taskObject.TaskName">{{ taskObject.TaskName }}</p>
                                </div>
                                <div class="blue text-decoration-underline cursor-pointer" @click="taskDetailOpen(taskObject)" >{{taskObject.TaskCode}}  </div>
                                <div class="inner_div displayRate d-flex">
                                    <span class="total__project-title pt-5px position-re bg-transparent">
                                        <p>{{ taskObject.taskLoggedHours != undefined ? convertedTimeString(taskObject.taskLoggedHours,'update') : ''}}</p>
                                        <div class="logType__Img--show p-0" v-if="taskObject?.trackdLoggedHours || taskObject?.manuallyLoggedHours">
                                            <img v-if="taskObject?.trackdLoggedHours ? taskObject?.trackdLoggedHours : ''" :src="green_line" />&nbsp;
                                            <img v-if="taskObject?.manuallyLoggedHours ? taskObject?.manuallyLoggedHours : ''" :src="purple_line" /> 
                                        </div>
                                        <DropDown v-if="taskObject?.trackdLoggedHours && taskObject?.manuallyLoggedHours" class="p-0 tracktime_dropdown" :bodyClass="{'tracktime_dropdown_wrapper' : true}" :hover="true">
                                            <template #button>
                                                <div class="logType__Img--show p-0">
                                                    <img v-if="taskObject?.trackdLoggedHours ? taskObject?.trackdLoggedHours : ''" :src="green_line" />&nbsp;
                                                    <img v-if="taskObject?.manuallyLoggedHours ? taskObject?.manuallyLoggedHours : ''" :src="purple_line" /> 
                                                </div>
                                            </template>
                                            <template #options>
                                                <div class="d-flex track-option-wrapper">
                                                    <DropDownOption class="font-weight-700 font-size-12 d-block m0-auto track__dropdownoption">
                                                        {{taskObject?.trackdLoggedHours ? convertedTimeString(taskObject?.trackdLoggedHours,'update') : ""}}
                                                        <img class="d-block m3px-auto" v-if="taskObject?.trackdLoggedHours" :src="green_line" />
                                                    </DropDownOption>
                                                    <DropDownOption class="font-weight-700 font-size-12 d-block m0-auto track__dropdownoption-noborder">
                                                        {{taskObject?.manuallyLoggedHours ? convertedTimeString(taskObject?.manuallyLoggedHours,'update') : ""}}
                                                        <img class="d-block m3px-auto" v-if="taskObject?.manuallyLoggedHours" :src="purple_line"/>
                                                    </DropDownOption>
                                                </div>
                                            </template>
                                        </DropDown>
                                    </span>
                                </div>
                                <div>
                                    <p>{{ taskObject.taskEstimatedHours != undefined ? convertedTimeString(taskObject.taskEstimatedHours,'update') : ''}}</p>
                                </div>
                            </div>
                        </td>
                        <td v-for="(colName, index) in theModel" :key="index" class="parent_data_div" v-bind:class="[{ 'weekoff': colName.day == 'Sat' || colName.day == 'Sun', 'current_date': colName.fullDate == colName.currentDate}]">
                            <div class="inner_div displayRate d-flex">
                                <span v-bind:class="[{ 'cursor-pointer': colName.totalTasklog[`${taskObject.id}`]}]" class="total__project-title pt-5px position-re" @click="openLogSetailSideBar(taskObject.id, Object.keys(colName.totalTasklog).includes(taskObject.id), colName,'task', taskObject)">
                                    {{ Object.keys(colName.totalTasklog).includes(taskObject.id)==true ? convertedTimeString(colName.totalTasklog[`${taskObject.id}`],'update') : ''}}
                                    <div class="logType__Img--show p-0" v-if="colName.totalTaskLogsType[`${taskObject.id}`]?.trackdLoggedHours || colName.totalTaskLogsType[`${taskObject.id}`]?.manuallyLoggedHours">
                                        <img v-if="colName.totalTaskLogsType[`${taskObject.id}`]?.trackdLoggedHours ? colName.totalTaskLogsType[`${taskObject.id}`]?.trackdLoggedHours : ''" :src="green_line" />&nbsp;
                                        <img v-if="colName.totalTaskLogsType[`${taskObject.id}`]?.manuallyLoggedHours ? colName.totalTaskLogsType[`${taskObject.id}`]?.manuallyLoggedHours : ''" :src="purple_line" /> 
                                    </div>
                                    <DropDown v-if="colName.totalTaskLogsType[`${taskObject.id}`]?.trackdLoggedHours && colName.totalTaskLogsType[`${taskObject.id}`]?.manuallyLoggedHours" class="p-0 tracktime_dropdown" :bodyClass="{'tracktime_dropdown_wrapper' : true}" :hover="true">
                                        <template #button>
                                            <div class="logType__Img--show p-0">
                                                <img v-if="colName.totalTaskLogsType[`${taskObject.id}`]?.trackdLoggedHours ? colName.totalTaskLogsType[`${taskObject.id}`]?.trackdLoggedHours : ''" :src="green_line" />&nbsp;
                                                <img v-if="colName.totalTaskLogsType[`${taskObject.id}`]?.manuallyLoggedHours ? colName.totalTaskLogsType[`${taskObject.id}`]?.manuallyLoggedHours : ''" :src="purple_line" /> 
                                            </div>
                                        </template>
                                        <template #options>
                                            <div class="d-flex track-option-wrapper">
                                                <DropDownOption class="font-weight-700 font-size-12 d-block m0-auto track__dropdownoption">
                                                    {{colName.totalTaskLogsType[`${taskObject.id}`]?.trackdLoggedHours ? convertedTimeString(colName.totalTaskLogsType[`${taskObject.id}`]?.trackdLoggedHours,'update') : ""}}
                                                    <img class="d-block m3px-auto" v-if="colName.totalTaskLogsType[`${taskObject.id}`]?.trackdLoggedHours" :src="green_line" />
                                                </DropDownOption>
                                                <DropDownOption class="font-weight-700 font-size-12 d-block m0-auto track__dropdownoption-noborder">
                                                    {{colName.totalTaskLogsType[`${taskObject.id}`]?.manuallyLoggedHours ? convertedTimeString(colName.totalTaskLogsType[`${taskObject.id}`]?.manuallyLoggedHours,'update') : ""}}
                                                    <img class="d-block m3px-auto" v-if="colName.totalTaskLogsType[`${taskObject.id}`]?.manuallyLoggedHours" :src="purple_line"/>
                                                </DropDownOption>
                                            </div>
                                        </template>
                                    </DropDown>
                                </span>
                                <span class="pt-5px total__project-etalogs">
                                    {{ Object.keys(colName.totalTaskETALogs).includes(taskObject.id)==true ? convertedTimeString(colName.totalTaskETALogs[`${taskObject.id}`],'update') : '' }}
                                </span>
                            </div>
                        </td>
                    </tr>
                </tbody>                     
            </table>
        </td>
    </tr>
    <TaskDetail
        v-if="isTaskDetail"
        :companyId="taskDetailOpenObject.CompanyId"
        :projectId="taskDetailOpenObject.ProjectID"
        :sprintId="taskDetailOpenObject.sprintId"
        :taskId="taskDetailOpenObject.id"
        :isTaskDetailSideBar="isTaskDetail"
        @toggleTaskDetail="toggleTaskDetail"
    />
    <LogTimeDetail
        v-if="isLogTimeOpen"
        @isSClose="(val) => {isLogTimeOpen = !val}"
        :date="colData"
        :userData={}
        :projectData="trData"
        :taskData="taskDataLogView"
        :track="track"
        :manual="manual"
        :total="total"
        :projectTimesheetPermission="projectTimesheetPermission"
        :filterUserIds="filterUserIds"
        :filterProjectIds="filterProjectIds"
    />
</template>
<script setup>
    import { defineProps,inject, nextTick, provide, ref ,watch } from 'vue';
    import moment from 'moment';
    import { useRoute, useRouter } from "vue-router"
    const router = useRouter();
    const route = useRoute();
    import DropDown from '@/components/molecules/DropDown/DropDown.vue';
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
    import LogTimeDetail from '@/components/atom/TimesheetView/LogDetailView/ProjectLogDetailView/LogDetailView.vue'
    import { getConvertedTimeString } from '@/composable/commonFunction';
    const purple_line = require('@/assets/images/svg/purple_line.svg');
    const green_line = require('@/assets/images/svg/green_line.svg');
    import TaskDetail from '@/views/TaskDetail/TaskDetail.vue'
    import { apiRequest } from '@/services';
    import * as env from '@/config/env';
    const logk_icon = ref(require("@/assets/images/timesheetcloseProject.png"))
    const props = defineProps({
        projectTrData: { type: Object },
        fullLoggedData: { type: Array, default : ()=>([]) },
        fullEstimatedData: { type: Array, default : ()=>([]) },
        modelValue : { type : Array, default : ()=>([]) },
        tableStyl : { type : Object, default : ()=>({}) },
        activeWeek : { type : Object, default:()=>({}) },
        tableStyle : { type : Object, default : ()=>({}) },
        activeWeekObj : { type : Object, default:()=>({}) },
        projectTimesheetPermission: { type : Boolean, default:()=>(false) },
        filterUserIds: { type : Array, default : ()=>([]) },
        filterProjectIds: { type : Array, default : ()=>([]) }
    });
    const table_arrow = ref(require("@/assets/images/table_arrow.png"))
    const theModel = ref(props.modelValue);
    const trData = ref(props.projectTrData);
    // AHE — trData is snapshotted from the prop on mount, but the parent sets
    // `hasEstimateChanged` asynchronously (after a rollup lookup), so sync that
    // field onto the snapshot when it arrives — otherwise the red project dot
    // never appears.
    watch(() => props.projectTrData && props.projectTrData.hasEstimateChanged, (val) => {
        if (trData.value) trData.value.hasEstimateChanged = val;
    }, { immediate: true });
    const fullLoggedData = ref(props.fullLoggedData);
    const fullEstimatedData = ref(props.fullEstimatedData);
    const projectTaskArray = ref([]);
    const isOpen = ref();
    const isTaskDetail = ref(false);
    const isLogTimeOpen = ref(false);
    const colData = ref();
    const track = ref(0);
    const manual = ref(0);
    const total = ref(0);
    const taskDataLogView = ref({});
    const taskDetailOpenObject = ref({});
    const companyId = inject('$companyId');
    const emit = defineEmits(["update:getTaskData"]);
    watch(()=> props.modelValue ,(val)=>{
        theModel.value = val;
    })
    const toggle =(id, ttRow) => {
        if (!ttRow?.trackdLoggedHours?.time && !ttRow?.manuallyLoggedHours?.time) {
            return;
        }
        isOpen.value = !isOpen.value;
        if (isOpen.value) {
            getTaskData(true);
            const allLogData = JSON.parse(JSON.stringify(fullLoggedData.value));
            const allEstimatedLogData = JSON.parse(JSON.stringify(fullEstimatedData.value));
            let uniqueLoggedHIds = [];
            let uniqueETAHIds = [];
            let uniqueTaskIds = [];
            const finalProjectData = allLogData.filter((x) => x._id.projectId === id);
            let tmpfullLoggedData = finalProjectData.map(item => item['data']).flat();
            const finalEstimatedProjectData = allEstimatedLogData.filter((x) => x._id.projectId === id);
            let tmpfullEstimatedData = finalEstimatedProjectData.map(item => item['data']).flat();
            if (tmpfullLoggedData && tmpfullLoggedData.length) {
                uniqueLoggedHIds = [...new Map(tmpfullLoggedData.map(item => [item['taskId'], item])).values()].map(a => a.taskId);
            }
            if (tmpfullEstimatedData && tmpfullEstimatedData.length) {
                uniqueETAHIds = [...new Map(tmpfullEstimatedData.map(item => [item['taskId'], item])).values()].map(a => a.taskId);
            }
            let conArray = uniqueLoggedHIds.concat(uniqueETAHIds);
            uniqueTaskIds = conArray.filter((item, a) => conArray.indexOf(item) === a)
            const finalTasks = [];
            projectTaskArray.value = [];
            if (uniqueTaskIds && uniqueTaskIds.length) {
                const findQuery = [
                    {
                        "$match": {
                            _id: {objId: { $in: uniqueTaskIds}},
                            objId:{
                                ProjectID: id
                            }
                        }
                    }
                ];
                apiRequest('post',`${env.TASK}/find`,{findQuery: findQuery}).then((taskData) => {                    
                    if (taskData?.status === 200 && taskData?.data.length) {
                        for (let i = 0; i < uniqueTaskIds.length; i += 1) {
                            const singleTaskData = taskData?.data.find((a) => a._id === uniqueTaskIds[i])
                            finalTasks.push({
                                CompanyId: singleTaskData.CompanyId,
                                ProjectID: singleTaskData.ProjectID,
                                sprintId: singleTaskData.sprintId,
                                id: uniqueTaskIds[i],
                                TaskName: singleTaskData.TaskName,
                                TaskCode: singleTaskData.TaskKey,
                                estimateChangedFlag: singleTaskData.estimateChangedFlag,
                                taskLoggedHours: tmpfullLoggedData.filter((x) => x.taskId == uniqueTaskIds[i]).reduce((a,b) => a + b.logMinutes, 0),
                                manuallyLoggedHours: tmpfullLoggedData.filter((x) => x.taskId == uniqueTaskIds[i] && (x.logType === 0 || !x.logType)).reduce((a,b) => a + b.logMinutes, 0),
                                trackdLoggedHours: tmpfullLoggedData.filter((x) => x.taskId == uniqueTaskIds[i] && x.logType === 1).reduce((a,b) => a + b.logMinutes, 0),
                                taskEstimatedHours: tmpfullEstimatedData.filter((x) => x.taskId == uniqueTaskIds[i]).reduce((a,b) => a + b.logMinutes, 0),
                                sprintArray: singleTaskData.sprintArray
                            })
                        }
                        projectTaskArray.value = finalTasks;
                        const tmpTheModel = JSON.parse(JSON.stringify(theModel.value));
                        if (tmpfullLoggedData && tmpfullLoggedData.length) {
                            for (let i = 0; i < tmpfullLoggedData.length; i += 1) {
                                const tmpDate = tmpfullLoggedData[i].date ? moment(new Date(tmpfullLoggedData[i].date)).format("YYYY-MM-DD") : '';
                                let searchInd = tmpTheModel.findIndex((x) => {
                                    return x.fullDate == tmpDate
                                });
                                if (searchInd !== -1) {
                                    if (!(tmpTheModel[searchInd].totalTasklog && tmpTheModel[searchInd].totalTasklog[`${tmpfullLoggedData[i].taskId.toString()}`])) {
                                        tmpTheModel[searchInd].totalTasklog[`${tmpfullLoggedData[i].taskId.toString()}`] = 0;
                                        tmpTheModel[searchInd].totalTaskLogsType[`${tmpfullLoggedData[i].taskId.toString()}`] = {
                                            manuallyLoggedHours: 0,
                                            trackdLoggedHours: 0
                                        };
                                    }
                                    tmpTheModel[searchInd].totalTasklog[`${tmpfullLoggedData[i].taskId.toString()}`] += tmpfullLoggedData[i].logMinutes;
                                    if (tmpfullLoggedData[i].logType === 0 || !tmpfullLoggedData[i].logType) {
                                        tmpTheModel[searchInd].totalTaskLogsType[`${tmpfullLoggedData[i].taskId.toString()}`].manuallyLoggedHours += tmpfullLoggedData[i].logMinutes;
                                    } else {
                                        tmpTheModel[searchInd].totalTaskLogsType[`${tmpfullLoggedData[i].taskId.toString()}`].trackdLoggedHours += tmpfullLoggedData[i].logMinutes;
                                    }
                                }
                            }
                            theModel.value = tmpTheModel;
                        }
                        
                        if (tmpfullEstimatedData && tmpfullEstimatedData.length) {
                            for (let i = 0; i < tmpfullEstimatedData.length; i += 1) {
                                const tmpDate = tmpfullEstimatedData[i].date ? moment(new Date(tmpfullEstimatedData[i].date)).format("YYYY-MM-DD") : '';
                                let searchInd = tmpTheModel.findIndex((x) => {
                                    return x.fullDate == tmpDate
                                });
                                if (searchInd !== -1) {
                                    if (!(tmpTheModel[searchInd].totalTaskETALogs && tmpTheModel[searchInd].totalTaskETALogs[`${tmpfullEstimatedData[i].taskId.toString()}`])) {
                                        tmpTheModel[searchInd].totalTaskETALogs[`${tmpfullEstimatedData[i].taskId.toString()}`] = 0;
                                    }
                                    tmpTheModel[searchInd].totalTaskETALogs[`${tmpfullEstimatedData[i].taskId.toString()}`] += tmpfullEstimatedData[i].logMinutes;
                                }
                            }
                            theModel.value = tmpTheModel;
                        }
                        getTaskData(false);
                    } else {
                        getTaskData(false);
                    }
                }).catch(() => {
                    getTaskData(false);
                })
            } else {
                getTaskData(false);
            }
        }
    }
    const convertedTimeString = (n, type)=>{
        return getConvertedTimeString(n,type);
    }
    const getTaskData = (status) => {
        emit("update:getTaskData",status);
    }
    const projectPush = (id) => {
        router.push({
            name: "Project",
            params: {
                cid: companyId.value,
                id: id
            }
        })
    }
    // const toggleTaskDetail = () => {
    //     isTaskDetail.value = false;
    // }
    const taskDetailOpen = (taskData) => {
        taskDetailOpenObject.value = {}
        isTaskDetail.value = true;
        taskDetailOpenObject.value.CompanyId = taskData.CompanyId;
        taskDetailOpenObject.value.ProjectID = taskData.ProjectID;
        taskDetailOpenObject.value.sprintId = taskData.sprintId;
        taskDetailOpenObject.value.id = taskData.id ? taskData.id : taskData._id;
    }
    
    const toggleTaskDetail = (task,close=false) => {
        isTaskDetail.value = false;
        if(close == true) {
            router.push({...route,query: {}})
            return;
        }
        taskDetailOpenObject.value ={};
        nextTick(()=>{
            router.push({...route,query: {detailTab: "task-detail-tab"}})
            taskDetailOpen(task);
        })
    }
    provide('toggleTaskDetail', toggleTaskDetail);
    provide('showArchived', ref(false));
    provide('isRouteRequired', false);
    provide('isSupport', ref(false));
    const openLogSetailSideBar = (id, open, data, key, taskObj) => {
        if (!open) {
            return;
        }
        if (key == 'task') {
            track.value = data?.totalTaskLogsType[id]?.trackdLoggedHours ? data?.totalTaskLogsType[id]?.trackdLoggedHours : 0;
            manual.value = data?.totalTaskLogsType[id]?.manuallyLoggedHours ? data?.totalTaskLogsType[id]?.manuallyLoggedHours : 0;
            total.value = data?.totalTasklog[id] ? data.totalTasklog[id] : 0;
            taskDataLogView.value = taskObj
        } else {
            track.value = data?.totalLogsType[id]?.trackdLoggedHours ? data?.totalLogsType[id]?.trackdLoggedHours : 0;
            manual.value = data?.totalLogsType[id]?.manuallyLoggedHours ? data?.totalLogsType[id]?.manuallyLoggedHours : 0;
            total.value = data?.totalProjectLogs[id] ? data.totalProjectLogs[id] : 0;
            taskDataLogView.value = {};
        }
        colData.value = new Date(data.mainDate);
        isLogTimeOpen.value = true;
    }
</script>

<style scoped>
.project__log-hours{
    line-height: 28px;
}
.total__project-title{
    line-height: 28px; 
}
.track__dropdownoption{
    background-color: #fff!important;
    color:#3E3E3E!important;
    padding: 0px 7px!important;
    border-right: 1px solid #ececec;
    border-radius: 0px!important;
}
.track__dropdownoption-noborder{
    margin:0 auto;
    background-color: #fff!important;
    color:#3E3E3E!important;
    padding: 0px 7px!important;
}
.total__project-etalogs{
    line-height: 30px; 
    cursor: default;
}
</style>