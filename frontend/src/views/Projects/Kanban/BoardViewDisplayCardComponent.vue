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
                        <input
                            v-if="renaming"
                            ref="renameInput"
                            v-model="renameDraft"
                            type="text"
                            class="card-rename ml-5px"
                            maxlength="250"
                            :aria-label="$t('List.rename_label')"
                            @click.stop
                            @mousedown.stop
                            @pointerdown.stop
                            @keydown.enter.prevent="saveRename"
                            @keydown.esc.stop.prevent="endRename"
                            @blur="saveRename"
                        />
                        <div
                            v-else
                            ref="titleEl"
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
                    <div v-show="!renaming" class="option-list" id="modelListComponent">
                        <TaskMenuPopup
                            v-if="showArchiveVar ? element.deletedStatusKey === 2 : element.deletedStatusKey === 0"
                            :items="menuItems"
                            :label="$t('Projects.task_actions')"
                            trigger-class="option-list__trigger"
                            @choose="runMenu"
                        >
                            <img :src="horizontalDots" alt="" aria-hidden="true">
                        </TaskMenuPopup>
                    </div>
                </div>
                <div
                    v-if="!showArchiveVar && taskTags.length && checkApps('tags') && checkPermission('task.task_tag',projectData?.isGlobalPermission) !== null"
                    class="card-tags d-flex align-items-center mt-10px ml--5px"
                >
                    <div v-for="item in taskTags.slice(0, TAG_CHIP_LIMIT)" :key="item.uid" class="tagList" @click.stop>
                        <TagChip :data="item" :isBorder="false" :prjectGlobalPermission="projectData?.isGlobalPermission" :ids="tagIds" :tagsArray="projectData.tagsArray"/>
                    </div>
                    <div v-if="taskTags.length > TAG_CHIP_LIMIT" class="tagcount">+{{ taskTags.length - TAG_CHIP_LIMIT }}</div>
                    <CreateTagPopup :task="element" :project="projectData" :isTaskList="false" @send:ids="(val) => tagIds = val" />
                </div>
                <div v-if="agentRun" class="agent-strip">
                    <span class="agent-strip__dot"></span>
                    <span class="agent-strip__name">{{ agentRun.agentName }} · {{ runClock }}</span>
                    <span v-if="agentRun.skill" class="agent-strip__meta">{{ skillLabel(t, agentRun.skill) }}</span>
                </div>
                <div v-else-if="agentProposal" class="agent-proposal">
                    <span class="agent-proposal__who">✦ {{ agentProposal.agentName }}:</span> {{ proposalTitle(t, agentProposal) }}
                    <button type="button" class="agent-proposal__review" @click.stop="openAiInbox()">{{ $t('Projects.review') }}</button>
                </div>
                <dl v-if="cardFieldValues.length" class="card-fields">
                    <div v-for="entry in cardFieldValues" :key="entry.id" class="card-field">
                        <dt class="card-field__name" :title="entry.label">{{ entry.label }}</dt>
                        <dd class="card-field__value" :title="entry.text">
                            <component :is="fieldTypeUi(entry.field.fieldType).value" v-if="fieldTypeUi(entry.field.fieldType)" compact :def="entry.field" :value="entry.value" :label="entry.label" v-bind="taskPropFor(entry.field.fieldType, element)" />
                            <template v-else-if="entry.choices.length">
                                <span v-for="option in entry.choices" :key="option.id" class="card-field__chip ah-status-ink" :style="choiceStyle(option)">{{ option.label || option.value }}</span>
                            </template>
                            <template v-else>{{ entry.text }}</template>
                        </dd>
                    </div>
                </dl>
                <div v-if="isTiming || showSplitBadge || cardPoints !== null" class="card-meta">
                    <span v-if="cardPoints !== null" class="card-points" :title="$t('ViewColumns.col_points')">{{ $t('ViewColumns.points_total', { n: cardPoints }) }}</span>
                    <span v-if="isTiming" class="card-timer">● {{ timerClock }}</span>
                    <ProvenanceBadge v-if="showSplitBadge" :task="element" />
                </div>
                <div class="d-flex justify-content-between mt-10px" :class="{'ml-5px': element.AssigneeUserId.length > 0}">
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
                            <img class="mr-5px" v-if="element?.DueDate" :src="calendarIcon" alt="" />
                            <CalenderCompo
                                v-if="canEditDueDate"
                                class="d-flex align-items-center"
                                :modelValue="duePickerValue"
                                :hideExtraLayouts="['time', 'minutes', 'hours', 'seconds']"
                                menuClass="calender-menu-class-duedate"
                                @click.stop
                                @update:modelValue="(dateVal) => updateDueDate({ dateVal })"
                            >
                                <template #trigger>
                                    <button
                                        type="button"
                                        class="d-flex calendar-trigger calendar-trigger--button"
                                        aria-haspopup="dialog"
                                        :aria-label="dueDateText ? $t('List.cell_change', { field: $t('List.due_date'), value: dueDateText }) : $t('List.cell_set', { field: $t('List.due_date') })"
                                        :title="dueDateFull || null"
                                    >
                                        <template v-if="dueDateText">{{ dueDateText }}</template>
                                        <img v-else :src="calendarIcon" alt="">
                                    </button>
                                </template>
                            </CalenderCompo>
                            <span v-else :title="dueDateFull">{{ dueDateText }}</span>
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
                        <button
                            v-if="subtaskCount"
                            type="button"
                            class="task-count-section card-subtasks-toggle"
                            :class="{ 'card-subtasks-toggle--spaced': myCounts > 0 }"
                            :aria-expanded="subtasksOpen"
                            :aria-label="subtaskLabel"
                            :title="subtaskLabel"
                            @click.stop="subtaskTree?.toggle(element, itemData)"
                        >
                            <img src="@/assets/images/png/subTaskShape.png" alt="" />
                            <span>{{ subtaskText }}</span>
                            <span v-if="myParentCounts > 0" class="sub-task-count">{{ myParentCounts > 99 ? "+99" : myParentCounts }}</span>
                        </button>
                        <button
                            type="button"
                            class="d-flex align-items-center board-task-comment-count position-re cursor-pointer"
                            v-if="projectData.viewColumn?.find((x)=> x.key === 'commentCounts')?.show && myCounts > 0"
                            :aria-label="$t('Projects.unread_comments_open', { n: myCounts })"
                            @click.stop="!showArchiveVar ? changeRoute() : ''"
                        >
                            <img class="mr-5px" src="@/assets/images/svg/ChatIcon.svg" alt="" />
                            <span class="parent-task-count" aria-hidden="true">{{myCounts > 99 ? "+99" : myCounts}}</span>
                        </button>
                    </div>
                </div>
            </div>
            <BoardCardSubtasks v-if="subtasksOpen" :parent="element" :depth="1" :column="itemData" />
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
            <TaskMenuSidebars :mode="sidebarMode" :task="element" @close="sidebarMode = null" />
        </div>
    </div>
