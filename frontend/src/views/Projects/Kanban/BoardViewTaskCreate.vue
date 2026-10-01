<template>
    <div class="board-create">
        <div class="board-create__head" v-if="!isSubTask">
            <DropDown mode="listbox" @isVisible="(val) => isOpend = val">
                <template #button>
                    <div ref="sprintName" class="board-create__sprint cursor-pointer">
                        <span>{{selectedSprint.name}}</span>
                        <span class="ah-mask-icon board-create__caret" :class="{ 'is-open': isOpend }" :style="maskOf(caretIcon)" aria-hidden="true"></span>
                    </div>
                </template>

                <template #options>
                    <div v-for="(item,index) in taskOption" :key="index" class="task__option">
                        <div v-if="item.isFolderSprint">
                            <DropDownOption @click="item.isFolderExpand = !item.isFolderExpand">
                                <div>
                                    <span class="board-create__folder">
                                        <span class="ah-mask-icon board-create__caret" :class="{ 'is-open': item.isFolderExpand }" :style="maskOf(caretIcon)" aria-hidden="true"></span>
                                        <img src="@/assets/images/svg/blue_folder.svg" alt="">
                                        <span class="text-ellipsis">{{item.folderName}}</span>
                                    </span>
                                </div>
                            </DropDownOption>
                        </div>
                        <div v-if="!item.isFolderSprint">
                            <DropDownOption :selected="item.id === selectedSprint.id" @click="selectedSprint = item; $refs.sprintName.click()">
                                <div>
                                    {{item.name}}
                                </div>
                            </DropDownOption>
                        </div>
                        <div v-if="item.isFolderSprint && item.isFolderExpand">
                            <div v-for="(foldSprint,index) in item.sprints" :key="index" class="board-create__folder-list">
                                <DropDownOption :selected="foldSprint.id === selectedSprint.id" @click="selectedSprint = foldSprint; $refs.sprintName.click()">
                                    <div>
                                        {{foldSprint.name}}
                                    </div>
                                </DropDownOption>
                            </div>
                        </div>
                    </div>
                </template>
            </DropDown>
            <button type="button" class="board-create__close" :aria-label="$t('Projects.close')" @click="$emit('toggle', data.key)">
                <span class="ah-mask-icon board-create__cross" :style="maskOf(closeIcon)" aria-hidden="true"></span>
            </button>
        </div>
        <div class="board-create__name">
            <div>
                <TaskType
                    class="d-inline-block"
                    :id="selectedSprint.id+taskId+'create_taskType'"
                    v-model="taskType"
                    :options="taskTypes"
                    :isBoardView="true"
                />
            </div>
            <div class="position-re w-100">
                <InputText
                    v-model="taskName.value"
                    :placeholder="$t('Projects.task_name')"
                    :maxLength="250"
                    class="input__type-taskname"
                    :minLength="3"
                    :isOutline="false"
                    @enter="saveTask()"
                    :isDirectFocus="true"
                    @keyup="checkErrors({'field':taskName,
                    'name':taskName.name,
                    'validations':taskName.rules,
                    'type':taskName.type,
                    'event':$event.event})"
                />
                <div v-if="save" class="position-ab z-index-1 save__error board-create__error">{{taskName.error}}</div>
            </div>
        </div>
        <div class="board-create__row">
            <div class="board-create__fields">
                <Assignee
                    v-if="groupValue !== 1"
                    :users="assignee"
                    :options="checkPermission('task.task_assignee',projectData?.isGlobalPermission) === true ? assigneeOptions : assigneeOptions.filter((x) => x === userId)"
                    :num-of-users="3"
                    @selected="changeAssignee(checkApps('MultipleAssignees',projectData) ? 'add' : 'replace', $event)"
                    @removed="changeAssignee('remove', $event)"
                    imageWidth="var(--avatar-size)"
                    :isDisplayTeam="true"
                    :multiSelect="checkApps('MultipleAssignees')"
                />

                <DueDateCompo
                    v-if="groupValue !== 3"
                    id="due-date-task"
                    :allowTillCurrentDate="true"
                    :displyDate="!dueDate ? new Date(dueDate).getTime()/1000 : new Date(dueDate)"
                    @SelectedDate="dueDate = $event?.dateVal"
                    :position="`right`"
                    :autoposition="false"
                    class="board-create__due"

                />

                <span v-if="groupValue !== 2">
                    <Priority
                        :priorityVal="priority"
                        @select="changePriority"
                        :showName="false"
                    />
                </span>
            </div>
            <div class="board-create__end">
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click.stop.prevent="saveTask()">{{$t("Projects.save")}}</button>
                <button v-if="isSubTask" type="button" class="board-create__close" :aria-label="$t('Projects.close')" @click.stop.prevent="$emit('toggle')">
                    <span class="ah-mask-icon board-create__cross" :style="maskOf(closeIcon)" aria-hidden="true"></span>
                </button>
            </div>
        </div>
    </div>
