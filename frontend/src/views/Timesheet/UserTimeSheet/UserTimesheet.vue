<template>
<div v-if="!currentCompany?.planFeature?.userTimesheet">
    <UpgradePlan
        :buttonText="$t('Upgrades.upgrade_your_plan')"
        :lastTitle="$t('conformationmsg.to_unlock_user_timesheet')"
        :secondTitle="$t('Upgrades.unlimited')"
        :firstTitle="$t('Upgrades.upgrade_to')"
        :message="$t('Upgrades.the_feature_not_available')"
    />
</div>
<div v-else>
    <div class="timesheet_view Usertimesheet_view timesheet_view_latest" v-if="error404">
        <div class="row">
            <div class="col-md-12">
                <div class="page_title_row d-flex">
                    <div class="page-title d-flex">
                        <ul class="breadcrumb title_strip">
                            <li @click="goHome()">
                                <img class="cursor-pointer" src="@/assets/images/home_icon.png" alt="home_icon"/>
                            </li>
                            <li class="pro_route_link">
                                <router-link :to="`/${CompanyDatabase}/project`" class="text-decoration-underline font-size-18 font-weight-700">{{$t('UserTimesheet.back_projects')}}</router-link>
                            </li>
                            <li>
                                <span class="workload_title font-size-18 font-weight-700">{{$t('UserTimesheet.user_timesheet')}}</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        <div class="timesheet__wrapper page-content" :class="{'pointer-event-none': isSpinner}">
            <div class="page_top_data  d-flex align-items-center justify-content-between" :class="clientWidth <= 1200 ? 'flex-wrap flex-column align-items-start' : ''">
                <div class="d-flex" :style="[{width : clientWidth <=1200 ? '100%' : 'calc(100% - 253px)'}]" :class="clientWidth <=767 ? 'flex-column' : ''"> 
                    <RangePickerComp 
                        class="rangeComp"
                        :class="{'disabled': isSpinner}"
                        @SelectedDate="handleDate"
                        :isValidate="false"
                        preSelectType="week"
                    />
                    <div class="wf_filter" :class="{'disabled': isSpinner, 'cursor-pointer': !isSpinner}" @click.stop="$refs.filter_ut_click.click()">
                        <span class="timesheet_user_filter">
                            <DropDown id="" class="status_change_dropdown" :bodyClass="{'timesheetDropdown_wrapper' : true}">
                                <template #button>
                                    <button class="btn-white border dot-btn" ref="filter_ut_click">
                                        <a href="#" class="link_disable_css">{{$t('Filters.filter_by')}}</a>
                                    </button>
                                </template>
                                <template #options>
                                <DropDownOption v-show="filterType=='' && isEveryOne" @click="handleFilterType('select','Users')">
                                    {{$t('UserTimesheet.Users')}}
                                </DropDownOption>
                                <DropDownOption v-show="filterType=='' && isEveryOne" @click="handleFilterType('select','Teams')">
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
                                        v-show="filterType.toLowerCase()=='users' && isEveryOne">
                                            <a class="vs-dropdown-users d-flex align-items-center">
                                                <input type="checkbox" v-show="filterType.toLowerCase() == 'users'" @click="handleFilterItem(item,'checkEvent',true)" :value="item.id" v-model="checkedFilter">&nbsp;
                                                <UserProfile
                                                    v-if="filterType.toLowerCase() == 'users'"
                                                    :showDot="false"
                                                    class="timesheet_user_profile mr-10px"
                                                    :data="{
                                                        id: item.id,
                                                        title: item.name,
                                                        image: item.profile
                                                    }"
                                                    width="22px !important"
                                                    :thumbnail="'22x22'"
                                                    @click="handleFilterItem(item,'checkEvent',true)"
                                                />
                                                <!-- <img v-if="filterType.toLowerCase() == 'users'" :src="item.profile ? item.profile : defaultImage" :alt="item.name" class="timesheet_user_profile" @click="handleFilterItem(item,'checkEvent',true)"/> -->
                                                <span class="filter_list_item cursor-pointer" @click="handleFilterItem(item,'checkEvent',true)">{{ item.name }}</span>
                                            </a>
                                        </span>
                                        <span
                                        v-for="item in optionFilter"
                                        class="wf_listItem users_filter_items"
                                        :key="item.id"
                                        v-show="filterType.toLowerCase()=='teams' && isEveryOne">
                                            <span class="filter_list_item cursor-pointer" @click="handleFilterItem(item,'add'),$refs.filter_ut_click.click()">&nbsp;&nbsp;{{ item.name }}</span>
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
                                                <span class="filter_list_item cursor-pointer" @click="handleFilterItem(item,'add'),$refs.filter_ut_click.click()">{{ item.name }}</span>
                                            </a>
                                        </span>
                                        <span v-if="!optionFilter || optionFilter.length == 0" class="invalid-feedback d-block p-5px">{{$t('UserTimesheet.no_records_found')}}.</span>
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
                                    <button @click.stop.prevent="handleFilterItem(chip,'remove')" type="button" class="btn-close vs-chip--close cursor-pointer">
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
                <BillableSummary
                    class="ml-2"
                    :period-start="dateRange.startDate"
                    :period-end="dateRange.endDate"
                    :user-ids="billableUserIds"
                />
                <TimesheetApproval
                    class="ml-2"
                    :period-start="dateRange.startDate"
                    :period-end="dateRange.endDate"
                    :current-user-id="currentUserId"
                    :current-user-name="currentUserRef?.Employee_Name || ''"
                    :role-type="companyUserDetail?.roleType"
                />
            </div>
            </div>
            
            <TimesheetView v-if="!isSpinner" :filterType="filterType" :checkedFilter="checkedFilter" v-model="dateColumns" :usersArray="usersArray" :activeWeekObj="activeWeekObj" :tableStyle="tableStyle" @update:getSubItemView="getProjectData" @update:getTaskData="getTaskDataFunction" :isNoRecordShow="(usersArray.length === 0 && !isSpinner) ? true : false"/>
            <SpinnerComp :is-spinner="isSpinner || isSpinnerTask" v-if="isSpinner || isSpinnerTask"/>
        </div>
    </div>
    <div v-else class="h-100">
        <NotFound />
    </div>
