<template>
    <div class="sprint position-re" :id="`sprint_${sprint?.id}`">
        <!-- FOLDER NAME LEGEND -->
        <div
            v-if="sprint && sprint.folderName"
            class="cursor-default black position-ab bg-white border border-radius-5-px text-capitalize color52 p0x-10px sprint__foldername"
        >
            {{sprint.folderName}}
        </div>

        <div class="sprint_name TaskName d-flex justify-content-between align-items-center flex-wrap"  :class="{'mb-20px': sprint.isExpanded , 'flex-column align-items-start' : clientWidth<=512}" >
            <div @click="sprint.deletedStatusKey === 0 || sprint.deletedStatusKey === undefined ? $emit('change',sprint?.id) : ''" :class="clientWidth <= 767 ? `mw-100 w-100 justify-content-between ${clientWidth <= 480 ? '' : 'd-flex align-items-center'}` : 'mw-60 d-flex align-items-center'">
                <div class="d-flex align-items-center" :class="checkApps('AI',project) && 
                        checkPermission('task.task_list',project?.isGlobalPermission) === true && 
                        checkPermission('task.task_create',project?.isGlobalPermission) === true ? clientWidth <= 480 ? 'mw-100' : clientWidth <= 991 ? 'mw-40' : clientWidth <= 1440 ? 'mw-50' : 'mw-65' : clientWidth <= 480 ? '' : clientWidth <= 991 ? 'mw-50' : 'mw-80'">
                    <img v-if="sprint.deletedStatusKey === 0 || sprint.deletedStatusKey === undefined" :src="triangleBlack" alt="traingle" :style="`transform: rotateZ(${sprint.isExpanded ? 90 : 0}deg); width: 6px;`" class="cursor-pointer">
                    <img v-if="sprint.deletedStatusKey === 2" :src="inventory_2" class="pr-10px" />
                    <img v-if="sprint.isFolder === true" :src="folder">
                    <span class="text-ellipse font-weight-bold text-capitalize ml-10px cursor-pointer font-size-14 color52">{{ sprint.name }}</span>
                </div>
                <div :class="clientWidth <= 480 ? 'pt-1' : ''" class="d-flex align-items-center sprint-head-actions">
                    <SprintStateChip :sprint="sprint" />
                    <template v-if="$route?.query?.tab !== 'Calendar'">
                        <button
                            v-if="sprint.isExpanded && !searchedTask && checkPermission('task.task_create',project.isGlobalPermission) === true && checkPermission('task.task_list',project.isGlobalPermission) == true && showArchiveVar === false"
                            class="outline-secondary-bg-gray"
                            :class="clientWidth <= 480  ? '' : 'ml-10px'"
                            id="createtask_driver"
                            @click.stop="createTask = !createTask,startTaskTour('isTaskTour')"
                        >
                            + {{$t('Projects.new_task')}}
                        </button>
                    </template>
                    <div class="d-flex align-items-center ml-10px cursor-pointer suggest-tasks-cta" :class="[{'pointer-event-none' : isSpinner}]" v-if="checkApps('AI',project) &&
                        checkPermission('task.task_list',project?.isGlobalPermission) === true &&
                        checkPermission('task.task_create',project?.isGlobalPermission) === true">
                        <img :src="aiIcon" class="mr-3px" />
                        <span @click.stop="suggestTask()" class="ai-color font-size-14 font-weight-500 ai-border-bottom" :class="[{'pointer-event-none' : isSpinner}]">{{$t("AI.suggest_tasks")}}</span>
                    </div>
                    <span v-if="showSprintHours" class="sprint-hours ml-10px" @click.stop data-board-hours>
                        <span class="sprint-hours__item" :title="$t('Projects.sprint_planned_hint')">
                            <span class="sprint-hours__label">{{ $t('Projects.sprint_planned') }}</span>
                            <span class="sprint-hours__value">{{ hoursLabel(sprintHours.plannedMinutes) }}</span>
                        </span>
                        <span class="sprint-hours__item" :title="$t('Projects.sprint_logged_hint')">
                            <span class="sprint-hours__label">{{ $t('Projects.sprint_logged') }}</span>
                            <span class="sprint-hours__value">{{ hoursLabel(sprintHours.loggedMinutes) }}</span>
                        </span>
                        <span class="sprint-hours__item" :title="$t('Projects.sprint_overdue_hint')">
                            <span class="sprint-hours__label">{{ $t('Projects.sprint_overdue') }}</span>
                            <span class="sprint-hours__value" :class="{ 'sprint-hours__value--over': sprintHours.overdueMinutes > 0 }">
                                {{ hoursLabel(sprintHours.overdueMinutes) }}
                            </span>
                        </span>
                    </span>
                </div>
            </div>
            <div v-if="!showArchiveVar" class="d-flex align-items-center sharewith__status-toggle" :style="[{paddingTop : clientWidth <=512 ? '15px' : '' }]">
                <div class="position-re mr-10px">
                    <DropDown>
                        <template #button>
                            <a href="#" class="d-flex align-items-center justify-content-center border border-radius-5-px eye__icon-wrapper">
                                <img :src="eyeIcon">
                            </a>
                            <span class="sprint-watcher-count">{{ sprint?.watchers?.length || 0 }}</span>
                        </template>
                        <template #head>
                            <div :class="{'border-bottom' : clientWidth > 767}" :style="`padding: ${clientWidth <= 767 ? 0 : 10}px;`">
                                <InputText
                                    v-model="searchWatcher"
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
                                :key="user._id"
                                :item="user"
                                :class="{ 'selected-watcher': user.isWatcher == true }"
                            >
                                    <div class="d-flex align-items-center justify-content-between w-100">
                                        <div class="d-flex align-items-center" @click="updateWatchers(user._id, 'add')">
                                            <img class="cursor-pointer emp__profile-imgurl"
                                                v-if="!getUser(user._id).Employee_profileImageURL"
                                                :src="user.Employee_profileImage"
                                                alt="userImg"
                                               
                                            >
                                            <WasabiIamgeCompp v-else :userImage="true" :thumbnail="'26x26'" :data="{title:getUser(user._id).Employee_Name, url: getUser(user._id).Employee_profileImageURL}" class="cursor-pointer emp__profile-imgurl"/>
                                            <span 
                                                class="cursor-pointer ml-5px"
                                            >
                                                {{ user.Employee_Name }}
                                            </span>
                                        </div>
                                        <img
                                            class="cursor-pointer"
                                            src="@/assets/images/svg/deletered.svg"
                                            v-if="user.isWatcher && user.isLoggedUser"
                                            @click="updateWatchers(user._id, 'remove')"
                                        />
                                    </div>
                            </DropDownOption>
                        </template>
                    </DropDown>
                </div>
                <div  class="d-flex align-items-center" v-if="checkPermission('project.sprint_type_change',project.isGlobalPermission) === true">
                    <span class="dark-gray font-weight-500" :class="clientWidth <=767 ? 'font-size-11' : 'font-size-12'">{{$t('Projects.share_with')}}:</span>
                    <div class="d-flex align-items-center justify-content-between">
                        <span class="cursor-default share__everyone-private font-size-12 gray81 text-capitalize" :class="clientWidth <=767 ? 'mr-5px ml-5px' : 'ml-10px mr-10px'">{{$t('Projects.everyone')}}</span>
                        <Toggle :modelValue="sprint?.private" inActiveColor="#8591F9" width="20" @click="togglePrivatePublic(!sprint?.private)"/>
                        <span class="cursor-default share__everyone-private font-size-12 gray81 text-capitalize" :class="clientWidth <=767 ? 'ml-5px' : 'ml-10px'">{{$t('Projects.private')}}</span>

                        <Assignee
                            :style="[{marginLeft : clientWidth > 767 ? '35px' : '10px'}]"
                            class="share__with-assignee"
                            v-if="sprint?.private"
                            :users="sprint?.AssigneeUserId || []"
                            :options="project?.isPrivateSpace ? (project?.AssigneeUserId || []) : (companyUsers || [])"
                            :num-of-users="2"
                            imageWidth="20px"
                            @selected="changeAssignee('add', $event.id)"
                            @removed="changeAssignee('remove', $event.id)"
                            :isDisplayTeam="true"
                        />
                    </div>
                </div>
                <div class="ml-10px">
                    <DropDown>
                        <template #button>
                            <img :ref=sprint.id :src="horizontalDots" alt="horizontalDots" class="vertical-middle">
                        </template>
                    <template #options>
                        <DropDownOption @click="$refs[sprint.id].click(), updateItem(0)" v-if="showArchiveVar && sprint?.deletedStatusKey === 2">
                            <div class="d-flex align-items-center project-mobile-desc">
                                <img :src="restore_icon" alt="restore_icon" class="mr-10px">
                                {{$t('Projects.restore')}}
                            </div>
                        </DropDownOption>
                        <DropDownOption
                            v-if="canRunScrum && scrumState === 'planned'"
                            @click="$refs[sprint.id]?.click(), startSprint()"
                        >
                            <div class="d-flex align-items-center project-mobile-desc">
                                <img :src="sprintStartIcon" alt="start sprint" class="mr-10px">
                                {{ $t('Scrum.start_sprint') }}
                            </div>
                        </DropDownOption>
                        <DropDownOption
                            v-if="canRunScrum && (scrumState === 'active' || scrumState === 'overdue')"
                            @click="$refs[sprint.id]?.click(), showCompleteSprint = true"
                        >
                            <div class="d-flex align-items-center project-mobile-desc">
                                <img :src="sprintCompleteIcon" alt="complete sprint" class="mr-10px">
                                {{ $t('Scrum.complete_sprint') }}
                            </div>
                        </DropDownOption>
                        <DropDownOption
                            v-if="canRunScrum"
                            @click="$refs[sprint.id]?.click(), showSprintSetup = true"
                        >
                            <div class="d-flex align-items-center project-mobile-desc">
                                <img :src="sprintSetupIcon" alt="sprint settings" class="mr-10px">
                                {{ scrumState === 'none' ? $t('Scrum.make_it_a_sprint') : $t('Scrum.sprint_settings') }}
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="$refs[sprint.id]?.click(), showSidebar = true, archive = true" v-if="!showArchiveVar">
                            <div class="d-flex align-items-center project-mobile-desc">
                                <img :src="inventoryIcon" alt="inventoryIcon" class="mr-10px">
                                {{$t('Projects.archive')}}
                            </div>
                        </DropDownOption>
                        <DropDownOption @click="$refs[sprint.id]?.click(), showMoveToFolder = true" v-if="!showArchiveVar && !sprint.isFolder && folderList.length">
                            <div class="d-flex align-items-center project-mobile-desc">
                                <img :src="folder" alt="folder" class="mr-10px" style="width: 16px;">
                                {{$t('Projects.move_to_folder')}}
                            </div>
                        </DropDownOption>
                    <DropDownOption @click="$refs[sprint.id]?.click(), showSidebar = true, archive = false">
                        <div class="d-flex align-items-center project-mobile-desc mobile-deleteIcon red">
                            <img :src="deleteIcon" alt="deleteIcon" class="mr-10px">
                            {{$t('Projects.delete')}}
                        </div>
                    </DropDownOption>
                    </template>
                    </DropDown>
                </div>
            </div>
        </div>
        <div>
            <ImportTaskButton 
                :showImportModal="showImportModal"
                :projectId="project?._id"
                :taskStatus="project?.taskStatusData"
                :users="project?.isPrivateSpace ? (project?.AssigneeUserId || []) : (companyUsers || [])"
                :sprint="sprint"
                @toggle-import-modal="showImportModal = false"
            />
        </div>
        <Transition>
            <div v-if="sprint.isExpanded">
                <CreateTask
                    v-if="createTask && checkPermission('task.task_create',project.isGlobalPermission) === true && checkPermission('task.task_list',project.isGlobalPermission) == true"
                    :sprint="sprint"
                    :assigneeOptions="project.AssigneeUserId"
                    :startDate="modalStartDate"
                    :endDate="modalEndDate"
                    @cancel="createTask = false"
                    @submit="taskSubmit"
                    :groupBy="groupType"
                    :groupType="groupType"
                />
                <div v-if="taskListAi && taskListAi.length">
                    <div class="ai-generated-task-div">
                        <div v-for="(sub,index) in taskListAi" :key="index" class="border-bottom px-1 subtask__item-input d-flex align-items-center">
                            <img :src="aiIcon" class="mr-3px" />
                            <label class="d-flex align-items-center font-weight-400 font-size-13">
                                {{sub.title}}
                            </label>
                            <input type="checkbox" v-model="sub.isSelected" @click="handleChecked(sub)" class="ml-auto" />
                        </div>
                    </div>
                    <div class="d-flex justify-content-end p15x-0px">
                        <button v-if="taskListAi.length" class="outline-primary mr-10-px font-size-16 font-weight-400" @click="taskListAi = []">{{$t('Projects.cancel')}}</button>
                        <button v-if="taskListAi.filter((x) => x.isSelected===true).length" class="btn-primary mr-10-px font-size-16 font-weight-400" @click="createTaskWithAi()">{{`Create ${taskListAi.filter((x) => x.isSelected===true).length} Task`}}</button>
                    </div>
                </div>
                <div v-if="isSpinner">
                    <Skelaton v-for="i in 5" :key="i" class="border-radius-5-px skelaton__option m-5px border-bottom"/>
                </div>
                <span v-if="isError" class="red">{{$t('Toast.something_went_wrong')}}</span>
                <div v-if="boardSurfaceKind === 'loading'" class="board-load-strip">
                    <p class="board-load-strip__line">{{ $t('EmptyState.board_loading') }}</p>
                </div>
                <EmptyState
                    v-else-if="boardSurfaceKind === 'failed' || boardSurfaceKind === 'empty'"
                    :title="boardSurfaceKind === 'failed' ? $t('EmptyState.load_failed_title') : $t('EmptyState.no_sprint_tasks_title')"
                    :message="boardSurfaceKind === 'failed' ? $t('EmptyState.load_failed_msg', { count: boardExpectedCount }) : ''"
                    :actionLabel="boardSurfaceKind === 'failed' ? $t('EmptyState.load_failed_action') : $t('EmptyState.no_sprint_tasks_action')"
                    :tone="boardSurfaceKind === 'failed' ? 'copper' : 'pine'"
                    @action="onBoardSurfaceAction"
                />
                <div v-else class="itemSprintWrapper style-scroll-6-px" id="tasklist_driver">
                    <template v-if="$route?.query?.tab !== 'Calendar'">
                        <ItemList
                            v-for="(item,index) in sprint.items"
                            :statusIndex="index"
                            :key="item.key"
                            :item="item"
                            :sprintId="sprint?.id"
                            :projectId="project._id"
                            :groupType="groupType"
                            :commonDateFormatForDate="commonDateFormatForDate"
                            @toggle="item.isExpanded = !item.isExpanded"
                            :project="project"
                            :sprintObject="sprint"
                        />
                    </template>
                    <template v-else>
                        <CalendarViewComponent
                            :projectData="project"
                            :sprint="sprint"
                            :newTaskData="newTaskData"
                            :calendarDate="initialDate"
                            @openTaskModel="openTaskModel"
                        />
                    </template>
                </div>
            </div>
        </Transition>

        <ConfirmationSidebar
            v-model="showSidebar"
            :title="`${close ? $t('Projects.close') : archive ? $t('Projects.archive') : $t('Projects.delete')}`"
            :message="close ? $t('conformationmsg.sprintclosemsg') : archive ? $t('conformationmsg.archive') : $t('conformationmsg.delete')"
            :confirmationString="`${close ? 'close' : archive ? 'archive' : 'delete'}`"
            :acceptButtonClass="archive && !close ? 'btn-primary': 'btn-danger'"
            :acceptButton="`${close ? $t('Projects.close') : archive ? $t('Projects.archive') : $t('Projects.delete')}`"
            @confirm="updateItem()"
            :showSpinner="showSpinner"
            @selected="changeAssignee('add', $event.id)"
            @removed="changeAssignee('remove', $event.id)"
        />
        <MoveToFolderModal
            v-model="showMoveToFolder"
            :folders="folderList"
            :currentFolderId="sprint.folderId"
            @select="moveToFolder"
        />
        <SprintSetupModal
            v-if="showSprintSetup"
            :sprint="sprint"
            @close="showSprintSetup = false"
            @saved="onSprintSaved"
        />
        <CompleteSprintModal
            v-if="showCompleteSprint"
            :sprint="sprint"
            :siblings="siblingSprints"
            @close="showCompleteSprint = false"
            @completed="onSprintCompleted"
        />
        <SpinnerComp :is-spinner="isCreateSpinner" />
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineComponent, defineEmits, defineProps, inject, onMounted, onUnmounted, ref, unref, watch} from 'vue';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import { useToast } from 'vue-toast-notification';

