<template>
    <div>
        <div class="new-row list-group-item" id="singletaskdisply">
            <!-- LEFT SECTION -->
            <div class="new-col1" :style="{ border: (clientWidth > sideScrollWidth ? '0px' : '')}">
                <div class="common-section task ignore-drag" :style="`${task.isParentTask === false ? 'padding-left: 12px;' : ''}`">
                    <!-- Multi-select checkbox: visible on row hover OR when this row is selected. Permission-gated. -->
                    <label
                        v-if="canMultiSelect"
                        class="task-multi-select"
                        :class="{ 'task-multi-select--active': isTaskSelected }"
                        @click.stop
                    >
                        <input
                            type="checkbox"
                            :checked="isTaskSelected"
                            @click.stop
                            @change="handleSelectChange($event)"
                            :aria-label="$t ? $t('Common.select_task') || 'Select task' : 'Select task'"
                        />
                    </label>
                    <img :src="dragIcon" alt="dragIcon" v-if="!showArchiveVar" class="draggable_icon cursor-all-scroll">
                    <div class="parent__tasksubarray-wrapper position-ab">
                        <template v-if="(task.subTasks && task.isParentTask) || (searchedTask && task?.subtaskArray?.length)">
                            <img id="tasktoggle_driver" class="cursor-pointer parent__task-image" v-if="(task.subTasks && task.isParentTask) || (searchedTask && task?.subtaskArray?.length)" :src="triangleBlack" alt="triangle" :style="`transform: rotateZ(${data.isExpanded ? '90' : '0'}deg)`" @click="$emit('toggle',true)">
                        </template>
                        <template v-else>
                            <img class="parent__task-image" v-if="(task.isParentTask) || (searchedTask && task?.subtaskArray?.length)" :src="triangleBlack" alt="triangle" :style="`opacity: 0.1;`" @click="$emit('toggle',true)">
                        </template>
                    </div>

                    <img v-if="!data.isParentTask" :src="lastChild ? pointer : extendedPointer" alt="" class="align-self-baseline parent__task-lastchild parent__task-image">

                    <!-- INVENTORY -->
                    <img v-if="task.deletedStatusKey === 2" :src="inventoryIcon" alt="inventory" class="ml-5px"/>
                    <img v-if="task.deletedStatusKey === 1" :src="deleteIcon" alt="delete" class="ml-5px">

                    <!-- TASK STATUS -->
                    <template v-if="clientWidth > 768">
                        <TaskStatus
                            :id="task._id+'status'"
                            :modelValue="taskStatus"
                            :options="projectStatus"
                            :disabled="showArchiveVar && checkPermission('task.task_list',projectData.isGlobalPermission)!==true || checkPermission('task.task_status',projectData.isGlobalPermission) !== true || showArchiveVar !== false"
                            @select="changeStatus($event)"
                        />
                    </template>

                    <!-- TASK TYPE -->
                    <template v-if="clientWidth > 768">
                        <ProjectTaskType
                            :id="task._id+'type'"
                            :modelValue="taskType"
                            :options="projectTaskType"
                            :disabled="showArchiveVar && checkPermission('task.task_list',projectData.isGlobalPermission)!==true || checkPermission('task.task_type',projectData.isGlobalPermission) !== true || showArchiveVar !== false"
                            @select="changeTaskType($event)"
                            :imgClasses="`ml-10px`"
                        />
                    </template>

                    <div @click="!showArchiveVar ? toggleTaskDetail(task) : ''" class="task_name_wrapper task_Name ml-6px">
                        <!-- TASK NAME -->
                        <span v-if="!editTaskName" class="text-ellipsis d-inline-block edit__taskname" :title="task.TaskName">
                            {{ task.TaskName }}
                        </span>
                        <InputText
                            v-else
                            :input-id="'taskRename'+data._id"
                            v-model.trim="taskName"
                            :is-direct-focus="true"
                            :max-length="250"
                            :place-holder="$t('PlaceHolder.Enter_Task_Name')"
                            height="30px"
                            :isOutline="false"
                            @blur="editTaskName = false;"
                            @enter="editTaskName = false, updateTaskName(taskName)"
                        />
                        <!-- Tagchips -->
                        <template v-if="checkApps('tags') && clientWidth > 768">
                            <div v-for="(item, index) in tagChipArray" :key="index" @click.stop="">
                                <div v-if="(index < chipCount)" class="tagList">
                                    <TagChip :data="item" :isBorder="false" :ids="ids" :tagsArray="projectData.tagsArray" :prjectGlobalPermission='projectData?.isGlobalPermission' :taskId="task._id" :sprintId="task.sprintId" :taskName="task.TaskName"/>
                                </div>
                                <div v-if="index == chipCount" class="tagcount" @click="openDropDwon()"> +{{tagChipArray.length - chipCount}} </div>
                            </div>
                            <div v-if="(task.tagsArray && task.tagsArray.length > chipCount ) && checkPermission('task.task_tag',projectData?.isGlobalPermission) !== null">
                                <CreateTagPopup ref="openDrop" :task="data" @send:tagChipArray="(val)=>tagChipArray = val" @send:ids="(val)=>ids = val" :project="projectData" :chipCount="chipCount" :isTaskList="true"/>
                            </div>
                        </template>
                        <template v-if="clientWidth > 768">
                            <div class="d-flex align-items-center task-options-image img__parent-task ml-5px p3x-5px" v-if="data?.isParentTask && ((showArchiveVar || searchedTask) ? data?.subtaskArray?.length : data?.subTasks)" :style="`min-width: ${myParentCounts ? '64px' : ''}`">
                                <img :src="subTaskImage" alt="subTaskImage" class="mr-2px">
                                {{(showArchiveVar || searchedTask) ? data?.subtaskArray?.length : data?.subTasks < 0 ? 0 : data?.subTasks}}
                                <div class="count-block ml-5px" v-if="myParentCounts">
                                    {{myParentCounts > 99 ? "+99" : myParentCounts}}
                                </div>
                            </div>
                        </template>
                        <!-- TASK OPTIONS -->
                        <div class="align-items-center justify-content-evenly task-options" :class="[{'d-flex':dropVisible, 'd-none' : !dropVisible }]" v-if="!showArchiveVar && !editTaskName && clientWidth > 768">
                            <template v-if="task.isParentTask">
                                <div v-if="checkPermission('task.sub_task_create',projectData.isGlobalPermission) === true" @click.stop="emit('createTask'), (data.isExpanded ? '' : emit('toggle'))">
                                    <img :src="addlistCheklistPlus" alt="addlistCheklistPlus" class="task-options-image">
                                </div>
                                <div>
                                    <img :src="addlistChecklist" alt="addlistChecklist" class="task-options-image">
                                </div>
                            </template>
                            <div v-if="checkPermission('task.task_name_edit',projectData.isGlobalPermission) === true" @click.stop="taskName = props.data.TaskName, editTaskName = true">
                                <img :src="editing" alt="editing" class="task-options-image">
                            </div>
                            <div v-if="(!task?.tagsArray || (task.tagsArray && task.tagsArray.length < 3 )) && checkPermission('task.task_tag',projectData?.isGlobalPermission) === true">
                                <CreateTagPopup ref="openDrop" :task="data" @send:dropvisible="(val) => dropVisible = val" @send:tagChipArray="(val)=>tagChipArray = val" @send:ids="(val)=>ids = val" :project="projectData" :chipCount="chipCount" :isTaskList="true"/>
                            </div>
                        </div>
                    </div>
                    <div id="modelListComponent" class="groupdFileOption sticky_options" v-if="!projectData?.deletedStatusKey && clientWidth <= 768">
                        <div class="d-flex align-items-center task-options-image img__parent-task ml-5px p3x-5px" v-if="data?.isParentTask && ((showArchiveVar || searchedTask) ? data?.subtaskArray?.length : data?.subTasks)" :style="`min-width: ${myParentCounts ? '64px' : ''}`">
                            <img :src="subTaskImage" alt="subTaskImage" class="mr-2px">
                            {{(showArchiveVar || searchedTask) ? data?.subtaskArray?.length : data?.subTasks < 0 ? 0 : data?.subTasks}}
                            <div class="count-block ml-5px" v-if="myParentCounts">
                                {{myParentCounts > 99 ? "+99" : myParentCounts}}
                            </div>
                        </div>
                        <TaskQuickMenu
                            :task="task"
                            :projectData="projectData"
                            :showArchiveVar="showArchiveVar"
                            :userId="userId"
                            @copyLink="copyTaskLink"
                            @copyKey="copyTaskKey"
                            @queue="(action) => addToQueue(action)"
                            @confirmArchive="showSidebar = true, archive = true"
                            @restore="updateTask(0, archive)"
                            @confirmDelete="showSidebar = true, archive = false"
                            @convertToSubTask="convertToSubTask"
                            @convertToList="convertToList"
                            @duplicate="duplicateTask"
                            @move="moveTask"
                            @merge="mergeTask"
                            @convertToTask="convertToTask"
                        />
                    </div>
                </div>
            </div>

            <!-- RIGHT SECTION -->
            <div class="new-col2 ignore-drag" v-if="clientWidth > 768">
                <div class="common-section task">
                    <!-- CHAT COUNTS -->
                    <span v-if="projectData.viewColumn?.find((x)=> x.key === 'commentCounts')?.show" class="chat-main-new position-re task_right" @click.stop="!showArchiveVar ? changeRoute() : ''">
                        <img :src="chatIcon" alt="chatIcon" :class="{'cursor-pointer': !showArchiveVar}">
                        <div class="position-ab count-block show__count" v-if="myCounts">
                            {{myCounts > 99 ? "+99" : myCounts}}
                        </div>
                    </span>

                    <!-- ASSIGNEE -->
                    <span class="assignee-main-new task_right" v-if="checkPermission('task.task_assignee',projectData.isGlobalPermission) !== null && projectData.viewColumn?.find((x)=> x.key === 'AssigneeUserId')?.show">
                        <Assignee
                            v-if="checkPermission('task.task_assignee',projectData.isGlobalPermission) === true && checkPermission('task.task_list',projectData.isGlobalPermission) == true"
                            :users="task.AssigneeUserId"
                            :options="permittedOptions"
                            :num-of-users="2"
                            imageWidth="30px"
                            :addUser="!showArchiveVar"
                            @selected="changeAssignee(checkApps('MultipleAssignees',projectData) ? 'add' : 'replace', $event)"
                            @removed="changeAssignee('remove', $event)"
                            :isDisplayTeam="true"
                            :multiSelect="checkApps('MultipleAssignees')"
                        />
                        <Assignee
                            v-else
                            :users="task.AssigneeUserId"
                            :options="nonPermittedOptions"
                            :num-of-users="2"
                            imageWidth="30px"
                            :addUser="!showArchiveVar"
                            @selected="changeAssignee(checkApps('MultipleAssignees',projectData) ? 'add' : 'replace', $event)"
                            @removed="changeAssignee('remove', $event)"
                            :isDisplayTeam="true"
                            :multiSelect="checkApps('MultipleAssignees')"
                        />
                    </span>

                    <!-- DUE DATE -->
                    <span class="duedate-new task_right" v-if="checkPermission('task.task_due_date',projectData.isGlobalPermission) !== null && projectData.viewColumn?.find((x)=> x.key === 'DueDate')?.show">
                        <DueDateCompo
                            id="due-date-task"
                            :overdue="true"
                            :displyDate="dueDate? dueDate : ''"
                            :disabledDates="task.dueDateDeadLine"
                            @SelectedDate="($event) => updateDueDate($event)"
                            :position="`right`"
                            v-if="!showArchiveVar && checkPermission('task.task_due_date',projectData.isGlobalPermission) === true && checkPermission('task.task_list',projectData.isGlobalPermission) == true && showArchiveVar === false"
                        />
                        <template v-else>
                            <span v-if="task.DueDate">{{convertDateFormat(task.DueDate,'',{showDayName:false})}}</span>
                            <span v-else>{{ $t('ProjectDetails.no_due_date') }}</span>
                        </template>
                    </span>

                    <!-- TASK PRIORITY -->
                    <span class="priority-new task_right" v-if="checkPermission('task.task_priority',projectData.isGlobalPermission) !== null && checkApps('Priority') && projectData.viewColumn?.find((x)=> x.key === 'Task_Priority')?.show">
                        <Priority
                            :priorityVal="task.Task_Priority"
                            @select="updatePriority"
                            :permission="!showArchiveVar && checkPermission('task.task_priority',projectData.isGlobalPermission) === true"
                        />
                    </span>

                    <!-- TASK KEY -->
                    <span class="key-new task_right" v-if="projectData.viewColumn?.find((x)=> x.key === 'TaskKey')?.show">
                        {{task.TaskKey}}
                    </span>

                    <!-- Created Date -->
                    <span class="key-new task_right" v-if="projectData.viewColumn?.find((x)=> x.key === 'created_date')?.show">
                        {{convertDateFormat(task.createdAt,'',{showDayName: false})}}
                    </span>

                    <!-- Created By -->
                    <span class="pointer-event-none task_right" v-if="projectData?.viewColumn?.find((x)=> x.key === 'created_by')?.show">
                        <Assignee
                            :users="[task?.Task_Leader]"
                            :num-of-users="1"
                            imageWidth="30px"
                            :addUser="false"
                        />
                    </span>
                    <template v-if="projectData?.viewColumn && projectData?.viewColumn.length && isCustomFields()">
                        <CustomFieldListViewColumnComponent
                            :projectData="projectData"
                            :task="task"
                        />
                    </template>
                    <!-- OPTIONS -->
                    <div id="modelListComponent" class="groupdFileOption sticky_options" v-if="!projectData?.deletedStatusKey">
                        <TaskQuickMenu
                            :task="task"
                            :projectData="projectData"
                            :showArchiveVar="showArchiveVar"
                            :userId="userId"
                            @copyLink="copyTaskLink"
                            @copyKey="copyTaskKey"
                            @queue="(action) => addToQueue(action)"
                            @confirmArchive="showSidebar = true, archive = true"
                            @restore="updateTask(0, archive)"
                            @confirmDelete="showSidebar = true, archive = false"
                            @convertToSubTask="convertToSubTask"
                            @convertToList="convertToList"
                            @duplicate="duplicateTask"
                            @move="moveTask"
                            @merge="mergeTask"
                            @convertToTask="convertToTask"
                        />
                    </div>
                </div>
            </div>
        </div>
        <ConfirmationSidebar
            v-model="showSidebar"
            :title="`${archive ? $t('Projects.archive') : $t('Projects.delete')}`"
            :message="archive ? $t('conformationmsg.archive') : $t('conformationmsg.delete')"
            :confirmationString="`${archive ? 'archive' : 'delete'}`"
            :acceptButtonClass="archive ? 'btn-primary': 'btn-danger'"
            :acceptButton="`${archive ? $t('Projects.archive') : $t('Projects.delete')}`"
            @confirm="updateTask(null, archive), showSidebar = false"
        />
        <ConvertToSubTaskSidebar v-if="openConvertSubTaskSidebar === true" :closeSideBar="openConvertSubTaskSidebar"
            @isConvertSubtaskOPen="(val) => {sidebarOPen(val)}" :isMoveTask="openMoveSidebar" :openMoveSubTask="openMoveSubTask"
            :isMergeTask="openMergeTask" :isDuplicate="duplicateTaskSidebar" :task="task" :isConvertTask="openConvertToTask" :isOpenSubTask="openSubTaskSideabr" :item="item"/>
        <ConvertToList v-if="converrtToListSidebar === true" :openSidebar="converrtToListSidebar" @closeSidebar="(val) => {converrtToListSidebar = val}" :task="task"/>
    </div>
