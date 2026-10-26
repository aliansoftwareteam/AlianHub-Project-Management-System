<template>
    <div class="task-detail-action">
        <ul class="task-detail-action-ul">
            <!-- Subtask completion badge (AHE-3776): at-a-glance % of this parent's
                 subtasks that are done. Hidden when the task has no subtasks. -->
            <!-- width:auto so the pill isn't clipped by the shared `li { width:30px }` icon sizing. -->
            <li v-if="subtaskCompletion && subtaskCompletion.total" style="display:flex; align-items:center; width:auto;">
                <SubtaskProgressBadge
                    :completed="subtaskCompletion.completed"
                    :total="subtaskCompletion.total"
                    variant="pill"
                />
            </li>
            <li>
                <Skelaton v-if="isSpinner" style="height: 30px;" class="w-30px border-radius-6-px"/>
                <img v-else @click="$emit('open', 'filesLinks')" src="@/assets/images/svg/Fileslinks.svg" />
            </li>
            <li>
                <Skelaton v-if="isSpinner" style="height: 30px;" class="w-30px border-radius-6-px"/>
                <img v-else @click="$emit('open', 'audio')" src="@/assets/images/svg/audio.svg" />
            </li>
            <li class="horizontalDocs">
                <DropDown
                    mode="menu"
                    :maxHeight="clientWidth > 765 ? 'fit-content' : '40dvh'"
                    id="horizontalDocs"
                    :zIndex="10"
                    class="h-100 w-100"
                    :bodyClassHeader="{'h-100 w-100 red': true}"
                    @isVisible="(shown) => shown && prefetchGoals()"
                >
                    <template #button="{ triggerAttrs }">
                        <Skelaton v-if="isSpinner" style="height: 30px;" class="w-30px border-radius-6-px"/>
                        <button v-else type="button" class="ah-btn ah-btn--secondary ah-btn--sm ah-detail__head-icon task-action__btn" :aria-label="$t('TaskPanel.more_actions')" :title="$t('TaskPanel.more_actions')" v-bind="triggerAttrs">
                            <ShellIcon name="more" :size="14" />
                        </button>
                    </template> 
                    <template #options>
                        <DropDownOption @click="copyTaskLink()">
                            <div :class="rowClass">
                                <ShellIcon name="link" :size="iconSize" />
                                <span>{{$t('ProjectDetails.copy_task_link')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="copyTaskKey()">
                            <div :class="rowClass">
                                <ShellIcon name="hash" :size="iconSize" />
                                <span>{{$t('ProjectDetails.copy_task_key')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="openReminderModal()">
                            <div :class="rowClass">
                                <ShellIcon name="bell" :size="iconSize" />
                                <span>{{$t('ProjectDetails.remind_me')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption v-if="goalsOffered" data-test="task-count-toward-goal" @click="linkingGoal = true">
                            <div :class="rowClass">
                                <ShellIcon name="target" :size="iconSize" />
                                <span>{{$t('Goals.count_toward')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption v-if="canOpenTracker" @click="$emit('open', 'tracker')">
                            <div :class="rowClass">
                                <ShellIcon name="time" :size="iconSize" />
                                <span>{{$t('TaskPanel.open_in_desktop_tracker')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption v-if="(task.queueListArray == undefined || (task.queueListArray && task.queueListArray.indexOf(userId) == -1)) && (task.AssigneeUserId && task.AssigneeUserId.indexOf(userId) !== -1) && checkPermission('task.queue_list',projectData.isGlobalPermission) == true" @click="addToQueue('add')">
                            <div :class="rowClass">
                                <ShellIcon name="upvote" :size="iconSize" />
                                <span>{{$t('ProjectDetails.add_que_list')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption v-if="(task.queueListArray && task.queueListArray.indexOf(userId) !== -1) && (task.AssigneeUserId && task.AssigneeUserId.indexOf(userId) !== -1) && checkPermission('task.queue_list',projectData.isGlobalPermission) == true" @click="addToQueue('remove')">
                            <div :class="rowClass">
                                <ShellIcon name="upvote" :size="iconSize" />
                                <span>{{$t('ProjectDetails.remove_que_list')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="convertToList()" v-if="checkPermission('project.project_sprint_create',projectData.isGlobalPermission) === true && checkPermission('task.task_convert_to_list',projectData.isGlobalPermission) === true">
                            <div :class="rowClass">
                                <ShellIcon name="menu" :size="iconSize" />
                                <span>{{$t('ProjectDetails.convert_list')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="convertToSubTask()" v-if="checkPermission('task.sub_task_create',projectData.isGlobalPermission) === true && task.isParentTask && checkPermission('task.task_convert_to_subtask',projectData.isGlobalPermission) === true">
                            <div :class="rowClass">
                                <ShellIcon name="layers" :size="iconSize" />
                                <span>{{$t('ProjectDetails.convert_subtask')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption v-if="checkPermission('task.task_create',projectData.isGlobalPermission) === true" @click="openTemplateDialog({ mode: 'save', task: props.task, project: projectData })">
                            <div :class="rowClass">
                                <ShellIcon name="template" :size="iconSize" />
                                <span>{{$t('TaskTemplates.save_as')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption v-if="checkPermission('task.task_create',projectData.isGlobalPermission) === true" @click="openTemplateDialog({ mode: 'apply', task: props.task, project: projectData })">
                            <div :class="rowClass">
                                <ShellIcon name="layout" :size="iconSize" />
                                <span>{{$t('TaskTemplates.apply_menu')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="duplicateTask()" v-if="checkPermission('task.task_duplicate',projectData.isGlobalPermission) == true">
                            <div :class="rowClass">
                                <ShellIcon name="copy" :size="iconSize" />
                                <span>{{$t('Projects.duplicate')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="mergeTask()" v-if="checkPermission('task.task_merge',projectData.isGlobalPermission) == true">
                            <div :class="rowClass">
                                <ShellIcon name="merge" :size="iconSize" />
                                <span>{{$t('ProjectDetails.merge')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="moveTask()" v-if="checkPermission('task.task_move',projectData.isGlobalPermission) == true">
                            <div :class="rowClass">
                                <ShellIcon name="arrowRight" :size="iconSize" />
                                <span>{{$t('ProjectDetails.move')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="convertToTask()" v-if="task.isParentTask === false && checkPermission('task.task_create',projectData.isGlobalPermission) && checkPermission('task.convert_to_task',projectData.isGlobalPermission) === true">
                            <div :class="rowClass">
                                <ShellIcon name="checkSquare" :size="iconSize" />
                                <span>{{$t('ProjectDetails.convert_task')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="showSidebar = true, archive = true" v-if="checkPermission('task.task_archive',projectData.isGlobalPermission) == true">
                            <div :class="rowClass">
                                <ShellIcon name="archive" :size="iconSize" />
                                <span>{{$t('Projects.archive')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="showSidebar = true, archive = false" v-if="checkPermission('task.task_delete',projectData.isGlobalPermission) == true">
                            <div :class="[rowClass, 'ah-menu-row--danger']">
                                <ShellIcon name="trash" :size="iconSize" />
                                <span>{{$t('Projects.delete')}}</span>
                            </div>
                        </DropDownOption>
                    </template>
                </DropDown>
            </li>
            <li class="watcher-action">
                <DropDown
                    mode="listbox"
                    id="watcher"
                    :bodyClass="{'watcher__action-dropdown' : true}"
                    :zIndex="10"
                    @isVisible="(shown) => shown && getWatcherUsers()"
                >
                    <template #button="{ triggerAttrs }">
                        <Skelaton v-if="isSpinner" style="height: 30px;" class="w-30px border-radius-6-px"/>
                        <button type="button" v-if="!isSpinner" class="ah-btn ah-btn--secondary ah-btn--sm task-action__btn task-action__watchers" :aria-label="$t('TaskPanel.watchers', { n: watchers && watchers.length ? watchers.length : 0 })" v-bind="triggerAttrs">
                            <ShellIcon name="eye" :size="14" />
                            <span class="watcher-count" aria-hidden="true">{{ watchers && watchers.length ? watchers.length : 0 }}</span>
                        </button>
                    </template>
                    <template #head>
                        <div :class="{'border-bottom' : clientWidth > 767}" :style="`padding: ${clientWidth <= 767 ? 0 : 10}px;`">
                            <InputText
                                v-model="search"
                                class="search__text font-size-14"
                                :place-holder="$t('PlaceHolder.search')"
                                type="text"
                                height="30px !important"
                                :isOutline="false"
                            />
                        </div>
                    </template>
                    <template #options>
                        <DropDownOption
                            v-for="user in filteredWatchers"
                            :key="user.id"
                            :item="user"
                            :class="{ 'selected-watcher': user.isWatcher == true }"
                            :selected="user.isWatcher == true"
                            @click="updateWatchers(user.id, 'add')"
                        >
                            <template #default>
                                <img class="cursor-pointer employee__profile-img"
                                    v-if="!user.Employee_profileImageURL"
                                    :src="user.Employee_profileImage"
                                    alt="userImg"
                                >
                                <WasabiIamgeCompp v-else :userImage="true" :data="{title: user.Employee_Name, url: user.Employee_profileImageURL}" :thumbnail="'30x30'" class="cursor-pointer wasabi__emp-image"/>
                                <span class="cursor-pointer">
                                    {{ user.Employee_Name }}
                                </span>
                                <ShellIcon
                                    v-if="user.isWatcher && user.isLoggedUser"
                                    name="trash"
                                    :size="14"
                                    class="cursor-pointer deleted__icon ml-auto"
                                    @click.stop="updateWatchers(user.id, 'remove')"
                                />
                            </template>
                        </DropDownOption>
                    </template>
                </DropDown>
            </li>
            <li class="close-icon" @click="$emit('close')">
                <img src="@/assets/images/svg/delete.svg" />
            </li>
        </ul>
        <ConvertToSubTaskSidebar v-if="openConvertSubTaskSidebar === true" 
            :closeSideBar="openConvertSubTaskSidebar"  @isConvertSubtaskOPen="(val) => {sidebarOPen(val)}" 
            :isMoveTask="openMoveSidebar" :openMoveSubTask="openMoveSubTask" :isMergeTask="openMergeTask" 
            :isDuplicate="duplicateTaskSidebar" :task="props.task" :isConvertTask="openConvertToTask" :isOpenSubTask="openSubTaskSideabr"/>        
        <ConvertToList v-if="converrtToListSidebar === true" :openSidebar="converrtToListSidebar" @closeSidebar="(val) => {converrtToListSidebar = val}" :task="props.task" />
        <ConfirmationSidebar
            v-model="showSidebar"
            :title="`${archive ? $t('Projects.archive') : $t('Projects.delete')}`"
            :message="$t(taskRemovalMessageKey(props.task, archive))"
            :confirmationString="`${archive ? 'archive' : 'delete'}`"
            :acceptButtonClass="archive ? 'btn-primary': 'btn-danger'"
            :acceptButton="`${archive ? $t('Projects.archive') : $t('Projects.delete')}`"
            @confirm="updateTask()"
            :showSpinner="showSpinner"
        />
        <GoalLinkPicker v-if="linkingGoal" :source="{ kind: 'taskIds', id: props.task._id, name: props.task.TaskName }" @close="linkingGoal = false" />
        <!-- Personal reminder (COLLAB-03) — pick a date/time to be reminded about this task. -->
        <div v-if="showReminderModal" class="reminder-modal__overlay" @click.self="showReminderModal = false">
            <div class="reminder-modal">
                <div class="reminder-modal__title">{{ $t('ProjectDetails.remind_me') }}</div>
                <label class="reminder-modal__label">{{ $t('ProjectDetails.reminder_when') }}</label>
                <input type="datetime-local" v-model="reminderAt" class="reminder-modal__field" />
                <label class="reminder-modal__label">{{ $t('ProjectDetails.reminder_note') }}</label>
                <input type="text" v-model="reminderText" class="reminder-modal__field" :placeholder="$t('ProjectDetails.reminder_note')" autocomplete="off" />
                <div class="reminder-modal__actions">
                    <span class="cursor-pointer gray81" @click="showReminderModal = false">{{ $t('Projects.cancel') }}</span>
                    <button class="btn-primary font-size-13" :disabled="!reminderAt || reminderSaving" @click="saveReminder()">{{ $t('Projects.save') }}</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
    import DropDown from '@/components/molecules/DropDown/DropDown'
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption'
    import InputText from '@/components/atom/InputText/InputText.vue';
    import ConvertToSubTaskSidebar from '@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue';
    import ConvertToList from '@/components/molecules/ConvertToList/ConvertToList.vue';
    import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
    import WasabiIamgeCompp from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';
    import SubtaskProgressBadge from '@/components/atom/SubtaskProgressBadge/SubtaskProgressBadge.vue';
    import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
    import { openTemplateDialog } from '@/components/molecules/TaskTemplates/taskTemplates';

    import { useGoalLinking } from '@/views/Goals/goalLinking';

    import { computed, defineAsyncComponent, defineProps,defineEmits, ref, inject, watch } from 'vue';
    import taskClass from "@/utils/TaskOperations"
    import { taskRemovalMessageKey } from "@/utils/taskRemovalWords";
    import { apiRequest } from '@/services';
    import { useGetterFunctions, useCustomComposable } from '@/composable';
    const { getUser } = useGetterFunctions();
    const { checkPermission, debounce } = useCustomComposable();

    import { useToast } from 'vue-toast-notification';
    import { useStore } from 'vuex';
    import { useI18n } from "vue-i18n";
    import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';
    const { t } = useI18n();

    const $toast = useToast();

    const props = defineProps({
        watchers: Array,
        task: {
            type: Object,
        },
        sprints: {
            type: Array,
        },
        isSpinner:{
            type:Boolean,
            default:false
        }
    });


    const emit = defineEmits(['update:watchers', 'open', 'close']);

    const {getters,commit} = useStore();
    const companyUsers = computed(() => getters["settings/companyUsers"]?.map((x) => x.userId))
    const projectData = inject("selectedProject")
    const watchers = ref(props.watchers || []);
    const watcherUsers = ref([]);
    const search = ref('');
    const userId = inject('$userId')
    const canOpenTracker = computed(() => (props.task?.AssigneeUserId || []).includes(userId.value) && (props.task?.status?.type || props.task?.statusType) !== 'close');
    const companyId = inject('$companyId')
    const GoalLinkPicker = defineAsyncComponent(() => import('@/views/Goals/GoalLinkPicker.vue'));
    const linkingGoal = ref(false);
    const { offered: goalsOffered, prefetch: prefetchGoals } = useGoalLinking();
    const clientWidth = inject('$clientWidth');
    const isPhone = computed(() => Boolean(clientWidth?.value) && clientWidth.value <= 767);
    const rowClass = computed(() => ['ah-menu-row', { 'ah-menu-row--phone': isPhone.value }]);
    const iconSize = computed(() => (isPhone.value ? 18 : 15));
    // Provided by TaskDetail.vue — { total, completed } for the subtask % badge.
    const subtaskCompletion = inject('subtaskCompletion', null);
    const openConvertSubTaskSidebar = ref(false);
    const converrtToListSidebar = ref(false);
    const openMoveSidebar = ref(false);
    const openMoveSubTask = ref(false);
    const openMergeTask = ref(false);
    const duplicateTaskSidebar = ref(false);
    const openConvertToTask = ref(false);
    const openSubTaskSideabr = ref(false);

    const showSidebar = ref(false);
    const showSpinner = ref(false);
    const archive = ref(true);

    // Personal reminder (COLLAB-03) state.
    const showReminderModal = ref(false);
    const reminderAt = ref('');
    const reminderText = ref('');
    const reminderSaving = ref(false);

    //watchers user details
    const getWatcherUsers = () => {
        let allUsers = (projectData.value && Object.keys(projectData.value || {}).length && projectData.value.sprintsObj?.[props.task?.sprintId]?.private) ?
                        projectData.value.sprintsObj?.[props.task.sprintId]?.AssigneeUserId :
                        projectData.value.isPrivateSpace ?
                        projectData.value.AssigneeUserId :
                        companyUsers.value;

        watcherUsers.value = [];
        if(watchers.value && watchers.value.length) {
            watchers.value.forEach(element => {
                watcherUsers.value.push({
                    ...getUser(element),
                    isWatcher: true,
                    isLoggedUser: element === userId.value
                });
            });

            if(!watchers.value.includes(userId.value)) {
                watcherUsers.value.push({
                    ...getUser(userId.value),
                    isWatcher: false,
                    isLoggedUser: true
                });
            }

        } else {
            watcherUsers.value = [{
                ...getUser(userId.value),
                isWatcher: false,
                isLoggedUser: true
            }];
        }

        (allUsers || []).forEach((uid) => {
            if(!watcherUsers.value.filter((x) => x.id === uid).length) {
                watcherUsers.value.push({
                    ...getUser(uid),
                    isWatcher: false,
                    isLoggedUser: true
                });
            }
        })
        watcherUsers.value = watcherUsers.value.filter((ele) =>  !ele.ghostUser)
    }
    watch(() => props.watchers, debounce(() => {
        watchers.value = props.watchers;
        getWatcherUsers();
    }), 50)

    const filteredWatchers = computed(() => {
        if(search.value) {
            return watcherUsers.value.filter(user => user.Employee_Name.toLowerCase().includes(search.value.toLowerCase()));
        } else {
            return watcherUsers.value;
        }
    });

    const updateWatchers = (uid, type) => {
        if(uid !== userId.value) return;
        let index = watcherUsers.value.findIndex(user => user.id == uid);
        if(type == 'add') {
            if(watchers.value.includes(uid)) {
                return;
            }
            watchers.value.push(uid);
            if(index != -1) {
                watcherUsers.value[index].isWatcher = true;
            }
        } else if(type == 'remove') {
            if(!watchers.value.includes(uid)) {
                return;
            }
            watchers.value = watchers.value.filter(user => user != uid);
            if(index != -1) {
                watcherUsers.value[index].isWatcher = false;
            }
        }
        emit('update:watchers', uid, type);
    }
    // copy task link
    const copyTaskLink = () => {
        navigator.clipboard.writeText(window.location.href);
        $toast.success(t("Toast.Link_is_Copied_to_clipboard"),{position: 'top-right'});
    }
    // copy task key
    const copyTaskKey = () => {
        navigator.clipboard.writeText(props.task.TaskKey);
        $toast.success(t("Toast.Task_Key_is_Copied_to_clipboard"),{position: 'top-right'});
    }
    // convert to subtask
    const convertToSubTask = () => {
        openConvertSubTaskSidebar.value = true;
        openSubTaskSideabr.value = true;
    }
    // move Task
    const moveTask = () => {
        if(props.task.isParentTask === true){
            openMoveSidebar.value = true;
        }else if(props.task.isParentTask === false){
            openMoveSubTask.value = true;
        }
        openConvertSubTaskSidebar.value = true;
    }
    // convert to list
    const convertToList = () => {
        converrtToListSidebar.value = true;
    }
    const mergeTask= () => {
        openConvertSubTaskSidebar.value = true;
        openMergeTask.value = true;
    }

    const sidebarOPen = (val) => {
        openConvertSubTaskSidebar.value = val;
        openMoveSubTask.value = false;
        openMoveSidebar.value = false;
        openMergeTask.value = false;
        duplicateTaskSidebar.value = false;
        openConvertToTask.value = false;
        converrtToListSidebar.value = false
        openSubTaskSideabr.value = false;
    }

    const duplicateTask = () => {
        openConvertSubTaskSidebar.value = true;
        duplicateTaskSidebar.value = true;
    }

    function updateTask(value = null) {
        showSpinner.value = true;

        const deletedStatusKey = value !== null ? value : archive.value ? 2 : 1;
        let usr = getUser(userId.value);
        const userData = {
            id: usr.id,
            Employee_Name: usr.Employee_Name,
            companyOwnerId: usr.companyOwnerId
        };
        const project = {
            _id: projectData.value._id,
            CompanyId: projectData.value.CompanyId,
            lastTaskId: projectData.value.lastTaskId,
            ProjectName: projectData.value.ProjectName,
            ProjectCode: projectData.value.ProjectCode
        }
        taskClass.updateArchiveDelete({
            companyId: companyId.value,
            projectData: project,
            sprintId: props.task.sprintId,
            task: props.task,
            folderId : props.task.folderObjId ? props.task.folderObjId : '',
            userData,
            deletedStatusKey
        })
        .then((res) => {
            if(res.status) {
                let sprint = {};
                if(props.task.folderObjId){
                    sprint = projectData.value.sprintsfolders?.[props.task.folderObjId]?.sprintsObj?.[props.task.sprintId];
                }
                else {
                    sprint = projectData.value?.sprintsObj[props.task.sprintId];
                }
                if (sprint) {
                    sprint.tasks = sprint.tasks - (props.task.isParentTask ? ((props.task.subTasks || 0) + 1) : 1)
                    commit("projectData/mutateSprints",{op:'modified',data:{...sprint}});
                }
                $toast.success(t(`Toast.Task_${value !== null ? 'restored' : archive.value ? 'archived' : 'deleted'}_successfully`), { position: "top-right" })
            }
            showSpinner.value = false;
            showSidebar.value = false;
            if (res.status && value === null) emit('close');
        })
        .catch((err) => {
            console.error(err);
            showSpinner.value = false;
            $toast.error(err?.error?.response?.data?.statusText || t('Toast.something_went_wrong'), { position: "top-right" });
        })
    }

    const convertToTask = () => {
        openConvertSubTaskSidebar.value = true;
        openConvertToTask.value = true;
    }
    // Open the reminder modal, defaulting the time to one hour from now.
    const openReminderModal = () => {
        const d = new Date(Date.now() + 60 * 60 * 1000);
        // datetime-local needs a local "YYYY-MM-DDTHH:mm" value.
        const pad = (n) => String(n).padStart(2, '0');
        reminderAt.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        reminderText.value = '';
        showReminderModal.value = true;
    };

    // Create a personal reminder for the logged-in user on this task.
    const saveReminder = () => {
        if (!reminderAt.value || reminderSaving.value) return;
        reminderSaving.value = true;
        // Send an ISO timestamp so the server parses the instant unambiguously.
        const isoWhen = new Date(reminderAt.value).toISOString();
        apiRequest('post', '/api/v1/reminders', {
            taskId: props.task && props.task._id,
            projectId: projectData.value && projectData.value._id,
            userId: userId.value,
            reminderAt: isoWhen,
            reminderText: reminderText.value || '',
        })
            .then((res) => {
                if (res && res.data && res.data.status) {
                    $toast.success(t('ProjectDetails.reminder_set'), { position: 'top-right' });
                    showReminderModal.value = false;
                } else {
                    $toast.error(t('ProjectDetails.reminder_failed'), { position: 'top-right' });
                }
                reminderSaving.value = false;
            })
            .catch((error) => {
                console.error('ERROR in saveReminder: ', error);
                $toast.error(t('ProjectDetails.reminder_failed'), { position: 'top-right' });
                reminderSaving.value = false;
            });
    };

    const addToQueue = (action) => {
        try {
            taskClass.updateQueueList({CompanyId:companyId.value, projectId:projectData.value._id, sprintId:props.task.sprintId, taskId:props.task._id,userId:userId.value,actionType:action,queueListArray: props.task.queueListArray})
                .then(() => {
                    $toast.success(t(`Toast.Queue list ${action == 'add' ? 'added' : 'removed'} successfully`),{position: 'top-right'});
                })
                .catch((error) => {
                    console.error("ERROR in update addToQueue: ", error);
                    $toast.error(t('Toast.queue_list_not_updated'),{position: 'top-right'});
                })
        } catch (error) {
            console.error("ERROR in update addToQueue: ", error);
        }
    };
</script>

<style src="./style.css"></style>