<template>
    <div class="kanban-card-wrapper">
        <div @click.stop.prevent="!showArchiveVar ? toggleTaskDetail(element) : ''">
            <div>
                <div class="d-flex justify-content-between">
                    <div class="d-flex align-items-start card-title-row">
                        <label
                            v-if="canCardMultiSelect"
                            class="kanban-card-multi-select"
                            :class="{ 'kanban-card-multi-select--active': isCardSelected }"
                            @click.stop
                            @mousedown.stop
                        >
                            <input
                                type="checkbox"
                                :checked="isCardSelected"
                                @click.stop="handleCardCheckboxChange($event)"
                                @keydown.shift.stop="handleCardCheckboxChange($event)"
                                @mousedown.stop
                                :aria-label="$t('Common.select_task_named', { name: element.TaskName })"
                            />
                        </label>
                        <div
                            class="card-title font-weight-500 ml-5px"
                            :title="element.TaskName"
                            role="button"
                            tabindex="0"
                            @keydown.enter.self.prevent="!showArchiveVar ? toggleTaskDetail(element) : ''"
                            @keydown.space.self.prevent="!showArchiveVar ? toggleTaskDetail(element) : ''"
                        >
                            <span v-if="taskKey" class="card-key">{{ taskKey }}</span>
                            <img v-if="element.deletedStatusKey === 2" :src="inventoryIcon" alt="inventory" class="ml-5px" />
                            <img v-if="element.deletedStatusKey === 1" :src="deleteIcon" alt="delete" class="ml-5px" />
                            {{ element.TaskName }}
                        </div>
                    </div>
                    <Transition>
                        <div class="option-list" id="modelListComponent">
                            <DropDown :title="element.TaskName" v-if="showArchiveVar ? element.deletedStatusKey === 2 : element.deletedStatusKey === 0">
                                <template #button>
                                    <button
                                        type="button"
                                        class="option-list__trigger"
                                        :ref="element.id+'options'"
                                        :title="$t('Projects.task_actions')"
                                        :aria-label="$t('Projects.task_actions')"
                                    >
                                        <img :src="horizontalDots" alt="" aria-hidden="true">
                                    </button>
                                </template>
                                <template #options>
                                    <DropDownOption @click="$refs[element.id+`options`].click(),copyTaskLink()">
                                        <div class="d-flex align-items-center">
                                            <img :src="linkIcon" alt="inventoryIcon" class="mr-10px">
                                            {{$t('ProjectDetails.copy_task_link')}}
                                        </div>
                                    </DropDownOption>
                                    <DropDownOption @click="$refs[element.id+`options`].click(),copyTaskKey()">
                                        <div class="d-flex align-items-center">
                                            <img :src="splitScreen" alt="inventoryIcon" class="mr-10px">
                                            {{$t('ProjectDetails.copy_task_key')}}
                                        </div>
                                    </DropDownOption>
                                    <DropDownOption v-if="element.deletedStatusKey === undefined || element.deletedStatusKey === 0 && checkPermission('task.task_archive',projectData.isGlobalPermission) == true" @click="$refs[element.id+`options`].click(), showSidebar = true, archive = true">
                                        <div class="d-flex align-items-center">
                                            <img :src="inventoryIcon" alt="inventoryIcon" class="mr-10px">
                                            {{$t('Projects.archive')}}
                                        </div>
                                    </DropDownOption>
                                    <DropDownOption v-if="element.deletedStatusKey === 2" @click="$refs[element.id+`options`].click(), updateTask(0)">
                                        <div class="d-flex align-items-center">
                                            <img :src="inventoryIcon" alt="restoreInventoryIcon" class="mr-10px">
                                            {{$t('Projects.restore')}}
                                        </div>
                                    </DropDownOption>
                                    <DropDownOption
                                        @click="$refs[element.id+`options`].click(), showSidebar = true, archive = false"
                                        v-if="checkPermission('task.task_delete',projectData.isGlobalPermission) == true">
                                        <div class="d-flex align-items-center">
                                            <img :src="deleteIcon" alt="deleteIcon" class="mr-10px">
                                            {{$t("Projects.delete")}}
                                        </div>
                                    </DropDownOption>
                                    <DropDownOption @click="$refs[element.id+`options`].click(),convertToSubTask()" v-if="checkPermission('task.sub_task_create',projectData.isGlobalPermission) === true && !showArchiveVar && task?.isParentTask && checkPermission('task.task_convert_to_subtask',projectData.isGlobalPermission) === true">
                                        <div class="d-flex align-items-center">
                                            <img :src="subTaskIcon" alt="deleteIcon" class="mr-10px">
                                            {{$t('ProjectDetails.convert_subtask')}}
                                        </div>
                                    </DropDownOption>
                                    <DropDownOption @click="$refs[element.id+`options`].click(),convertToList()" v-if="checkPermission('project.project_sprint_create',projectData.isGlobalPermission) === true && !showArchiveVar && checkPermission('task.task_convert_to_list',projectData.isGlobalPermission) === true">
                                        <div>
                                            <img :src="combinedIcon" />
                                            <span class="dropdown-label">{{$t('ProjectDetails.convert_list')}}</span>
                                        </div>
                                    </DropDownOption>
                                    <DropDownOption @click="$refs[element.id+`options`].click(),duplicateTask()" v-if="!showArchiveVar && checkPermission('task.task_duplicate',projectData.isGlobalPermission) == true">
                                        <div>
                                            <img :src="copyIcon" class="copyIcon"/>
                                            <span class="dropdown-label">{{$t('Projects.duplicate')}}</span>
                                        </div>
                                    </DropDownOption>
                                    <DropDownOption @click="$refs[element.id+`options`].click(),moveTask()" v-if="!showArchiveVar && checkPermission('task.task_move',projectData.isGlobalPermission) == true">
                                        <div>
                                            <img :src="moveIcon" />
                                            <span class="dropdown-label">{{$t('ProjectDetails.move')}}</span>
                                        </div>
                                    </DropDownOption>
                                    <DropDownOption @click="$refs[element.id+`options`].click(),mergeTask()" v-if="!showArchiveVar && checkPermission('task.task_merge',projectData.isGlobalPermission) == true">
                                        <div>
                                            <img :src="mergeIcon" />
                                            <span class="dropdown-label">{{$t('ProjectDetails.merge')}}</span>
                                        </div>
                                    </DropDownOption>
                                </template>
                            </DropDown>
                        </div>
                    </Transition>
                </div>
                <div class="d-flex mt-10px align-items-center" :class="{'ml--5px' :tagChipArray?.length}" v-if="!showArchiveVar && tagChipArray.length && checkApps('tags')">
                    <!-- Tags -->
                    <div v-for="(item, index) in tagChipArray" :key="index" @click.stop.prevent="">
                        <div v-if="(index < chipCount)" class="tagList">
                            <TagChip  :data="item" :isBorder="false" :prjectGlobalPermission="projectData?.isGlobalPermission"  :ids="ids" :tagsArray="projectData.tagsArray"/>
                        </div>
                        <div v-if="index == chipCount" class="tagcount"> +{{tagChipArray.length - chipCount}} </div>         
                    </div>
                    <div v-if="checkPermission('task.task_tag',projectData?.isGlobalPermission) !== null">
                        <CreateTagPopup :task="element" @send:tagChipArray="(val)=>tagChipArray = val" @send:ids="(val)=>ids = val" :project="projectData" :chipCount="chipCount" :isTaskList="false" />
                    </div>
                </div>
                <div v-if="agentRun" class="agent-strip">
                    <span class="agent-strip__dot"></span>
                    <span class="agent-strip__name">{{ agentRun.agentName }} · {{ runClock }}</span>
                    <span v-if="agentRun.skill" class="agent-strip__meta">{{ agentRun.skill }}</span>
                </div>
                <div v-else-if="agentProposal" class="agent-proposal">
                    <span class="agent-proposal__who">✦ {{ agentProposal.agentName }}:</span> {{ agentProposal.what }}
                    <button type="button" class="agent-proposal__review" @click.stop="openAiInbox()">{{ $t('Projects.review') }}</button>
                </div>
                <div v-if="isTiming || showSplitBadge" class="card-meta">
                    <span v-if="isTiming" class="card-timer">● {{ timerClock }}</span>
                    <ProvenanceBadge v-if="showSplitBadge" :task="element" />
                </div>
                <div class="d-flex justify-content-between mt-10px" :class="{'ml-5px': element.AssigneeUserId.length > 0}">
                    <!-- Assignee -->
                    <div class="card-assignee" :class="{ 'card-assignee--agent': !!agentRun }" v-if="checkPermission('task.task_assignee',projectData?.isGlobalPermission) !== null && (groupValue !== 1 || isSubTask)">
                        <span v-if="agentRun" class="card-assignee__agent" :title="agentRun.agentName" aria-hidden="true">◉</span>
                        <Assignee
                            :users="element.AssigneeUserId"
                            :options="canAssignOthers ? permittedOptions : nonPermittedOptions"
                            :num-of-users="1"
                            imageWidth="25px"
                            :addUser="!showArchiveVar"
                            :buttonLabel="assigneeNames ? $t('List.cell_change', { field: $t('List.assignee'), value: assigneeNames }) : $t('List.cell_set', { field: $t('List.assignee') })"
                            @selected="changeAssignee(checkApps('MultipleAssignees',projectData) ? 'add' : 'replace', $event)"
                            @removed="changeAssignee('remove', $event)"
                            :isDisplayTeam="true"
                            :multiSelect="checkApps('MultipleAssignees')"
                        />
                    </div>
                    <div class="d-flex align-items-center board-view-action-wrapper">
                        <span class="mr-5px date-picker d-flex align-items-center"
                            v-if="showDueDateChip"
                            :class="(myCounts || myParentCounts) > 0 ? 'mr-5px' : ''"
                            :style="`border-radius: ${element?.DueDate ? '5px' : '50%'}; padding: ${element?.DueDate ? '3px 6px' : '6px'};`"
                        >
                            <img class="mr-5px" v-if="element?.DueDate" src="@/assets/images/svg/component-inactive-icons/comp_calender_inactive.svg" />
                            <DueDateCompo
                                v-if="canEditDueDate"
                                id="due-date-task"
                                class="d-flex align-items-center"
                                :displyDate="dueDate? new Date(dueDate) : ''"
                                :disabledDates="element.dueDateDeadLine"
                                @SelectedDate="($event) => updateDueDate($event)"
                                :isWithoutBorderImage="true"
                                :buttonLabel="dueDateText ? $t('List.cell_change', { field: $t('List.due_date'), value: dueDateText }) : $t('List.cell_set', { field: $t('List.due_date') })"
                            />
                            <span v-else>{{ element.DueDate ? convertDateFormat(element.DueDate, '', { showDayName: false }) : '' }}</span>
                        </span>
                        <span class="priority__compo"
                            v-if="(groupValue !== 2 || isSubTask) && checkPermission('task.task_priority',projectData?.isGlobalPermission) !== null && checkApps('Priority')"
                            :class="((element?.subTasks) || (myCounts || myParentCounts) > 0) ? 'mr-5px' : ''"
                        >
                            <Priority
                                :priorityVal="element.Task_Priority"
                                @select="updatePriority"
                                :permission="!showArchiveVar && checkPermission('task.task_priority',projectData?.isGlobalPermission) === true"
                                :showName="true"
                                :buttonLabel="priorityName ? $t('List.cell_change', { field: $t('List.priority'), value: priorityName }) : $t('List.cell_set', { field: $t('List.priority') })"
                            />
                        </span>
                        <span v-if="!isSubTask && element?.subTasks" class="d-flex align-items-center task-count-section" :class="myCounts > 0 ? 'mr-5px' : ''">
                            <img class="mr-5px" src="@/assets/images/png/subTaskShape.png" />
                            <span class="font-size-12" :style="{'color': (element.isExpanded && element?.subtaskArray?.length > 0) ? 'var(--brand)' : ''}">
                                {{(showArchiveVar || searchedTask) ? element?.subtaskArray?.length : element?.subTasks}}
                            </span>
                            <span v-if="myParentCounts > 0" class="sub-task-count">{{myParentCounts > 99 ? "+99" : myParentCounts}}</span>
                        </span>
                        <span class="d-flex align-items-center board-task-comment-count position-re cursor-pointer"
                            v-if="projectData.viewColumn?.find((x)=> x.key === 'commentCounts')?.show && myCounts > 0"
                            @click.stop="!showArchiveVar ? changeRoute() : ''"
                        >
                            <img class="mr-5px" src="@/assets/images/svg/ChatIcon.svg" alt="chatIcon" />
                            <span class="parent-task-count">{{myCounts > 99 ? "+99" : myCounts}}</span>
                        </span>
                    </div>
                </div>
            </div>
            <BoardViewTaskCreate
                v-if="isSubtaskCreate && !showArchiveVar"
                :sprintData="element.sprintArray"
                :data="itemData"
                :taskId="element._id"
                :assigneeOptionsData="element.AssigneeUserId"
                @toggle="isSubtaskCreate = false"
                :isSubTask="true"
            />
            <ConfirmationSidebar
                v-model="showSidebar"
                :title="archive ? $t('Projects.archive_task') : $t('Projects.delete_task')"
                :message="archive ? $t('conformationmsg.archive') : $t('conformationmsg.delete')"
                :confirmationString="archive ? $t('Projects.confirm_word_archive') : $t('Projects.confirm_word_delete')"
                :acceptButtonClass="archive ? 'btn-primary': 'btn-danger'"
                :acceptButton="`${archive ? $t('Projects.archive') : $t('Projects.delete')}`"
                @confirm="updateTask(), showSidebar = false"
            />
            <ConvertToSubTaskSidebar 
                v-if="openConvertSubTaskSidebar === true" :closeSideBar="openConvertSubTaskSidebar"
                @isConvertSubtaskOPen="(val) => {sidebarOPen(val)}" :isMoveTask="openMoveSidebar" 
                :openMoveSubTask="openMoveSubTask" :isMergeTask="openMergeTask" :isDuplicate="duplicateTaskSidebar" 
                :task="element" :isOpenSubTask="openSubTaskSideabr"/>
            <ConvertToList v-if="converrtToListSidebar === true" :openSidebar="converrtToListSidebar" @closeSidebar="(val) => {converrtToListSidebar = val}" :task="element" />
        </div> 
    </div>
