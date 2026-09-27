import { inject,computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import { openTask, isSameProjectPage } from "@/components/organisms/TaskDetailOverlay/useTaskOverlay";
import { i18n } from "@/locales/main";
const t = i18n.global.t;
export function useHelper() {
    const companyId = inject("$companyId");
    const router = useRouter();
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
            if (route.params.taskId && isSameProjectPage(route.params.id, route.params.sprintId)) {
                openTask({
                    companyId: route.params.cid,
                    projectId: route.params.id,
                    sprintId: route.params.sprintId,
                    folderId: route.params.folderId || "",
                    taskId: route.params.taskId,
                    tab: route.query?.detailTab === "comment" ? "activity" : ""
                });
                return;
            }
            router.push(route);
        } catch (error) {
            console.error(error,"ERROR IN ROUTE");
        }
    }

    return {
        openRoute
    }
}