</template>

<script setup>
import { ref, watch, defineProps, inject, defineEmits, defineComponent, computed, onMounted } from 'vue';

import Assignee from '@/components/molecules/Assignee/Assignee.vue';
import InputText from '@/components/atom/InputText/InputText.vue';
import Priority from '@/components/molecules/PriorityCompo/PriorityComp.vue';
import TaskStatus from '@/components/atom/TaskStatus/TaskStatus.vue';
import ProjectTaskType from '@/components/atom/TaskTypeSelection/TaskTypeSelection.vue';
import DueDateCompo from '@/components/molecules/DueDateCompo/DueDateCompo.vue';
import ConfirmationSidebar from '@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue';
import CreateTagPopup from '@/components/molecules/TagList/CreateTagPopup.vue';
import TagChip from '@/components/atom/TagChip/TagChip.vue';
import ConvertToSubTaskSidebar from '@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue';
import ConvertToList from '@/components/molecules/ConvertToList/ConvertToList.vue';

import TaskQuickMenu from './components/TaskQuickMenu.vue';
import { useTaskActions } from './composables/useTaskActions';
import { useTaskMutations } from './composables/useTaskMutations';

import { useConvertDate, useCustomComposable } from '@/composable';
import { useTaskSelection } from '@/composable/useTaskSelection.js';
import { useStore } from 'vuex';
import { customField } from '../../../plugins/customFieldView/helper.js';