// COMPONENTS
import WasabiIamgeCompp from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';
import ItemList from '../ItemList/ItemList.vue';
import InputText from '@/components/atom/InputText/InputText.vue';
import CreateTask from "@/components/atom/CreateTask/CreateTask.vue"
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import Toggle from "@/components/atom/Toggle/Toggle.vue"
import Assignee from "@/components/molecules/Assignee/Assignee.vue"
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
import MoveToFolderModal from "@/components/molecules/MoveToFolder/MoveToFolderModal.vue"
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import SprintStateChip from "@/components/molecules/SprintScrum/SprintStateChip.vue"
import SprintSetupModal from "@/components/molecules/SprintScrum/SprintSetupModal.vue"
import CompleteSprintModal from "@/components/molecules/SprintScrum/CompleteSprintModal.vue"
import CalendarViewComponent from '@/views/Projects/ProjectCalendarView/CalendarViewComponent.vue';
import Skelaton from "@/components/atom/Skelaton/AiSkelaton.vue"
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp'
import * as env from '@/config/env';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { apiRequest } from '../../../services'
import { boardHoursVisible, sprintTasksBucket } from '@/utils/taskOpenProjectId';
import { useAiApiFunction } from "@/composable/aiHelper";
import taskClass from "@/utils/TaskOperations"
import { useI18n } from "vue-i18n";
const { t } = useI18n();

