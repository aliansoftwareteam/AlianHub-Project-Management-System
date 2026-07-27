<template>
<div v-if="!currentCompany?.planFeature?.projectTimesheet">
    <UpgradePlan
        :buttonText="$t('Upgrades.upgrade_your_plan')"
        lastTitle="To Unlock Project Timesheet"
        secondTitle="Unlimited"
        firstTitle="Upgrade To"
        message="That feature isn’t available on your current plan"
    />
</div>
<div v-else>
    <div class="timesheet_view Usertimesheet_view project-timesheet-contain" v-if="error404">
        <div class="row">
            <div class="col-md-12">
                <div class="page_title_row d-flex">
                    <div class="page-title d-flex">
                        <ul class="breadcrumb title_strip">
                            <li @click="goHome()">
                                <img class="cursor-pointer" :src="home_icon" alt="home_icon"/>
                            </li>
                            <li class="pro_route_link">
                                <router-link :to="`/${companyId}/project`" class="text-decoration-underline font-size-18 font-weight-700">{{$t('UserTimesheet.back_projects')}}</router-link>
                            </li>
                            <li>
                                <span class="workload_title font-size-18 font-weight-700">{{$t('UserTimesheet.project_timesheet')}}</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        <div class="timesheet__wrapper page-content" :class="{'pointer-event-none': isManinSpinner}">
            <div class="page_top_data d-flex align-items-center justify-content-between" :class="clientWidth <= 1200 ? 'flex-wrap flex-column align-items-start' : ''">
                <div class="d-flex" :style="[{width : clientWidth <=1200 ? '100%' : 'calc(100% - 253px)'}]" :class="clientWidth <=767 ? 'flex-column' : ''"> 
                <RangePickerComp 
                        class="range-picker rangeComp"
                        @SelectedDate="handleDate"
                        preSelectType="week"
                    />
                    <div class="wf_filter" @click.stop="$refs.filter_pt_click.click()">
                        <span class="timesheet_user_filter">
                            <DropDown id="" class="status_change_dropdown" :bodyClass="{'timesheetDropdown_wrapper' : true}">
                                <template #button>
                                    <button class="btn-white border cursor-pointer dot-btn" ref="filter_pt_click">
                                        <a href="#" class="link_disable_css">{{$t('Filters.filter_by')}}</a>
                                    </button>
                                </template>
                                <template #options>
                                <DropDownOption v-show="filterType=='' && projectTimesheetPermission" @click="handleFilterType('select','Users')">
                                    {{$t('UserTimesheet.Users')}}
                                </DropDownOption>
                                <DropDownOption v-show="filterType=='' && projectTimesheetPermission" @click="handleFilterType('select','Teams')">
                                    {{$t('UserTimesheet.Teams')}}
                                </DropDownOption>
                                <DropDownOption v-show="filterType==''" @click="handleFilterType('select','Projects')">
                                    {{$t('UserTimesheet.Projects')}}
                                </DropDownOption>
                                <div v-if="filterType!=''">
                                    <div class="wf_header">
                                        <a @click="handleFilterType('back','')">
                                            <img src="@/assets/images/svg/filter_back_icon.svg"/>&nbsp;
                                            {{ $t('UserTimesheet.back') }}
                                        </a>
                                        <span>{{ $t(`UserTimesheet.${filterType}`) }}</span>
                                    </div>
                                    <span class="filter_search_block">
                                        <input type="search" class="form-control" ref="filter_dd_search" :placeHolder="$t('PlaceHolder.search')" v-model="filterSearch"/>
                                    </span>
                                    <div class="wf_body filter_body_scroll checklist-main" :class="{'filter_body_scroll': optionFilter.length >= 5}">
                                        <span
                                        v-for="(item,index) in optionFilter"
                                        class="wf_listItem users_filter_items"
                                        :key="index"
                                        v-show="filterType.toLowerCase()=='users' && projectTimesheetPermission">
                                            <a class="vs-dropdown-users d-flex align-items-center">
                                                <input type="checkbox" v-show="filterType.toLowerCase() == 'users'" @click="handleFilterItem(item,'checkEvent',true)" :value="item.id" v-model="checkedFilter">&nbsp;
                                                <UserProfile
                                                    v-if="filterType.toLowerCase() == 'users'"
                                                    :showDot="false"
                                                    class="timesheet_user_profile mr-10px"
                                                    :data="{
                                                        id: item.id,
                                                        title: item.name,
                                                        image: item.profile || ''
                                                    }"
                                                    width="22px"
                                                    :thumbnail="'22x22'"
                                                    @click="handleFilterItem(item,'checkEvent',true)"
                                                />
                                                <!-- <img v-if="filterType.toLowerCase() == 'users'" :src="item.profile ? item.profile : defaultImage" :alt="item.name" class="timesheet_user_profile" @click="handleFilterItem(item,'add')"/> -->
                                                <span class="filter_list_item cursor-pointer" @click="handleFilterItem(item,'checkEvent',true)">{{ item.name }}</span>
                                            </a>
                                        </span>
                                        <span
                                        v-for="item in optionFilter"
                                        class="wf_listItem users_filter_items"
                                        :key="item.id"
                                        v-show="filterType.toLowerCase()=='teams' && projectTimesheetPermission">
                                            <span class="filter_list_item cursor-pointer" @click="handleFilterItem(item,'add'),$refs.filter_pt_click.click()">&nbsp;&nbsp;{{ item.name }}</span>
                                        </span>
                                        <span
                                        v-for="(item,index) in optionFilter"
                                        class="wf_listItem users_filter_items"
                                        :key="index"
                                        v-show="filterType.toLowerCase()=='projects'">
                                            <a class="vs-dropdown-users d-flex align-items-center">
                                                <input type="checkbox" v-show="filterType.toLowerCase() == 'users'" @click="handleFilterItem(item,'checkEvent')" :value="item.id" v-model="checkedFilter">&nbsp;
                                                <span v-if="item?.projectIcon && item?.projectIcon.type === 'color'" class="d-flex align-items-center justify-content-center inital-box" :style="[{'background-color': item?.projectIcon.data}]">{{ item?.name.charAt(0).toUpperCase()}}</span>
                                                <img v-if="item?.projectIcon && item?.projectIcon.type === 'image' && validateURL(item?.projectIcon.data)" class="profile-sm-square inital-box" :src="item?.projectIcon.data" alt=""/>
                                                <WasabiImage 
                                                    v-if="item?.projectIcon && item?.projectIcon.type === 'image' && !validateURL(item?.projectIcon.data)"
                                                    class="profile-sm-square inital-box"
                                                    :data="{url: item?.projectIcon.data}"
                                                />
                                                <span class="filter_list_item cursor-pointer" @click="handleFilterItem(item,'add'),$refs.filter_pt_click.click()">{{ item.name }}</span>
                                            </a>
                                        </span>
                                        <span v-if="!optionFilter || optionFilter.length == 0" class="invalid-feedback">{{$t('UserTimesheet.no_records_found')}}.</span>
                                    </div>
                                </div>
                                </template>
                            </DropDown>
                        </span>
                        <div class="chipusername_main">
                            <span class="chipusername_wrapper" v-for="(chip,chipKey) in selectedFilters" :key="chipKey">
                                <span class="user_name" :title="chip.name" >
                                    {{  `${$t(`general.${chip.type.slice(0,-1)}`)} : ${chip.name}` }}
                                        <!-- {{ `${chip.type=='Users' ? 'User' : 'Teams' ? 'Team' : 'Projects' ? 'Projects' : 'Projects'}  ${chip.name}` }} -->
                                </span>
                                <button @click="handleFilterItem(chip,'remove')" type="button" class="btn-close vs-chip--close cursor-pointer">
                                    <img :src="close" alt="cancel"/>
                                </button>
                            </span>
                        </div>
                    </div>
                </div>
                <div class="d-flex align-items-center">
                    <span class="d-flex align-items-center" :class=" clientWidth <= 1200 ? 'm-0 pt-10px' : 'ml-1 '">
                        <div class="circlegreen mr-6px"></div>
                        <span class="font-size-14 GunPowder font-weight-400">{{$t('UserTimesheet.tracked_time')}}</span>
                    </span>
                    <span class="d-flex align-items-center" :class=" clientWidth <=1200 ? 'm-0 pt-10px ml-1' : 'ml-1'">
                        <div class="circlePurple mr-6px"></div>
                        <span class="font-size-14 GunPowder font-weight-400">{{ $t('UserTimesheet.manual_time') }}</span>
                    </span>
                </div>
            </div>
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
        <NotFound />
    </div>