const { isCustomFields } = customField();
const dropVisible = ref(false);

// Multi-select state. Checkbox renders on hover OR when THIS row is
// selected — never blocks existing single-task interactions. We let the
// browser handle the toggle (no preventDefault) and sync the store via
// the change event; this keeps the native :checked binding in sync.
const selection = useTaskSelection();
const canMultiSelect = computed(() => checkPermission('task.task_status', projectData.value?.isGlobalPermission) === true
    && !showArchiveVar.value);
const isTaskSelected = computed(() => selection.isSelected(props.data?._id));
const handleSelectChange = (evt) => {
    if (!props.data?._id) return;
    if (evt) evt.stopPropagation();
    selection.toggle(props.data._id, evt);
};
const clientWidth = inject('$clientWidth');
const projectRef = inject('selectedProject');
const userId = inject('$userId');
const { getters } = useStore();
const searchedTask = inject('searchedTask');
const { convertDateFormat } = useConvertDate();
const { checkPermission, checkApps } = useCustomComposable();
const showArchiveVar = inject('showArchived');
const tagChipArray = ref();
const ids = ref();
const chipCount = ref(2);

// IMAGES
const dragIcon = require('@/assets/images/svg/move_table_icon.svg');
const triangleBlack = require('@/assets/images/svg/triangleBlack.svg');
const inventoryIcon = require('@/assets/images/inventory_2.png');
const deleteIcon = require('@/assets/images/DeleteIcon.png');
const addlistCheklistPlus = require('@/assets/images/svg/addlistCheklistPlus.svg');
const addlistChecklist = require('@/assets/images/svg/addlistChecklist.svg');
const editing = require('@/assets/images/editing.png');
const subTaskImage = require('@/assets/images/subtask2.png');
const pointer = require('@/assets/images/svg/pointer.svg');
const extendedPointer = require('@/assets/images/svg/pointer_extended.svg');
const chatIcon = require('@/assets/images/svg/ChatIcon.svg');

