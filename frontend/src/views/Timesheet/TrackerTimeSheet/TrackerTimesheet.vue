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
        <div class="timesheet_view Usertimesheet_view timesheet_view_latest bg-light-gray time_tracker__timesheet" v-if="error404">
            <div class="row">
                <div class="col-md-12">
                    <div class="page_title_row d-flex">
                        <div class="page-title d-flex">
                            <ul class="breadcrumb title_strip">
                                <li @click="goHome()">
                                    <img class="cursor-pointer" src="@/assets/images/home_icon.png" alt="home_icon"/>
                                </li>
                                <li class="pro_route_link">
                                    <router-link :to="`/${companyId}/project`" class="text-decoration-underline font-size-18 font-weight-700">{{$t('UserTimesheet.back_projects')}}</router-link>
                                </li>
                                <li>
                                    <span class="workload_title font-size-18 font-weight-700">{{$t('UserTimesheet.tracker_timesheet')}}</span>
                                </li>
                            </ul>
                        <TimesheetTabs active="tracker" class="ts-legacy-tabs" />
                        </div>
                    </div>
                </div>
            </div>
            <div class="timesheet__wrapper page-content bg-light-gray h-100">
                <div class="page_top_data  d-flex align-items-center justify-content-between flex-wrap">
                    <div class="d-flex" :class="[{'flex-wrap' : clientWidth <=767}]" :style="[{width : clientWidth > 768 ? 'calc(100% - 233px)' : '100%'}]"> 
                    <span class="cursor-pointer"><img class="position-re left__arrow-img" src="@/assets/images/rectangle_leftArrow.png" @click="dateChange('left')"></span>
                        <span class="tracker-timesheet-calender-wrapper">
                            <CalenderCompo
                                class="tracker-timesheet-calender"
                                v-model:model-value="dateValue"
                                :isShowDateAndicon="true"
                                @update:model-value="($event) => {dateUpdate($event)}"
                            />
                        </span>
                        <span class="cursor-pointer"><img class="position-re right__arrow-img" src="@/assets/images/rectangle_rightArrow.png" @click="dateChange('right')" ></span>
                        <div class="wf_filter cursor-pointer" @click.stop="$refs.filter_tt_click.click()"  :style="[{marginTop : clientWidth <= 767 ? '15px' : '0px', marginLeft : clientWidth <=767 ? '0' : '17px' }]">
                            <span class="timesheet_user_filter bg-white">
                                <DropDown id="" class="status_change_dropdown" :bodyClass="{'timesheetDropdown_wrapper' : true}">
                                    <template #button>
                                        <button ref="filter_tt_click" class="btn-white border dot-btn">
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
                                                {{$t('UserTimesheet.back')}}
                                            </a>
                                            <span>{{$t(`UserTimesheet.${filterType}`)}}</span>
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
                                                            image: item.profile || ''
                                                        }"
                                                        width="22px"
                                                        :thumbnail="'22x22'"
                                                        @click="handleFilterItem(item,'checkEvent',true)"
                                                    />
                                                    <span class="filter_list_item cursor-pointer" @click="handleFilterItem(item,'checkEvent',true)">{{ item.name }}</span>
                                                </a>
                                            </span>
                                            <span
                                            v-for="item in optionFilter"
                                            class="wf_listItem users_filter_items"
                                            :key="item.id"
                                            v-show="filterType.toLowerCase()=='teams' && isEveryOne">
                                                <span class="filter_list_item cursor-pointer" @click="handleFilterItem(item,'add'),$refs.filter_tt_click.click()">&nbsp;&nbsp;{{ item.name }}</span>
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
                                                    <span class="filter_list_item cursor-pointer" @click="handleFilterItem(item,'add'),$refs.filter_tt_click.click()">{{ item.name }}</span>
                                                </a>
                                            </span>
                                            <span v-if="!optionFilter || optionFilter.length == 0" class="invalid-feedback d-block p-5px">{{$t('UserTimesheet.no_records_found')}}</span>
                                        </div>
                                    </div>
                                    </template>
                                </DropDown>
                            </span>
                            <div class="chipusername_main d-flex">
                                <span class="chipusername_wrapper" v-for="(chip,chipKey) in selectedFilters" :key="chipKey">
                                    <span class="user_name" :title="chip.name" >
                                            {{  `${$t(`general.${chip.type.slice(0,-1)}`)} : ${chip.name}` }}
                                        </span>
                                        <button @click="handleFilterItem(chip,'remove')" type="button" class="btn-close vs-chip--close cursor-pointer">
                                            <img src="@/assets/images/svg/close_timesheet.svg" alt="cancel"/>
                                        </button>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="trackerTimeSheet">
                    <div class="timebarWrapper">
                        <TimebarComponent :logRangeValue="logRange" :selectedSlot="selectedSlot" @toggle="selectedSlot = $event"/>
                    </div>
                    <div class="mt-12px">
                        <div class="screenShotTime red mt-50px text-center" v-if="subSpinner">
                            <div class="screenShotTime-skelaton bg-white" v-for="(sKey) in skelatonArray" :key="sKey">
                                <div class="screenShotTime-skelaton--time font-size-18 black">
                                    <Skelaton class="" style="height: 22px; width: 170px;"/>
                                </div>
                            </div>
                        </div>
                        <div class="screenShotTime style-scroll" v-if="finalRange?.length && !subSpinner">
                            <ScreenshotTime v-for="log in finalRange" :key="log.time" :logRangeData="log" :active="selectedSlot === log.time" :trackShots="log.trackShot" @update:getScreenShotDetail="getScreenShotDetailFunction" @toggle="selectedSlot = $event" :id="log.time" />
                        </div>
                        <div class="screenShotTime red mt-50px text-center" v-if="!finalRange?.length && !subSpinner">
                            {{$t('UserTimesheet.no_records_found')}}
                        </div>
                    </div>
                </div>
                <SpinnerComp :is-spinner="isSpinner" v-if="isSpinner"/>
            </div>
        </div>
        <div v-else class="h-100">
            <NotFound />
        </div>
    </div>
