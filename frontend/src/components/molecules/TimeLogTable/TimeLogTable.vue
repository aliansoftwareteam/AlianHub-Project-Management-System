<template>
<div class="time-logtable-wrapper mainTableDiv">
        <table class="mt-1 time-logtable position-re" v-if="isShowDetail === false">
            <thead class="position-sti timelog-table-thead">
                <tr>
                <th colspan="3" rowspan="1">
                    <div class="d-flex align-items-center timelog-task-title">
                        <TaskTypeIcon :taskType="getTaskType(props.task.TaskTypeKey)" :title="props.task.TaskType" class="border-radius-2-px mt-2px timelog___taskimg"/>
                        <span v-if="!props.task.TaskName && isSpinner" class="timelogtable-thtitle-wrapped font-weight-500 pl-9px">
                            <Skelaton class="border-radius-5-px skelaton__option m-5px" :style="{ height: clientWidth <= 767 ? '24' : '24px', width: '150px' }" />
                        </span>
                        <span v-else class="timelogtable-thtitle-wrapped font-weight-500 pl-9px">{{props.task.TaskName}}</span>
                    </div>
                </th>
                <th colspan="3" rowspan="1"><div class="d-flex justify-content-end total_time"><span class="font-size-13 font-weight-400 GunPowder ml-10px">{{$t('TimeTracker.total')}}:- </span><span class="total-duration">{{totalDuration}}</span></div></th>
                </tr>
            </thead>
            <tbody>
                <template v-if="props.taskLogArray.length > 0 && isSpinner === false">
                    <TimelogTabletrCompoVue
                        v-for="(item, itemIndex) in props.taskLogArray"
                        :key="'item'+itemIndex"
                        :item="item"
                        @deleteTime="(item) => deleteTimelog(item)"
                        @showEdit="(item) => showEditData(item)"
                        @viewDetail="(item) => viewTimeLogDetail(item)"
                    />
                </template>
                <template v-else>
                    <template v-if="isSpinner === true">
                        <SpinnerTimelogTableRowCompo v-for="i in 5" :key="i" />
                    </template>
                    <div class="d-flex align-items-center" v-else>
                        <p class="invalid-feedback red" v-if="noFoundMsg !== ''">{{ $t('TimeTracker.' + noFoundMsg) }} </p>
                    </div>
                </template>
            </tbody>
        </table>
        <AddTimeLog v-if="activeTimeLog === true" :closeTimeLogSidebar="closeTimeLogSidebar" :isAddLog="isAddLog" :task="task" :modelValue="timeLogData" :selectedTimeRow="selectedTimeRow" @addTime="(data) => {emit('updateEditTime',data)}" />
        <ViewTimelogDetailVue v-if="isShowDetail === true" :timelogDetail="timelogDetail" :task="task"/>
    </div>
</template>

