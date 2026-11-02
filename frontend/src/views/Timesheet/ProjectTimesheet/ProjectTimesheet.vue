<template>
<div v-if="!currentCompany?.planFeature?.projectTimesheet">
    <UpgradePlan
        :buttonText="$t('Upgrades.upgrade_your_plan')"
        :lastTitle="$t('Upgrades.to_unlock_project_timesheet')"
        :secondTitle="$t('Upgrades.unlimited')"
        :firstTitle="$t('Upgrades.upgrade_to')"
        :message="$t('Upgrades.the_feature_not_available')"
    />
</div>
<div v-else>
    <div class="ah-page rpt timesheet_view Usertimesheet_view project-timesheet-contain" v-if="error404">
        <ReportToolbar
            :title="$t('Time.project_timesheet_title')"
            tab="project"
            :exporting="exporting"
            :canExport="finalProjectData.length > 0"
            @export="onExport"
        />
        <ReportFilterBar
            :filters="filters"
            :presets="PRESETS"
            :fields="filterFields"
            :options="filterOptions"
            @apply="apply"
            @step="step"
            @clear="clear"
            @need-lists="options.loadListsFor(filters.projects)"
        >
            <template #end>
                <span class="tv-legend">
                    <span><i class="pt-key pt-key--tracked"></i>{{ $t('UserTimesheet.tracked_time') }}</span>
                    <span><i class="pt-key pt-key--manual"></i>{{ $t('UserTimesheet.manual_time') }}</span>
                </span>
            </template>
        </ReportFilterBar>
        <div class="timesheet__wrapper rpt__body" :class="{'pointer-event-none': isManinSpinner}">
            <p v-if="exportFailed" class="tv-error">{{ $t('Time.action_failed') }}</p>
            <ProjectTimesheetView
                v-if="!isManinSpinner"
                v-model="dateColumns"
                @update:getTaskData="getTaskDataFunction"
                :isManinSpinner="isManinSpinner"
                :fullLoggedData="fullLoggedData"
                :fullEstimatedData="fullEstimatedData"
                :projectData="finalProjectData"
                :activeWeekObj="activeWeekObj"
                :tableStyle="tableStyle"
                :projectTimesheetPermission="projectTimesheetPermission"
                :filterUserIds="userArray"
                :filterProjectIds="projectArray"
            />
            <SpinnerComp :is-spinner="isSpinner" v-if="isSpinner"/>
            <SpinnerComp :is-spinner="isManinSpinner" v-if="isManinSpinner"/>
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
    import { PRESETS } from '@/views/Timesheet/report/reportRange';
    import { hoursOf } from '@/views/Timesheet/report/reportTable';
    import { useI18n } from 'vue-i18n';
    import { useCustomComposable, useGetterFunctions } from '@/composable';
    import { useStore } from "vuex";
    import { ref, inject, watch, computed, onMounted } from "vue";
    import moment from 'moment';
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import ProjectTimesheetView from '@/components/atom/TimesheetView/ProjectTimeSheetView/ProjectTimesheetView.vue'
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
    import * as helper from '@/views/Timesheet/helper';
    import AppState from '@/components/molecules/AppState/AppState.vue';
    import { apiRequest } from '../../../services';
    import * as env from '@/config/env';
    import { isOwnerOrAdmin } from "@/utils/roles";
    const {checkPermission} = useCustomComposable();
    const { t } = useI18n();
    const { getters , dispatch} = useStore();
    const { getUser } = useGetterFunctions()
    const projectsGetter = computed(() => getters["projectData/allProjects"]);
    const projectList = ref([]);
    const finalProjectData = ref([]);
    const fullLoggedData = ref([]);
    const fullEstimatedData = ref([]);
    const companyId = inject('$companyId');
    const companyUserDetail = computed(() => getters["settings/companyUserDetail"]);
    const currentCompany = computed(() => getters["settings/selectedCompany"]);
    const { filters, range, serverFilters, apply, step, clear } = useReportFilters({ defaultPreset: 'this_week' });
    const options = useReportOptions(companyId);
    const { exporting, failed: exportFailed, exportReport } = useReportExport((field, value) => options.labelOf(field, value));
    const filterFields = computed(() => [...(projectTimesheetPermission.value ? ['people'] : []), 'projects', 'lists', 'status', 'billable', 'tags']);
    const filterOptions = computed(() => ({ people: options.people.value, projects: options.projects.value, lists: options.lists.value, status: options.statuses.value, tags: options.tags.value }));
    const localDate = (iso) => moment(iso, 'YYYY-MM-DD').toDate();
    const dateRange = computed(() => ({ startDate: localDate(range.value.start), endDate: localDate(range.value.end) }));
    const dateColumns = ref([]);
    const userArray = ref([]);
    const projectArray = ref([]);
    const timesheetDocArray = ref([]);
    let isSpinner = ref(false);
    let isManinSpinner = ref(true);
    const activeWeekObj = ref({ isWeeked: false, isOneday: false, isTwoday: false, isThreeday: false, isFourday: false, isFiveday: false, isSixday: false})
    const tableStyle = ref({'colspanCount':  "27",'tableWidth': "1888px"});
    const projectTimesheetPermission = ref(false);
    const error404 = ref(true);
    const loading = ref(true);

    const userId = inject("$userId")


    function getTaskDataFunction(status) {
        isSpinner.value = status;
    }

    const {getTeamsData} = useGetterFunctions();

    onMounted(()=>{
        if(checkPermission('sheet_settings.project_timesheet') !== null){
            if (checkPermission('sheet_settings.project_timesheet') === true || checkPermission('sheet_settings.project_timesheet') === 2) {
                projectTimesheetPermission.value = true;
            } else {
                projectTimesheetPermission.value = false;
            }

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
                    dispatch('projectData/setProjects', {
                        ...(checkPermission("project.public_projects") === true ? publicQuery : {}),
                        restrictPublic: checkPermission("project.public_projects") !== true,
                        privateQuery,
                        roleType,
                        uid
                    })
                    .then(() => {
                        projectList.value = projectsGetter.value?.data && projectsGetter.value?.data?.length ? JSON.parse(JSON.stringify(projectsGetter.value.data)) : [];
                        projectList.value = projectList.value.filter((x) => !x.isRestrict);
                        getProjectTimesheetData(dateRange.value.startDate, dateRange.value.endDate);
                        loading.value = false;
                    })
                    .catch((error)=>{
                        console.error(error);
                        loading.value = false;
                    })
                }).catch((error) => {
                    console.error(error,"ERROR IN GET TEAMS DATA");
                    loading.value = false;
                });
            } else {
                projectList.value = projectsGetter.value?.data && projectsGetter.value?.data?.length ? JSON.parse(JSON.stringify(projectsGetter.value.data)) : [];
                projectList.value = projectList.value.filter((x) => !x.isRestrict);
                getProjectTimesheetData(dateRange.value.startDate, dateRange.value.endDate);
                loading.value = false;
            }
        }else{
            error404.value = false;
            loading.value = false;
        }
    })


    function getProjectTimesheetData(startDate, endDate) {
        try {
            if(!(startDate) && !(endDate)) {
                isManinSpinner.value = false;
                return;
            }
            isManinSpinner.value = true;
            var sDate = startDate ? new Date(startDate).getTime() : new Date(dateRange.value.startDate).getTime();
            var eDate = endDate ? new Date(endDate).setHours(23,59,59,59) : new Date(dateRange.value.endDate).getTime() + 86399999;
            dateColumns.value = [];
            finalProjectData.value = [];
            let manageProjectData = JSON.parse(JSON.stringify(projectList.value));
            let projectIds = manageProjectData.map(a => a._id);
            for (let i = sDate; i < eDate; i += 86400000) {
                const DateColumn = {
                    date: moment(new Date(i)).format('DD'),
                    day: moment(new Date(i)).format('ddd'),
                    fullDate: moment(new Date(i)).format('YYYY-MM-DD'),
                    currentDate: moment(new Date()).format('YYYY-MM-DD'),
                    arabiDay: moment(new Date(i)).format('Do').replace(/[0-9]/g, ''),
                    arabiMonth: moment(new Date(i)).format('MMM'),
                    mainDate: new Date(i),
                    weekNumber: "",
                    weekName: "",
                    dateMonth: moment(new Date(i)).format('MM'),
                    totalProjectLogs: {},
                    totalProjectETALogs: {},
                    totalDayEst: 0,
                    totalDayLogs: 0,
                    totalLogsType: {},
                    totalTasklog: {},
                    totalTaskLogsType: {},
                    totalTaskETALogs: {}
                }
                //WEEK NUMBER LOGIC
                let weeks = moment(new Date(i)).weeks() - moment(new Date(i)).startOf('month').weeks() + 1;
                weeks = (weeks + 52) % 52;
                DateColumn.weekNumber = weeks;
                DateColumn.weekName = (weeks == 1 ? "1st" : weeks == 2 ? "2nd" : weeks == 3 ? "3rd" : weeks == 4 ? "4th" : weeks == 5 ? "5th" : "")
                dateColumns.value.push(DateColumn);
            }
            
            const tmpdateColumns =  JSON.parse(JSON.stringify(dateColumns.value))
            const dateColumnsLength = tmpdateColumns.length;
            activeWeekObj.value = {
                isOneday: dateColumnsLength === 1,
                isTwoday: dateColumnsLength === 2,
                isThreeday: dateColumnsLength === 3,
                isFourday: dateColumnsLength === 4,
                isFiveday: dateColumnsLength === 5,
                isSixday: dateColumnsLength === 6,
            };
            if (dateColumnsLength <= 20) {
                tableStyle.value.colspanCount = "27";
                tableStyle.value.tableWidth = "1888px";
                activeWeekObj.value.isWeeked = true;
            }
            if (dateColumnsLength > 7) {
                activeWeekObj.value.isWeeked = true;
                const noOfDays = dateColumnsLength;
                const tblWidth = noOfDays * 135 + 445;
                tableStyle.value.tableWidth = tblWidth + 'px';
                const tblColspan = 6 + 3 * noOfDays;
                tableStyle.value.colspanCount = tblColspan;
            }
            if(projectList.value && projectList.value.length){
                const filterUserIds = JSON.parse(JSON.stringify(userArray.value));
                const filterProjectIds = JSON.parse(JSON.stringify(projectArray.value));
                // Filter Project Specific
                if (filterProjectIds && filterProjectIds.length) {
                    projectIds = filterProjectIds;
                    manageProjectData = manageProjectData.filter((x) => projectIds.indexOf(x._id) !== -1);
                }


                helper.managedDateRange(sDate, eDate).then(async (result)=>{
                    if(!result.status){
                        timesheetDocArray.value = [];
                    }
                    let startNumber = result.data.start ? result.data.start : sDate.getTime();
                    let endNumber = result.data.end ? result.data.end : eDate.getTime();
                    let finalTimeSheetData = [];

                    let mongo_search_eta_parameters = [{
                        UserId: userId.value,
                        ProjectId: {
                            $in: projectIds
                        },
                        Date: {
                            dbDate: {
                                $gte: startNumber,
                                $lte: endNumber
                            }
                        }
                    }];

                    if (projectTimesheetPermission.value) {
                        mongo_search_eta_parameters = [{
                            ProjectId: {
                                $in: projectIds
                            },
                            Date: {
                                dbDate: {
                                    $gte: startNumber,
                                    $lte: endNumber
                                }
                            }
                        }];
                        if (filterProjectIds.length === 0 && isOwnerOrAdmin(companyUserDetail.value.roleType)) {
                            mongo_search_eta_parameters = [{
                                Date: {
                                    dbDate: {
                                        $gte: startNumber,
                                        $lte: endNumber
                                    }
                                }
                            }];
                        }
                        if (filterUserIds && filterUserIds.length) {
                            mongo_search_eta_parameters = [{
                                UserId: {
                                    $in: filterUserIds
                                },
                                ProjectId: {
                                    $in: projectIds
                                },
                                Date: {
                                    dbDate: {
                                        $gte: startNumber,
                                        $lte: endNumber
                                    }
                                }
                            }];
                            if (filterProjectIds.length === 0 && isOwnerOrAdmin(companyUserDetail.value.roleType)) {
                                mongo_search_eta_parameters = [{
                                    UserId: {
                                        $in: filterUserIds
                                    },
                                    Date: {
                                        dbDate: {
                                            $gte: startNumber,
                                            $lte: endNumber
                                        }
                                    }
                                }];
                            }
                        }
                    }
                    const axiosObj = {
                        filterProjectIds : filterProjectIds,
                        filterUserIds: filterUserIds,
                        projectIds: projectIds,
                        startNumber: startNumber,
                        endNumber: endNumber,
                        companyUserDetail: companyUserDetail.value,
                        projectTimesheetPermission: projectTimesheetPermission.value,
                        timeZone: getUser(userId.value).timeZone ? getUser(userId.value).timeZone : "Asia/Kolkata",
                        userId: userId.value,
                        filters: serverFilters.value
                    }
                    let queryeta = [
                        {
                            $match: {
                                // This $and is not strictly necessary as MongoDB implicitly treats multiple fields in $match as an AND operation.
                                $and: mongo_search_eta_parameters
                            }
                        },
                        {
                            $group: {
                                _id: {
                                    date: "$Date",
                                    // user: "$Loggeduser",
                                    projectId: "$ProjectId"
                                },
                                data: {
                                    $push: {
                                        projectId: "$ProjectId",
                                        taskId: "$TaskId",
                                        logMinutes: "$EstimatedTime",
                                        userId: "$UserId",
                                        date: "$Date",
                                    }
                                },
                                user: {
                                    $first: "$UserId" // Getting the first user in each group
                                },
                                totalCount: {
                                    $sum: "$EstimatedTime" // Calculate sum of all LogTimeDuration for each group
                                }
                            }
                        }
                    ]
                    apiRequest("post", `${env.TIMESHEET}/project`,axiosObj)
                    .then((data) => {
                        const timeSheetData = data.data;
                        apiRequest("post", `${env.ESTIMATED_TIME}`,{queryeta: queryeta, filters: serverFilters.value})
                        .then((etaData) => {
                            const etaDataRes = etaData.data;
                            finalProjectData.value = [];
                            finalTimeSheetData = timeSheetData;
                            fullLoggedData.value = timeSheetData;
                            if (finalTimeSheetData && finalTimeSheetData.length) {
                                for (let i = 0; i < finalTimeSheetData.length; i += 1) {
                                    const tmpDate = finalTimeSheetData[i]?._id?.date ? moment(new Date(finalTimeSheetData[i]._id.date)).format("YYYY-MM-DD") : '';
                                    let searchInd = tmpdateColumns.findIndex((x) => {
                                        return x.fullDate == tmpDate
                                    });
                                    if (searchInd !== -1) {
                                        if (!(tmpdateColumns[searchInd].totalProjectLogs && tmpdateColumns[searchInd].totalProjectLogs[`${finalTimeSheetData[i]._id.projectId.toString()}`])) {
                                            tmpdateColumns[searchInd].totalProjectLogs[`${finalTimeSheetData[i]._id.projectId.toString()}`] = 0;
                                            tmpdateColumns[searchInd].totalLogsType[`${finalTimeSheetData[i]._id.projectId.toString()}`] = {
                                                manuallyLoggedHours: 0,
                                                trackdLoggedHours: 0
                                            };
                                        }
                                        tmpdateColumns[searchInd].totalProjectLogs[`${finalTimeSheetData[i]._id.projectId.toString()}`] += finalTimeSheetData[i].totalCount;
                                        if (finalTimeSheetData[i]._id.logType === 0 || !finalTimeSheetData[i]._id.logType) {
                                            tmpdateColumns[searchInd].totalLogsType[`${finalTimeSheetData[i]._id.projectId.toString()}`].manuallyLoggedHours += finalTimeSheetData[i].totalCount;
                                        } else {
                                            tmpdateColumns[searchInd].totalLogsType[`${finalTimeSheetData[i]._id.projectId.toString()}`].trackdLoggedHours += finalTimeSheetData[i].totalCount;
                                        }
                                    }
                                }
                                dateColumns.value = tmpdateColumns;
                            }
                            let finalTimeSheetDataETA = [];
                            finalTimeSheetDataETA = etaDataRes;
                            fullEstimatedData.value = etaDataRes;
                            if (finalTimeSheetDataETA && finalTimeSheetDataETA.length) {
                                for (let i = 0; i < finalTimeSheetDataETA.length; i += 1) {
                                    const tmpDate = finalTimeSheetDataETA[i]._id.date ? moment(new Date(finalTimeSheetDataETA[i]._id.date)).format("YYYY-MM-DD") : '';
                                    let searchInd = tmpdateColumns.findIndex((x) => {
                                        return x.fullDate == tmpDate
                                    });
                                    if (searchInd !== -1) {
                                        if (!(tmpdateColumns[searchInd].totalProjectETALogs && tmpdateColumns[searchInd].totalProjectETALogs[`${finalTimeSheetDataETA[i]._id.projectId.toString()}`])) {
                                            tmpdateColumns[searchInd].totalProjectETALogs[`${finalTimeSheetDataETA[i]._id.projectId.toString()}`] = 0;
                                        }
                                        tmpdateColumns[searchInd].totalProjectETALogs[`${finalTimeSheetDataETA[i]._id.projectId.toString()}`] += finalTimeSheetDataETA[i].totalCount;
                                    }
                                }
                                dateColumns.value = tmpdateColumns;
                            }
                            if (manageProjectData && manageProjectData.length) {
                                for (let i = 0; i < manageProjectData.length; i += 1) {
                                    const projectLoggedHours = finalTimeSheetData.filter((x) => x._id.projectId == manageProjectData[i]._id).reduce((a,b) => a + b.totalCount, 0);
                                    const projectEstimatedHours = finalTimeSheetDataETA.filter((x) => x._id.projectId == manageProjectData[i]._id).reduce((a,b) => a + b.totalCount, 0);
                                    if (projectLoggedHours || projectEstimatedHours) {
                                        let fIndex = finalProjectData.value.findIndex((e)=>{return e.id == manageProjectData[i]._id})
                                        if(fIndex == -1) { 
                                            finalProjectData.value.push({
                                                id: manageProjectData[i]._id,
                                                status: manageProjectData[i].status,
                                                deletedStatusKey: manageProjectData[i]?.deletedStatusKey ? manageProjectData[i].deletedStatusKey : undefined,
                                                projectName: manageProjectData[i].ProjectName,
                                                projectCode: manageProjectData[i].ProjectCode,
                                                projectLoggedHours: projectLoggedHours,
                                                manuallyLoggedHours: {
                                                    name: 'Manually Time',
                                                    time: finalTimeSheetData.filter((x) => x._id.projectId == manageProjectData[i]._id && (x._id.logType === 0 || !x._id.logType)).reduce((a,b) => a + b.totalCount, 0)
                                                },
                                                trackdLoggedHours: {
                                                    name: 'Track Time',
                                                    time: finalTimeSheetData.filter((x) => x._id.projectId == manageProjectData[i]._id && x._id.logType === 1).reduce((a,b) => a + b.totalCount, 0)
                                                },
                                                projectEstimatedHours: projectEstimatedHours,
                                            });
                                        } else {
                                            finalProjectData.value[fIndex] = {...finalProjectData.value[fIndex],...{
                                                id: manageProjectData[i]._id,
                                                status: manageProjectData[i].status,
                                                deletedStatusKey: manageProjectData[i]?.deletedStatusKey ? manageProjectData[i].deletedStatusKey : undefined,
                                                projectName: manageProjectData[i].ProjectName,
                                                projectCode: manageProjectData[i].ProjectCode,
                                                projectLoggedHours: projectLoggedHours,
                                                manuallyLoggedHours: {
                                                    name: 'Manually Time',
                                                    time: finalTimeSheetData.filter((x) => x._id.projectId == manageProjectData[i]._id && (x._id.logType === 0 || !x._id.logType)).reduce((a,b) => a + b.totalCount, 0)
                                                },
                                                trackdLoggedHours: {
                                                    name: 'Track Time',
                                                    time: finalTimeSheetData.filter((x) => x._id.projectId == manageProjectData[i]._id && x._id.logType === 1).reduce((a,b) => a + b.totalCount, 0)
                                                },
                                                projectEstimatedHours: projectEstimatedHours,
                                            }}
                                        }
                                    }
                                }
                                // AHE — flag projects that contain any task whose estimate was
                                // re-updated, so the row shows a red dot for the TL. One grouped
                                // lookup; best-effort (never blocks the timesheet render).
                                try {
                                    apiRequest('post', `${env.TASK}/find`, { findQuery: [
                                        { $match: { estimateChangedFlag: true, deletedStatusKey: { $ne: 1 } } },
                                        { $group: { _id: "$ProjectID" } }
                                    ] }).then((flagRes) => {
                                        const flaggedIds = new Set((flagRes?.data || []).map((r) => String(r._id)));
                                        finalProjectData.value = finalProjectData.value.map((p) => ({ ...p, hasEstimateChanged: flaggedIds.has(String(p.id)) }));
                                    }).catch((e) => console.error('estimate-flag rollup failed', e));
                                } catch (e) { console.error(e); }
                                isManinSpinner.value = false;
                            } else {
                                isManinSpinner.value = false;
                            }
                        })
                        .catch((error_eta) => {
                            console.error('project timesheet error_eta', error_eta);
                            isManinSpinner.value = false;
                        });
                    })
                    .catch((error_timesheet) => {
                        isManinSpinner.value = false;
                        console.error('project timesheet error_timesheet', error_timesheet);
                    })
                }).catch((error) => {
                    isManinSpinner.value = false;
                    console.error('error', error);
                })
            }else{
                isManinSpinner.value = false;
            }
        } catch(error) {
            isManinSpinner.value = false;
            console.error('Get TimeSheet Data error', error);
        }
    }

    watch(() => getters["settings/companyUserDetail"],(val) => {
        companyUserDetail.value = val;
    })
    const reload = () => {
        userArray.value = projectTimesheetPermission.value ? [...filters.value.people] : [];
        projectArray.value = [...filters.value.projects];
        if ((projectList.value && projectList.value.length) || !loading.value) {
            getProjectTimesheetData(dateRange.value.startDate, dateRange.value.endDate);
        }
    };
    watch(() => [range.value.start, range.value.end, filters.value.people.join(','), filters.value.projects.join(','), JSON.stringify(serverFilters.value)], reload);

    const onExport = async (format) => {
        const days = dateColumns.value;
        const sumOf = (byProject) => Object.values(byProject || {}).reduce((a, b) => a + b, 0);
        const logOf = (row, day) => (row.isTotal ? sumOf(day.totalProjectLogs) : (day.totalProjectLogs || {})[String(row.id)] || 0);
        const estOf = (row, day) => (row.isTotal ? sumOf(day.totalProjectETALogs) : (day.totalProjectETALogs || {})[String(row.id)] || 0);
        const head = [
            { key: 'project', label: t('Reports.col_project'), value: (row) => row.projectName || '' },
            { key: 'code', label: t('Time.col_code'), value: (row) => row.projectCode || '' },
            { key: 'logged', label: t('Reports.col_logged_hours'), value: (row) => hoursOf(row.projectLoggedHours) },
            { key: 'estimated', label: t('Reports.col_estimated_hours'), value: (row) => hoursOf(row.projectEstimatedHours) },
            ...days.map((day) => ({ key: day.fullDate, label: `${day.fullDate} (${t('Reports.col_logged_short')})`, value: (row) => hoursOf(logOf(row, day)) })),
            ...days.map((day) => ({ key: `${day.fullDate}-est`, label: `${day.fullDate} (${t('Reports.col_estimated_short')})`, value: (row) => hoursOf(estOf(row, day)) })),
        ];
        const rows = finalProjectData.value;
        await exportReport(format, {
            name: 'project-timesheet',
            title: t('Time.project_timesheet_title'),
            filters: filters.value,
            columns: head,
            rows,
            total: {
                isTotal: true, projectName: t('Time.col_total'), projectCode: '',
                projectLoggedHours: rows.reduce((a, r) => a + (r.projectLoggedHours || 0), 0),
                projectEstimatedHours: rows.reduce((a, r) => a + (r.projectEstimatedHours || 0), 0),
            },
        });
    };
</script>
<style src="../style.css"></style>
<style scoped>
    .pt-key { border-radius: 50%; }
    .pt-key--tracked { background: var(--ok); }
    .pt-key--manual { background: var(--agent); }
</style>