</template>
<script setup>
    import {ref,inject,computed,watch,onMounted,onUnmounted} from "vue";
    import { useStore } from "vuex";
    import { useToast } from "vue-toast-notification";
    import { useRoute, useRouter } from "vue-router"
    import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
    import ProvenanceBadge from '@/components/molecules/Provenance/ProvenanceBadge.vue';
    import { isAgentWork } from '@/components/molecules/Provenance/provenance';
    import { useUpdateTasks } from "@/views/Projects/helper"
    import TagChip from '@/components/atom/TagChip/TagChip.vue'
    import Priority from "@/components/molecules/PriorityCompo/PriorityComp.vue"
    import taskClass from "@/utils/TaskOperations";
    import BoardViewTaskCreate from "@/views/Projects/Kanban/BoardViewTaskCreate.vue"
    import Assignee from "@/components/molecules/Assignee/Assignee.vue"
    import {useConvertDate,useCustomComposable,useGetterFunctions } from "@/composable";
    import { useTaskSelection } from "@/composable/useTaskSelection.js";
    import CreateTagPopup from "@/components/molecules/TagList/CreateTagPopup.vue";
    import DropDown from '@/components/molecules/DropDown/DropDown.vue'
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
    import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
    import ConvertToSubTaskSidebar from '@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue';
    import ConvertToList from '@/components/molecules/ConvertToList/ConvertToList.vue';
    import DueDateCompo from '@/components/molecules/DueDateCompo/DueDateCompo.vue';
    import { useI18n } from "vue-i18n";
    import { useTimer } from "@/components/molecules/Home/useTimer";
    import { permittedAssignees, selfAssignable } from "@/utils/assigneeOptions";
    const { t } = useI18n();
    const props = defineProps({
        data: Object,
        groupValue: Number,
        itemData: Object,
        isSubTask: Boolean,
        parentAssignee: Array,
        // 28b: the open run / pending proposal for THIS task, resolved once per
        // board by KanbanBoard so every card does not poll on its own.
        agentRun: { type: Object, default: null },
        agentProposal: { type: Object, default: null }
    })

    const {checkPermission,checkApps} = useCustomComposable();
    const {convertDateFormat} = useConvertDate();
    const showArchiveVar = inject("showArchived");
    const userId = inject('$userId')
    const toggleTaskDetail = inject('toggleTaskDetail')
    const companyId = inject("$companyId");
    const {getters,commit} = useStore();
    const isSubtaskCreate = ref(false);
    const {getUser, getTeam, getPriorities} = useGetterFunctions();
    const projectData = inject("selectedProject");
    const $toast = useToast()
    const tagChipArray = ref([])
    const element = ref(props.data)
    const {updateTaskByGroup} = useUpdateTasks();

    const cardSelection = useTaskSelection();
    const canCardMultiSelect = computed(() => checkPermission('task.task_status', projectData.value?.isGlobalPermission) === true
        && !showArchiveVar.value);
    const isCardSelected = computed(() => cardSelection.isSelected(props.data?._id));
    // A click, not change: only the click event says whether Shift was held.
    const handleCardCheckboxChange = (evt) => {
        if (!props.data?._id) return;
        cardSelection.selectFromEvent(props.data, evt, '.kanban-cards');
    };
    const chipCount = ref(4)
    const showSidebar = ref(false);
    const archive = ref(false);
    const horizontalDots = require("@/assets/images/svg/horizontalDots.svg");
    const linkIcon = require("@/assets/images/png/link.png");
    const splitScreen = require("@/assets/images/png/splitscreen.png");
    const inventoryIcon = require("@/assets/images/inventory_2.png");
    const deleteIcon = require("@/assets/images/DeleteIcon.png");
    const moveIcon = require("@/assets/images/png/moveIcon.png");
    const mergeIcon = require("@/assets/images/png/mergeIcon.png");
    const combinedIcon = require("@/assets/images/png/Combined_shape.png");
    const subTaskIcon = require("@/assets/images/png/subTaskIcon.png");
    const copyIcon = require("@/assets/images/copy.png");
    const route = useRoute()
    const searchedTask = inject('searchedTask');
    const openConvertSubTaskSidebar = ref(false);
    const converrtToListSidebar = ref(false);
    const openMoveSubTask = ref(false);
    const openMoveSidebar = ref(false);
    const taskCollapsed = inject("taskCollapsed");
    const openMergeTask = ref(false);
    const duplicateTaskSidebar = ref(false);
    const openSubTaskSideabr = ref(false)
    const dueDate = computed(() => element.value.DueDate)
    const dueDateText = computed(() => (element.value.DueDate ? convertDateFormat(element.value.DueDate, '', { showDayName: false }) : ''))
    const assigneeNames = computed(() => (element.value.AssigneeUserId || [])
        .map((id) => (String(id).startsWith('tId_') ? getTeam(String(id).slice(4))?.name : getUser(id)?.Employee_Name))
        .filter(Boolean)
        .join(', '))
    const priorityName = computed(() => {
        const found = getPriorities().find((priority) => priority.value === element.value.Task_Priority);
        return found?.name && found.name !== 'N/A' ? found.name : '';
    })

    const router = useRouter();
    const { timer, elapsedMs, isTracking } = useTimer();
    const now = ref(Date.now());
    let runTicker = null;

    const taskKey = computed(() => (element.value?.TaskKey && element.value.TaskKey !== '--' ? element.value.TaskKey : ''));
    const isTiming = computed(() => Boolean(timer.active?.running) && isTracking(element.value?._id));

    /* The card only carries the split label when it says something: HUMAN is
     * what every task without a matching agent gets, so on a board it is noise.
     * The full badge stays on the list row and in the task detail. */
    const showSplitBadge = computed(() => isAgentWork(element.value));

    const canEditDueDate = computed(() => showArchiveVar.value === false
        && checkPermission('task.task_due_date', projectData.value?.isGlobalPermission) === true
        && checkPermission('task.task_list', projectData.value?.isGlobalPermission) === true);
    const showDueDateChip = computed(() => checkPermission('task.task_due_date', projectData.value?.isGlobalPermission) !== null
        && (props.groupValue !== 3 || props.isSubTask)
        && (Boolean(element.value?.DueDate) || canEditDueDate.value));

    const clock = (ms) => {
        const total = Math.floor(Math.max(0, ms) / 1000);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const sec = total % 60;
        return h > 0
            ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
            : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    };

    const timerClock = computed(() => clock(elapsedMs.value));
    const runClock = computed(() => clock(now.value - new Date(props.agentRun?.startedAt || now.value).getTime()));

    watch(() => props.agentRun, (run) => {
        if (runTicker) { clearInterval(runTicker); runTicker = null; }
        if (run) runTicker = setInterval(() => { now.value = Date.now(); }, 1000);
    }, { immediate: true });

    onUnmounted(() => { if (runTicker) clearInterval(runTicker); });

    function openAiInbox() {
        router.push({ name: 'AiInbox', params: { cid: companyId.value } }).catch(() => {});
    }

    const myCounts = computed(() => {
        let total = 0;
        if(getters["users/myCounts"]?.data?.[`task_${projectData.value._id}_${props.data.sprintId}_${props.data._id}_comments`]) {
            total += getters["users/myCounts"]?.data?.[`task_${projectData.value._id}_${props.data.sprintId}_${props.data._id}_comments`] || 0
        }
        return total;
    })
    const myParentCounts = computed(() => {
        let total = 0;

        if(getters["users/myCounts"]?.data?.[`parentTask_${projectData.value._id}_${props.data.sprintId}_${props.data._id}_comments`]) {
            total += getters["users/myCounts"]?.data?.[`parentTask_${projectData.value._id}_${props.data.sprintId}_${props.data._id}_comments`] || 0
        }

        return total;
    })
    const companyUsers = computed(() => getters["settings/companyUsers"]?.map((x) => x.userId))
    const companyOwner = computed(() => {
        return getters["settings/companyOwnerDetail"];
    })
    const sprintData = computed(() => {
        let sprintData = false;
        if (projectData.value && element.value) {
            sprintData = element.value.folderObjId ? projectData.value?.sprintsfolders?.[element.value.folderObjId]?.sprintsObj?.[element.value.sprintId] : projectData.value?.sprintsObj?.[element.value.sprintId]
        }
        return sprintData || null;
    })
    const assigneeInput = computed(() => ({
        task: element.value,
        sprint: sprintData.value,
        project: projectData.value,
        parentAssignees: props.parentAssignee,
        companyUsers: companyUsers.value
    }))
    const permittedOptions = computed(() => permittedAssignees(assigneeInput.value))
    const canAssignOthers = computed(() => checkPermission('task.task_assignee', projectData.value?.isGlobalPermission) === true
        && checkPermission('task.task_list', projectData.value?.isGlobalPermission) == true)
    const nonPermittedOptions = computed(() => selfAssignable({ ...assigneeInput.value, userId: userId.value }))

    const emit = defineEmits(["subtaskOpen"]);

    watch(() => props.data, (newVal, oldVal) => {
        if(JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
            element.value = newVal;
        }
    })

    onMounted(()=> {
        if (!taskCollapsed.value) {
            emit("subtaskOpen")
        }
    })
    function updatePriority(val = null) {
        if(!val) return;
        updateTaskByGroup(element.value, val, 2);
    }
    function getUserData() {
        const user = getUser(userId.value);
        const userData = {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: companyOwner.value.userId,
        }
        return userData;
    }
    function changeAssignee(type, value) {
        if(!value?.id) return;
        const userData = getUserData();
        let operation = ""

        if(type === "add") {
            operation = "assigneeAdd"
        } else if(type === 'remove') {
            operation = "assigneRemove"
        } else if(type === 'replace') {
            operation = "replace"
        }

        let updateObject = {
            AssigneeUserId : value.id
        }

        const project = {
            _id: projectData.value._id,
            CompanyId: projectData.value.CompanyId,
            lastTaskId: projectData.value.lastTaskId,
            ProjectName: projectData.value.ProjectName,
            ProjectCode: projectData.value.ProjectCode
        }

        taskClass.updateAssignee({
            firebaseObj: updateObject,
            projectData: project,
            taskData: props.data,
            employeeName: getUser(value.id).Employee_Name,
            type: operation,
            userData
        })
        .then(() => {
            if(operation === "assigneRemove"){
                let taskData = props.data;
                let index = taskData.AssigneeUserId.findIndex((x) => x === value.id);
                taskData.AssigneeUserId.splice(index,1);
                commit("projectData/mutateSearchTask", {op:"modified", data: [taskData]});
            }
            $toast.success(t(`Toast.Assignee ${type === "add" || type === "replace" ? 'added' : 'removed'} successfully`), {position: "top-right"})
        })
        .catch((error) => {
            console.error("ERROR in changeAssignee: ", error);
        })
    }
    const copyTaskLink = () => {
        let path;
        let navigation = window.location.href;
        let modifiedUrl;
        let newnavigation = navigation.replace(/\?tab.*$/, '');

        if (route.name === "Project") {
        if (element.value.folderObjId) {
            modifiedUrl = newnavigation.slice(0, -2);
            path = `${modifiedUrl}/fs/${element.value.folderObjId}/${element.value.sprintId}/${element.value._id}`;
        } else {
            modifiedUrl = newnavigation.slice(0, -2);
            path = `${modifiedUrl}/s/${element.value.sprintId}/${element.value._id}`;
        }
        }
        if (route.name === "ProjectSprint" || route.name === "ProjectFolderSprint") {
            path = `${newnavigation}/${element.value._id}`;
        }
        if (route.name === "ProjectFolder") {
            modifiedUrl = newnavigation.replace(/\/f(.*)/, '');
            path = `${modifiedUrl}/fs/${element.value.folderObjId}/${element.value.sprintId}/${element.value._id}`;
        }

        const tabParamIndex = navigation.indexOf('?tab');
        if (tabParamIndex !== -1) {
            const tabParam = navigation.slice(tabParamIndex);
            path += tabParam;
        }

        navigator.clipboard.writeText(path);
        $toast.success(t("Toast.Link_is_Copied_to_clipboard"), { position: 'top-right' });
    }
    const copyTaskKey = () => {
        navigator.clipboard.writeText(element.value.TaskKey);
        $toast.success(t("Toast.Task_Key_is_Copied_to_clipboard"),{position: 'top-right'});
    }
    const updateDueDate = (event) => {
        try {
            if(!event?.dateVal) return;
            element.value.DueDate = event?.dateVal;
            updateTaskByGroup(props.data, {seconds: new Date(event.dateVal).getTime()/1000}, 3);
        } catch (error) {
            console.error("ERROR in updateDueDate: ", error);
        }
    }
    function updateTask(value = null) {
        const deletedStatusKey = value !== null ? value : archive.value ? 2 : 1;
        const userData = getUserData();
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
            sprintId: element.value.sprintId,
            folderId : element.value.folderObjId ? element.value.folderObjId : '',
            task: element.value,
            userData,
            deletedStatusKey
        })
        .then((res) => {
            if(res.status) {
                let sprint = {};
                if(element.value.folderObjId){
                    sprint = projectData.value.sprintsfolders[element.value.folderObjId].sprintsObj[element.value.sprintId];
                }
                else{
                    sprint = projectData.value.sprintsObj[element.value.sprintId];
                }
                sprint.tasks = sprint.tasks - (element.value.isParentTask ? ((element.value.subTasks || 0) + 1) : 1)
                commit("projectData/mutateSprints",{op:'modified',data:{...sprint}});
                $toast.success(t(`Toast.Task ${value !== null ? 'restored' : archive.value ? 'archived' : 'deleted'} successfully`), { position: "top-right" })
            }
        })
        .catch((err) => {
            console.error(err);
        })
    }
    const convertToSubTask = () => {
        openConvertSubTaskSidebar.value = true;
        openSubTaskSideabr.value = true;
    }
    const sidebarOPen = (val) => {
        openConvertSubTaskSidebar.value = val;
        openMoveSubTask.value = false;
        openMoveSidebar.value = false;
        duplicateTaskSidebar.value = false;
    }
    const convertToList = () => {
        converrtToListSidebar.value = true;
    }
    const moveTask = () => {
        if(props.data?.isParentTask === true){
            openMoveSidebar.value = true;
        }else if(props.data?.isParentTask === false){
            openMoveSubTask.value = true;
        }
        openConvertSubTaskSidebar.value = true;
    }
    const mergeTask= () => {
        openConvertSubTaskSidebar.value = true;
        openMergeTask.value = true;
    }
    const duplicateTask = () => {
        openConvertSubTaskSidebar.value = true;
        duplicateTaskSidebar.value = true;
    }
    function changeRoute() {
        const paramsObj = {
            cid: companyId.value,
            id: projectData.value._id,
            sprintId: element.value.sprintId,
            taskId: element.value._id
        }

        if(element.value.folderObjId) {
            paramsObj.folderId = element.value.folderObjId;
        }
        openTask({ ...paramsObj, companyId: paramsObj.cid, projectId: paramsObj.id, tab: 'activity' })
    }
</script>