// EMITS
const emit = defineEmits(['toggle', 'createTask']);

defineComponent({ name: 'Task-Component' });

const props = defineProps({
    data: { type: Object, default: null },
    lastChild: { type: Boolean, default: false },
    parentAssignee: { type: Array, default: () => [] },
    // Note: defaults must be undefined/null (not {}). The projectData computed
    // below treats truthy projectObject as authoritative and falls back to
    // injected `selectedProject` otherwise; an empty-object default would skip
    // the fallback and crash on `projectData.value.taskStatusData.find(...)`.
    item: { type: Object, default: null },
    projectObject: { type: Object, default: null },
});

const showSidebar = ref(false);
const archive = ref(false);
const openDrop = ref();

const openDropDwon = () => {
    if (checkPermission('task.task_tag', projectData.value?.isGlobalPermission) == true) {
        openDrop.value.sendMethod();
    }
};

const customFieldList = computed(() => (getters['settings/finalCustomFields'] && getters['settings/finalCustomFields'].length) ? JSON.parse(JSON.stringify(getters['settings/finalCustomFields'])) : []);

const companyUsers = computed(() => getters['settings/companyUsers']?.map((x) => x.userId));

const projectData = computed(() => {
    if (props.projectObject) {
        return props.projectObject;
    } else {
        return projectRef.value;
    }
});

