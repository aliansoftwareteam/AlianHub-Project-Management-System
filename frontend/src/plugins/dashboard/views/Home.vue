<template>
    <div class="w-100 h-100 overflow-y-auto"
        v-if="checkPermission('project') !== null && checkPermission('project.project_list') !== null && checkPermission('task.task_list') !== null">
        <div class="bg-white px-1 d-flex white align-items-center justify-content-between p-15px border-gray">
            <div>
                <h3 class="m-0 font-size-18 font-weight-700 blue">{{ $t('Home.Home') }}</h3>
            </div>
            <div class="dashboard__calendar-wrapper">
                <button class="text-capitalize outline-primary mr-10-px d-flex align-items-center" @click="toggleDashboardLock()">
                    <img :src="companyUser.dashboardLocked ? unlockImage : lockImage" alt="lock" class="mr-5px" />{{ companyUser.dashboardLocked ? $t('Home.unlock') : $t('Home.lock') }}
                </button>
                <button class="text-capitalize outline-primary mr-10-px" @click="addItem">{{ $t(`dashboardCard.add_card`) }}</button>
                <div class="position-re dashboard__settings">
                    <button class="outline-primary dashboard__settings-btn" :title="$t('dashboardCard.dashboard_settings')" @click.stop="dashMenuOpen = !dashMenuOpen">
                        <img :src="settingIcon" alt="settings" />
                    </button>
                    <template v-if="dashMenuOpen">
                        <div class="dashboard__settings-overlay" @click="dashMenuOpen = false"></div>
                        <div class="dashboard__settings-menu">
                            <div class="dashboard__settings-item" @click="onExportDashboard">{{ $t('dashboardCard.export_dashboard') }}</div>
                            <div class="dashboard__settings-item" @click="onImportDashboard">{{ $t('dashboardCard.import_dashboard') }}</div>
                        </div>
                    </template>
                </div>
            </div>
        </div>
        <div class="d-flex main_component-wrapper" :class="[{'flex-column' : clientWidth <= 991}]">
            <div class="w-100 h-100 style-scroll overflow-auto"
                v-if="!isSpinner"
                :class="[{'bg-off-white': (clientWidth < 992 && isSpinner == false) || clientWidth >= 992}]">
                <HomePage ref="myRefsss" :allProjectsArray="allProjectsArrayFilter" :locked="companyUser.dashboardLocked" />
            </div>
            <div v-if="isSpinner" class="w-100 h-100 style-scroll overflow-auto p-10px">
                <DashboardSpinner :is-spinner="isSpinner"/>
            </div>
        </div>
        <TaskDetail v-if="isTaskDetail" :companyId="companyId" :projectId="projectId" :sprintId="sprintId"
            :taskId="taskId" :isTaskDetailSideBar="isTaskDetail" @toggleTaskDetail="toggleTaskDetail" :zIndex='7' />
    </div>
    <div v-else class="d-flex bg-off-white align-items-center justify-content-center w-100 h-100">
        <img :src="accessDeniedImage" alt="accessDenied">
    </div>
    <ConfirmModal :modelValue="showSidebar" :acceptButtonText="$t('Home.Confirm')"
        :cancelButtonText="$t('Projects.cancel')" :header="true" :showCloseIcon="false" @accept="updateTourStatusInUser"
        @close="closeModal">
        <template #header>
            <h3 class="m-0">{{ $t('Home.Confirm') }}</h3>
        </template>
        <template #body>
            <span>{{ $t('Home.tourclose') }}</span>
        </template>
    </ConfirmModal>
</template>
<script setup>
import { useStore } from 'vuex';
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import * as env from '@/config/env';
import HomePage from './HomePage.vue';
import { useRouter } from 'vue-router';
import { useCustomComposable } from '@/composable';
import { apiRequest, apiRequestWithoutCompnay } from '@/services';
import { useGetterFunctions } from "@/composable/index.js";
import TaskDetail from '@/views/TaskDetail/TaskDetail.vue';
import ConfirmModal from '@/components/atom/Modal/Modal.vue';
import { defineComponent ,ref,inject,computed,onMounted,provide, nextTick} from "vue";
import DashboardSpinner from '@/components/atom/Dashboard/DashboardSpinner.vue'
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';

const { getters,dispatch,commit } = useStore();
const { checkPermission } = useCustomComposable();
const {getTeamsData} = useGetterFunctions();