</template>

<script setup>
    import TimesheetTabs from '@/views/Timesheet/TimesheetTabs.vue';
    import '@/views/Timesheet/timeV2.css';
    import { useCustomComposable ,useGetterFunctions } from '@/composable';
    import TimebarComponent from '@/components/atom/TimesheetView/TrackerTimeSheetView/TimebarComponent.vue'
    import { defineComponent , onMounted ,ref , computed , inject ,watch } from "vue";
    import CalenderCompo from '@/components/atom/CalenderCompo/CalenderCompo.vue';
    import { useStore } from "vuex";
    import { useRouter } from "vue-router"
    import DropDown from '@/components/molecules/DropDown/DropDown.vue'
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import * as helper from '@/views/Timesheet/helper';
    import ScreenshotTime from '@/components/atom/TimesheetView/TrackerTimeSheetView/ScreenshotTime'
    import NotFound from '@/views/NotFound.vue'
    import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
    import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
    import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
    import { apiRequest } from '../../../services';
    import * as env from '@/config/env';
    const {getUser} = useGetterFunctions();
    defineComponent({
        name: "UserTimesheet",
        components: {
            DropDown,
            DropDownOption,
        }
    })
    const skelatonArray = ref([1,2,3,4,5])
    const timeSlots = ref([]);
    const selectedSlot = ref(null);
    const timeSlotObj = ref([]);
    const logRange = ref([]);
    const finalRange = ref([]);
    const router = useRouter()
    const { getters , dispatch} = useStore();
    const {checkPermission,debouncerWithPromise} = useCustomComposable();
    const selectedFilters = ref([]);
    const isSpinner = ref(false);
    const subSpinner = ref(true);
    const users = ref();
    const dateValue = ref(new Date());
    const checkedFilter = ref([]);
    const filterType = ref("");
    const filterSearch = ref("");
    const companyId = inject('$companyId');
    const clientWidth = inject("$clientWidth");
    const userId = inject('$userId')
    const teams = computed(() => getters["settings/teams"]);
    const taskArray = ref([]);
    const filter_tt_click = ref(null);
    const timer = ref(null);

    const currentCompany = computed(() => getters["settings/selectedCompany"])

    watch(() => getters["settings/teams"],(val) => {
        teams.value = val;
    })
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
    const finalFilter = ref([]);
    const companyUserDetail = computed(() => getters["settings/companyUserDetail"]);
    const projects = ref([]);
    const projectsGetter = computed(() => getters["projectData/projects"]);
    const isEveryOne = ref(false);
    const error404 = ref(true);

    const {getTeamsData} = useGetterFunctions();

    onMounted(async () => {
        if(checkPermission('sheet_settings.tracker_timesheet') !== null){
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
    const dateUpdate = (val) => {
        dateValue.value = val;
        getTimeSlot();
        getTrackerTimesheetData();
        selectedSlot.value = null;
    }
    const resetLogRange = () => {
        finalRange.value = [];
        logRange.value.forEach((ele)=>{
            ele.inRange = false;
            ele.isSelected = false;
        })
    }
    const getTimeSlot = () => {
        resetLogRange();
        timeSlots.value = [];
        for (let i = 0; i < 24; i++) {
            let startTime = new Date(dateValue.value).setHours(i,0,0)
            let endTime = new Date(dateValue.value).setHours(i+1,0,0)
            timeSlots.value.push({time:i , inRange: false , start: startTime, end: endTime , trackShot: []});
        }
    }
    function debouncer(timeout = 1000) {
        return new Promise((resolve) => {
            if (timer.value) {
            clearTimeout(timer.value);
            }
            timer.value = setTimeout(() => {
            resolve();
            }, timeout);
        });
    }
    const dateChange = (type) => {
        if (type == 'left') {
            dateValue.value =  new Date(new Date(dateValue.value).setDate(dateValue.value.getDate() - 1));
        } else {
            dateValue.value =  new Date(new Date(dateValue.value).setDate(dateValue.value.getDate() + 1));
            selectedSlot.value = null;
        }
        debouncer(300).then(() => {
            getTimeSlot();
            getTrackerTimesheetData();
            selectedSlot.value = null;
        })
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
    const goHome = () => {
        router.push({path: `/${companyId.value}`});
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
    const getTrackerTimesheetData = () => {
        subSpinner.value = true;
        let batchObject = {first: [], second: [], third: []};
        for (let i = 0; i < timeSlots.value.length; i++) {
            if (i < 8) {
                batchObject.first.push(timeSlots.value[i])
            } else if (i >= 8 && i < 16) {
                batchObject.second.push(timeSlots.value[i])
            } else {
                batchObject.third.push(timeSlots.value[i])
            }
        }
        
        let count = 0;
        let countFunction = (row) => {
            if (count >= Object.keys(batchObject).length) {
                finalRange.value.sort((a,b)=> a.time - b.time);
                
                let first = logRange.value.find((ele)=> ele.inRange)
                if (first) {
                    selectedSlot.value = first.time
                    getDBData().catch((e) => {
                        subSpinner.value = false;
                        console.error(e)
                    })
                } else {
                    subSpinner.value = false;
                }
                return;
            } else {
                let promise = []
                row.forEach((ele) => {
                    promise.push(executeQuery(ele));
                })
                Promise.allSettled(promise).then(()=>{
                    count++;
                    countFunction(batchObject[Object.keys(batchObject)[count]]);
                }).catch((error)=>{
                    console.error(error);
                    count++;
                    countFunction(batchObject[Object.keys(batchObject)[count]]);
                })
            }
        }
        countFunction(batchObject[Object.keys(batchObject)[count]]);
    }
    const getTrackShotData = (element) => {
        return new Promise((resolve, reject) => {
            try {
                if (timeSlots.value[element].trackShot.length === 0) {
                    let start = Math.floor(timeSlots.value[element].start / 1000);
                    let end = Math.floor(timeSlots.value[element].end / 1000);
                    queryFunction().then((userArr) => {
                        const axiosObj = {
                            selectedFilter : selectedFilters.value,
                            userArray: userArr,
                            start: start,
                            end: end,
                            isEveryOne: isEveryOne.value
                        }
                        apiRequest("post", `${env.TIMESHEET}/tracker`,axiosObj)
                        .then((result) => {
                            const timesheet = result.data; 
                            let arrayData = [];
                            let finalresult = timesheet.filter( (x)=>{
                                 x.data =  x.data.filter( (y)=>{
                                    let isProject =  projects.value.find((z)=> z._id == y.ProjectId)
                                    if (isProject) {
                                        return true;
                                    }
                                })
                                if (x.data.length) {
                                    return true
                                }
                            })
                            finalresult.map((vals) => {
                                let docTemp = vals;
                                arrayData.push({ ...docTemp, 'logAddType': docTemp.logAddType ? docTemp.logAddType : 0 });
                            })

                            // Use reduce to concatenate 'data' arrays
                            const finalData = arrayData.reduce((accumulator, currentValue) => {
                                return accumulator.concat(currentValue.data);
                            }, []);

                            let array = [];
                            finalData.forEach((row) => {
                                if (row.trackShots && row.trackShots.length) {
                                    row.trackShots.forEach((track) => {
                                        let screenShotTime = track.screenShotTime ? Number(track.screenShotTime) : new Date().getTime()
                                        if (screenShotTime >= start * 1000 && screenShotTime <= end * 1000) {
                                            let proInd = projects.value.findIndex((x) => x._id === row.ProjectId)
                                            let obj = {
                                                time: screenShotTime,
                                                image: track.image,
                                                trackShots: track,
                                                userId: row.Loggeduser,
                                                memoName: row.LogDescription,
                                                projectName: proInd !== -1 ? projects.value[proInd].ProjectName : '',
                                                projectKey: proInd !== -1 ? projects.value[proInd].ProjectCode : '',
                                                userProfile: getUser(row.Loggeduser)?.Employee_profileImageURL,
                                                userName: getUser(row.Loggeduser)?.Employee_Name,
                                                taskId: row.TicketID,
                                                companyId: companyId.value,
                                                projectId: row.ProjectId
                                            }
                                            array.push(obj);
                                        }
                                    })
                                }
                            })

                            timeSlots.value[element].trackShot = array;
                            timeSlotObj.value = timeSlots.value[element];
                            resolve(timeSlots.value[element].trackShot);
                        })
                    }).catch((error)=>{
                        reject(error);
                        console.error(error);
                    })
                }
                else {
                    resolve([])
                }            
            } catch (error) {
                reject(error);
            }
        })
    }
    function handleFilterItem(selectedItem, type, isUser=false){
        debouncerWithPromise(400).then(()=>{
            helper.handleFilterItem(selectedItem,type,selectedFilters.value, checkedFilter.value, filterType.value).then((filterRes)=>{
                if(filterRes.status){
                    let userFilter = filterRes.data.selectedFilters.filter((x) => x.type == "Users");
                    if (isUser && userFilter.length == 0) {
                        filter_tt_click.value.click()
                    }
                    selectedFilters.value = filterRes.data.selectedFilters;
                    checkedFilter.value = filterRes.data.checkedFilter; // call inint function here
                    selectedSlot.value = null;
                    resetLogRange();
                    getTimeSlot();
                    getTrackerTimesheetData();
                }
            })
        })
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
                let teamsIds = selectedFilters.value.filter((x) => { return x.type == 'Teams' });
                if (teamsIds.length) {
                    teamsIds.forEach((element)=>{
                        let ind = teams.value.findIndex((x)=>{return x._id == element.id});
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

                resolve(userArray);
            } catch (error) {
                reject(error);
            }
        })
    }
    const executeQuery = (ele) => {
        return new Promise((resolve, reject) => {
            try {
                let start = Math.floor(ele.start / 1000);
                let end = Math.floor(ele.end / 1000);
                queryFunction().then((userArr) => {
                    const axiosObj = {
                        selectedFilter : selectedFilters.value,
                        userArray: userArr,
                        start: start,
                        end: end,
                        isEveryOne: isEveryOne.value
                    }
                    apiRequest("post", `${env.TIMESHEET}/tracker`,axiosObj)
                    .then((result) => {
                        const timesheet = result.data;
                        if (timesheet.length) {
                            let finalresult = timesheet.filter( (x)=>{
                                 x.data =  x.data.filter( (y)=>{
                                    let isProject =  projects.value.find((z)=> z._id == y.ProjectId)
                                    if (isProject) {
                                        return true;
                                    }
                                })
                                if (x.data.length) {
                                    return true
                                }
                            })
                            if (finalresult.length) {
                                let ind = logRange.value.findIndex((x) => x.time === ele.time);
                                logRange.value[ind] = {time: ele.time, inRange: true}
                                finalRange.value.push({...logRange.value[ind], isSelected: false})
                                resolve();
                            } else {
                                resolve();
                            }
                        } else {
                            resolve();
                        }
                    }).catch((error) => {
                        console.error(error);
                        reject();
                    })
                }).catch((error)=>{
                    console.error(error);
                    reject(error)
                })
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
        return searchArray.length > 0 ? searchArray : filterSearch.value ? searchArray : finalFilter.value;
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
    border: 1px solid #e8e8e8;
    border-radius: 12px;
    margin-bottom: 20px;
}
.left__arrow-img{
    right:-2px;
    min-width: 32px;
    height: 30px;
}
.right__arrow-img{
    left:-2px;
    min-width: 32px;
    height: 30px;
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
    background-color: #FCFCFC;
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
    padding: 0px 20px;
    border-left: 1px solid #b7b7b7;
    font-family: 'Roboto', sans-serif;
    font-weight:700;
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
    padding: 1px 4px 0.77px 8px;
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
.timesheet__wrapper .wf_filter {
    height: 30px;
    padding: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
}
.timesheet_user_filter {
    position: sticky;
    left: 0;
    padding: 0px 0px 0px 10px;
    min-width: 69px;
    margin-right: 10px;
}
.checklist-main input{
    margin-right: 5px;
}
    
/* .timesheet__wrapper .wf_filter::-webkit-scrollbar{
    display: none;
} */
.wf__filter-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 21px;
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
.wf_filter{
    overflow-x: auto !important;
    overflow-y: hidden !important;
}
.chipusername_main {
    padding-right: 25px;
}
span.chipusername_wrapper span.user_name {
    font-size: 13px;
    font-weight: 500;
    color: #505050;
    line-height: 19.24px;
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
.timesheet_user_filter button.dot-btn {
  min-width: 60px;
  height: 28px;
}
.tracker-timesheet-calender-wrapper{
    border:1px solid #DFE1E6;
    height: 30px;
    background-color: #FFFFFF;
    width: 143px;
    min-width: 143px;
}
.tracker-timesheet-calender {
    margin: 2px 10px 0;
}
.tracker-timesheet-calender .date_format_cal.calendar-comp::placeholder{font-size: 16px !important;color: #000 !important;}
.tracker-timesheet-calender .date_format_cal.calendar-comp{font-size: 16px !important;color: #000 !important;}

.timebarWrapper{
    margin-top: 16px;
}
.calendar-comp{display: none !important;}
.screenShotTime{
    max-height: calc(100vh - 274px);
    overflow: auto;
}

.screenShotTime::-webkit-scrollbar {
    width: 6px;
    height: 6px;
    background: #D9D9D9 !important;
    border-radius: 6px;
}
.screenShotTime.style-scroll::-webkit-scrollbar-thumb {
    background: #2f3990;
    border-radius: 6px;
}
.screenShotTime.style-scroll::-webkit-scrollbar-track{
    background-color: #D9D9D9 !important;
    border-radius: 6px;
}
.timesheetDropdown_wrapper {
    padding: 10px !important;
}
.timesheetDropdown_wrapper{
  border: 0 !important;
  margin-top: 9px;
  margin-left: -11px;
  filter: drop-shadow(0px 2px 12px rgba(0, 0, 0, 0.15)) !important;
}
.timesheet__wrapper .range-picker.rangeComp{
    min-width: 251px !important;
}
@media(max-width: 767px){
    .pro_route_link a, ul.breadcrumb.title_strip li span{
        font-size: 14px!important;
    }
    ul.breadcrumb.title_strip li {
    padding: 0px 10px;

}
.screenShotTime {
    max-height: calc(100vh - 335px);
    overflow: auto;
}
.timesheetDropdown_wrapper span.filter_search_block .form-control {padding: 15.5px 10px !important;}
.timesheetDropdown_wrapper .wf_header span{font-size: 18px;}
.timesheetDropdown_wrapper span.filter_search_block{padding: 20px 0 20px;}
.timesheetDropdown_wrapper span.filter_list_item{font-size: 16px !important; line-height: 21px;}
.timesheetDropdown_wrapper .wf_header{margin-bottom: 0;padding-top: 0;}
.timesheetDropdown_wrapper .wf_body.filter_body_scroll{margin: 0;}
.wf_body.checklist-main.filter_body_scroll.filter_body_scroll .wf_listItem{padding: 10px;}
.timesheet__wrapper .wf_filter{height: 50px;}
.timesheetDropdown_wrapper{margin-top: 0;margin-left: 0;}
 .wf_body.filter_body_scroll {height: 50px; padding: 10px !important;}
 .wf_body.filter_body_scroll .invalid-feedback{ font-size: 16px;}



   .wf_header span,  .wf_header a{font-size: 18px;}
   span.filter_list_item{font-size: 16px;}
   .wf_header {padding: 0 0 5px 0;border-bottom: 0;}
}

</style>
