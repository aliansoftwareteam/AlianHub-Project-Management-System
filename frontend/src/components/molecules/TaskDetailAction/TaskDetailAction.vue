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
                    :maxHeight="clientWidth > 765 ? 'fit-content' : '40dvh'"
                    id="horizontalDocs"
                    :zIndex="10"
                    class="h-100 w-100"
                    :bodyClassHeader="{'h-100 w-100 red': true}"
                >
                    <template #button>
                        <Skelaton v-if="isSpinner" style="height: 30px;" class="w-30px border-radius-6-px"/>
                        <div v-else class="h-100 w-100 d-flex align-items-center">
                            <img :src="horizontalDots" ref="horizontalDocs">
                        </div>
                    </template> 
                    <template #options>
                        <DropDownOption @click="$refs['horizontalDocs'].click(),copyTaskLink()">
                            <div>
                                <img :src="linkIcon" />
                                <span class="dropdown-label">{{$t('ProjectDetails.copy_task_link')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="$refs['horizontalDocs'].click(),copyTaskKey()">
                            <div>
                                <img :src="splitScreen" />
                                <span class="dropdown-label">{{$t('ProjectDetails.copy_task_key')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="$refs['horizontalDocs'].click(),openReminderModal()">
                            <div>
                                <img :src="linkIcon" />
                                <span class="dropdown-label">{{$t('ProjectDetails.remind_me')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption v-if="(task.queueListArray == undefined || (task.queueListArray && task.queueListArray.indexOf(userId) == -1)) && (task.AssigneeUserId && task.AssigneeUserId.indexOf(userId) !== -1) && checkPermission('task.queue_list',projectData.isGlobalPermission) == true" @click="$refs['horizontalDocs'].click(),addToQueue('add')">
                            <div>
                                <img :src="cancelIcon" />
                                <span class="dropdown-label">{{$t('ProjectDetails.add_que_list')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption v-if="(task.queueListArray && task.queueListArray.indexOf(userId) !== -1) && (task.AssigneeUserId && task.AssigneeUserId.indexOf(userId) !== -1) && checkPermission('task.queue_list',projectData.isGlobalPermission) == true" @click="$refs['horizontalDocs'].click(),addToQueue('remove')">
                            <div>
                                <img :src="cancelIcon" />
                                <span class="dropdown-label">{{$t('ProjectDetails.remove_que_list')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="$refs['horizontalDocs'].click(),convertToList()" v-if="checkPermission('project.project_sprint_create',projectData.isGlobalPermission) === true && checkPermission('task.task_convert_to_list',projectData.isGlobalPermission) === true">
                            <div>
                                <img :src="combinedIcon" />
                                <span class="dropdown-label">{{$t('ProjectDetails.convert_list')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="$refs['horizontalDocs'].click(),convertToSubTask()" v-if="checkPermission('task.sub_task_create',projectData.isGlobalPermission) === true && task.isParentTask && checkPermission('task.task_convert_to_subtask',projectData.isGlobalPermission) === true">
                            <div>
                                <img :src="subTaskIcon" />
                                <span class="dropdown-label">{{$t('ProjectDetails.convert_subtask')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="$refs['horizontalDocs'].click(),duplicateTask()" v-if="checkPermission('task.task_duplicate',projectData.isGlobalPermission) == true">
                            <div>
                                <img :src="copyIcon" class="copyIcon"/>
                                <span class="dropdown-label">{{$t('Projects.duplicate')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="$refs['horizontalDocs'].click(),mergeTask()" v-if="checkPermission('task.task_merge',projectData.isGlobalPermission) == true">
                            <div>
                                <img :src="mergeIcon" />
                                <span class="dropdown-label">{{$t('ProjectDetails.merge')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="$refs['horizontalDocs'].click(),moveTask()" v-if="checkPermission('task.task_move',projectData.isGlobalPermission) == true">
                            <div>
                                <img :src="moveIcon" />
                                <span class="dropdown-label">{{$t('ProjectDetails.move')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="$refs['horizontalDocs'].click(),convertToTask()" v-if="task.isParentTask === false && checkPermission('task.task_create',projectData.isGlobalPermission) && checkPermission('task.convert_to_task',projectData.isGlobalPermission) === true">
                            <div>
                                <img :src="mergeIcon" />
                                <span class="dropdown-label">{{$t('ProjectDetails.convert_task')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="$refs['horizontalDocs'].click(), showSidebar = true, archive = true" v-if="checkPermission('task.task_archive',projectData.isGlobalPermission) == true">
                            <div>
                                <img :src="inventoryIcon" />
                                <span class="dropdown-label">{{$t('Projects.archive')}}</span>
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="$refs['horizontalDocs'].click(), showSidebar = true, archive = false" v-if="checkPermission('task.task_delete',projectData.isGlobalPermission) == true">
                            <div>
                                <img :src="deleteIcon" />
                                <span class="dropdown-label red">{{$t('Projects.delete')}}</span>
                            </div>
                        </DropDownOption>
                    </template>
                </DropDown>
            </li>
            <li class="watcher-action">
                <DropDown
                    id="watcher"
                    :bodyClass="{'watcher__action-dropdown border-radius-12-px border-0' : true}"
                    :zIndex="10"
                >
                    <template #button>
                        <Skelaton v-if="isSpinner" style="height: 30px;" class="w-30px border-radius-6-px"/>
                        <a href="#" v-if="!isSpinner">
                            <img src="@/assets/images/svg/PriorityIcon/watchProjectEye.svg">
                        </a>
                        <span v-if="!isSpinner" class="watcher-count">{{ watchers && watchers.length ? watchers.length : 0 }}</span>
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
                        >
                            <template #default>
                                <img class="cursor-pointer employee__profile-img"
                                    v-if="!user.Employee_profileImageURL"
                                    :src="user.Employee_profileImage"
                                    alt="userImg"
                                    @click="updateWatchers(user.id, 'add')"
                                >
                                <WasabiIamgeCompp v-else :userImage="true" :data="{title: user.Employee_Name, url: user.Employee_profileImageURL}" :thumbnail="'30x30'" class="cursor-pointer wasabi__emp-image"/>
                                <span 
                                    class="cursor-pointer ml-10px" 
                                    @click="updateWatchers(user.id, 'add')"
                                >
                                    {{ user.Employee_Name }}
                                </span>
                                <img
                                    class="cursor-pointer deleted__icon ml-auto"
                                    src="@/assets/images/svg/deletered.svg"
                                    v-if="user.isWatcher && user.isLoggedUser"
                                    @click="updateWatchers(user.id, 'remove')"
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
            :message="archive ? $t('conformationmsg.archive') : $t('conformationmsg.delete')"
            :confirmationString="`${archive ? 'archive' : 'delete'}`"
            :acceptButtonClass="archive ? 'btn-primary': 'btn-danger'"
            :acceptButton="`${archive ? $t('Projects.archive') : $t('Projects.delete')}`"
            @confirm="updateTask()"
            :showSpinner="showSpinner"
        />
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

    import { computed, defineProps,defineEmits, ref, inject, watch, onMounted, onBeforeUnmount } from 'vue';
    import taskClass from "@/utils/TaskOperations"
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

    const horizontalDots = require("@/assets/images/svg/horizontalDots.svg");
    const linkIcon = require("@/assets/images/png/link.png");
    const splitScreen = require("@/assets/images/png/splitscreen.png");
    const subTaskIcon = require("@/assets/images/png/subTaskIcon.png");
    const cancelIcon = require("@/assets/images/svg/arrow_circle_up.svg");
    const combinedIcon = require("@/assets/images/png/Combined_shape.png");
    const copyIcon = require("@/assets/images/copy.png");
    const mergeIcon = require("@/assets/images/png/mergeIcon.png");
    const moveIcon = require("@/assets/images/png/moveIcon.png");
    // const inventoryIcon = require("@/assets/images/inventory_2.png");
    // const deleteIcon = require("@/assets/images/DeleteIcon.png");
    const inventoryIcon = require("@/assets/images/inventory_2.png");
    const deleteIcon = require("@/assets/images/DeleteIcon.png");

    const emit = defineEmits(['update:watchers', 'open', 'close']);

    const {getters,commit} = useStore();
    const companyUsers = computed(() => getters["settings/companyUsers"]?.map((x) => x.userId))
    const projectData = inject("selectedProject")
    const watchers = ref(props.watchers || []);
    const watcherUsers = ref([]);
    const search = ref('');
    const userId = inject('$userId')
    const companyId = inject('$companyId')
    const clientWidth = inject('$clientWidth');
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

    function dismissReminder() {
        showReminderModal.value = false;
    }
    onMounted(() => {
        document.addEventListener('kiln-dismiss-modal', dismissReminder);
    });
    onBeforeUnmount(() => {
        document.removeEventListener('kiln-dismiss-modal', dismissReminder);
    });

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

        allUsers.forEach((uid) => {
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
    debounce(() => {
        getWatcherUsers();
    }, 100)

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
                sprint.tasks = sprint.tasks - (props.task.isParentTask ? ((props.task.subTasks || 0) + 1) : 1)
                commit("projectData/mutateSprints",{op:'modified',data:{...sprint}});
                if (deletedStatusKey !== 1 || deletedStatusKey !== 2) {
                    $toast.success(t(`Toast.Task_${value !== null ? 'restored' : archive.value ? 'archived' : 'deleted'}_successfully`), { position: "top-right" })
                }
            }
            showSpinner.value = false;
            showSidebar.value = false;

        })
        .catch((err) => {
            console.error(err);
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
                    $toast.error(t('Toast.Queue_list_not_updated'),{position: 'top-right'});
                })
        } catch (error) {
            console.error("ERROR in update addToQueue: ", error);
        }
    };
</script>

<style src="./style.css"></style>