const companyUserDetail = computed(() => getters["settings/companyUserDetail"]);
const projectsGetter = computed(() => getters["projectData/onlyActiveProjects"]);

const accessDeniedImage = require("@/assets/images/access_denied_img.png");
const lockImage = require("@/assets/images/lock.png");
const unlockImage = require("@/assets/images/unlock.png");
const settingIcon = require("@/assets/images/svg/Setting_icon.svg");

const userId = inject("$userId");
const companyId = inject("$companyId");
const clientWidth = inject("$clientWidth");

const router = useRouter();
const $toast = useToast();
const {t} = useI18n();

const taskId = ref('');
const myRefsss = ref();
const sprintId = ref('');
const projectId = ref('');
const isDrag = ref(false);
const isSpinner = ref(false);
const showSidebar = ref(false);
const isTaskDetail = ref(false);
const hasCompletedTour = ref(false);
const taskDetail = ref({});

const allProjectsArrayFilter = ref(JSON.parse(JSON.stringify(projectsGetter.value)));

const {getUser} = useGetterFunctions();

const toggleTaskDetail = (task,close=false,isComment = false) => {
    isTaskDetail.value = false;
    if(close == true) {
        taskDetail.value = task;
        router.push({name: 'Home',query: {}, params: {cid: companyId.value}})
        return;
    }
    projectId.value = '';
    sprintId.value = '';
    taskId.value = '';
    nextTick(()=>{
        if(isComment) {
            router.push({name: 'Home',query: {detailTab: "comment"}, params: {cid: companyId.value}})
        }else{
            router.push({name: 'Home',query: {detailTab: "task-detail-tab"}, params: {cid: companyId.value}});
        }
        openInNewTab(task);
    })
}
const openInNewTab = (task) => {
    projectId.value = task.ProjectID
    sprintId.value = task.sprintId
    taskId.value = task._id
    isTaskDetail.value = true;
};

const companyUser = computed(() => getUser(userId.value));

onMounted(() => {
    // Company check
    if(companyId.value == '' && companyUser.value.assigneeCompany.length === 0){
        router.replace({name: "Create_Company"});
    } else {
        getData();
    }
});


const driverObj = driver({
  popoverClass: 'driverjs-theme',
  showProgress: true,
  overlayColor: 'black',
  showButtons: ['next', 'previous','close'],
  disableActiveInteraction : true,
  smoothScroll: true,
  steps: [
    { element: '#addqueue', popover: { title: 'Create Queue', description: 'Here you can add queue task', side: "left", align: 'start' }},
    { element: '#queuelist', popover: { title: 'Queue Tasks', description: 'Here you can see queue list', side: "left", align: 'start' }},
    { element: '#TodaySection', popover: { title: 'Today Task', description: 'Here you can see today tasks', side: "left", align: 'start' }},
    { element: '#OverdueSection', popover: { title: 'Overdue Task', description: 'Here you can see overdue tasks', side: "left", align: 'start' }},
    { element: '#NextSection', popover: { title: 'Next Task', description: 'Here you can see next tasks', side: "left", align: 'start' }},
    { element: '#UnscheduledSection', popover: { title: 'Unscheduled Task', description: 'Here you can see unscheduled tasks', side: "left", align: 'start' }},
    { element: '#calenderSection', popover: { title: 'Calender', description: 'Here you can see Calender', side: "left", align: 'start' }},
    { element: '#calenderDatesSection', popover: { title: 'Calender Date Change', description: 'Here you can changes date of calender', side: "left", align: 'start' }},
    { popover: { title: 'Discover Alien Hub: A Journey into the Unknown.', description: "Let's embark on an exciting journey! Explore the boundless possibilities waiting to be discovered." } }
  ],
  onCloseClick: () => closeButtonClick(),
  onDestroyStarted: () => {
    if (!driverObj.hasNextStep()) {
        updateTourStatusInUser();
        driverObj.destroy();
    }
  },
});
const closeButtonClick = () => {
    hasCompletedTour.value = true;
    showSidebar.value = true
    driverObj.destroy();
}
const closeModal = () => {
    showSidebar.value = false
}