</template>
<script setup>
    import {ref,inject,computed,watch,nextTick,onMounted,onUnmounted} from "vue";
    import { useStore } from "vuex";
    import { useToast } from "vue-toast-notification";
    import { useRoute, useRouter } from "vue-router"
    import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
    import ProvenanceBadge from '@/components/molecules/Provenance/ProvenanceBadge.vue';
    import { taskPoints } from '@/views/Projects/composables/taskPoints';
    import { shownFieldValues } from '@/views/Projects/composables/projectCustomFields';
    import { fieldTypeUi, taskPropFor } from '@/plugins/customFieldView/fieldTypes';
    import { statusChipStyle } from '@/utils/statusChipColors';
    import { isAgentWork } from '@/components/molecules/Provenance/provenance';
    import { useUpdateTasks } from "@/views/Projects/helper"
    import TagChip from '@/components/atom/TagChip/TagChip.vue'
    import Priority from "@/components/molecules/PriorityCompo/PriorityComp.vue"
    import taskClass from "@/utils/TaskOperations";
    import BoardViewTaskCreate from "@/views/Projects/Kanban/BoardViewTaskCreate.vue"
    import BoardCardSubtasks from "@/views/Projects/Kanban/BoardCardSubtasks.vue"
    import { MAX_DEPTH, depthOf } from "@taskTreeRules";
    import Assignee from "@/components/molecules/Assignee/Assignee.vue"
    import {useConvertDate,useCustomComposable,useGetterFunctions } from "@/composable";
    import { useTaskSelection } from "@/composable/useTaskSelection.js";
    import CreateTagPopup from "@/components/molecules/TagList/CreateTagPopup.vue";
    import { taskTagChips } from "@/components/molecules/TagList/helper.js";
    import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
    import TaskMenuSidebars from '@/views/Projects/components/taskMenu/TaskMenuSidebars.vue';
    import TaskMenuPopup from '@/views/Projects/components/taskMenu/TaskMenuPopup.vue';
    import { taskMenuItems } from '@/views/Projects/composables/taskMenu';
    import { taskUrl } from '@/views/Projects/composables/taskLink';
    import { openTemplateDialog } from '@/components/molecules/TaskTemplates/taskTemplates';
    import CalenderCompo from '@/components/atom/CalenderCompo/CalenderCompo.vue';
    import { dueLabel } from '@/components/molecules/Home/homeFormat';
    import { useI18n } from "vue-i18n";
    import { proposalTitle, skillLabel } from "@/views/Ai/plainLabels";
    import { useTimer } from "@/components/molecules/Home/useTimer";
    import { permittedAssignees, selfAssignable } from "@/utils/assigneeOptions";
    const { t } = useI18n();
    const props = defineProps({
        data: Object,
        groupValue: [Number, String],
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
    const element = ref(props.data)
    const TAG_CHIP_LIMIT = 4
    const taskTags = computed(() => taskTagChips(projectData.value?.tagsArray, element.value?.tagsArray))
    // TagChip requires ids, and the row's tag picker only reports them after the chips first render.
    const tagIds = ref({})
    const {updateTaskByGroup} = useUpdateTasks();

    const cardSelection = useTaskSelection();
    const canCardMultiSelect = computed(() => checkPermission('task.task_status', projectData.value?.isGlobalPermission) === true
        && !showArchiveVar.value);
    const isCardSelected = computed(() => cardSelection.isSelected(props.data?._id));
    // A click, not change: only the click event says whether Shift was held.
    // A card is ticked alone, as a List row is: the server carries its subtasks with it.
    const handleCardCheckboxChange = (evt) => {
        if (!props.data?._id) return;
        cardSelection.selectFromEvent(props.data, evt, '.kanban-cards', { rowsAlone: true });
    };
    const showSidebar = ref(false);
    const archive = ref(false);
    const horizontalDots = require("@/assets/images/svg/horizontalDots.svg");
    const calendarIcon = require("@/assets/images/svg/component-inactive-icons/comp_calender_inactive.svg");
    const inventoryIcon = require("@/assets/images/inventory_2.png");
    const deleteIcon = require("@/assets/images/DeleteIcon.png");
    const route = useRoute()
    const searchedTask = inject('searchedTask');
    const taskCollapsed = inject("taskCollapsed");
    const boardMenu = inject("boardTaskMenu", null);
    const menuItems = computed(() => taskMenuItems(element.value, boardMenu?.rights.value, { canNest: depthOf(element.value) < MAX_DEPTH }));
    const subtaskTree = inject("boardSubtaskTree", null);
    const subtasksOpen = computed(() => Boolean(subtaskTree?.isExpanded(element.value?._id)));
    const subtaskProgress = computed(() => (subtaskTree ? subtaskTree.progressFor(element.value) : null));
    const subtaskCount = computed(() => {
        if (subtaskTree) return subtaskTree.totalFor(element.value);
        return (showArchiveVar.value || searchedTask.value ? element.value?.subtaskArray?.length : element.value?.subTasks) || 0;
    });
    const subtaskText = computed(() => (subtaskProgress.value ? `${subtaskProgress.value.done}/${subtaskProgress.value.total}` : String(subtaskCount.value)));
    const subtaskLabel = computed(() => (subtaskProgress.value
        ? t('Projects.subtasks_progress', subtaskProgress.value)
        : t('Projects.subtasks_total', { n: subtaskCount.value })));
    const sidebarMode = ref(null);
    const renaming = ref(false);
    const renameDraft = ref("");
    const renameInput = ref(null);
    const titleEl = ref(null);
    const duePickerValue = computed(() => (element.value.DueDate ? new Date(element.value.DueDate) : ''))
    const dueDateText = computed(() => dueLabel(element.value.DueDate, t))
    const dueDateFull = computed(() => (element.value.DueDate ? convertDateFormat(element.value.DueDate, '', { showDayName: false }) : ''))
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
    const cardFields = inject("boardCardFields", null);
    const cardPoints = computed(() => (cardFields?.value?.some((field) => field.id === "points") ? taskPoints(element.value) : null));
    const fieldTasks = inject("boardFieldTasks", ref([]));
    const dateFormat = inject("$dateFormat", ref("DD/MM/YYYY"));
    const cardFieldValues = computed(() => shownFieldValues(cardFields?.value, element.value, {
        allTasks: fieldTasks.value || [], dateFormat: dateFormat.value, userName: (id) => getUser(id)?.Employee_Name
    }));
    const choiceStyle = (option) => (option.color ? statusChipStyle({ textColor: option.color }) : {});

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
    function startRename() {
        renameDraft.value = element.value.TaskName || "";
        renaming.value = true;
        nextTick(() => {
            renameInput.value?.focus();
            renameInput.value?.select();
        });
    }
    function endRename() {
        renaming.value = false;
        nextTick(() => titleEl.value?.focus());
    }
    function saveRename() {
        if (!renaming.value) return;
        endRename();
        boardMenu.rename(element.value, renameDraft.value);
    }
    function openInNewTab() {
        const href = taskUrl(router, { companyId: companyId.value, project: projectData.value, task: element.value });
        if (href) window.open(href, "_blank", "noopener");
    }
    function confirmRemoval(archiving) {
        archive.value = archiving;
        showSidebar.value = true;
    }
    function runMenu(id) {
        const viaSidebar = () => { sidebarMode.value = id; };
        const actions = {
            rename: startRename,
            subtask: () => {
                isSubtaskCreate.value = true;
                subtaskTree?.expand(element.value, props.itemData);
            },
            "copy-link": copyTaskLink,
            "copy-key": copyTaskKey,
            "new-tab": openInNewTab,
            open: () => toggleTaskDetail(element.value),
            "save-template": () => openTemplateDialog({ mode: "save", task: element.value, project: projectData.value }),
            "convert-subtask": viaSidebar,
            "convert-list": viaSidebar,
            move: viaSidebar,
            duplicate: viaSidebar,
            "duplicate-subtasks": () => boardMenu.duplicate(element.value, { withSubtasks: true }),
            merge: viaSidebar,
            archive: () => confirmRemoval(true),
            restore: () => updateTask(0),
            delete: () => confirmRemoval(false)
        };
        actions[id]?.();
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
