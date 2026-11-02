<template>
    <div v-if="!currentCompany?.planFeature?.trackerTimesheet">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('conformationmsg.to_unlock_tracker_timesheet')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <div v-else>
        <div class="ah-page rpt timesheet_view Usertimesheet_view timesheet_view_latest time_tracker__timesheet" v-if="error404">
            <ReportToolbar
                :title="$t('Time.tracker_title')"
                tab="tracker"
                :exporting="exporting"
                :canExport="dayLogs.length > 0"
                @export="onExport"
            />
            <ReportFilterBar
                :filters="filters"
                :presets="DAY_PRESETS"
                :fields="filterFields"
                :options="filterOptions"
                @apply="apply"
                @step="step"
                @clear="clear"
            />
            <div class="timesheet__wrapper rpt__body">
                <p v-if="exportFailed" class="tv-error">{{ $t('Time.action_failed') }}</p>
                <div class="trackerTimeSheet">
                    <div class="timebarWrapper">
                        <TimebarComponent :logRangeValue="logRange" :selectedSlot="selectedSlot" @toggle="selectedSlot = $event"/>
                    </div>
                    <div class="mt-12px">
                        <div class="screenShotTime mt-50px text-center" v-if="subSpinner">
                            <div class="screenShotTime-skelaton" v-for="(sKey) in skelatonArray" :key="sKey">
                                <div class="screenShotTime-skelaton--time">
                                    <Skelaton class="" style="height: 22px; width: 170px;"/>
                                </div>
                            </div>
                        </div>
                        <div class="screenShotTime style-scroll" v-if="finalRange?.length && !subSpinner">
                            <ScreenshotTime v-for="log in finalRange" :key="log.time" :logRangeData="log" :active="selectedSlot === log.time" :trackShots="log.trackShot" @update:getScreenShotDetail="getScreenShotDetailFunction" @toggle="selectedSlot = $event" :id="log.time" />
                        </div>
                        <div class="screenShotTime ts-empty mt-50px text-center" v-if="!finalRange?.length && !subSpinner">
                            {{$t('UserTimesheet.no_records_found')}}
                        </div>
                    </div>
                </div>
                <SpinnerComp :is-spinner="isSpinner" v-if="isSpinner"/>
            </div>
        </div>
        <div v-else class="h-100">
            <AppState kind="denied" />
        </div>
    </div>
</template>