const sideScrollWidth = ref(769);
const task = ref(props.data);
const toggleTaskDetail = inject('toggleTaskDetail');
const statusSearch = ref('');
const taskName = ref(props.data.TaskName);
const editTaskName = ref(false);

const dueDate = computed(() => props.data.DueDate);

const projectStatus = computed(() => projectData.value.taskStatusData.filter((x) => x.name?.toLowerCase().includes(statusSearch.value.toLowerCase())));
const projectTaskType = computed(() => projectData.value.taskTypeCounts);
const taskStatus = computed(() => projectData.value.taskStatusData.find((x) => x.key === task.value.statusKey));
const taskType = computed(() => projectData.value.taskTypeCounts.find((x) => x.key === task.value.TaskTypeKey));

const sprintData = computed(() => {
    let sprintData = false;
    if (projectData.value && props.data) {
        sprintData = props.data.folderObjId ? projectData.value?.sprintsfolders?.[props.data.folderObjId]?.sprintsObj?.[props.data.sprintId] : projectData.value?.sprintsObj?.[props.data.sprintId];
    }
    return sprintData || null;
});

const permittedOptions = computed(() => {
    let users = [];
    if (sprintData.value) {
        if (props.data.isParentTask) {
            if (sprintData.value?.private) {
                users = sprintData.value?.AssigneeUserId || [];
            } else {
                users = projectData.value?.isPrivateSpace ? (projectData.value?.AssigneeUserId || []) : companyUsers.value;
            }
        } else {
            users = sprintData.value?.private
                ? props.parentAssignee.filter((x) => sprintData.value?.AssigneeUserId?.includes(x))
                : props.parentAssignee;
        }
    }

    if (projectData.value?.isPrivateSpace) {
        users = users.filter((x) => projectData.value?.AssigneeUserId.includes(x));
        return Array.from(new Set([...users, ...(props.data?.AssigneeUserId || [])]));
    }
    return users;
});