function toggleDashboardLock() {
    if(!companyUser.value.cuid) {
        console.error("CUID not found in user data.");
        return;
    }

    const locked = companyUser.value.dashboardLocked ? false : true;
    const params = {
        id: companyUser.value.cuid,
        data: {
            dashboardLocked: locked,
        }
    }

    apiRequest("put", `${env.API_MEMBERS}`, params)
    .then((response) => response.data)
    .then((response) => {
        if(response.status) {
            // TOAST THE SUCCESS MESSAGE
            $toast.success(locked ? t("Home.dashboardLockSuccess") : t("Home.dashboardUnlockSuccess"), {
                position: "top-right"
            });

            commit("settings/mutateCompanyUsers", {
                op: "modified",
                data: {_id: companyUser.value.cuid, dashboardLocked: locked}
            })
        } else {
            $toast.error(t("Toast.something_went_wrong"), {
                position: "top-right"
            })
        }
    })
    .catch((err)=>{
        $toast.error(t("Toast.something_went_wrong"), {
            position: "top-right"
        })
        console.error("ERROR: ", err);
    });
}
const updateTourStatusInUser = () => {
    try {
        let tourObject = {
            ...(companyUser.value.tourStatus && companyUser.value.tourStatus),
            isDashboardTourComplete: true
        }
        const updateObject = {
            $set: { tour: tourObject } 
        }
        showSidebar.value = false;
        apiRequestWithoutCompnay("put",env.USER_UPATE,{
            userId: userId.value,
            updateObject: updateObject,
        }).then(()=>{
        }).catch((err)=>{
            console.error("ERROR: ", err);
        });
    } catch (error) {
        console.error(error.message);
    }
}
defineComponent({
    name: "HomeView"
})

const getData = () => {
    isSpinner.value = true;
    if(!projectsGetter.value || !Object.keys(projectsGetter.value).length) {
        getTeamsData().then((response) => {
            const uid = userId.value;
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
                    allProjectsArrayFilter.value = projectsGetter.value.data ? [...projectsGetter.value.data] : [];
                    if(allProjectsArrayFilter.value && allProjectsArrayFilter.value.length){
                        allProjectsArrayFilter.value = [1,2].includes(roleType) === false ? allProjectsArrayFilter.value.filter((x) => x._id !== '6571e7195470e64b1203295c' && !x.isRestrict) : allProjectsArrayFilter.value.filter((x) => !x.isRestrict)
                    }
                    isSpinner.value = false;
                })
                .catch((error) => {
                    isSpinner.value = false;
                    console.error("ERROR in setProjects: ", error);
                })
            } else {
                isSpinner.value = false;
            }
        }).catch((error) => {
            console.error(error,"ERROR IN GET TEAMS DATA");
        });
    }else{
        const roleType = companyUserDetail.value.roleType;
        allProjectsArrayFilter.value = [...projectsGetter.value.data.filter((x) => !x.isRestrict)];
        if(allProjectsArrayFilter.value && allProjectsArrayFilter.value.length){
            allProjectsArrayFilter.value = [1,2].includes(roleType) === false ? allProjectsArrayFilter.value.filter((x) => x._id !== '6571e7195470e64b1203295c') : allProjectsArrayFilter.value
        }
        isSpinner.value = false;
    }
};

const addItem = () => {
    myRefsss.value.handleToggle();
};

const dashMenuOpen = ref(false);
const onExportDashboard = () => {
    dashMenuOpen.value = false;
    myRefsss.value.exportDashboard();
};
const onImportDashboard = () => {
    dashMenuOpen.value = false;
    myRefsss.value.triggerImport();
};

const dragFunction = (value) => {
    isDrag.value = value;
}
provide('dragFunction', dragFunction);


provide('toggleTaskDetail', toggleTaskDetail);
provide('taskDetail',taskDetail)
provide('showArchived', ref(false));
provide('isRouteRequired', false);
provide('isSupport', ref(false));
provide('showLoader', ref(false));
provide('progress', ref(0));
</script>
<style scoped src="../css/style.css">
</style>
<style scoped>
.dashboard__settings { display: inline-block; }
.dashboard__settings-btn { display: inline-flex; align-items: center; justify-content: center; padding: 6px 8px; }
.dashboard__settings-btn img { height: 16px; width: 16px; }
.dashboard__settings-overlay { position: fixed; inset: 0; z-index: 20; }
.dashboard__settings-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 21;
    min-width: 180px;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
    padding: 4px;
    overflow: hidden;
}
.dashboard__settings-item {
    padding: 8px 12px;
    font-size: 13px;
    color: #3a3f52;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
}
.dashboard__settings-item:hover { background: #f5f7fb; color: #2F3990; }
</style>