<script setup>
    import moment from 'moment'
    import Swal from 'sweetalert2';

    import { ref, inject, computed, defineProps ,watch} from 'vue'
    import { useGetterFunctions } from "@/composable";
    import {useToast} from 'vue-toast-notification';
    import { apiRequest } from '../../../services';
    import { useStore } from "vuex";

    import TimelogTabletrCompoVue from '@/components/atom/TimelogTableRowCompo/TimelogTableRowCompo.vue'
    import SpinnerTimelogTableRowCompo from '@/components/atom/TimelogTableRowCompo/SpinnerTimelogTableRowCompo.vue'
    import  AddTimeLog  from '@/components/molecules/AddTimeLog/AddTimeLog.vue'
    import ViewTimelogDetailVue from '@/components/atom/ViewTimelogDetail/ViewTimelogDetail.vue';
    import * as env from '@/config/env';
    import { dbCollections } from '@/utils/Collections';
    import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';
    import { useI18n } from 'vue-i18n';
    import TaskTypeIcon from '@/components/atom/TaskTypeIcon/TaskTypeIcon.vue';
    const {getUser} = useGetterFunctions();
    const { getters } = useStore();
    const userId =  inject('$userId');
    const companyId = inject('$companyId');
    const $toast = useToast();

    const { getTaskType } = useGetterFunctions();
    const {t} = useI18n();

    
    const props = defineProps({
        task: {
            type: Object,
            default: () => ({})
        },
        taskLogArray: {
            type: Array,
        },
        noFoundMsg: {
            type: String,
            default: ''
        },
        isShow:{
            type: Boolean,
            default: false
        },
        totalTimeLog : {
            type: Number,
            default: 0
        },
        isSpinner: {
            type: Boolean,
            default: false
        }
    })

    const selectedTimeRow = ref({});
    const projectData = inject("selectedProject");
    const totalTimeDuration = ref(props.totalTimeLog)

    const emit = defineEmits(["isView","isDelete"])

    watch(() => props.isShow, (val) => {
        isShowDetail.value = val;
    })

    watch(() => props.totalTimeLog, (val) => {
        totalTimeDuration.value = val;
    })

    const timeLogData = ref({
        logTimeDate : new Date().toISOString().split('T')[0],
        startLogTime : '',
        endLogTime : '',
        timeDuration : '',
        description : '',
    })
    const activeTimeLog = ref(false);

    const isAddLog = ref(false);
    const isShowDetail = ref(props.isShow);
    const timelogDetail = ref({});

    const totalDuration = computed(() => {
        // var sub_total_Data = props.taskLogArray.reduce((acc, item) =>
        //     acc + parseFloat(item.LogTimeDuration ? item.LogTimeDuration : 0),0);
        // if (isNaN(sub_total_Data)) {
        //     sub_total_Data = 0;
        // }
        return secondsToHms(totalTimeDuration.value);
    })

    const secondsToHms = (a) => {
        var mins_num = parseFloat(a, 10);
        var hours   = Math.floor(mins_num / 60);
        var minutes = Math.floor((mins_num - ((hours * 3600)) / 60));
        var seconds = Math.floor((mins_num * 60) - (hours * 3600) - (minutes * 60));
        // Appends 0 when unit is less than 10
        if (hours   < 10) {hours   = "0"+hours;}
        if (minutes < 10) {minutes = "0"+minutes;}
        if (seconds < 10) {seconds = "0"+seconds;}
        return hours+':'+minutes+':'+seconds;
    }

    const showEditData = (logData) => {
        let user = getUser(userId.value);
        let tempStartLog = moment(new Date(logData.LogStartTime * 1000),"hh:mm A").format('HH:mm');
        let tempEndLog = moment(new Date(logData.LogEndTime * 1000),"hh:mm A").format('HH:mm');
        if(user.timeFormat == '12'){
            let tempResponse = getLogsTimeInFormate(tempStartLog,tempEndLog);
            if(tempResponse.status == true){
                tempStartLog = tempResponse.start;
                tempEndLog = tempResponse.end;
            }
            if(tempStartLog === '00:00:AM'){
                tempStartLog = '12:00:AM';
            }
        }
        let start = tempStartLog.split(":");
        let end = tempEndLog.split(":")
        tempStartLog = start[0] + ":" + start[1] + " "  + start[2];
        tempEndLog = end[0] + ":" + end[1] + " "  + end[2];
        timeLogData.value = {
            logTimeDate : moment(new Date(logData.LogStartTime * 1000)).format("YYYY-MM-DD"),
            startLogTime : tempStartLog,
            endLogTime : tempEndLog,
            timeDuration : minToHM(logData.LogTimeDuration),
            description : logData.LogDescription,
            oldDuration : logData.LogTimeDuration
        }
        isAddLog.value = false;
        selectedTimeRow.value = logData;
        activeTimeLog.value = true;
    }

    const getLogsTimeInFormate = (logStart, logEnd) =>{
        let timeStartString = logStart;
        let timeEndString = logEnd;
        let timeString = {'start': timeStartString, 'end': timeEndString}
        try{
            let resp = timeStartString.split(":");
            let temph = resp[0];
            let tempm = resp[1];
            if(Number(temph) >= 12){
                temph = Number(temph) !== 12 ? Number(temph)%12 : 12;
                timeStartString = temph.toString().padStart(2, '0') + ":" + tempm + ":PM";
            }else{
                timeStartString = timeStartString + ":AM";
            }
            let resp2 = timeEndString.split(":");
            let temph2 = resp2[0];
            let tempm2 = resp2[1];
            if(Number(temph2) >= 12){
                temph2 = Number(temph2) !== 12 ? Number(temph2)%12 : 12;
                timeEndString = temph2.toString().padStart(2, '0') + ":" + tempm2 + ":PM";
            }else{
                timeEndString = timeEndString + ":AM";
            }
            timeString = {'start': timeStartString, 'end': timeEndString, 'status': true}
            return timeString
        }catch(error){
            console.error();
            timeString.status = false;
            return timeString
        }
    }

    const minToHM = (mins_num) => {
        var hours   = Math.floor(mins_num / 60);
        var minutes = Math.floor((mins_num - ((hours * 3600)) / 60));
        if (hours   < 10) {hours   = "0"+hours;}
        if (minutes < 10) {minutes = "0"+minutes;}
        return hours+':'+minutes;
    }

    const deleteTimelog = (data) => {
            Swal.fire({
            title: t(`conformationmsg.are_you_sure`),
            text: t(`conformationmsg.no_revert_msg`),
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#d33',
            cancelButtonText: t('Projects.cancel'),
            confirmButtonText: t('conformationmsg.yes_delete')
        }).then((result)=>{
            if(result.isConfirmed){
                const axiosData = {
                    companyId : companyId.value,
                    timeSheetId : data._id,
                    logTimeDate : new Date(data.LogStartTime * 1000),
                    timeDuration : data.LogTimeDuration,
                    startLogTime : moment(new Date(data.LogStartTime * 1000)).format('HH:mm'),
                    endLogTime : moment(new Date(data.LogEndTime     * 1000)).format('HH:mm'),
                    ticketId : data.TicketID,
                    projectId: data.ProjectId,
                    userId : data.Loggeduser,
                    userName : data.loggedUserName,
                    dateFormat : getters['settings/companyDateFormat'].dateFormat,
                    sprintId : props.task.sprintId,
                    taskName : props.task.TaskName,
                    companyOwnerId : getters["settings/companyOwnerDetail"]._id,
                    projectName : projectData.value.ProjectName,
                    timeFormat: getUser(userId.value).timeFormat,
                    type: dbCollections.TIMESHEETS,
                    LogStartTime:data.LogStartTime,
                    LogEndTime:data.LogEndTime
                }
                apiRequest("post", env.DELETE_TIMELOG, axiosData).then((result)=>{
                    if(result.data.status == true){
                        $toast.success(t("Toast.Data_deleted_successfully."),{position: 'top-right'});
                        emit("isDelete", true,data)
                    }else{
                        $toast.error(t("Toast.something_went_wrong"),{position: 'top-right'});
                        console.error(result.data.statusText)
                    }
                }).catch((error)=>{
                    console.error(error,"Error in Delete Timelog in Typesesnse");
                })
            }
        })
    }

    const closeTimeLogSidebar = () => {
        activeTimeLog.value=false;
        timeLogData.value = {
            logTimeDate : new Date().toISOString().split('T')[0],
            startLogTime : '',
            endLogTime : '',
            timeDuration : '',
            description : '',
        }
    }
    const viewTimeLogDetail = (logRow) => {
        emit("isView", isShowDetail.value = true)
        timelogDetail.value = logRow;
    }
</script>    
<style src="./style.css">
</style>