</div>
</template>

<script setup>
    import { useCustomComposable ,useGetterFunctions } from '@/composable';
    import { defineComponent , onMounted ,ref , computed , inject ,watch } from "vue";
    import { useStore } from "vuex";
    import RangePickerComp from '@/components/molecules/RangePickerComp/RangePickerComp.vue';
    import moment from 'moment';
    import '@vuepic/vue-datepicker/dist/main.css';
    import { useRouter } from "vue-router"
    import TimesheetView from '@/components/atom/TimesheetView/UserTimeSheetView/UserTimesheetView.vue'
    import DropDown from '@/components/molecules/DropDown/DropDown.vue'
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import * as helper from '@/views/Timesheet/helper';
    import NotFound from '@/views/NotFound.vue';
    import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
    import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
    import { apiRequest } from '../../../services';
    import * as env from '@/config/env';
    import TimesheetApproval from '@/components/molecules/TimesheetApproval/TimesheetApproval.vue';
    import BillableSummary from '@/components/molecules/BillableSummary/BillableSummary.vue';

    defineComponent({
        name: "UserTimesheet",
        components: {
            DropDown,
            DropDownOption,
            RangePickerComp,
        }
    })
    // const defaultImage = require("@/assets/images/default_user.png")
    const close = require("@/assets/images/svg/close_timesheet.svg")
    const router = useRouter()
    const { getters , dispatch} = useStore();
    const {getUser} = useGetterFunctions();
    const {checkPermission,debouncerWithPromise} = useCustomComposable();
    const filter_ut_click = ref(null);
    const CompanyDatabase = inject("$companyId");
    const selectedFilters = ref([]);
    const clientWidth = inject("$clientWidth");
    const isSpinner = ref(true);
    const isSpinnerTask = ref(false);
    const activeWeekObj = ref({
        isWeeked: false,
        isOneday: false,
        isTwoday: false,
        isThreeday: false,
        isFourday: false,
        isFiveday: false,
        isSixday: false,
    });
    const tableStyle = ref({'colspanCount':  "35",'tableWidth': "4885px"});
    const users = ref();
    const currentUserId = inject("$userId");
    const currentUserRef = ref(getUser(currentUserId.value, true));
    const dateColumns = ref([]);
    const dateRange = ref({});
    const selectedDates = ref([]);
    // let date = new Date();
    const checkedFilter = ref([]);
    const filterType = ref("");
    const filterSearch = ref("");
    const companyId = inject('$companyId');
    const timesheetDocArray = ref([]);
    const teams = computed(() => getters["settings/teams"]);
    watch(() => getters["settings/teams"],(val) => {
        teams.value = val;
    })
    const finalFilter = ref([]);
    const companyUserDetail = computed(() => getters["settings/companyUserDetail"]);
    const billableUserIds = computed(() => (users.value || []).map((u) => u._id).filter(Boolean));
    const usersArray = ref([]);
    // dateRange.value.startDate = new Date(date.getFullYear(), date.getMonth(), 1);
    // dateRange.value.endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    selectedDates.value = [dateRange.value.startDate,dateRange.value.endDate];
    const projects = ref([]);
    const projectsGetter = computed(() => getters["projectData/allProjects"]);
    const currentCompany = computed(() => getters["settings/selectedCompany"])

    const getFinalProjectArray = ref([]);
    const isEveryOne = ref(false);
    const error404 = ref(true);
    const loading = ref(true);

    const {getTeamsData} = useGetterFunctions();

    onMounted(async () => {
        if(checkPermission('sheet_settings.user_timesheet') !== null){
            if(!projectsGetter.value || !Object.keys(projectsGetter.value).length) {
                getUserData();
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
                    if(checkPermission('project.project_list') !== null) {
                        dispatch("projectData/setProjects", {
                            ...(checkPermission("project.public_projects") === true ? publicQuery : {}),
                            restrictPublic: checkPermission("project.public_projects") !== true,
                            privateQuery,
                            roleType
                        }).then(()=>{
                            projects.value = projectsGetter.value.data ? [...projectsGetter.value.data] : [];
                            projects.value = projects.value.filter((x)=> !x.isRestrict)
                            getFinalProjectArray.value = JSON.parse(JSON.stringify(projects.value));
                            getUserData();
                            initData(dateRange.value.startDate,dateRange.value.endDate);
                            loading.value = false;
                        })
                        .catch((error) => {
                            console.error("ERROR in setProjects: ", error);
                            loading.value = false;
                        })
                    }
                }).catch((error) => {
                    console.error(error,"ERROR IN GET TEAMS DATA");
                    loading.value = false;
                });
            } else {
                projects.value = projectsGetter.value.data ? [...projectsGetter.value.data] : [];
                projects.value = projects.value.filter((x)=> !x.isRestrict)
                getFinalProjectArray.value = JSON.parse(JSON.stringify(projects.value));
                getUserData();
                initData(dateRange.value.startDate,dateRange.value.endDate);
                loading.value = false;
            }
        }else{
            error404.value = false;
            loading.value = false;
        }
    })
    const getUserData = async () => {
        if (checkPermission('sheet_settings.user_timesheet') === true || checkPermission('sheet_settings.user_timesheet') === 2) {
            isEveryOne.value = true;
            const allUser = computed(() => getters["users/users"])
            users.value = allUser.value;
        } else {
            isEveryOne.value = false;
            users.value = [getUser(currentUserId.value,true)]
        }
    }
    const handleDate = (modelData) => {
        dateRange.value.startDate = modelData.dateVal[0]
        dateRange.value.endDate = modelData.dateVal[1]
        if((projects.value && projects.value.length) || (!loading.value)){
            initData(modelData.dateVal[0] ? modelData.dateVal[0] : '',modelData.dateVal[1] ? modelData.dateVal[1]: '');
        }
    }
    const getTaskDataFunction = (projectObject,cb) => {
        isSpinnerTask.value = true;
        helper.getTaskData(projectObject,timesheetDocArray,companyId).then((response)=>{
            isSpinnerTask.value = false;
            cb(response)
        }).catch((error)=>{
            isSpinnerTask.value = false;
            console.error(error,"Error get task");
        })
    }
    const getProjectData = (userObj, cb) => {
        userObj.projectArray = [];
        const tmpfullLoggedData = timesheetDocArray.value.filter(x => x.user.trim() === userObj.id.trim());
        let userRecord = tmpfullLoggedData.map(item => item['data']).flat();
        const countFunction = (row, cb) => {
            if (count >= userRecord.length) {
                cb({ 'status': true, 'data': userObj });
                return;
            }
            let projectKey = userObj.projectArray.findIndex(item => item._id === row.projectId);
            if (projectKey === -1) {
                let proIndex = getFinalProjectArray.value.findIndex(ele => ele._id === row.projectId);
                if (proIndex !== -1) {
                    let projectData = { ...getFinalProjectArray.value[proIndex], 'activitiesArray': [], totalProjectTime: 0, 'projectManualTime': 0, 'projectTrackeTime': 0, 'projectFinalLogs': {}, 'dateWiseProjectType': {}, 'dateWiseManulTime': {}, 'dateWiseTrackTime': {}, 'selectedUserId': userObj.id }
                    let tempESTDate = row.date ? moment(new Date(row.date)).format("YYYY-MM-DD") : "";
                    projectData.totalProjectTime += row.logMinutes || 0;
                    if (row.logType === 0 || row.logType === undefined) {
                        projectData.projectManualTime += row.logMinutes || 0;
                    } else if (row.logType === 1) {
                        projectData.projectTrackeTime += row.logMinutes || 0;
                    }
                    let isExist = Object.keys(projectData.projectFinalLogs).includes(tempESTDate);
                    if (isExist) {
                        projectData.projectFinalLogs[tempESTDate] += row.logMinutes || 0;
                        if (row.logType === 0 || row.logType === undefined) {
                            projectData.dateWiseManulTime[tempESTDate] = projectData.dateWiseManulTime[tempESTDate] ?  projectData.dateWiseManulTime[tempESTDate] + (row.logMinutes || 0) : (row.logMinutes || 0);
                        } else if (row.logType === 1) {
                            projectData.dateWiseTrackTime[tempESTDate] = projectData.dateWiseTrackTime[tempESTDate] + row.logMinutes || 0;
                        }
                        if (projectData.dateWiseProjectType[tempESTDate] !== row.logType) {
                            projectData.dateWiseProjectType[tempESTDate] = 2;
                        }
                    } else {
                        projectData.projectFinalLogs[tempESTDate] = row.logMinutes || 0;
                        projectData.dateWiseProjectType[tempESTDate] = row.logType;
                        if (row.logType === 0 || row.logType === undefined) {
                            projectData.dateWiseManulTime[tempESTDate] = row.logMinutes || 0;
                        }  else if (row.logType === 1) {
                            projectData.dateWiseTrackTime[tempESTDate] = row.logMinutes || 0;
                        }
                    }
                    userObj.projectArray.push(projectData);
                    count++;
                    countFunction(userRecord[count], cb);
                } else {
                    count++;
                    countFunction(userRecord[count], cb);
                }
            } else {
                let tempESTDate = row.date ? moment(new Date(row.date)).format("YYYY-MM-DD") : "";
                userObj.projectArray[projectKey].totalProjectTime += row.logMinutes || 0;
                if (row.logType === 0 || row.logType === undefined) {
                    userObj.projectArray[projectKey].projectManualTime += row.logMinutes || 0;
                } else if (row.logType === 1) {
                    userObj.projectArray[projectKey].projectTrackeTime += row.logMinutes || 0;
                }
                let isExist = Object.keys(userObj.projectArray[projectKey].projectFinalLogs).includes(tempESTDate);
                if (isExist) {
                    userObj.projectArray[projectKey].projectFinalLogs[tempESTDate] += row.logMinutes || 0;
                    if (userObj.projectArray[projectKey].dateWiseProjectType[tempESTDate] !== row.logType) {
                        userObj.projectArray[projectKey].dateWiseProjectType[tempESTDate] = 2;
                    }
                    if (row.logType === 0 || row.logType === undefined) {
                        userObj.projectArray[projectKey].dateWiseManulTime[tempESTDate] = userObj.projectArray[projectKey].dateWiseManulTime[tempESTDate] ?  userObj.projectArray[projectKey].dateWiseManulTime[tempESTDate] + (row.logMinutes || 0) : (row.logMinutes || 0);
                    } else if (row.logType === 1) {
                        userObj.projectArray[projectKey].dateWiseTrackTime[tempESTDate] = userObj.projectArray[projectKey].dateWiseTrackTime[tempESTDate] + row.logMinutes || 0;
                    }
                } else {
                    userObj.projectArray[projectKey].projectFinalLogs[tempESTDate] = row.logMinutes || 0;
                    userObj.projectArray[projectKey].dateWiseProjectType[tempESTDate] = row.logType;
                    if (row.logType === 0 || row.logType === undefined) {
                        userObj.projectArray[projectKey].dateWiseManulTime[tempESTDate] = row.logMinutes || 0;
                    } else if (row.logType === 1) {
                        userObj.projectArray[projectKey].dateWiseTrackTime[tempESTDate] = row.logMinutes || 0;
                    }
                }
                count++;
                countFunction(userRecord[count], cb);
            }
        };
        let count = 0;
        countFunction(userRecord[count], cb);
    }
    const goHome = () => {
        router.push({path: `/${companyId.value}`});
    }
    const getTimesheetData = (sdate, edate) => {
        return new Promise((resolve, reject) => {
            let start = sdate / 1000;
            let end = edate / 1000;
            let userArray = [];
            let filterIds = selectedFilters.value.filter((x) => { return x.type == 'Users' });
            if (filterIds.length) {
                filterIds.forEach((element) => {
                    userArray.push(element.id)
                });
            }
            let teamsIds = selectedFilters.value.filter((x) => { return x.type == 'Teams' });
            if (teamsIds.length) {
                teamsIds.forEach((element) => {
                    let ind = teams.value.findIndex((x) => { return x._id === element.id });
                    teams.value[ind].assigneeUsersArray.forEach((dt) => {
                        userArray.push(dt)
                    })
                })
            }
            if (filterIds.length === 0 && teamsIds.length === 0) {
                users.value.forEach((element) => {
                    userArray.push(element._id)
                });
            }
            let filterProject = selectedFilters.value.filter((x) => { return x.type == "Projects" });
            let projectArray = [];
            if (filterProject.length) {
                filterProject.forEach((element) => {
                    projectArray.push(element.id)
                })
            }
            const axiosObj = {
                selectedFilter : selectedFilters.value,
                projectArray: projectArray,
                userArray: userArray,
                start: start,
                end: end,
                companyUserDetail: companyUserDetail.value,
                timeZone: currentUserRef.value.Time_Zone ? currentUserRef.value.Time_Zone : "Asia/Kolkata"
            }

            apiRequest("post", `${env.TIMESHEET}/user`,axiosObj)
            .then((result) => {
                const timeSheet = result.data;
                let data = [];
                timeSheet.map((row) => {
                    data.push({ ...row, 'logType': row._id.logType ? row._id.logType : 0 });
                })
                timesheetDocArray.value = data;
                if (filterProject.length) {
                    timesheetDocArray.value.forEach((x) => {
                        if(getUser(x.user).ghostUser){
                            const index = users.value.findIndex((user) => user._id === x.user);
                            if(index === -1){
                                users.value.push(getUser(x.user));
                            }
                        }
                    })
                }
                resolve(timeSheet)
            })
            .catch(() => {
                timesheetDocArray.value = [];
                reject([])
            })
        })
    }
    const initData = (startDate, EndDate) => {
        try {
            if(!(startDate) && !(EndDate)) {
                isSpinner.value = false;
                return;
            }
            isSpinner.value = true;
            var sDate = startDate ? new Date(startDate).setHours(0,0,0,0) : new Date(dateRange.value.startDate).getTime();
            var eDate = new Date(EndDate || dateRange.value.endDate);
            eDate.setHours(23, 59, 59);
            dateColumns.value = [];
            usersArray.value = [];
            for (let i = sDate; i < eDate.getTime(); i += 86400000) {
                const momentDate = moment(new Date(i));
                const DateColumn = {
                    date: momentDate.format('DD'),
                    day: momentDate.format('ddd'),
                    fullDate: momentDate.format('YYYY-MM-DD'),
                    currentDate: moment(new Date()).format('YYYY-MM-DD'),
                    arabiDay: momentDate.format('Do').replace(/[0-9]/g, ''),
                    arabiMonth: momentDate.format('MMM'),
                    mainDate: new Date(i),
                    weekNumber: (momentDate.weeks() - momentDate.startOf('month').weeks() + 1 + 52) % 52,
                    weekName: ["1st", "2nd", "3rd", "4th", "5th"][(momentDate.weeks() - momentDate.startOf('month').weeks() + 1 + 52) % 52 - 1] || "",
                    dateMonth: momentDate.format('MM'),
                    totalUserEst: {},
                    totalUserLogs: {},
                    totalManualLogs:{},
                    totalTrackedLogs:{},
                    totalDayEst: 0,
                    totalDayLogs: 0,
                    totalLogsType: {},
                };
                dateColumns.value.push(DateColumn);
                const dateColumnsLength = dateColumns.value.length;
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
                    const tblWidth = noOfDays * 190 + 570;
                    tableStyle.value.tableWidth = tblWidth + 'px';
                    const tblColspan = 6 + 3 * noOfDays;
                    tableStyle.value.colspanCount = tblColspan;
                }
            }
            if(projects.value && projects.value.length){
                getTimesheetData(sDate, eDate).then(() => {
                    let promise = []
                    getRemainingProject();
                    displayUserArray().then((response) => {
                        response.forEach((user) => {
                            promise.push(userArrayPromise(user));
                        })
                    })
                    Promise.allSettled(promise).then(() => {
                        isSpinner.value = false;
                    }).catch((error) => {
                        isSpinner.value = false;
                        console.error(error,"error");
                    })
                });   
            }else{
                isSpinner.value = false;
            }
        } catch (error) {
            isSpinner.value = false;
            console.error("Error",error)
        }
    }
    const displayUserArray = () => {
        return new Promise((resolve, reject) => {
            try {
                let userArray = [];
                const filterIds = selectedFilters.value.filter(x => x.type === 'Users');
                const teamsIds = selectedFilters.value.filter(x => x.type === 'Teams');
                const filterProject = selectedFilters.value.filter(x => x.type === 'Projects');
                if (timesheetDocArray.value.length) {
                    timesheetDocArray.value.forEach(ele => {
                        const index = users.value.findIndex(x => x._id === ele.user);
                        if (index !== -1) {
                            userArray.push(users.value[index]);
                        }
                    });
                }
                teamsIds.forEach(element => {
                    const ind = teams.value.findIndex(x => x._id === element.id);
                    if (ind !== -1) {
                        const userArr = teams.value[ind].assigneeUsersArray;
                        userArr.forEach(data => {
                            const index = users.value.findIndex(x => x._id === data);
                            if (index !== -1) {
                                userArray.push(users.value[index]);
                            }
                        });
                    }
                });
                filterIds.forEach(element => {
                    const ind = users.value.findIndex(x => x._id === element.id);
                    if (ind !== -1) {
                        userArray.push(users.value[ind]);
                    }
                })
                if (filterProject.length === 0 && filterIds.length === 0 && teamsIds.length === 0) {
                    userArray = [...users.value];
                }
                const uniqueArray = [...new Set(userArray)];
                resolve(uniqueArray);
            } catch (error) {
                reject(error);
            }
        })
    }
    const getRemainingProject = () => {
        if (timesheetDocArray.value.length && getFinalProjectArray.value.length) {
            let tmpfullLoggedData = timesheetDocArray.value.map(item => item['data']).flat() || [];
            let uniqueProject = [...new Set(tmpfullLoggedData.map((x)=>{return x.projectId}))]
            let projectId = getFinalProjectArray.value.map((x)=>{return x._id});
            let remainProject = uniqueProject.filter(item => !projectId.includes(item));
            if (!isEveryOne.value || companyUserDetail.value.roleType === 1 || companyUserDetail.value.roleType === 2) {
                const params = { dataIds: remainProject }
                apiRequest("post", `${env.API_GET_REMAINING_PROJECTS}`, params).then((response) => {
                    const results = response.data.data;
                    if (results.length > 0) {
                        results.forEach((res) => {
                            getFinalProjectArray.value.push({ ...res, isShow: false });
                            getFinalProjectArray.value = getFinalProjectArray.value.filter((x)=> !x.isRestrict)
                        })
                    }
                })
            }
        }
    } 
    const userArrayPromise = (userData) => {
        return new Promise((resolve, reject) => {
            try {
                var totalLoghrs = 0;
                userData.manuallyLog = {'name' : 'Manually Time',time : 0};
                userData.trackdLog = {'name' : 'Track Time',time : 0};
                let tmpfinalMongoData = timesheetDocArray.value.filter((x)=>{return x.user.trim() == userData._id.trim()});
                let finalMongoData = tmpfinalMongoData.map(item => item['data']).flat();
                if(finalMongoData.length){
                    let count = 0;
                    let countFunction = (element) => {
                        if (count >= finalMongoData.length) {
                            let fIndex = usersArray.value.findIndex((e)=>{return e.id == userData._id})
                            if(fIndex == -1) {
                                usersArray.value.push({
                                    'id': userData._id,
                                    'name': userData.Employee_Name,
                                    'profileImage': userData.Employee_profileImageURL,
                                    'activitiesArray': [],
                                    'totalLoggedHours': totalLoghrs,
                                    'projectArray' : [],
                                    'manuallyLog' : userData.manuallyLog,
                                    'trackdLog' : userData.trackdLog
                                })
                            } else {
                                usersArray.value[fIndex] = {...usersArray.value[fIndex],...{
                                    'id': userData._id,
                                    'name': userData.Employee_Name,
                                    'profileImage': userData.Employee_profileImageURL,
                                    'activitiesArray': [],
                                    'totalLoggedHours': totalLoghrs,
                                    'projectArray' : [],
                                    'manuallyLog' : userData.manuallyLog,
                                    'trackdLog' : userData.trackdLog
                                }}
                            }
                            resolve();
                        } else {
                            let isOkProject = getFinalProjectArray.value.find((x)=> x._id == element.projectId)
                            if (isOkProject) {
                                let totalMin = element.logMinutes ? parseInt(element.logMinutes) : 0;
                                let tempDate = element.date ? moment(new Date(element.date)).format("YYYY-MM-DD") : '';
                                let searchInd = dateColumns.value.findIndex((x) => {
                                    return x.fullDate == tempDate
                                });
                                if(element.userId.toString().trim() === userData._id.trim()){
                                    userData.totalLoggedHours += totalMin;
                                    totalLoghrs += totalMin;
                                    if(element.logType == 0){
                                        userData.manuallyLog.time += totalMin; 
                                    }
                                    else if(element.logType == 1){
                                        userData.trackdLog.time += totalMin; 
                                    }
                                    else if(element.logType == undefined){
                                        userData.manuallyLog.time += totalMin; 
                                    }
                                    if(searchInd !== -1){
                                        dateColumns.value[searchInd].totalDayLogs += totalMin;
                                        let getUserKey = Object.keys(dateColumns.value[searchInd].totalUserLogs).includes(element.userId.toString().trim());
                                        if(!getUserKey){
                                            dateColumns.value[searchInd].totalUserLogs[`${element.userId.toString()}`] = totalMin;
                                            dateColumns.value[searchInd].totalLogsType[`${element.userId.toString()}`] = element.logType;
                                            if (element.logType === 0 || element.logType === undefined) {
                                                dateColumns.value[searchInd].totalManualLogs[`${element.userId.toString()}`] = totalMin
                                            } else {
                                                dateColumns.value[searchInd].totalTrackedLogs[`${element.userId.toString()}`] = totalMin
                                            }
                                            count++;
                                            countFunction(finalMongoData[count]);
                                        }
                                        else{
                                            dateColumns.value[searchInd].totalUserLogs[`${element.userId.toString()}`] = totalMin + parseInt(dateColumns.value[searchInd].totalUserLogs[`${element.userId.toString()}`] ? dateColumns.value[searchInd].totalUserLogs[`${element.userId.toString()}`] : 0);
                                            if(dateColumns.value[searchInd].totalLogsType[`${element.userId.toString()}`] != element.logType){
                                                dateColumns.value[searchInd].totalLogsType[`${element.userId.toString()}`] = 2;
                                            }
                                            if (element.logType === 0 || element.logType === undefined) {
                                                dateColumns.value[searchInd].totalManualLogs[`${element.userId.toString()}`] = totalMin + parseInt(dateColumns.value[searchInd].totalManualLogs[`${element.userId.toString()}`] ? dateColumns.value[searchInd].totalManualLogs[`${element.userId.toString()}`] : 0)
                                            } else {
                                                dateColumns.value[searchInd].totalTrackedLogs[`${element.userId.toString()}`] = totalMin + parseInt(dateColumns.value[searchInd].totalTrackedLogs[`${element.userId.toString()}`] ? dateColumns.value[searchInd].totalTrackedLogs[`${element.userId.toString()}`] : 0)
                                            }
                                            count++;
                                            countFunction(finalMongoData[count]);
                                        }
                                    } else {
                                        count++;
                                        countFunction(finalMongoData[count]);
                                    }
                                } else {
                                    count++;
                                    countFunction(finalMongoData[count]);
                                }
                            } else {
                                count++;
                                countFunction(finalMongoData[count]);
                            }
                        }
                    }
                    countFunction(finalMongoData[count]);
                } else {
                    let fIndex = usersArray.value.findIndex((e)=>{return e.id == userData._id})
                    if(fIndex == -1) {
                        usersArray.value.push({
                            'id': userData._id,
                            'name': userData.Employee_Name,
                            'profileImage': userData.Employee_profileImageURL,
                            'activitiesArray': [],
                            'totalLoggedHours': totalLoghrs,
                            'projectArray' : [],
                            'manuallyLog' : userData.manuallyLog,
                            'trackdLog' : userData.trackdLog
                        })
                    } else {
                        usersArray.value[fIndex] = {...usersArray.value[fIndex],...{
                            'id': userData._id,
                            'name': userData.Employee_Name,
                            'profileImage': userData.Employee_profileImageURL,
                            'activitiesArray': [],
                            'totalLoggedHours': totalLoghrs,
                            'projectArray' : [],
                            'manuallyLog' : userData.manuallyLog,
                            'trackdLog' : userData.trackdLog
                        }}
                    }
                    resolve(); 
                }
            } catch (error) {
                reject(error)
            }
        })
    }
    function handleFilterType(type,item){
        if(type != 'back'){
            setTimeout(()=>{ filterType.value =item;openFilterMenu() },100);
        }else{
            setTimeout(()=>{ filterType.value ='' },100);
        }
    }
    function openFilterMenu(){
        try{
            filterSearch.value ='';
            helper.getFinalFilter(filterType.value,users.value,teams.value,projects.value).then((filterRes)=>{
                if(filterRes.status){
                    finalFilter.value = filterRes.data.finalFilter;
                }
            })
        }catch(error){
            console.error(error);
        }
    }
    function handleFilterItem(selectedItem, type ,isUser=false){
        debouncerWithPromise(400).then(()=>{
            helper.handleFilterItem(selectedItem,type,selectedFilters.value, checkedFilter.value, filterType.value).then((filterRes)=>{
                if(filterRes.status){
                    let userFilter = filterRes.data.selectedFilters.filter((x) => x.type == "Users");
                    if (isUser && userFilter.length == 0) {
                        filter_ut_click.value.click()
                    }
                    selectedFilters.value = filterRes.data.selectedFilters;
                    checkedFilter.value = filterRes.data.checkedFilter;
                    initData(dateRange.value.startDate,dateRange.value.endDate);
                }
            })
        })
    }
    const optionFilter = computed(()=>{
        const searchArray = [];
        if (filterSearch.value && filterSearch.value.length > 0) {
            const filterTypeLower = filterType.value.toLowerCase();
            if (filterTypeLower === "users") {
                users.value.forEach(rawData => {
                if (rawData.Employee_Name.trim().toLowerCase().includes(filterSearch.value.trim().toLowerCase())) {
                    searchArray.push({
                    "id": rawData._id,
                    'name': rawData.Employee_Name,
                    'profile': rawData.Employee_profileImageURL || ''
                    });
                }
                });
            } else if (filterTypeLower === "teams") {
                    teams.value.forEach(val => {
                    if (val.name.trim().toLowerCase().includes(filterSearch.value.trim().toLowerCase())) {
                        searchArray.push({
                        "id": val._id,
                        'name': val.name
                        });
                    }
                    });
            } else if (filterTypeLower === "projects") {
                projects.value.forEach(ele => {
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
.disabled{
    pointer-events: none;
}
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
    min-width: 69px;
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
span.timesheet_user_filter button.dot-btn {
  min-width: 60px;
}


@media(max-width: 1599px){
    span.timesheet_user_filter{
        min-width: 85px;
    }
}
@media(max-width: 767px){
    .pro_route_link a, ul.breadcrumb.title_strip li span{
        font-size: 14px !important;
    }
    ul.breadcrumb.title_strip li{
        padding-right: 10px;
        padding-left: 10px;
    }
}
</style>