</template>
<script setup>
    import { computed, inject, onMounted, ref } from "vue";
    import { useStore } from "vuex";

    import DropDown from '@/components/molecules/DropDown/DropDown.vue'
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
    import DueDateCompo from '@/components/molecules/DueDateCompo/DueDateCompo.vue';
    import Assignee from "@/components/molecules/Assignee/Assignee.vue"
    import InputText from "@/components/atom/InputText/InputText.vue"
    import Priority from "@/components/molecules/PriorityCompo/PriorityComp.vue"
    import TaskType from "@/components/atom/TaskType/TaskType.vue"
    import { taskPlanPermission } from "@/composable/commonFunction";

    import { useCustomComposable, useGetterFunctions } from "@/composable";
    import taskClass from "@/utils/TaskOperations"
    import { useValidation } from "@/composable/Validation";
    import { useToast } from "vue-toast-notification";
    import { useI18n } from "vue-i18n";
    import { folderPathLabel } from "@/utils/folderTree";
    import { maskOf } from "@/utils/iconMask";
    const { t } = useI18n();
    const caretIcon = require("@/assets/images/table_arrow.png");
    const closeIcon = require("@/assets/images/crossBoardTaskIcon.png");
    const companyId = inject("$companyId");
    const $toast = useToast()
    const {getUser} = useGetterFunctions()
    const userId = inject("$userId")
    const {getters,commit} = useStore();
    const {checkPermission,checkApps} = useCustomComposable();
    const  { checkErrors , checkAllFields } = useValidation();
    const { checkTaskPerSprintPermisssion } = taskPlanPermission();

    const props = defineProps({
        data: {
            type:Object,
        },
        taskId: {
            type: String,
            default: ""
        },
        assigneeOptionsData: {
            type: Array,
            default: () => []
        },
        sprintData: {
            type: Object,
            default: () => {}
        },
        isSubTask: {
            type: Boolean,
            default: false
        },
        groupValue: {
            type: [Number, String],
            default: 0
        },
        sprintId: {
            type: String
        }
    })
    const projectData = inject("selectedProject");
    const assigneeOptions = ref([]);
    let taskOption = ref([]);
    const isOpend = ref(false);
    const selectedSprint = ref({});
    const taskName = ref({
        value: "",
        rules:
        "required | min: 3",
        name: "name",
        error: "",
    });
    const taskType = ref({});
    const taskTypes = computed(() => project.value.taskTypeCounts)
    const status = ref({});
    const save = ref(false);
    const dueDate = ref("");
    const priority = ref("MEDIUM");
    const assignee = ref([]);
    const companyOwner = computed(() => {
        return getters["settings/companyOwnerDetail"];
    })
    const project = computed(() => {
        return projectData.value
    })

    onMounted(() => {
        let sprints = [...(Object.values(projectData.value?.sprintsObj || {}))];
        Object.values(projectData.value?.sprintsfolders || {}).forEach((folder) => {
            let sprintsArray = [];
            Object.values(folder?.sprintsObj || {}).forEach((sprint) => {
                sprintsArray.push({ ...sprint })
            })
            sprints.push({ sprints: sprintsArray, isFolderExpand: false, folderName: folderPathLabel(projectData.value.sprintsfolders, folder), isFolderSprint: true })
        })
        taskOption.value = sprints
        if (props.sprintData && Object.keys(props.sprintData).length > 0) {
            selectedSprint.value = props.sprintData
        } else {
            let sp = {}
            taskOption.value.forEach((x) => {
                if (x.isFolderSprint) {
                    let ind = x.sprints.findIndex((x) => x.id === props.sprintId)
                    if (ind !== -1) {
                        sp = x.sprints[ind]
                    }
                } else {
                    if (x.id == props.sprintId) {
                        sp = x
                    }
                }
            })
            selectedSprint.value = sp
        }

        const taskTypeIndex = taskTypes.value && taskTypes.value.length ? 0 : -1
        if (taskTypeIndex !== -1) {
            taskType.value = taskTypes.value[taskTypeIndex]
        }

        // SELECT DEFAULT STATUS
        let statusIndex = project.value.taskStatusData && project.value.taskStatusData.length ? project.value.taskStatusData.findIndex((x) => x.type === "default_active") : -1
        if (statusIndex !== -1) {
            status.value = project.value.taskStatusData[statusIndex];
        }

        assignee.value = defaultAssignee();

        if (!props.assigneeOptionsData && props.assigneeOptionsData.length) {
            assigneeOptions.value = props.assigneeOptionsData
        } else {
            assigneeOptions.value = projectData.value.AssigneeUserId
        }
    })

    function changePriority(val) {
        priority.value = val.value
    }

    function changeAssignee(type, user) {
        if(type === "add") {
            assignee.value.push(user.id)
        } else if(type === 'remove') {
            const userIndex = assignee.value.findIndex((x) => x === user.id);

            if(userIndex !== -1) {
                assignee.value.splice(userIndex, 1);
            }
        } else if(type === 'replace') {
            assignee.value = [];
            assignee.value.push(user.id);
        }
    }

    /**
     * The assignee a freshly-emptied card starts with — the creator, matching the inline
     * row in the sprint list (CreateTask.vue).
     *
     * Returns a NEW array every time on purpose. The reset after a save runs while the
     * payload still holds the previous array by reference, so emptying that array in
     * place would strip the assignee off the task being created.
     */
    function defaultAssignee() {
        return userId.value ? [userId.value] : [];
    }

    function resetTaskFields() {
        dueDate.value = "";
        taskName.value.value = "";
        taskName.value.error = "";
        priority.value = "MEDIUM";
        // Back to the default, not to empty. The card stays mounted after a save, so
        // onMounted never runs again — clearing this outright left every task after the
        // first one unassigned.
        assignee.value = defaultAssignee();
    }

    function saveTask() {
        save.value = true;
        checkAllFields({ taskName: taskName.value }).then((valid) => {
            if (valid) {
                checkTaskPerSprintPermisssion(selectedSprint.value.id).then((resp) => {
                    if (resp) {
                        save.value = false;
                        if (taskName.value.value.trim().length < 3 || taskName.value.value.trim().length > 250) return;

                        const name = taskName.value.value.trim();

                        const user = getUser(userId.value)

                        const userData = {
                            id: user.id,
                            Employee_Name: user.Employee_Name,
                            companyOwnerId: companyOwner.value.userId,
                        }


                        let sprintObj = {
                            id: selectedSprint.value.id,
                            name: selectedSprint.value.name,
                            value: selectedSprint.value.value
                        }

                        if (selectedSprint.value.folderId) {
                            sprintObj.folderId = selectedSprint.value.folderId;
                            sprintObj.folderName = selectedSprint.value.folderName;
                        }

                        const obj = {
                            'TaskName': name,
                            'TaskKey': '--',
                            'AssigneeUserId': assignee.value,
                            'watchers': [...assignee.value, userId.value],
                            'DueDate': new Date(dueDate.value),
                            'dueDateDeadLine': [],
                            'TaskType': taskType.value.value,
                            'TaskTypeKey': taskType.value.key,
                            'ParentTaskId': props.taskId,
                            'ProjectID': project.value._id,
                            'CompanyId': companyId.value,
                            'status': {
                                "text": status.value.name,
                                "key": status.value.key,
                                "value": status.value.value,
                                'type': status.value.type
                            },
                            'isParentTask': props.taskId === "",
                            'Task_Leader': userId.value,
                            'sprintArray': sprintObj,
                            'Task_Priority': priority.value,
                            'deletedStatusKey': 0,
                            'sprintId': selectedSprint.value.id,
                            'statusType': status.value.type,
                            'statusKey': status.value.key,
                        }
                        if (selectedSprint.value.folderId) {
                            obj.folderObjId = selectedSprint.value.folderId;
                        }
                        if (props.taskId === "") {
                            obj[props.data.indexName] = -999999999999999
                            if (!(props.data.searchKey === "AssigneeUserId" && props.data.searchValue === "[]")) {
                                if (props.data.searchKey === "DueDate" && props.data.searchValue !== 0) {
                                    obj[props.data.searchKey] = new Date(props.data.searchValue * 1000)
                                } else {
                                    obj[props.data.searchKey] = props.data.searchValue
                                }
                            }
                        }
                        const projectData = {
                            id: project.value._id,
                            CompanyId: project.value.CompanyId,
                            lastTaskId: project.value.lastTaskId,
                            ProjectName: project.value.ProjectName,
                            ProjectCode: project.value.ProjectCode
                        }
                        let indexObj = {}
                        if (props.taskId === "") {
                            indexObj = {
                                indexName: props.data.indexName,
                                searchKey: props.data.searchKey,
                                searchValue: props.data.searchValue,
                            }
                        }
                        resetTaskFields();
                        taskClass.create({ data: obj, user: userData, projectData, indexObj, groupBy: props.groupValue })
                            .then((res) => {
                                if (res.status) {
                                    let sprint = {};
                                    if (selectedSprint.value.folderId) {
                                        sprint = project.value?.sprintsfolders?.[selectedSprint.value.folderId]?.sprintsObj?.[selectedSprint.value.id];
                                    } else {
                                        sprint = project.value?.sprintsObj[selectedSprint.value.id];
                                    }
                                    sprint.tasks = sprint.tasks + 1;
                                    commit("projectData/mutateSprints", { op: 'modified', data: { ...sprint } });
                                    $toast.success(t(`Toast.task_created_successfully`), { position: "top-right" });
                                } else if (res.isUpgrade) {
                                    $toast.error(t('Toast.create_task_plan_limit_message').replace('TASK_SPRINT', selectedSprint.value.name), { position: "top-right" });
                                } else {
                                    $toast.error(t(`Toast.something_went_wrong`), { position: "top-right" });
                                }
                            })
                            .catch((error) => {
                                console.error("ERROR in create task: ", error);
                            })
                    } else {
                        $toast.error(t('Toast.create_task_plan_limit_message').replace('TASK_SPRINT', selectedSprint.value.name), { position: "top-right" });
                    }
                })
            }
        })
        .catch((error) => {
            console.error("ERROR in creat task: ", error);
        })
    }
