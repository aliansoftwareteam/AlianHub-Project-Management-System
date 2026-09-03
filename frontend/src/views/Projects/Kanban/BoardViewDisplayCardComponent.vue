<template>
    <div class="kanban-card-wrapper">
        <!-- Multi-select checkbox: top-left of card. Visible on card hover OR when this card is selected. -->
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
                @click.stop
                @mousedown.stop
                @change="handleCardCheckboxChange($event)"
                aria-label="Select task"
            />
        </label>
        <div @click.stop.prevent="!showArchiveVar ? toggleTaskDetail(element) : ''">
            <div>
                <div class="d-flex justify-content-between">
                    <div class="d-flex align-items-center mw-82">
                        <!-- Task type removed from the Kanban card. This spacer keeps the
                             top-left slot for the absolute multi-select checkbox so the
                             title never sits underneath it. -->
                        <span class="kanban-card-checkbox-space" aria-hidden="true"></span>
                        <div class="list-group-kanban-item__taskName text-ellipsis font-weight-500 font-size-14 ml-5px black" :title="element.TaskName">
                            <img v-if="element.deletedStatusKey === 2" :src="inventoryIcon" alt="inventory" class="ml-5px" />
                            <img v-if="element.deletedStatusKey === 1" :src="deleteIcon" alt="delete" class="ml-5px" />
                            {{ element.TaskName }}
                        </div>
                    </div>
                    <Transition>
                        <div class="option-list" id="modelListComponent">
                            <DropDown :title="element.TaskName" v-if="showArchiveVar ? element.deletedStatusKey === 2 : element.deletedStatusKey === 0">
                                <template #button>
                                    <img :ref="element.id+'options'" :src="horizontalDots" alt="horizontalDots">
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
                <div class="d-flex justify-content-between mt-10px" :class="{'ml-5px': element.AssigneeUserId.length > 0}">
                    <!-- Assignee -->
                    <div v-if="checkPermission('task.task_assignee',projectData?.isGlobalPermission) !== null && (groupValue !== 1 || isSubTask)">
                        <Assignee
                            v-if="checkPermission('task.task_assignee',projectData?.isGlobalPermission) === true && checkPermission('task.task_list',projectData?.isGlobalPermission) == true"
                            :users="element.AssigneeUserId"
                            :options="permittedOptions"
                            :num-of-users="1"
                            imageWidth="25px"
                            :addUser="!showArchiveVar"
                            @selected="changeAssignee(checkApps('MultipleAssignees',projectData) ? 'add' : 'replace', $event)"
                            @removed="changeAssignee('remove', $event)"
                            :isDisplayTeam="true"
                            :multiSelect="checkApps('MultipleAssignees')"
                        />
                        <Assignee
                            v-else
                            :users="element.AssigneeUserId"
                            :options="nonPermittedOptions"
                            :num-of-users="1"
                            imageWidth="25px"
                            :addUser="!showArchiveVar"
                            @selected="changeAssignee(checkApps('MultipleAssignees',projectData) ? 'add' : 'replace', $event)"
                            @removed="changeAssignee('remove', $event)"
                            :isDisplayTeam="true"
                            :multiSelect="checkApps('MultipleAssignees')"
                            class=""
                        />
                    </div>
                    <div class="d-flex align-items-center board-view-action-wrapper">
                        <span class="mr-5px date-picker d-flex align-items-center"
                            v-if="checkPermission('task.task_due_date', projectData?.isGlobalPermission) !== null && (groupValue !== 3 || isSubTask)"
                            :class="(myCounts || myParentCounts) > 0 ? 'mr-5px' : ''"
                            :style="`border-radius: ${element?.DueDate ? '5px' : '50%'}; padding: ${element?.DueDate ? '3px 6px' : '6px'};`"
                        >
                            <img class="mr-5px" v-if="element?.DueDate" src="@/assets/images/svg/component-inactive-icons/comp_calender_inactive.svg" />
                            <DueDateCompo
                                v-if="!showArchiveVar && checkPermission('task.task_due_date',projectData?.isGlobalPermission) === true && checkPermission('task.task_list',projectData?.isGlobalPermission) === true && showArchiveVar === false" 
                                id="due-date-task"
                                class="d-flex align-items-center"
                                :displyDate="dueDate? new Date(dueDate) : ''"
                                :disabledDates="element.dueDateDeadLine"
                                @SelectedDate="($event) => updateDueDate($event)"
                                :isWithoutBorderImage="true"
                            />
                            <template v-else>
                                <span>{{convertDateFormat(element.DueDate, '', { showDayName: false })}}</span>
                            </template>
                        </span>
                        <span class="priority__compo" v-if="groupValue !== 2 || isSubTask" :class="((element?.subTasks) || (myCounts || myParentCounts) > 0) ? 'mr-5px' : ''">
                            <div
                                v-if="checkPermission('task.task_priority',projectData?.isGlobalPermission) !== null && checkApps('Priority')">
                                <Priority
                                    :priorityVal="element.Task_Priority"
                                    @select="updatePriority"
                                    :permission="!showArchiveVar && checkPermission('task.task_priority',projectData?.isGlobalPermission) === true"
                                    :showName="false"
                                />
                            </div>
                        </span>
                        <span v-if="!isSubTask && element?.subTasks" class="d-flex align-items-center task-count-section" :class="myCounts > 0 ? 'mr-5px' : ''">
                            <img class="mr-5px" src="@/assets/images/png/subTaskShape.png" />
                            <span class="font-size-12" :style="{'color': (element.isExpanded && element?.subtaskArray?.length > 0) ? '#2F3990' : ''}">
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
                :title="`${archive ? $t('Projects.archive') : $t('Projects.delete')} Task`"
                :message="archive ? $t('conformationmsg.archive') : $t('conformationmsg.delete')"
                :confirmationString="`${archive ? 'archive' : 'delete'}`"
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
    import {ref,inject,computed,watch,onMounted} from "vue";
    import { useStore } from "vuex";
    import { useToast } from "vue-toast-notification";
    import { useRoute } from "vue-router"
    import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
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
    const { t } = useI18n();
    const props = defineProps({
        data: Object,
        groupValue: Number,
        itemData: Object,
        isSubTask: Boolean,
        parentAssignee: Array
    })

    const {checkPermission,checkApps} = useCustomComposable();
    const {convertDateFormat} = useConvertDate();
    const showArchiveVar = inject("showArchived");
    const userId = inject('$userId')
    const toggleTaskDetail = inject('toggleTaskDetail')
    const companyId = inject("$companyId");
    const {getters,commit} = useStore();
    const isSubtaskCreate = ref(false);
    const {getUser} = useGetterFunctions();
    const projectData = inject("selectedProject");
    const $toast = useToast()
    const tagChipArray = ref([])
    const element = ref(props.data)
    const {updateTaskByGroup} = useUpdateTasks();

    // Multi-select on Kanban cards: checkbox renders on card hover OR when
    // THIS card is selected. Permission-gated. Click/mousedown propagation
    // stopped so it doesn't open the task detail or start a drag.
    const cardSelection = useTaskSelection();
    const canCardMultiSelect = computed(() => checkPermission('task.task_status', projectData.value?.isGlobalPermission) === true
        && !showArchiveVar.value);
    const isCardSelected = computed(() => cardSelection.isSelected(props.data?._id));
    const handleCardCheckboxChange = (evt) => {
        if (!props.data?._id) return;
        if (evt) evt.stopPropagation();
        // Parent ↔ subtask cascade (mirrors list/table view behavior).
        cardSelection.toggleAndCascade(props.data, evt);
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
    const permittedOptions = computed(() => {
        let users = [];
        if(sprintData.value) {
            if(element.value?.isParentTask) {
                if(sprintData.value?.private) {
                    users = sprintData.value?.AssigneeUserId || [];
                } else {
                    if(projectData.value?.isPrivateSpace) {
                        users = projectData.value?.AssigneeUserId || [];
                    } else {
                        users = companyUsers.value;
                    }
                }
            } else {
                if(sprintData.value?.private) {
                    users = (props.parentAssignee || []).filter((x) => sprintData.value?.AssigneeUserId?.includes(x))
                } else {
                    users = (props.parentAssignee || [])
                }
            }
        }
        if(projectData.value?.isPrivateSpace) {
            users = users.filter((x) => projectData.value?.AssigneeUserId.includes(x));
            return Array.from(new Set([...users, ...(props.data?.AssigneeUserId || [])]));
        } else {
            return users;
        }
    })
    const nonPermittedOptions = computed(() => {
        let users = [];
        if(sprintData.value) {
            if(element.value?.isParentTask) {
                if(sprintData.value?.private) {
                    users = (sprintData.value?.AssigneeUserId || []).filter((x) => x === userId.value);
                } else {
                    if(projectData.value?.isPrivateSpace) {
                        users = (projectData.value?.AssigneeUserId || []).filter((x) => x === userId.value);
                    } else {
                        users = [userId.value];
                    }
                }
            } else {
                users = (props.parentAssignee || [])?.filter((x) => x === userId.value)
                if(sprintData.value?.private) {
                    users = users.filter((x) => sprintData.value?.AssigneeUserId?.includes(x))
                }
            }
        }
        if(projectData.value?.isPrivateSpace) {
            users = users.filter((x) => projectData.value?.AssigneeUserId.includes(x));
            return users;
        } else {
            return users;
        }
    })

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
<style src="./new-style.css" scoped />