// UTILS
const project = inject("selectedProject");
const searchedTask = inject("searchedTask");
const clientWidth = inject("$clientWidth");
const boardSurfaceKind = inject('boardSurfaceKind', computed(() => 'loading'));
const boardExpectedCount = inject('boardExpectedCount', computed(() => 0));
const onBoardSurfaceAction = inject('onBoardSurfaceAction', () => {});
const { checkPermission, debouncerWithPromise, checkApps} = useCustomComposable();
const showArchiveVar = inject("showArchived");
const companyId = inject("$companyId");
const userId = inject("$userId");
const modalStartDate = ref(null);
const modalEndDate = ref(null);
const initialDate = ref(0);
const $toast = useToast();
const {getters, commit} = useStore();
const route = useRoute()
const {getUser} = useGetterFunctions()
const {generateAiRequestForFunction} = useAiApiFunction();
const mainTour = inject("$mainTour");

// IMAGES
const triangleBlack = require('@/assets/images/svg/triangleBlack.svg');
const folder = require('@/assets/images/folder.png');
const eyeIcon = require('@/assets/images/svg/PriorityIcon/watchProjectEye.svg');
const inventory_2 = require('@/assets/images/inventory_2.png');
const horizontalDots = require("@/assets/images/svg/horizontalDots.svg");
const aiIcon = require("@/assets/images/svg/ai_image.svg");
const inventoryIcon = require("@/assets/images/svg/inventoryIcon.svg");
const restore_icon = require("@/assets/images/svg/restore_icon.svg");
const sprintSetupIcon = require("@/assets/images/svg/sprintSetup.svg");
const sprintStartIcon = require("@/assets/images/svg/sprintStart.svg");
const sprintCompleteIcon = require("@/assets/images/svg/sprintComplete.svg");
const deleteIcon = require("@/assets/images/svg/deleteIcon.svg");