<script setup>
    import '@/views/Timesheet/timeV2.css';
    import ReportToolbar from '@/views/Timesheet/report/ReportToolbar.vue';
    import ReportFilterBar from '@/views/Timesheet/report/ReportFilterBar.vue';
    import { useReportFilters } from '@/views/Timesheet/report/useReportFilters';
    import { useReportOptions } from '@/views/Timesheet/report/useReportOptions';
    import { useReportExport } from '@/views/Timesheet/report/useReportExport';
    import { DAY_PRESETS } from '@/views/Timesheet/report/reportRange';
    import { hoursOf } from '@/views/Timesheet/report/reportTable';
    import moment from 'moment';
    import { useI18n } from 'vue-i18n';
    import { useCustomComposable ,useGetterFunctions } from '@/composable';
    import TimebarComponent from '@/components/atom/TimesheetView/TrackerTimeSheetView/TimebarComponent.vue'
    import { onMounted ,ref , computed , inject ,watch } from "vue";
    import { useStore } from "vuex";
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import ScreenshotTime from '@/components/atom/TimesheetView/TrackerTimeSheetView/ScreenshotTime'
    import AppState from '@/components/molecules/AppState/AppState.vue'
    import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
    import { apiRequest } from '../../../services';
    import * as env from '@/config/env';
    import { isOwnerOrAdmin } from "@/utils/roles";
    import { dayRange, hourSlots, hoursWithLogs, logsOf, shotsIn } from './trackerDay';
    const {getUser} = useGetterFunctions();
    const { t } = useI18n();
    const skelatonArray = ref([1,2,3,4,5])
    const timeSlots = ref([]);
    const selectedSlot = ref(null);
    const timeSlotObj = ref([]);
    const logRange = ref([]);
    const finalRange = ref([]);
    const { getters , dispatch} = useStore();
    const {checkPermission} = useCustomComposable();
    const isSpinner = ref(false);
    const subSpinner = ref(true);
    const users = ref();
    const companyId = inject('$companyId');
    const { filters, range, apply, step, clear } = useReportFilters({ defaultPreset: 'today', presets: DAY_PRESETS });
    const options = useReportOptions(companyId);
    const { exporting, failed: exportFailed, exportReport } = useReportExport((field, value) => options.labelOf(field, value));
    const dateValue = computed(() => moment(range.value.start, 'YYYY-MM-DD').toDate());
    const filterFields = computed(() => [...(isEveryOne.value ? ['people'] : []), 'projects']);
    const filterOptions = computed(() => ({ people: options.people.value, projects: options.projects.value }));
    /* The tracker route still takes the filter chips of the old screen. */
    const selectedFilters = computed(() => [
        ...(isEveryOne.value ? filters.value.people.map((id) => ({ type: 'Users', id })) : []),
        ...filters.value.projects.map((id) => ({ type: 'Projects', id })),
    ]);
    const userId = inject('$userId')
    const taskArray = ref([]);

    const currentCompany = computed(() => getters["settings/selectedCompany"])

    function getDBData() {
        return new Promise((resolve, reject) => {
            try {
                let ind = finalRange.value.findIndex((x) => x.time == selectedSlot.value)
                if (finalRange.value[ind]?.trackShot?.length) {
                    subSpinner.value = false;
                    resolve(finalRange.value[ind].trackShot);
                } else {
                    let index = timeSlots.value.findIndex((x) => x.time == selectedSlot.value)
                    getTrackShotData(index).then((response)=>{
                        response.sort((a,b)=> a.time - b.time)
                        if (!(finalRange.value[ind] && finalRange.value[ind]?.trackShot)) {
                            finalRange.value[ind].trackShot = {};
                        }
                        finalRange.value[ind].trackShot = response;
                        subSpinner.value = false;
                        resolve(response);
                    })
                }
            } catch (e) {
                console.error(e);
                subSpinner.value = false;
                reject(e);
            }
        })
    }
    watch(selectedSlot, (newVal, oldVal) => {
        if(newVal && newVal !== oldVal) {
            getDBData().then(()=>{
                document.getElementById(selectedSlot.value)?.scrollIntoView({ behavior: 'smooth', block: 'start',  inline: 'nearest'});
            }).catch((e) =>{
                console.error(e)
            })
        }
    })
    const companyUserDetail = computed(() => getters["settings/companyUserDetail"]);
    const projects = ref([]);
    const projectsGetter = computed(() => getters["projectData/projects"]);
    const isEveryOne = ref(false);
    const error404 = ref(true);

    const {getTeamsData} = useGetterFunctions();

    onMounted(async () => {
        if(checkPermission('sheet_settings.tracker_timesheet') !== null){
            options.ready();
            if(!projectsGetter.value || !Object.keys(projectsGetter.value).length) {
                getTeamsData().then((response) => {
                    const uid = companyUserDetail.value.userId;
                    const filterteam = response.filter((x) => x.assigneeUsersArray.indexOf(uid) !== -1);
                    const teamIds = filterteam.map((x) => 'tId_'+x._id);
                    let publicQuery = {
                        isPrivateSpace:false
                    }
                    if(!isOwnerOrAdmin(companyUserDetail.value.roleType) && !getters["settings/rules"].toggle.showAllProjects) {
                        publicQuery.AssigneeUserId = {
                            $in:[uid]
                        }
                        if (teamIds && teamIds.length) {
                            publicQuery.AssigneeUserId.$in = [...publicQuery.AssigneeUserId.$in.concat(teamIds)]
                        }
                    }
                    let privateQuery = {
                        isPrivateSpace:true
                    }
                    if(!isOwnerOrAdmin(companyUserDetail.value.roleType)) {
                        privateQuery.AssigneeUserId = {
                            $in:[uid]
                        }
                        if (teamIds && teamIds.length) {
                            privateQuery.AssigneeUserId.$in = [...privateQuery.AssigneeUserId.$in.concat(teamIds)]
                        }
                    }
                    const roleType = companyUserDetail.value.roleType;
                    if(checkPermission('project.project_list') !== null) {
                        dispatch("projectData/setProjects", {
                            ...(checkPermission("project.public_projects") === true ? publicQuery : {}),
                            restrictPublic: checkPermission("project.public_projects") !== true,
                            privateQuery,
                            roleType,
                            uid
                        }).then(()=>{
                            projects.value = projectsGetter.value.data ? [...projectsGetter.value.data] : [];
                            projects.value = projects.value.filter((x)=> !x.isRestrict)
                            getUserData();
                            getTimeSlot();
                            getTrackerTimesheetData();
                        })
                        .catch((error) => {
                            console.error("ERROR in setProjects: ", error);
                        })
                    }
                }).catch((error) => {
                    console.error(error,"ERROR IN GET TEAMS DATA");
                });
            } else {
                projects.value = projectsGetter.value.data ? [...projectsGetter.value.data] : [];
                projects.value = projects.value.filter((x)=> !x.isRestrict)
                getUserData();
                getTimeSlot();
                getTrackerTimesheetData();
            }
            for (let i = 0; i < 24; i++) {
                logRange.value.push({time:i, inRange: false , isSelected: false});
            }
        }else{
            error404.value = false;
        }
    })
    const resetLogRange = () => {
        finalRange.value = [];
        logRange.value.forEach((ele)=>{
            ele.inRange = false;
            ele.isSelected = false;
        })
    }
    const getTimeSlot = () => {
        resetLogRange();
        timeSlots.value = hourSlots(dateValue.value);
    }
    const getUserData = async () => {
        if (checkPermission('sheet_settings.tracker_timesheet') === true || checkPermission('sheet_settings.tracker_timesheet') === 2) {
            isEveryOne.value = true;
            const allUser = computed(() => getters["users/users"])
            users.value = allUser.value;
        } else {
            isEveryOne.value = false;
            users.value = [getUser(userId.value,true)]
        }
    }
    const reloadDay = () => {
        selectedSlot.value = null;
        getTimeSlot();
        getTrackerTimesheetData();
    };
    watch(() => [range.value.start, filters.value.people.join(','), filters.value.projects.join(',')], () => {
        if (users.value) reloadDay();
    });
    const dayLogs = ref([]);
    let dayReads = 0;
    /* One request for the whole day (./trackerDay.js). A later date or filter asks again, and the earlier answer is dropped. */
    const getTrackerTimesheetData = async () => {
        subSpinner.value = true;
        dayReads += 1;
        const read = dayReads;
        let logs = [];
        try {
            const userArray = await queryFunction();
            const result = await apiRequest("post", `${env.TIMESHEET}/tracker`, {
                selectedFilter: selectedFilters.value,
                userArray,
                ...dayRange(dateValue.value),
                isEveryOne: isEveryOne.value
            });
            logs = logsOf(result?.data, projects.value);
        } catch (error) {
            console.error(error);
        }
        if (read !== dayReads) return;
        dayLogs.value = logs;
        hoursWithLogs(logs, timeSlots.value).forEach((hour) => {
            const ind = logRange.value.findIndex((x) => x.time === hour);
            logRange.value[ind] = {time: hour, inRange: true};
            finalRange.value.push({...logRange.value[ind], isSelected: false});
        });
        const first = logRange.value.find((ele) => ele.inRange);
        if (!first) {
            subSpinner.value = false;
            return;
        }
        selectedSlot.value = first.time;
        getDBData().catch((e) => {
            subSpinner.value = false;
            console.error(e);
        });
    }
    const getTrackShotData = async (element) => {
        const slot = timeSlots.value[element];
        if (slot.trackShot.length) return [];
        slot.trackShot = shotsIn(dayLogs.value, slot, { projects: projects.value, userOf: getUser, companyId: companyId.value });
        timeSlotObj.value = slot;
        return slot.trackShot;
    }
    const queryFunction = () => {
        return new Promise((resolve, reject) => {
            try {
                let userArray = [];
                let filterIds = selectedFilters.value.filter((x) => { return x.type == 'Users' });
                if (filterIds.length) {
                    filterIds.forEach((element) => {
                        userArray.push(element.id)
                    });
                }
                if (filterIds.length === 0) {
                    users.value.forEach((element) => {
                        userArray.push(element._id)
                    });
                }

                resolve(userArray);
            } catch (error) {
                reject(error);
            }
        })
    }
    const getScreenShotDetailFunction = async (obj,cb) => {
        let newObject = obj;
        if (newObject.projectName === '' || newObject.projectKey === '') {
            let projectDetail = await getProjectDetail(newObject.projectId);
            newObject.projectName = projectDetail.name;
            newObject.projectKey = projectDetail.key;
        }
        let ind = taskArray.value.findIndex((x) => x._id === newObject.taskId)
        if (ind !== -1) {
            newObject.taskName = taskArray.value[ind].TaskName;
            newObject.isFolderSprint = taskArray.value[ind].folderObjId ? true : false;
            newObject.sprintName = taskArray.value[ind].sprintArray.name;
            newObject.folderName = taskArray.value[ind].sprintArray.folderName ? taskArray.value[ind].sprintArray.folderName : ""
        } else {
            let taskDetail = await getTaskDetail(newObject.taskId);
            newObject.taskName = taskDetail.TaskName;
            newObject.isFolderSprint = taskDetail.folderObjId ? true : false;
            newObject.sprintName = taskDetail.sprintArray.name;
            newObject.folderName = taskDetail.sprintArray.folderName ? taskDetail.sprintArray.folderName : ""
        }
        newObject = {...newObject, ...newObject.trackShots}
        cb(newObject)
    }
    const getProjectDetail = (projectId) => {
        return new Promise((resolve, reject) => {
            apiRequest("get", `${env.PROJECT}/${projectId}`)
                .then((response) => {
                    if (response.status === 200) {
                        resolve({
                            name: response.data.ProjectName,
                            key: response.data.ProjectCode
                        });
                    } else {
                        console.error("Failed to fetch project details: Status not 200");
                        resolve({}); // Resolve with an empty object for graceful handling
                    }
                })
                .catch((error) => {
                    console.error("Error in getProjectDetail:", error);
                    reject(error); // Reject with the error
                });
        });
    };

    const getTaskDetail = (taskId) => {
        return new Promise((resolve,reject) => {
            apiRequest('get',`${env.TASK}/${taskId}`).then((result) => {                
                if(result.status === 200 && result?.data && Object.keys(result?.data).length){
                    taskArray.value.push(result?.data);
                    resolve(result?.data);
                }else{
                    resolve({});
                }
            })
            .catch((error)=>{
                console.error(error);
                reject(error);
            })
        })
    }
    const clockOf = (seconds) => (seconds ? moment.unix(Number(seconds)).format('HH:mm') : '');
    const onExport = async (format) => {
        const projectName = (id) => (options.projectById.value[String(id)] || {}).ProjectName || '';
        await exportReport(format, {
            name: 'tracker',
            title: t('Time.tracker_title'),
            filters: filters.value,
            columns: [
                { key: 'start', label: t('Reports.col_start'), value: (log) => clockOf(log.LogStartTime) },
                { key: 'end', label: t('Reports.col_end'), value: (log) => clockOf(log.LogEndTime) },
                { key: 'person', label: t('Reports.col_person'), value: (log) => (getUser(log.Loggeduser) || {}).Employee_Name || '' },
                { key: 'project', label: t('Reports.col_project'), value: (log) => projectName(log.ProjectId) },
                { key: 'note', label: t('Reports.col_note'), value: (log) => log.LogDescription || '' },
                { key: 'shots', label: t('Reports.col_screenshots'), value: (log) => (log.trackShots || []).length },
                { key: 'hours', label: t('Reports.col_hours'), value: (log) => hoursOf(log.LogTimeDuration) },
            ],
            rows: [...dayLogs.value].sort((a, b) => Number(a.LogStartTime) - Number(b.LogStartTime)),
        });
    };
</script>
<style src="../style.css"></style>
<style scoped>
.screenShotTime-skelaton--time {
    font-weight: 500;
    font-size: 18px;
    display: flex;
    justify-content: space-between;
    padding: 14px 12px 15px 20px;
    height: 54px;
    align-items: center;
}
.screenShotTime-skelaton {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 12px;
    margin-bottom: 20px;
}
.timebarWrapper{
    margin-top: 16px;
}
.screenShotTime{
    max-height: calc(100vh - 274px);
    overflow: auto;
}
.screenShotTime::-webkit-scrollbar {
    width: 6px;
    height: 6px;
    background: var(--fill) !important;
    border-radius: 6px;
}
.screenShotTime.style-scroll::-webkit-scrollbar-thumb {
    background: var(--brand);
    border-radius: 6px;
}
.screenShotTime.style-scroll::-webkit-scrollbar-track{
    background-color: var(--fill) !important;
    border-radius: 6px;
}
@media (max-width: 767px) {
    .screenShotTime { max-height: calc(100vh - 335px); }
}
</style>
