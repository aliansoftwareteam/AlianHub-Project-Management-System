import moment from "moment";
import { inject,computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCustomComposable } from "@/composable";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
const {checkPermission} = useCustomComposable();
import { i18n } from "@/locales/main";
const t = i18n.global.t;
export function useHelper() {
    const companyId = inject("$companyId");
    const router = useRouter();
    const menu = [
        {
            name: "Projects",
            to: {path: `/${companyId.value}/project`},
            show:true,
            showerr: () => {
                return true;
                // return this.rules && this.checkPermission(this.rules.project, this.companyUserDetail.roleType) !== null && this.checkPermission(this.rules.project.project_list, this.companyUserDetail.roleType) !== null;
            },
            submenu: [],
            isActive: true
        },
        {
            // Workspace — oversight + planning + apps grouped under one menu.
            name: "Workspace",
            show: true,
            submenu: [
                {
                    name: "Portfolio",
                    to: {path: `/${companyId.value}/portfolio`},
                    show: true
                },
                {
                    name: "Capacity_Planning",
                    to: {path: `/${companyId.value}/reports/capacity`},
                    show: true
                },
                {
                    name: "Integrations",
                    to: {path: `/${companyId.value}/integrations`},
                    // Hidden from the Workspace menu for now — route + page are kept; flip to true to restore.
                    show: false
                }
            ]
        },
        {
            name: "Time_Sheet",
            id: "time_sheet_driver",
            show:checkPermission('sheet_settings.workload_timesheet') !== null || checkPermission('sheet_settings.project_timesheet') !== null || checkPermission('sheet_settings.user_timesheet') !== null,
            shower: () => {
                return true;
                // return this.rules && this.checkPermission(this.rules.sheet_settings, this.companyUserDetail.roleType) !== null && (this.checkPermission(this.rules.sheet_settings.user_timesheet, this.companyUserDetail.roleType) !== null || this.checkPermission(this.rules.sheet_settings.project_timesheet, this.companyUserDetail.roleType) !== null || this.checkPermission(this.rules.sheet_settings.workload_timesheet, this.companyUserDetail.roleType) !== null);
            },
            submenu: [
                {
                    name: "User_Timesheet",
                    id: "user_time_sheet_driver",
                    to: {path: `/${companyId.value}/timesheet/user`},
                    show: checkPermission('sheet_settings.user_timesheet') !== null,
                    showerr: () => {
                        return true;
                        // return this.rules && this.checkPermission(this.rules.sheet_settings.user_timesheet, this.companyUserDetail.roleType) !== null;
                    }
                },
                {
                    name: "project_Timesheet",
                    id: "project_time_sheet_driver",
                    to: {path: `/${companyId.value}/timesheet/project`},
                    show: checkPermission('sheet_settings.project_timesheet') !== null,
                    shower: () => {
                        return true;
                        // return this.rules && this.checkPermission(this.rules.sheet_settings.project_timesheet, this.companyUserDetail.roleType) !== null;
                    }
                },
                {
                    name: "Workload_Timesheet",
                    id: "workload_time_sheet_driver",
                    to: {path: `/${companyId.value}/timesheet/workload`},
                    show: checkPermission('sheet_settings.workload_timesheet') !== null,
                    shower: () => {
                        return true;
                        // return this.rules && this.checkPermission(this.rules.sheet_settings.workload_timesheet, this.companyUserDetail.roleType) !== null;
                    }
                },
                {
                    name: "Tracker_Timesheet",
                    id: "tracker_time_sheet_driver",
                    to: {path: `/${companyId.value}/timesheet/tracker`},
                    show: checkPermission('sheet_settings.tracker_timesheet') !== null,
                    shower: () => {
                        return true;
                        // return this.rules && this.checkPermission(this.rules.sheet_settings.workload_timesheet, this.companyUserDetail.roleType) !== null;
                    }
                }
            ]
        },
        {
            // Reports — Milestone (permission-gated) + the always-on Custom & Variance reports.
            name: "Reports",
            show: true,
            submenu: [
                {
                    name: "Milestone_Report",
                    to: {path: `/${companyId.value}/report/milestone`},
                    show:checkPermission('sheet_settings.milestone_report') !== null
                },
                {
                    name: "Custom_Report",
                    to: {path: `/${companyId.value}/custom-reports`},
                    show: true
                },
                {
                    name: "Variance_Report",
                    to: {path: `/${companyId.value}/reports/variance`},
                    show: true
                }
            ]
        }
    ]
    const prevRoute = useRoute();

    function openRoute(data, key,options = {gettersVal: null}) {
        try {
            const {gettersVal} = options;
            const $toast = useToast();
            let tmpGetter = {};
            if(gettersVal) {
                tmpGetter = gettersVal
            } else {
                const { getters } = useStore();
                tmpGetter = getters
            }
            let route = {
                name: "",
                params: {
                    cid: companyId.value,
                    id: data.projectId ? data.projectId : data.ProjectId
                },
                query: {tab: "Comments"}
            }
            const projects = computed(() => tmpGetter["projectData/projects"])
            if(key === "notifications") {
                route.query = {tab: "ProjectListView"};
                if(data.type.toLowerCase() !== "project") {
                    if(projects.value?.data?.length > 0){
                        let find = projects.value?.data.find((project) => project._id === data.projectId);
                        if(!find){
                            $toast.info(t('Toast.The_project_not_found'),{position:'top-right'});
                            return prevRoute;
                        }
                        if(find?.deletedStatusKey === 2){
                            $toast.info(t('Toast.The_project_is_archived'),{position:'top-right'});
                            return prevRoute;
                        }
                    }
                    if(data.folderId) {
                        route.name = "ProjectFolderSprintTask";
                        route.params = {
                            ...route.params,
                            folderId: data.folderId,
                            sprintId: data.sprintId,
                            taskId: data.taskId
                        }
                        if(data.Key === "logged_hours_notification") {
                            route.query= {detailTab: 'TimeLog'};
                        } else {
                            route.query= {detailTab: 'task-detail-tab'};
                        }
                    } else {
                        route.name = "ProjectSprintTask";
                        route.params = {
                            ...route.params,
                            sprintId: data.sprintId,
                            taskId: data.taskId
                        }
                        if(data.Key === "logged_hours_notification") {
                            route.query= {detailTab: 'TimeLog'};
                        } else {
                            route.query= {detailTab: 'task-detail-tab'};
                        }
                    }
                } else {
                    if(data.Key === "project_folder_create") {
                        route.name = "ProjectFolder";
                        route.params = {
                            ...route.params,
                            folderId: data.folderId
                        }
                    } else if(data.folderId !== "" && data.folderId !== undefined && data.sprintId !== "" && data.sprintId !== undefined) {
                        route.name = "ProjectFolderSprint";
                        route.params = {
                            ...route.params,
                            folderId: data.folderId,
                            sprintId: data.sprintId
                        }
                    } else if(data.Key === "project_sprint_create") {
                        route.name = "ProjectSprint";
                        route.params = {
                            ...route.params,
                            sprintId: data.sprintId
                        }
                    } else {
                        route.name = "Project";
                        route.params = {
                            cid: data.companyId,
                            id: data.projectId
                        }
                        route.query = {tab: "ProjectDetail"}
                    }
                }
            } else {
                if (data.comment_id) {
                    route.hash = `#${data.comment_id}`;
                }
                if(data.mainChat) {
                    route.name="chat_project_channel";
                    route.params = {
                        cid: companyId.value,
                        pid: data.projectId,
                        sid: data.sprintId
                    }
                    route.query = {};
                } else {
                    route.query = {tab: "Comments"};
    
                    if(data.taskId !== "") {
                        route.query= {detailTab: "comment"}
                        if(data.folderId) {
                            route.name = "ProjectFolderSprintTask";
                            route.params = {
                                ...route.params,
                                folderId: data.folderId,
                                sprintId:data.sprintId,
                                taskId: data.taskId
                            }
                        } else {
                            route.name = "ProjectSprintTask";
                            route.params = {
                                ...route.params,
                                sprintId:data.sprintId,
                                taskId: data.taskId
                            }
                        }
                    } else {
                        route.name = "Project";
                    }
                }
            }
            router.push(route);
        } catch (error) {
            console.error(error,"ERROR IN ROUTE");
        }
    }

    function getDateType(seconds) {
        if(seconds >= new Date().getTime()) {
            return moment(new Date(seconds)).format("LT");
        } 
        else {
            return moment(new Date(seconds)).format("ddd, D MMM, YYYY [at] hh:mm a");
        }
    }

    return {
        menu,
        openRoute,
        getDateType
    }
}