defineComponent({
    name: "SprintsList",
    
    components: {
        ItemList,
        CreateTask,
        DropDown,
        DropDownOption,
        Toggle,
        Assignee,
        ConfirmationSidebar,
        MoveToFolderModal
    }
})

defineEmits(['change']);

const props = defineProps({
    sprint: Object,
    groupType: Number,
    commonDateFormatForDate: String,
    calendarDate: Number
})

const sprintHours = ref({ plannedMinutes: 0, loggedMinutes: 0, overdueMinutes: 0 });
const currentCompanyForHours = computed(() => getters["settings/selectedCompany"]);
const showSprintHours = computed(() => boardHoursVisible(unref(boardSurfaceKind))
    && !!currentCompanyForHours.value?.planFeature?.timeEstimateProjectApp
    && checkPermission('task.task_list', project.value?.isGlobalPermission) === true);

const hoursLabel = (minutes) => {
    const total = Number(minutes) || 0;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${h.toString().padStart(2, "0")}h ${m.toString().padStart(2, "0")}m`;
};

const loadSprintHours = () => {
    if (!showSprintHours.value || !props.sprint?.id) return;
    apiRequest("post", `${env.SPRINT_HOURS}`, { sprintId: props.sprint.id })
        .then((res) => {
            const d = res?.data?.data;
            if (d) sprintHours.value = d;
        })
        .catch(() => {
            // A failed count must not blank numbers that were right a moment ago.
        });
};

// Re-count when this sprint's tasks change — an estimate edited, time logged, a task
// added, moved or deleted. Debounced because a bulk change fires this once per task.
let hoursTimer = null;
const refreshSprintHours = () => {
    clearTimeout(hoursTimer);
    hoursTimer = setTimeout(loadSprintHours, 600);
};
watch(() => sprintTasksBucket(getters["projectData/tasks"], project.value?._id, props.sprint?.id)?.tasks,
    refreshSprintHours, { deep: true });
onMounted(loadSprintHours);
onUnmounted(() => clearTimeout(hoursTimer));

watch(route, () => {
    if (createTask.value) {
        createTask.value = false;
        modalStartDate.value = null;
        modalEndDate.value = null;
    }
})
const companyUsers = computed(() => {
    return getters["settings/companyUsers"]?.map((x) => x.userId)
})

const companyOwner = computed(() => {
    return getters["settings/companyOwnerDetail"];
})

const companyOwnerId = computed(() => getters["settings/companyOwnerDetail"]?.userId)

const createTask = ref(false);
const assigneeInProgress = ref(false);
const showSpinner = ref(false);
const archive = ref(false);
const close = ref(false);
const showSidebar = ref(false);
const newTaskData = ref({});
const searchWatcher = ref("");
const watcherUsers = ref([]);
const timer = ref(null);
const taskListAi = ref([]);
const isSpinner = ref(false);
const isCreateSpinner = ref(false);
const isError = ref(false);
const showImportModal = ref(false);
const showMoveToFolder = ref(false);
const showSprintSetup = ref(false);
const showCompleteSprint = ref(false);

// --- Scrum lifecycle ----------------------------------------------------------
//
// Mirrors deriveState in Modules/Sprints/scrumRules.js. 'none' means a plain list,
// which is every sprint until somebody opts one in, so none of this appears for a
// project that is not running Scrum.
const scrumState = computed(() => {
    const s = props.sprint || {};
    if (s.isScrum !== true) return 'none';
    const stored = String(s.state || '');
    if (stored === 'closed') return 'closed';
    if (stored !== 'active') return 'planned';
    const end = s.endDate ? new Date(s.endDate) : null;
    return end && !Number.isNaN(end.getTime()) && end.getTime() < Date.now() ? 'overdue' : 'active';
});

// A folder, a chat channel and the backlog are not sprints. Gated on the same
// permission the server gates the lifecycle endpoints on.
const canRunScrum = computed(() => !props.sprint?.isFolder
    && props.sprint?.mainChat !== true
    && !props.sprint?.isBacklog
    && !showArchiveVar.value
    && scrumState.value !== 'closed'
    && checkPermission('project.project_sprint_create', project.value?.isGlobalPermission) === true);

// Every other sprint in this project, so "where should the unfinished work go"
// can offer somewhere real. Foldered sprints live in their own bucket.
const siblingSprints = computed(() => {
    const root = Object.values(project.value?.sprintsObj || {});
    const foldered = Object.values(project.value?.sprintsfolders || {})
        .flatMap((folder) => Object.values(folder?.sprintsObj || {}));
    return [...root, ...foldered];
});

const applySprintChange = (updated) => {
    if (!updated) return;
    commit('projectData/mutateSprints', { op: 'modified', data: { ...updated, id: updated._id } });
};

const onSprintSaved = (updated) => applySprintChange(updated);

// Unfinished work has just moved into another sprint, so that sprint's task
// count is stale in the store. Re-read the project's sprints and commit each as
// a modification — mutateSprints ignores an 'added' op for a sprint it already
// holds, so re-running the usual load would not refresh anything.
const refreshSprintCounts = async () => {
    try {
        const res = await apiRequest('get', `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${project.value?._id}?collection=sprints`);
        (res?.data || []).forEach((row) => {
            commit('projectData/mutateSprints', { op: 'modified', data: { ...row, id: row._id } });
        });
    } catch (error) {
        // The counts stay stale until the next load. Not worth an error toast on
        // top of a sprint that completed successfully.
        console.error('ERROR in refresh sprint counts: ', error);
    }
};

const onSprintCompleted = async (updated) => {
    applySprintChange(updated);
    await refreshSprintCounts();
};

const startSprint = async () => {
    try {
        const res = await apiRequest('post', '/api/v2/sprints/start', { sprintId: props.sprint?.id });
        if (!res?.data?.status) {
            $toast.error(res?.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
            return;
        }
        $toast.success(t('Scrum.sprint_started'), { position: 'top-right' });
        applySprintChange(res.data.data);
    } catch (error) {
        $toast.error(error?.message || t('Toast.something_went_wrong'), { position: 'top-right' });
    }
};

// LIST OF FOLDERS A SPRINT CAN BE MOVED INTO (excludes deleted folders + the sprint's own id when it is a folder)
const folderList = computed(() => {
    return Object.values(project.value?.sprintsfolders || {})
        .filter((f) => !f?.deletedStatusKey && (f?.folderId || f?._id) !== props.sprint?.id)
        .map((f) => ({ id: f.folderId || f._id, name: f.name || f.folderName || '' }));
})

// MOVE SPRINT INTO A FOLDER (or back to root when folder is null)
function moveToFolder(folder) {
    // CAPTURE THE BUCKET THE SPRINT IS LEAVING (null = root) BEFORE THE PATCH MUTATES IT
    const oldFolderId = props.sprint?.folderId || null;
    updateSprintAPICALL({
        $set: {
            folderId: folder ? folder.id : null,
            folderName: folder ? folder.name : ''
        }
    }, { type: 'moved' }, oldFolderId);
    showMoveToFolder.value = false;
}


watch(props.sprint, (val) => {
    if(val.isExpanded === false && createTask.value === true) {
        createTask.value = false;
    }
})
watch([() => props.calendarDate], (data) => {
    if (data && data.length) {
        const selectedDate = data[0];
        if (selectedDate) {
            initialDate.value = new Date(selectedDate).getTime()
        } else {
            initialDate.value = new Date().getTime()
        }
    } else {
        initialDate.value = new Date().getTime()
    }
})
const openTaskModel = (data) => {
    createTask.value = true;
    modalStartDate.value = data.modalStartDate;
    modalEndDate.value = data.modalEndDate;
}
const taskSubmit = (taskData) => {
    const data = taskData.data;
    newTaskData.value = data;
}
function getUserData() {
    const user = getUser(userId.value);
    const userData = {
        id: user._id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: user.companyOwnerId,
    }

    return userData;
}

function updateItem(value = null) {
    showSpinner.value = true;

    let obj = {};
    let updatedValue = '';
    if(props.sprint.isFolder) {
        obj.$set = {deletedStatusKey: value !== null ? value : archive.value ? 2 : 1}
        updatedValue = value !== null ? value : archive.value ? 2 : 1
    } else {
        obj.$set = {deletedStatusKey: value !== null ? value : close.value ? 5 : archive.value ? 2 : 1};
        updatedValue = value !== null ? value : close.value ? 5 : archive.value ? 2 : 1
    }

    const userData = getUserData();

    const axiosData = {
        type: !props.sprint.isFolder ? "updateSprint" : "updateFolder",
        companyId: companyId.value,
        projectId: project.value._id,
        folderId: props.sprint.isFolder ? props.sprint.folderId : props.sprint.id,
        updateObject: {
            ...obj
        },
        updatedValueDeleteStatusKey: updatedValue,
        userData,
        sprintName: !props.sprint.isFolder ? props.sprint.name : null,
        projectData: {
            id: project.value._id,
            ProjectName: project.value.ProjectName
        },
        folderName: props.sprint.isFolder ? props.sprint?.name : "",
    }

    if (props.sprint.isFolder) {
        axiosData.sprints = Object.values(props.sprint.archivedSprintList).filter((x) => !x.deletedStatusKey || x.deletedStatusKey === 6)?.map((x) => x.id)
    }
    let reqUrl = env.SPRINT+"/"+props.sprint.id;
    if (props.sprint.isFolder) {
        reqUrl = env.FOLDER+"/"+props.sprint.id;
    }
    apiRequest("patch", reqUrl, axiosData)
    .then((res) => {
        // A refusal arrives as HTTP 200 with status:false. Committing its empty
        // `data` blanks the row in the store, and the success toast below would
        // then report the opposite of what happened.
        if (res?.data?.status === false) {
            close.value = false;
            showSidebar.value = false;
            showSpinner.value = false;
            $toast.error(res?.data?.statusText || t(`Toast.something_went_wrong`), {position: "top-right"});
            return;
        }
        if (props.sprint.isFolder) {
            commit("projectData/mutateFolders",{op:'modified',data:{...res?.data?.data}});
        }
        else{
            commit("projectData/mutateSprints",{op:'modified',data:{...res?.data?.data}});
        }
        $toast.success(t(`Toast.${props.sprint.isFolder ? 'Folder' : 'Sprint'} ${value !== null ? 'restored' : close.value ? 'closed' : archive.value ? 'archived' : 'deleted'} successfully`), {position: "top-right"})
        showSidebar.value = false;
        showSpinner.value = false;
        close.value = false;
    })
    .catch((error) => {
        close.value = false;
        showSidebar.value = false;
        showSpinner.value = false;
        $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"});
        console.error("ERROR in updateItem: ", error);
    })
}

// CHANGE ASSIGNEE OF PRIVATE SPRINTS
function togglePrivatePublic(value = true) {
    if(assigneeInProgress.value) return;
    assigneeInProgress.value = true;

    let updateData = {};
    if(value) {
        updateData.$addToSet = {
            'AssigneeUserId': userId.value,
        }
        updateData.$set = {
            'private': value,
        }
    } else {
        updateData.$set = {
            'AssigneeUserId': [],
            'private': value,
        }
    }
    let obj = {
        type : value === true ? 'private' : 'public',
    }

    updateSprintAPICALL(updateData,obj);
}
// CHANGE ASSIGNEE OF PRIVATE SPRINTS
function changeAssignee(type, uid) {
    if(assigneeInProgress.value) return;
    assigneeInProgress.value = true;

    let updateData = {};
    if(type === "add") {
        if(!props.sprint?.AssigneeUserId?.includes(uid)) {
            updateData.$addToSet = {
                'AssigneeUserId': uid,
                'watchers': uid
            }
        }
    } else {
        if(props.sprint?.AssigneeUserId?.includes(uid)) {
            updateData.$pull = {
                AssigneeUserId: uid,
                watchers: uid
            }

            if(props.sprint?.AssigneeUserId?.length === 1) {
                updateData.$set = {
                    private: false
                }
            }
        }
    }
    let obj = {
        type : type === 'add' ? 'added' : 'removed',
        userName : getUser(uid)?.Employee_Name
    }

    updateSprintAPICALL(updateData,obj)
}
// RELOCATE THE SPRINT BETWEEN BUCKETS ON THE STORE, THEN RE-TRIGGER THE LIST GROUPING WATCHER
function relocateSprintLive(sprint, oldFolderId) {
    if(!sprint) return;
    const pid = sprint.projectId || project.value?._id;
    commit('projectData/relocateSprint', { data: sprint, oldFolderId: oldFolderId || null });
    // selectedProject is provided as a ref; reassigning .value re-runs the (non-deep) sprint grouping watcher in Projects.vue
    const relocated = getters['projectData/projects']?.data?.find((p) => p._id === pid);
    if(relocated) {
        project.value = relocated;
    }
}

// CALL SPRINT UPDATE
function updateSprintAPICALL(updateData = null,historyObj, oldFolderId = undefined) {
    if(updateData) {
        try {
            const userData = getUserData();
            apiRequest("patch", `${env.SPRINT}/${props.sprint?.id ? props.sprint?.id : props.sprint?._id}`, {
                companyId: companyId.value,
                projectId: project.value._id,
                folderId: props.sprint?.folderId || null,
                type: "updateSprint",
                updateObject: updateData,
                userData,
                sprintName: !props.sprint.isFolder ? props.sprint.name : null,
                projectData: {
                    id: project.value._id,
                    ProjectName: project.value.ProjectName
                },
                folderName: props.sprint.isFolder ? props.sprint?.folderName : "",
                historyData : historyObj
            })
            .then((resp) => {
                if(resp.data.status) {
                    commit('projectData/mutateSprints', {op: "modified", data: resp.data.data});
                    // RE-GROUP LIVE WHEN THIS WAS A FOLDER MOVE (root<->folder / folder<->folder)
                    if(historyObj?.type === 'moved') {
                        relocateSprintLive(resp.data.data, oldFolderId);
                    }
                    // let historyObj = {
                    //     message: `<b>${userData.Employee_Name}</b> has ${type} <b>${props.sprint.name}</b> sprint ${props.sprint?.folderId === null ? '' : `in <b>${props.sprint.isFolder ? props.sprint?.folderName : ""}</b> folder`} in <b>${project.value.ProjectName}</b> project.`,
                    //     key: "project_sprint_removed",
                    //     sprintId: props.sprint.id,
                    // }
                    // apiRequest("post", env.HANDLE_HISTORY, {
                    //     "type": 'project',
                    //     "companyId": companyId.value,
                    //     "projectId": props.projectData._id,
                    //     "taskId": null,
                    //     "object": historyObj,
                    //     "userData": userData
                    // })
                    $toast.success(t(`Toast.Sprint updated successfully`), {position: "top-right"})
                }
                assigneeInProgress.value = false;
            })
            .catch((error) => {
                console.error('ERROR in update Sprint: ', error);
                $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"})
                assigneeInProgress.value = false;
            })
        } catch (error) {
            $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"})
            console.error('ERROR in update Sprint: ', error);
            assigneeInProgress.value = false;
        }
    } else {
        assigneeInProgress.value = false;
    }
}

// WATCHERS
onMounted(() => {
    handleWatcherList();
})
function handleWatcherList() {
    watcherUsers.value = [];
    let allUsers = JSON.parse(JSON.stringify(project.value?.isPrivateSpace ? !props.sprint?.private ? (project.value?.AssigneeUserId || []) : (props.sprint?.AssigneeUserId || []) : companyUsers.value));

    if(!allUsers.includes(companyOwnerId.value)) {
        allUsers.push(companyOwnerId.value);
    }

    if(props.sprint?.watchers?.length) {
        props.sprint.watchers.forEach(element => {
            if (!getUser(element).ghostUser) {
                watcherUsers.value.push({
                    ...getUser(element),
                    isWatcher: true,
                    isLoggedUser: element === userId.value
                });
            }
        });
    } else {
        if (!getUser(userId.value).ghostUser) {     
            watcherUsers.value = [{
                ...getUser(userId.value),
                isWatcher: false,
                isLoggedUser: true
            }];
        }
    }

    allUsers.forEach((uid) => {
        if(!watcherUsers.value.filter((x) => x.id === uid).length) {
            if (!getUser(uid).ghostUser) {  
                watcherUsers.value.push({
                    ...getUser(uid),
                    isWatcher: false,
                    isLoggedUser: true
                });
            }
        }
    })
}
watch(() => props.sprint?.watchers, () => {
    handleWatcherList();
})

const filteredWatchers = computed(() => {
    if(searchWatcher.value) {
        return watcherUsers.value.filter(user => user.Employee_Name.toLowerCase().includes(searchWatcher.value.toLowerCase()));
    } else {
        return watcherUsers.value;
    }
});

function debouncer(timeout = 1000) {
    return new Promise((resolve) => {
        if(timer.value) {
            clearTimeout(timer.value);
        }
        timer.value = setTimeout(() => {
            resolve();
        }, timeout);
    })
}
function updateWatchers(uid, type) {
    debouncer().then(()=>{
        if(uid !== userId.value ||(type == 'add' && props.sprint?.watchers?.includes(uid)) || (type == 'remove' && !props.sprint?.watchers?.includes(uid))) return;
        let updateObj = {};
        if(type == 'add') {
            updateObj.$addToSet = {
                watchers: uid
            }
        } else if(type == 'remove') {
            updateObj.$pull = {
                watchers: uid
            }
        }
        updateSprintAPICALL(updateObj);
    })
}

function suggestTask () {
    if(!isSpinner.value){
        taskListAi.value = [];
        isSpinner.value = true;
        debouncerWithPromise(1000).then(() => {
            isError.value = false;
            let data = {
                userId: userId.value,
                uniqueUserId: userId.value,
                companyId: companyId.value
            }
            generateAiRequestForFunction(data,project.value.ProjectName,project.value.rawDescription,'Create Task',true,'single',project.value?.isGlobalPermission).then((result) => {
                if(result.status === true){
                    try {
                        isSpinner.value = false;
                        taskListAi.value = JSON.parse(JSON.stringify(result.statusText.data.statusText));
                        taskListAi.value = taskListAi.value.replace(/\n|\r/g, '').trim();
                        taskListAi.value = eval(taskListAi.value);
                        if(isArrayOfObjects(taskListAi.value) == true){
                            taskListAi.value = eval(taskListAi.value).map((x) => ({...x,isSelected: true}));
                        }else{
                            isSpinner.value = false;
                            isError.value = true;
                            taskListAi.value = [];
                        }
                    } catch (error) {
                        isSpinner.value = false;
                        isError.value = true;
                        console.error(error,"ERROR IN GENERAE PROMPTS:");
                    }
                }else{
                    if(result.isReachedLimit){
                        $toast.error(t("Toast.Ai_limit_reached"),{position: 'top-right'});
                    }else if(result.isNotAi){
                        $toast.error(result.statusText,{position: 'top-right'});
                    }
                    isSpinner.value = false;
                }
            }).catch((error) => {
                isSpinner.value = false;
                isError.value = true;
                console.error(error,"ERROR IN GENERAE PROMPTS:");
            })
        })
    }
}


function createTaskWithAi () {
    let array = taskListAi.value.filter((data) => data.isSelected);
    if(array.length > 0){
        isCreateSpinner.value = true;
        taskListAi.value = [];
        let sprintObj = {
            id: props.sprint._id,
            name: props.sprint.name,
        }
        if(props.sprint.folderId){
            sprintObj.folderId = props.sprint.folderId;
            sprintObj.folderName = props.sprint.folderName;
        }

        const projectData = {
            _id: project.value._id,
            CompanyId: companyId.value,
            lastTaskId: project.value.lastTaskId,
            ProjectName: project.value.ProjectName,
            ProjectCode: project.value.ProjectCode
        }
        const user = getUser(userId.value)
        const userData = {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: companyOwner.value.userId,
        }
        taskClass.createSubTaskWithAi({
            companyId:companyId.value,
            userId: userId.value,
            subTitles: array,
            sprintObj: sprintObj,
            projectData: projectData,
            userData:userData,
            parentTask: {ProjectID: project.value._id},
            type: 'task'
        })
        .then((res) => {
            if(res.status === true){
                let taskArray = res.data;
                const showAllTasks = true;
                const pid = project.value._id;
                const sprintId = props.sprint._id;
                let snap = props.sprint._id;

                taskArray.forEach((x)=>{
                    commit("projectData/mutateUpdateFirebaseTasks",{
                        snap, 
                        op: "added",
                        pid,
                        sprintId,
                        data: x,
                        showAllTasks,
                        updatedFields: x,
                    });
                })
                isCreateSpinner.value = false;
                $toast.success(t(`Toast.task_created_successfully`), {position: "top-right"});
            }
        })
        .catch((error) => {
            isCreateSpinner.value = false;
            console.error("ERROR in create task: ", error);
        })
    }else{
        $toast.error(t(`Toast.Please_Select_Task`), {position:"top-right"});
    }

}

function handleChecked (item) {
    item.isChecked = !item.isChecked;
}

function isArrayOfObjects(arr) {
  if (!Array.isArray(arr)) {
    return false;
  }

  return arr.every(item => item !== null && typeof item === 'object');
}

function startTaskTour(key) {
    try {
        mainTour.value.handleTour(key);
    } catch (error) {
        console.error("ER: ", error);
    }
}

</script>

<style>
/* Sprint hours. Quiet by design: they sit beside "+ New Task" and the AI CTA, and they
   are figures to glance at, not actions — so no accent colour and no pointer. One pill
   holding three readings rather than three pills, so the row stays calm. */
/* The header runs out of room long before the viewport does — the sprint name,
   New Task, Suggest tasks and this chip share one capped column. It used to be
   rigid (flex: 0 0 auto + nowrap), so instead of giving way it overflowed and
   sat on top of the Share With controls. It now shrinks, and drops onto its own
   line when there is genuinely no room, which is the honest failure mode. */
.sprint-head-actions {
    flex-wrap: wrap;
    row-gap: 6px;
    min-width: 0;
}

.sprint-hours {
    display: inline-flex;
    align-items: baseline;
    gap: 12px;
    flex: 0 1 auto;
    max-width: 100%;
    padding: 2px 10px;
    border-radius: 11px;
    background: #f0f2f7;
    font-size: 12px;
    line-height: 1.5;
    white-space: nowrap;
    cursor: default;
}
.sprint-hours__item { display: inline-flex; align-items: baseline; gap: 5px; }
/* Label recedes, number carries — so each pair scans as "Planned 43h" rather than as two
   competing pieces of text. */
.sprint-hours__label { color: #8a909c; font-weight: 500; }
.sprint-hours__value { color: #5b6472; font-weight: 600; font-variant-numeric: tabular-nums; }
/* An overrun is the one figure here worth colouring — same amber the task list uses. */
.sprint-hours__value--over { color: #b45309; }

/* Narrow screens keep the numbers and drop the words. Each item already has a
   title attribute, so nothing becomes unexplainable — and three labelled pairs
   is the single widest thing in this header. */
@media (max-width: 767px) {
    .sprint-hours { gap: 10px; padding: 2px 8px; }
    .sprint-hours__label { display: none; }
}
.v-enter-active,
.v-leave-active {
  transition: all 0.2s ease;
}
.v-enter-from,
.v-leave-to {
  opacity: 0;
}
.sprint__foldername{
    top: -10px;
    left: 10px;
}
.eye__icon-wrapper{
    height: 30px; 
    width: 30px;
}
.emp__profile-imgurl{
    width: 30px; 
    height: 30px;
    border-radius: 30px;
    border: 2px solid #fff;
}
.ai-generated-task-div{
    border: 1px solid #DFE1E6;
}
/* Hide the per-sprint "Suggest Tasks" AI CTA in the list view.
   !important is required: the element also carries the `d-flex` utility
   (display: flex), which has the same specificity (one class, no !important).
   In the production CSS bundle `.d-flex` lands later and re-shows the button,
   even though the component style wins in dev hot-reload. */
.suggest-tasks-cta{
    display: none !important;
}
.board-load-strip {
    background: var(--kiln-paper, #f4ead8);
    border: 1px solid var(--kiln-line, #d8cbb3);
    border-radius: var(--kiln-radius-sm, 9px);
    padding: 12px 16px;
    margin: 8px 0 4px;
}
.board-load-strip__line {
    margin: 0;
    font-family: var(--kiln-font-display), Georgia, serif;
    font-size: 15px;
    font-weight: 600;
    color: var(--kiln-ink, #1b2f28);
}

</style>
<style scoped src="./style.css"></style>