</div>
</template>
<script setup>
    import { useCustomComposable, useGetterFunctions } from '@/composable';
    import { useStore } from "vuex";
    import { ref, inject, watch, computed, defineComponent, onMounted } from "vue";
    import moment from 'moment';
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import ProjectTimesheetView from '@/components/atom/TimesheetView/ProjectTimeSheetView/ProjectTimesheetView.vue'
    import RangePickerComp from '@/components/molecules/RangePickerComp/RangePickerComp.vue';
    import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
    import '@vuepic/vue-datepicker/dist/main.css';
    import DropDown from '@/components/molecules/DropDown/DropDown.vue'
    import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
    import * as helper from '@/views/Timesheet/helper';
    import NotFound from '@/views/NotFound.vue';
    import { useRouter } from "vue-router"
    import { apiRequest } from '../../../services';
    import * as env from '@/config/env';
    const router = useRouter()
    const {checkPermission,debouncerWithPromise} = useCustomComposable();
    const { getters , dispatch} = useStore();
    const { getUser } = useGetterFunctions()
    const projectsGetter = computed(() => getters["projectData/allProjects"]);
    const projectList = ref([]);
    const finalProjectData = ref([]);
    const fullLoggedData = ref([]);
    const fullEstimatedData = ref([]);
    const home_icon = require("@/assets/images/home_icon.png");
    const close = require("@/assets/images/svg/close_timesheet.svg")
    const companyId = inject('$companyId');
    const clientWidth = inject("$clientWidth");
    const users = computed(() => getters["users/users"]);
    const companyUserDetail = computed(() => getters["settings/companyUserDetail"]);
    const currentCompany = computed(() => getters["settings/selectedCompany"]);
    const teams = computed(() => getters["settings/teams"]);
    const dateRange = ref({});
    const dateColumns = ref([]);
    const userArray = ref([]);
    const projectArray = ref([]);
    const timesheetDocArray = ref([]);
    const filterType = ref("");
    let isSpinner = ref(false);
    let isManinSpinner = ref(true);
    const filterSearch = ref("");
    const finalFilter = ref([]);
    const selectedFilters = ref([]);
    const checkedFilter = ref([]);
    const activeWeekObj = ref({ isWeeked: false, isOneday: false, isTwoday: false, isThreeday: false, isFourday: false, isFiveday: false, isSixday: false})
    const tableStyle = ref({'colspanCount':  "27",'tableWidth': "1888px"});
    const projectTimesheetPermission = ref(false);
    const error404 = ref(true);
    const filter_pt_click = ref(null);
    const loading = ref(true);

    const userId = inject("$userId")

    defineComponent({
        name: "UserTimesheet",
        components: {
            DropDown,
            DropDownOption,
        }
    })

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
                    if(companyUserDetail.value.roleType !== 1 && companyUserDetail.value.roleType !== 2 && !getters["settings/rules"].toggle.showAllProjects) {
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
                    if(companyUserDetail.value.roleType !== 1 && companyUserDetail.value.roleType !== 2) {
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

    const goHome = () => {
        router.push({path: `/${companyId.value}`});
    }

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
                        if (filterProjectIds.length === 0 && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2)) {
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
                            if (filterProjectIds.length === 0 && (companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2)) {
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
                        userId: userId.value
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
                        apiRequest("post", `${env.ESTIMATED_TIME}`,{queryeta: queryeta})
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
    watch(() => getters["settings/teams"],(val) => {
        teams.value = val;
    })
    const handleDate = (modelData) => {
        dateRange.value.startDate = modelData.dateVal[0] ? modelData.dateVal[0] : '';
        dateRange.value.endDate = modelData.dateVal[1] ? modelData.dateVal[1] : '';
        if((projectList.value && projectList.value.length) || (!loading.value)){
            getProjectTimesheetData(modelData.dateVal[0] ? modelData.dateVal[0] : '',modelData.dateVal[1] ? modelData.dateVal[1]: '');
        }
    }
    function handleFilterType(type,item){
        if(type != 'back'){
            setTimeout(()=>{ filterType.value =item; openFilterMenu() },100);
        }else{
            setTimeout(()=>{ filterType.value ='' },100);
        }
    }
    function manageFilterData(cb) {
        userArray.value = [];
        projectArray.value = [];
        let filterIds = selectedFilters.value.filter((x)=>{return x.type == 'Users'});
        if (filterIds.length) {
            filterIds.forEach((element) => {
                userArray.value.push(element.id)
            });
        }
        let teamsIds = selectedFilters.value.filter((x)=>{return x.type == 'Teams'});
        if (teamsIds.length) {
            teamsIds.forEach((element)=>{
                let ind = teams.value.findIndex((x)=>{return x._id == element.id});
                teams.value[ind].assigneeUsersArray.forEach((dt)=>{
                    userArray.value.push(dt)
                })
            })
        }
        let filterProject = selectedFilters.value.filter((x)=>{return x.type == "Projects"});
        if (filterProject.length) {
            filterProject.forEach((element) => {
                projectArray.value.push(element.id)
            })
        }
        cb(userArray.value, projectArray.value);
    }
    function openFilterMenu(){
        try{
            filterSearch.value ='';
            helper.getFinalFilter(filterType.value,users.value,teams.value,projectList.value).then((filterRes)=>{
                if(filterRes.status){
                    finalFilter.value = filterRes.data.finalFilter;
                }
            })
        }catch(error){
            console.error(error);
        }
    }
    function handleFilterItem(selectedItem, type, isUser=false){
        debouncerWithPromise(400).then(()=>{
            helper.handleFilterItem(selectedItem,type,selectedFilters.value, checkedFilter.value, filterType.value).then((filterRes)=>{
                if(filterRes.status){
                    let userFilter = filterRes.data.selectedFilters.filter((x) => x.type == "Users");
                    if (isUser && userFilter.length == 0) {
                        filter_pt_click.value.click()
                    }
                    selectedFilters.value = filterRes.data.selectedFilters;
                    checkedFilter.value = filterRes.data.checkedFilter;
                    manageFilterData(() => {
                        getProjectTimesheetData(dateRange.value.startDate, dateRange.value.endDate);
                    });
                }
            })
        })
    }
    const optionFilter = computed(()=>{
        const searchArray = [];
        if(filterSearch.value && filterSearch.value.length > 0) {
            const filterTypeLower = filterType.value.toLowerCase();
            if(filterTypeLower == "users") {
                users.value.forEach(rawData => {
                    if (rawData.Employee_Name.trim().toLowerCase().includes(filterSearch.value.trim().toLowerCase())) {
                        searchArray.push({
                            "id": rawData._id,
                            'name': rawData.Employee_Name,
                            'profile': rawData.Employee_profileImageURL || ''
                        });
                    }
                });
            } else if (filterTypeLower == "teams") {
                teams.value.forEach(val => {
                    if (val.name.trim().toLowerCase().includes(filterSearch.value.trim().toLowerCase())) {
                        searchArray.push({
                        "id": val._id,
                        'name': val.name
                        });
                    }
                });
            } else if (filterTypeLower == "projects") {
                projectList.value.forEach(ele => {
                    if (ele.ProjectName.trim().toLowerCase().includes(filterSearch.value.trim().toLowerCase())) {
                        searchArray.push({
                            "id": ele._id,
                            'name': ele.ProjectName,
                            'AssigneeUserId': ele.AssigneeUserId,
                            'ProjectCode': ele.ProjectCode,
                            "projectIcon": ele.projectIcon
                        });
                    }
                });
            }
        }
        return filterSearch.value ? searchArray : finalFilter.value;
    })
    const validateURL = (str) => {
        var tarea = str;
        if (tarea.indexOf("http://") == 0 || tarea.indexOf("https://") == 0) {
            return true;
        }
    }
</script>
<style src="../style.css"></style>
<style scoped>
    .page-content {
        padding: 15px;
    }
    .page-title {
        width: 100%;
    }
    ul.breadcrumb.title_strip {
        margin: 0;
        padding: 0;
        display: flex;
        align-items: center;
        height: 61px;
        background-color: #fff;
        border-bottom: 1px solid #DAE1E7;
        width: 100%;
        padding-left: 15px;
    }
    ul.breadcrumb.title_strip li:first-child {
        border-left: 0;
        padding-left: 0px;
    }
    ul.breadcrumb.title_strip li {
        list-style: none;
        padding-right:15px;
        border-left: 1px solid #b7b7b7;
        font-family: 'Roboto', sans-serif;
        font-weight:700;
        padding-left: 15px;
    }
    .dp__main.dp__theme_light {
        max-width: 100%;
        width: 260px;
        margin-right: 15px;
    }
    span.chipusername_wrapper {
        display: flex;
        background-color: #f1efef;
        border-radius: 10px;
        margin-right: 10px;
        padding: 2px 4px 2px 8px;
        font-family: 'Roboto', sans-serif;
        font-weight: 500;
        align-items: center;
        min-width: fit-content;
    }
    a.link_disable_css {
        color: #000;
        text-decoration: none;
        font-size: 16px;
    }

    span.chipusername_wrapper button {
        padding: 0;
        border: 0;
        margin-left: 4px;
        min-width: 17px;
        width: 17px;
        height: 17px;
        background: transparent !important;
    }
    span.timesheet_user_filter {
        position: sticky;
        left: 0;
        background-color: #fff;
        padding: 3px 10px 3px 10px;
        min-width: 75px;
    }
    .wf_filter::-webkit-scrollbar-thumb {
        border-radius: 10px;
        -webkit-box-shadow: inset 0 0 6px rgba(0,0,0,.3);
        background-color: #C1C1C1;
    }
    .wf_filter::-webkit-scrollbar {
        width: 5px;
        height: 5px;
        background-color: #F5F5F5;
    }
    .chipusername_main {
        display: flex;
    }
    span.chipusername_wrapper span.user_name {
        font-size: 13px;
        line-height: 18px;
        min-width: max-content;
    }
    .circlegreen {
        width: 10px;
        height: 10px;
        background-color: #1CB303;
        border-radius: 50%;
    }
    .circlePurple {
        width: 10px;
        height: 10px;
        background-color: #7367F0;
        border-radius: 50%;
    }
    @media(max-width: 1599px){
    span.timesheet_user_filter{
        min-width: 85px;
    }
}
    @media(max-width: 767px){
    .pro_route_link a, ul.breadcrumb.title_strip li span{
        font-size: 14px!important;
    }
    ul.breadcrumb.title_strip li{
        padding-right: 10px;
        padding-left: 10px;
    }
}
</style>