</script>

<style scoped>
.priority__component {
    min-width: var(--hit-min);
    min-height: var(--hit-min);
    border-radius: 50%;
    border: 1px solid var(--border);
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
    font-size: var(--fs-sm, 12px);
}
.board-create { padding: var(--card-pad-y, 15px) var(--card-pad-x, 15px); }
.board-create__head { display: flex; justify-content: space-between; align-items: center; }
.board-create__sprint { display: flex; align-items: center; gap: var(--gap-row, 5px); min-height: var(--hit-min); font-size: var(--fs-md, 13px); }
.board-create__caret { width: 5px; height: 9px; color: var(--ink-2); transition: transform var(--t-state) var(--ease); }
.board-create__caret.is-open { transform: rotate(90deg); }
.board-create__folder { display: inline-flex; align-items: center; gap: var(--gap-row, 5px); }
.board-create__folder-list { margin-left: 32px; }
.board-create__name { display: flex; align-items: center; gap: var(--sp-4); width: 100%; margin-top: var(--gap-row, 10px); }
.board-create__row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--sp-3); margin-top: var(--gap-stack, 15px); }
.board-create__fields { display: flex; align-items: center; gap: var(--sp-3); }
.board-create__due { display: flex; align-items: center; font-size: var(--fs-xs, 11px); }
.board-create__end { display: flex; align-items: center; gap: var(--sp-3); margin-left: auto; }
.board-create__close {
    display: inline-flex; align-items: center; justify-content: center;
    width: var(--hit-min); height: var(--hit-min);
    padding: 0; border: 0; background: none; color: var(--ink-2); cursor: pointer; border-radius: var(--r-sm, 4px);
}
.board-create__close:hover { background: var(--surface-hover); color: var(--ink); }
.board-create__close:focus-visible { outline: none; box-shadow: var(--focus); }
.board-create__cross { width: 10px; height: 10px; }
.board-create__error { left: 0; width: 100%; font-size: var(--fs-xs, 11px); color: var(--danger); }
</style>