const nonPermittedOptions = computed(() => {
    let users = [];
    if (sprintData.value) {
        if (props.data.isParentTask) {
            if (sprintData.value?.private) {
                users = (sprintData.value?.AssigneeUserId || []).filter((x) => x === userId.value);
            } else {
                users = projectData.value?.isPrivateSpace
                    ? (projectData.value?.AssigneeUserId || []).filter((x) => x === userId.value)
                    : [userId.value];
            }
        } else {
            users = (props.parentAssignee || [])?.filter((x) => x === userId.value);
            if (sprintData.value?.private) {
                users = users.filter((x) => sprintData.value?.AssigneeUserId?.includes(x));
            }
        }
    }
    if (projectData.value?.isPrivateSpace) {
        users = users.filter((x) => projectData.value?.AssigneeUserId.includes(x));
    }
    return users;
});

watch(() => props.data, (newVal, oldVal) => {
    if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
        task.value = newVal;
        manageCustomField(customFieldList.value);
    }
});

watch(() => projectData.value?.viewColumn?.length, (newVal, oldVal) => {
    if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
        manageCustomField(customFieldList.value);
    }
});
watch(() => getters['settings/finalCustomFields'], (newVal) => {
    manageCustomField(newVal);
}, { deep: true });

const taskCollapsed = inject('taskCollapsed');
onMounted(() => {
    if (taskCollapsed.value !== undefined && !taskCollapsed.value) {
        emit('toggle');
    }
    manageCustomField(customFieldList.value);
});

