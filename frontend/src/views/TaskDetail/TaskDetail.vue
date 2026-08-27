<template>
    <div>
        <div v-if="openBlocked" class="td-missing">
            <div class="td-missing__card">
                <p class="td-missing__line">{{ $t('Projects.task_not_in_project') }}</p>
                <button type="button" class="td-missing__back" @click="backToSearch">{{ $t('Projects.task_back_to_search') }}</button>
            </div>
        </div>
        <Sidebar
            v-else-if="showTaskChrome"
            width="1545px"
            :defaultLayout="false"
            :visible="isTaskDetailSideBar"
            @update:visible="() => $emit('toggleTaskDetail' , task, true)"
            className="task-detail-sidebar"
            headClass="task-detail-head"
            :zIndex="props.zIndex"
            :top="props.top"
        >
            <template #head-left>
                <div class="d-flex">
                    <div class="d-flex align-items-center">                        
                        <img :src="sidebarArrowIcon" v-if="task.isParentTask === false" alt="sidebarArrowIcon" class="cursor-pointer mr-10px" style="width: 25px; height: 25px;" @click.stop="open('parent')"/>
                    </div>
                    <div class="task-details-title-wrapper">
                        <Skelaton v-if="isSpinner && !taskLoaded" style="height: 35px;width:55%;" class="border-radius-5-px"/>
                        <TaskDetailNavBar
                            v-if="(taskLoaded || !isSpinner) && clientWidth > 764 && !isSupport"
                            :taskKey="task.TaskKey"
                            :isParent="task.isParentTask"
                            :sprintName="task.sprintName ? task.sprintName : ''"
                            :isFolderSprint="task.sprintArray && task.folderObjId ? true : false"
                            :folderName="task.folderName ? task.folderName : ''"
                            :parentKey="parentTask ? parentTask.TaskKey : ''"
                            :projectName="projectData ? projectData.ProjectName : ''"
                            @open="(val) => open(val)"
                        />
                        <TaskDetailTitle
                            v-if="taskLoaded || !isSpinner"
                            :taskName="task.TaskName"
                            :isSupport="isSupport"
                            :taskType="task.TaskTypeKey"
                            :favourites="task.favouriteTasks"
                            :userId="user.id"
                            @update:favourite="(val) => updateFavourite()"
                            @update:taskName="(val) => updateTaskName(val)"
                            @update:taskType="(val) => changeTaskType(val)"
                        />
                    </div>
                </div>
            </template>
            <template #head-right>
                <TaskDetailAction
                    v-if="task !== undefined && isSupport === false"
                    :watchers="task.watchers"
                    @open="(val) => open(val)"
                    @update:watchers="(userId, type) => updateWatchers(userId, type)"
                    @close="$emit('toggleTaskDetail' , task, true)"
                    :task="task"
                    :isSpinner="isSpinner"
                />
                <div class="task-detail-action" v-if="isSupport === true">
                    <ul class="task-detail-action-ul">
                        <li class="close-icon" @click="$emit('toggleTaskDetail' , task, true)">
                            <img src="@/assets/images/svg/delete.svg" />
                        </li>
                    </ul>
                </div>
            </template>
            <template #body>
                <!-- <SpinnerComp :is-spinner="(task && Object.keys(task).length) ? Object.keys(task).length > 2  ? false : true : isSpinner" v-if="isSpinner"/> -->
                <TaskDetailBody
                    v-if="task !== undefined"
                    :task="task"
                    :parentTask="parentTask"
                    :clientWidth="clientWidth"
                    @open="(val) => open(val)"
                    :taskStatusIndex="10"
                    :zIndexAssigne="10"
                    :zIndexPriority="10"
                    :zIndexEstimate="10"
                    :isSupport="isSupport"
                    :subTasksArray="subTasks"
                    :isSpinner="isSpinner"
                />
            </template>
        </Sidebar>

        <Sidebar
            className="task-sub-sidebar"
            v-model:visible="isSidebar"
            :title="sidebarTitle"
            width="375px"
            :zIndex="10"
        >
            <template #body>
                <FileAndLinks
                    v-if="sidebarTitle === $t('Projects.Files_&_Links')"
                    :attachments="task.attachments"
                    :description="task.description"
                    :handleType="'task'"
                    @closeSidebar="(val) => isSidebar = val"
                    :selectedData="task"
                />
                <TaskAudioFiles
                    v-else-if="sidebarTitle === $t('Projects.audio_files')"
                    :fromWhich="'task'"
                    :key="`${task?._id}${Date.now() * Math.random() * 10000}` + 'task'"
                    :selectedData="task"
                />
            </template>
        </Sidebar>
    </div>