// MUTATIONS
const { updateTask, updateTaskName, changeStatus, changeTaskType, changeAssignee, updateDueDate, updatePriority } = useTaskMutations({ projectData, task, props });

// ACTIONS
const {
    openConvertSubTaskSidebar,
    converrtToListSidebar,
    openMoveSubTask,
    openMoveSidebar,
    openMergeTask,
    duplicateTaskSidebar,
    openSubTaskSideabr,
    openConvertToTask,
    changeRoute,
    copyTaskLink,
    copyTaskKey,
    convertToSubTask,
    sidebarOPen,
    convertToList,
    moveTask,
    mergeTask,
    duplicateTask,
    convertToTask,
    addToQueue,
} = useTaskActions({ projectData, task, props });

const myCounts = computed(() => {
    let total = 0;
    if (getters['users/myCounts']?.data?.[`task_${projectData.value._id}_${task.value.sprintId}_${task.value._id}_comments`]) {
        total += getters['users/myCounts']?.data?.[`task_${projectData.value._id}_${task.value.sprintId}_${task.value._id}_comments`] || 0;
    }
    return total;
});
const myParentCounts = computed(() => {
    let total = 0;
    if (getters['users/myCounts']?.data?.[`parentTask_${projectData.value._id}_${task.value.sprintId}_${task.value._id}_comments`]) {
        total += getters['users/myCounts']?.data?.[`parentTask_${projectData.value._id}_${task.value.sprintId}_${task.value._id}_comments`] || 0;
    }
    return total;
});

const manageCustomField = (data) => {
    if (!(data && data.length)) {
        return;
    }
    if (projectData.value?.viewColumn && projectData.value?.viewColumn.length) {
        let count = 0;
        const countFunction = (element) => {
            if (count >= projectData.value?.viewColumn.length) {
                return;
            }
            const checkCustom = customFieldList.value.find((x) => (x._id === element.key) && (x?.isDelete) && (x?.type === 'task') && (x?.global || x?.projectId.includes(task?.value?.ProjectID)));
            if (checkCustom && Object.keys(checkCustom).length) {
                if (task.value.customField?.[element.key]) {
                    if (checkCustom.fieldType === 'phone') {
                        task.value.customField[element.key] = {
                            ...checkCustom,
                            taskId: task.value._id,
                            fieldValue: task.value.customField[element.key].fieldValue,
                            fieldCode: task.value.customField[element.key].fieldCode,
                            fieldFlag: task.value.customField[element.key].fieldFlag,
                            fieldPattern: task.value.customField[element.key].fieldPattern,
                        };
                    } else {
                        task.value.customField[element.key] = {
                            ...checkCustom,
                            taskId: task.value._id,
                            fieldValue: task.value.customField[element.key].fieldValue,
                        };
                    }
                    count++;
                    countFunction(projectData.value.viewColumn[count]);
                } else {
                    delete checkCustom?.fieldPattern;
                    delete checkCustom?.fieldValue;
                    delete checkCustom?.fieldCode;
                    delete checkCustom?.fieldFlag;
                    checkCustom.taskId = task.value._id;
                    const newObject = { [element.key]: checkCustom };
                    task.value.customField = { ...task.value.customField, ...newObject };
                    count++;
                    countFunction(projectData.value.viewColumn[count]);
                }
            } else {
                count++;
                countFunction(projectData.value.viewColumn[count]);
            }
        };
        countFunction(projectData.value.viewColumn[count]);
    }
};
</script>

<style src="./style.css">

</style>