</template>

<script setup>
    import { computed, defineProps, inject, nextTick, onBeforeUnmount, onMounted, onUnmounted, provide, ref, watch } from 'vue'
    import { useGetterFunctions } from '@/composable';
    import { useRouter,useRoute } from 'vue-router';
    import taskClass from "@/utils/TaskOperations";
    import { apiRequest } from '../../services';
    import * as env from '@/config/env';
    import { resolveOpenProjectId, shouldShowTaskChrome, bindSprintsToProject, asDocList, taskOpenRoute, firstId } from '@/utils/taskOpenProjectId';
    import { openGlobalSearch } from '@/utils/openGlobalSearch';
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue'
    import TaskDetailNavBar from '@/components/molecules/TaskDetailNavBar/TaskDetailNavBar.vue'
    import TaskDetailTitle from '@/components/molecules/TaskDetailTitle/TaskDetailTitle.vue'
    import TaskDetailAction from '@/components/molecules/TaskDetailAction/TaskDetailAction.vue'
    import TaskDetailBody from '@/components/organisms/TaskDetailBody/TaskDetailBody.vue'
    import FileAndLinks from '@/components/molecules/FileAndLinks/FileAndLinks.vue'
    import TaskAudioFiles from '@/components/molecules/TaskAudioFiles/TaskAudioFiles.vue';    
    import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';
    const sidebarArrowIcon = require("@/assets/images/svg/sidebarclose_arrow.svg");

    import { useStore } from 'vuex';
    import { useToast } from 'vue-toast-notification';

    import { useI18n } from "vue-i18n";
    import { useUpdateTasks } from '../Projects/helper';
    const { t } = useI18n();
    const {updateTaskByGroup} = useUpdateTasks();
    const socket= inject("$socket");
    let debounceTimeout;

    const emit = defineEmits(["toggleTaskDetail","handleSpinner"]);
    const props = defineProps({
        companyId:{ type: String, default: '' },
        projectId:{ type: String, default: '' },
        sprintId:{ type: String, default: '' },
        taskId:{ type: String, default: '' },
        isTaskDetailSideBar:{type:  Boolean  ,default: false },
        zIndex:{ type: Number, default:  7},
        top:{ type: String },
        isSupport:{
            type:Boolean,
            default:false
        },
        selectedTask:{
            type:Object,
            default:() => {}
        }
    });

    const router = useRouter();
    const route = useRoute();
    const { getters,dispatch,commit } = useStore();
    const { getUser } = useGetterFunctions();

    // const toggleTaskDetail = inject('toggleTaskDetail')
    const $toast = useToast();
    let isTaskDetailSideBar = ref(props.isTaskDetailSideBar);

    const parentTask = ref(null);
    const isSidebar = ref(false);
    const sidebarTitle = ref('');
    const subTasks = ref([])
    const subTaskLimit = ref(35);

    // PROJECT DATA
    const snap = ref(null);
    const projectDataObj = inject("selectedProject");
    const projectData = ref(projectDataObj?.value ? projectDataObj?.value : {});

    const resolvedProjectId = computed(() => resolveOpenProjectId({
        queryProjectId: props.projectId,
        selectedTask: props.selectedTask,
        routeProjectId: route.params && route.params.id,
    }));
    const openBlocked = ref(false);

    const clientWidth = ref(document.documentElement.clientWidth);
    window.addEventListener('resize', (e) => {
        clientWidth.value = e.target.innerWidth;
    });

    const companyOwner = computed(() => {
        return getters["settings/companyOwnerDetail"];
    });

    const taskDetailGetter = computed(()=>{
        return getters["projectData/gettaskDetailData"];
    })

    // Subtask completion (AHE-3776): how many of this parent's subtasks are done
    // (statusType 'close'), used by the progress badge in the task header and the
    // subtask section. The detail view loads at most `subTaskLimit` (35) subtasks,
    // so a parent with more than that (e.g. 50) would otherwise report only the
    // loaded slice ("0/35") and a misleading %. We therefore use:
    //   • the live loaded list when it covers the whole set (the common case), or
    //   • an accurate done/total count fetched via the /task/find aggregate when
    //     there are more subtasks than were loaded (paginated parents).
    // Only non-deleted subtasks count; a task with no subtasks yields total 0 and
    // the badge hides itself. Stays live: getQueryFun() reloads the subtasks and
    // refetches the count on every subtask socket update.
    const fetchedSubtaskCount = ref(null);

    const subtaskCompletion = computed(() => {
        const list = Array.isArray(subTasks.value) ? subTasks.value : [];
        const valid = list.filter((s) => s && (s.deletedStatusKey === 0 || s.deletedStatusKey === undefined));
        const loadedTotal = valid.length;
        const loadedCompleted = valid.filter((s) => (s?.status?.type || s?.statusType) === 'close').length;

        // The parent's stored subtask count is the true total; the loaded slice
        // may be smaller when paginated. Trust whichever total is largest.
        const fetched = fetchedSubtaskCount.value;
        const trueTotal = Math.max(loadedTotal, Number(task.value?.subTasks) || 0, (fetched && fetched.total) || 0);
        if (loadedTotal >= trueTotal) {
            return { total: loadedTotal, completed: loadedCompleted };
        }
        if (fetched && fetched.total) {
            return fetched;
        }
        // Accurate count still loading — keep the correct denominator meanwhile.
        return { total: trueTotal, completed: loadedCompleted };
    });

    // Accurate done/total count across ALL of this parent's subtasks (not just the
    // loaded slice), via the existing /task/find aggregate — mirrors the list-row
    // badge in Task.vue (fetchSubtaskProgress). Only runs when the loaded slice may
    // be incomplete; best-effort, any failure leaves the live loaded value in place.
    function fetchSubtaskCount() {
        const parentId = task.value?._id;
        if (!parentId) { fetchedSubtaskCount.value = null; return; }
        const totalCount = Number(task.value?.subTasks) || 0;
        const loaded = Array.isArray(subTasks.value) ? subTasks.value.length : 0;
        const mayBeIncomplete = totalCount > subTaskLimit.value || (totalCount === 0 && loaded >= subTaskLimit.value);
        if (!mayBeIncomplete) { fetchedSubtaskCount.value = null; return; }
        const findQuery = [
            { $match: { ParentTaskId: String(parentId), deletedStatusKey: { $in: [0, undefined] } } },
            { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$statusType', 'close'] }, 1, 0] } } } },
        ];
        apiRequest('post', `${env.TASK}/find`, { findQuery })
            .then((response) => {
                const row = response?.data && response.data[0];
                if (row) fetchedSubtaskCount.value = { total: Number(row.total) || 0, completed: Number(row.completed) || 0 };
            })
            .catch((error) => {
                console.error('ERROR in fetchSubtaskCount: ', error);
            });
    }

    const currentUserId = inject("$userId");
    const user = getUser(currentUserId.value);
    const isSpinner = ref(true);
    let hydrateGen = 0;
    let hydrateTimer = null;

    const task = ref(props?.selectedTask ? props.selectedTask : {});
    const taskLoaded = computed(() => Boolean(
        task.value && task.value.TaskName && projectData.value && projectData.value.ProjectName
    ));
    const showTaskChrome = computed(() => shouldShowTaskChrome({
        projectId: resolvedProjectId.value,
        loaded: taskLoaded.value,
        blocked: openBlocked.value,
    }));

    const updateTaskName = (val) => {
        if(!val?.trim()?.length) return;
        const userData = {
            id: user.id,
            name: user.Employee_Name,
            companyOwnerId: companyOwner.value.userId,
        }

        const firebaseObj = {
            'TaskName': val
        }
        let obj = {
            'previousTaskName': task.value.TaskName,
            'userName' : userData.name
        }
        const project = {
            _id: projectData.value._id,
            CompanyId: projectData.value.CompanyId,
            lastTaskId: projectData.value.lastTaskId,
            ProjectName: projectData.value.ProjectName,
            ProjectCode: projectData.value.ProjectCode
        }

        taskClass.updateTaskName({firebaseObj, projectData: project, taskData: task.value, obj, userData})
        .then(() => {
            $toast.success(t(`Toast.Task_name_updated_successfully`), {position: "top-right"})
        })
        .catch((err) => {
            console.error(err);
        })
    }

    const updateFavourite = () => {
        taskClass.markAsFavourite({
            companyId: projectData.value.CompanyId,
            projectId: projectData.value._id,
            sprintId: props.sprintId,
            taskData: task.value,
            userId: user.id,
        })
        .then((res) => {
            if(res.status === 200){
                $toast.success(res.statusText, {position: "top-right"});
            }else{
                $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
            }
        })
        .catch((error) => {
            console.error("ERROR in markAsFavourite: ", error);
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        })
    }

    const updateWatchers  =  (userId, type) => {
        const operationtype = (type === "add") ? true : false
        const userData = {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: companyOwner.value.userId,
        }
        taskClass.updateWatcher({
            companyId: projectData.value.CompanyId,
            projectId: projectData.value._id,
            sprintId: props.sprintId,
            taskId: props.taskId,
            userId: userId,
            watchers: task.value?.watchers,
            add: operationtype,
            userData: userData,
            employeeName : getUser(userId)?.Employee_Name
        }).then(() => {
            $toast.success(t(`Toast.${type === "add" ? 'Watcher_added_successfully' : 'Watcher_removed_successfully'}`), {position: "top-right"});
        }).catch((error) => {
            console.error("ERROR in updateWatcher: ", error);
        });
    }

    const open = (val) => {
        const query = route.query;
        switch (val) {
            case 'project':
                emit("toggleTaskDetail",task.value,true);
                delete query.detailTab;
                router.push({
                    name: 'Project',
                    params: {
                        cid: props.companyId,
                        id: props.projectId
                    },
                    query
                })
                break;
            case 'sprint':
                emit("toggleTaskDetail",task.value,true);
                delete query.detailTab;
                if(task.value.folderObjId) {
                    router.push({
                        name: 'ProjectFolderSprint',
                        params: {
                            cid: props.companyId,
                            id: props.projectId,
                            sprintId: props.sprintId,
                            folderId: task.value.folderObjId
                        },
                        query
                    });
                } else {
                    router.push({
                        name: 'ProjectSprint',
                        params: {
                            cid: props.companyId,
                            id: props.projectId,
                            sprintId: props.sprintId
                        },
                        query
                    })
                }
                break;
            case 'parent':
                if(parentTask.value) {
                   emit("toggleTaskDetail",parentTask.value);
                    if(parentTask.value.folderObjId) {
                        nextTick(() =>{router.push({
                            name: 'ProjectFolderSprintTask',
                            params: {
                                cid: props.companyId,
                                id: props.projectId,
                                sprintId: props.sprintId,
                                folderId: parentTask.value.folderObjId,
                                taskId: task.value.ParentTaskId
                            },
                            query: {detailTab: "task-detail-tab"}
                        })})
                    } else {
                        nextTick(() =>{router.push({
                            name: 'ProjectSprintTask',
                            params: {
                                cid: props.companyId,
                                id: props.projectId,
                                sprintId: props.sprintId,
                                taskId: task.value.ParentTaskId
                            },
                            query: {detailTab: "task-detail-tab"}
                        })})
                    }
                }

                break;
            case 'folder':
                if(task.value.folderObjId) {
                    delete query.detailTab;
                    emit("toggleTaskDetail",task.value,true);
                    router.push({
                        name: 'ProjectFolder',
                        params: {
                            cid: props.companyId,
                            id: props.projectId,
                            folderId: task.value.folderObjId
                        },
                        query
                    });
                }
                break;
            case 'filesLinks':
                isSidebar.value = true;
                sidebarTitle.value = t('Projects.files_links');
                break;
            case 'audio':
                isSidebar.value = true;
                sidebarTitle.value = t('Projects.audio_files');
                break;
            default:
                break;
        }
    }

    watch(task, (oldVal) => {
        if(oldVal && task.value && task.value.isParentTask == false && task.value.ParentTaskId){            
            getParentTask()
        }
    })


    watch(taskDetailGetter, (newVal) => {
        if (!newVal) return;
        const { fullDocument, updatedFields, isSubTaskUpdate } = newVal;

        // Handle fullDocument updates
        if (fullDocument && Object.keys(fullDocument).length) {
            if (!isSubTaskUpdate) {
                task.value = { ...task.value, ...fullDocument };
            }
            getQueryFun();
        }

        // Handle deleted status updates
        const isDeletedParent = updatedFields?.deletedStatusKey === 1 && fullDocument?.isParentTask;
        const isTaskLoaded = task.value && Object.keys(task.value).length > 0;
        const isChildTask = isTaskLoaded && task.value.isParentTask === false && task.value.ParentTaskId;
        if (updatedFields?.deletedStatusKey === 1 || updatedFields?.deletedStatusKey === 2) {
            if (isChildTask || isDeletedParent) {
                const params = { ...route.params };
                delete params.taskId;
                router.replace({ name: route.name.replace("Task", ""), params });
            }
        }

        const isDeleted = updatedFields?.deletedStatusKey === 1 || updatedFields?.deletedStatusKey === 2;
        const isDifferentTask = route.params.taskId !== fullDocument?._id;
        if (isDeleted && (isDifferentTask || isDeletedParent)) {
            const messageKey = updatedFields.deletedStatusKey === 1
                ? 'Toast.Task_deleted_successfully'
                : 'Toast.Task_archived_successfully';

            $toast.info(t(messageKey), { position: "top-right" });
        }

        // Handle remaining hours update safely
        if (updatedFields && Object.keys(updatedFields).includes("remainingHours")) {
            task.value = { ...task.value, remainingHours: updatedFields.remainingHours };
        }
    });


    const getSprintFolderData = async (id,sprintsResult,foldersResult) => {
        try {
            const bound = bindSprintsToProject(asDocList(sprintsResult), asDocList(foldersResult), id);
            return { sprints: bound.sprintsObj, folders: bound.sprintsfolders };
        } catch (error) {
            console.error("ERROR", error);
            return { sprints: {}, folders: {} };
        }
    }

    const visibilityHandler = async () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(async () => {
            if (!document.hidden) {
                getQueryFun();
            }
        }, 1000);
    };

    const socketConnectionPromise = new Promise((resolve) => {
        setTimeout(()=> {
            let attempts = 0;
            const maxAttempts = 3;
            const checkSocketConnection = setInterval(() => {
                if (socket.value && socket.value.id) {
                    clearInterval(checkSocketConnection);
                    resolve();
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkSocketConnection);
                    resolve();
                }
                attempts++;
            }, 1000);
        })
    });

    onMounted(async () => {
        getQueryFun();
        try {
            document.addEventListener('visibilitychange', visibilityHandler);            
            if(task.value && Object.keys(task.value).length > 0){
                getParentTask();
            }
            await socketConnectionPromise;
            dispatch("projectData/getTaskDetailSnapShot",{taskId: props.taskId}).catch((error)=>{
                console.error(error);
            })
        } catch (error) {
            console.error("ERROR in get project: ", error)
        }
    })

    onBeforeUnmount(()=>{
        hydrateGen += 1;
        if (hydrateTimer) {
            clearTimeout(hydrateTimer);
            hydrateTimer = null;
        }
        commit('projectData/setTaskDetailData',{});
        commit('projectData/setTaskdetailPayloadId',{});
        const events = ['taskDetail_taskUpdate', 'taskDetail_taskDelete'];
        events.forEach(event => {
            socket.value.off(event);
        });
        socket.value.emit('leaveTaskDetail',`taskDetail_${props.taskId}**${socket.value.id}`);
        clearTimeout(debounceTimeout);
        document.removeEventListener('visibilitychange', visibilityHandler);
    })
    provide("selectedProject", projectData);
    // Shared so both the header badge (TaskDetailAction) and the subtask section
    // header (SubTasks) read one identical value and never disagree.
    provide("subtaskCompletion", subtaskCompletion);

    function keepTaskOpenHash() {
        const dest = taskOpenRoute({
            companyId: firstId(props.companyId, route.params && route.params.cid),
            projectId: firstId(
                resolvedProjectId.value,
                task.value && (task.value.ProjectID || task.value.projectId),
                projectData.value && projectData.value._id,
                route.params && route.params.id,
            ),
            sprintId: firstId(task.value && task.value.sprintId, props.sprintId, route.params && route.params.sprintId),
            taskId: firstId(task.value && (task.value._id || task.value.id), props.taskId),
            folderId: firstId(task.value && task.value.folderObjId, route.params && route.params.folderId),
        });
        if (!dest) return;
        const sameName = route.name === dest.name;
        const sameParams = firstId(route.params.id) === dest.params.id
            && firstId(route.params.sprintId) === dest.params.sprintId
            && firstId(route.params.taskId) === dest.params.taskId
            && firstId(route.params.folderId) === firstId(dest.params.folderId);
        if (sameName && sameParams) return;
        router.replace({ ...dest, query: { ...route.query } }).catch(() => {});
    }

    function getParentTask() {
        if(task?.value?.ParentTaskId) {
            apiRequest('get', `${env.TASK}/${task.value.ParentTaskId}`).then((response) => {
                if(response && response?.status === 200 && response?.data){
                    parentTask.value = response.data;
                }
            }).catch((error) => {
                console.error('error in getting the task',error);
            });
        }
    }

    function markTaskMissing() {
        openBlocked.value = true;
        isSpinner.value = false;
        if (hydrateTimer) {
            clearTimeout(hydrateTimer);
            hydrateTimer = null;
        }
    }

    function backToSearch() {
        emit('toggleTaskDetail', task.value, true);
        openGlobalSearch();
    }

    function getQueryFun () {
        const taskId = firstId(props.taskId, route.params && route.params.taskId);
        if (!taskId) {
            markTaskMissing();
            return;
        }
        const gen = ++hydrateGen;
        if (hydrateTimer) clearTimeout(hydrateTimer);
        hydrateTimer = setTimeout(() => {
            if (gen === hydrateGen && !taskLoaded.value) {
                hydrateGen += 1;
                markTaskMissing();
            }
        }, 8000);
        const query = {
            taskId,
            subTaskLimit: String(subTaskLimit.value),
        };
        if (resolvedProjectId.value) query.projectId = resolvedProjectId.value;
        const queryParams = new URLSearchParams(query).toString();
        try{
            apiRequest('get', `${env.TASK_DATA}?${queryParams}`)
            .then((res) => {
                if (gen !== hydrateGen) return;
                if (hydrateTimer) {
                    clearTimeout(hydrateTimer);
                    hydrateTimer = null;
                }
                if (res.status  == 200 && res.data.length > 0) {
                    let response = res.data
                    const row = response[0].tasks && response[0].tasks[0];
                    if (!row || !row._id) {
                        markTaskMissing();
                        return;
                    }
                    openBlocked.value = false;
                    isSpinner.value = false;
                    emit('handleSpinner');
                    task.value = row;
                    projectData.value = response[0];
                    keepTaskOpenHash();
                    const sprint = response[0].sprintsObj;
                    const folder = response[0].sprintsfolders;
                    getSprintFolderData(response[0]._id,sprint,folder).then((resp) => {
                        if (gen !== hydrateGen) return;
                        if (resp && resp.sprints) response[0].sprintsObj = resp.sprints
                        if (resp && resp.folders) response[0].sprintsfolders = resp.folders
                        projectData.value = response[0];
                        subTasks.value = response[0].subtasks || [];
                        commit('projectData/setTaskDetailData',{isSubTaskData: true, data: subTasks.value});
                        fetchSubtaskCount();

                        if(!projectData.value?.isGlobalPermission && !(getters["settings/projectRules"] && Object.keys(getters["settings/projectRules"])?.length > 0)) {
                            dispatch("settings/setProjectRules", {pid: resolvedProjectId.value || response[0]._id})
                            .catch((error) => {
                                console.error("ERROR in get project rules", error);
                            });
                        }
                    })
                } else {
                    markTaskMissing();
                }
            }).catch((error)=>{
                if (gen !== hydrateGen) return;
                if (hydrateTimer) {
                    clearTimeout(hydrateTimer);
                    hydrateTimer = null;
                }
                console.error(error);
                markTaskMissing();
            })
        }catch(error){
            console.error(error)
            markTaskMissing();
        }
    }

    watch(resolvedProjectId, (id, prev) => {
        if (id && id !== prev && !taskLoaded.value) {
            openBlocked.value = false;
            isSpinner.value = true;
            getQueryFun();
        }
    });

    function changeTaskType(status) {
        const statusIndex = projectData.value.taskTypeCounts.findIndex((x) => x.key === task.value.TaskTypeKey);
        if(statusIndex === -1) return;
        updateTaskByGroup(task.value, status, 4);
    }

    onUnmounted(() => {
        // DETACH
        if(snap.value !== null) {
            snap.value();
        }
    })
</script>
<style src="./style.css"></style>