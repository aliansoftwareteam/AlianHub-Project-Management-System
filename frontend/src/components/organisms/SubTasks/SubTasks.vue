<template>
    <section class="stx">
        <header class="stx__head">
            <span class="stx__title">{{ $t('MembersV2.subtasks') }}</span>
            <span v-if="rollup.total" class="ah-mono stx__rollup">{{ rollupText }}</span>
            <div v-if="rollup.total" class="stx__bar"><div class="stx__bar-fill" :style="{ width: `${rollup.percent}%` }"></div></div>
            <button
                v-if="canUseAi"
                type="button"
                class="stx__ai"
                :disabled="isSpinnerSuggest"
                @click="sugestSubTask()"
            >✦ {{ $t('MembersV2.suggest_subtasks') }}</button>
            <button v-if="rollup.total" type="button" class="stx__link" @click="collapsed = !collapsed">
                {{ collapsed ? $t('MembersV2.expand') : $t('MembersV2.collapse') }}
            </button>
        </header>

        <template v-if="isMainSpinner">
            <Skelaton v-for="i in 3" :key="i" class="stx__skeleton" />
        </template>
        <template v-else-if="!collapsed">
            <div v-if="visibleSubTasks.length" class="stx__list ah-scroll" @scroll="onScroll">
                <div v-for="sub in visibleSubTasks" :key="'subtask-' + sub._id" class="stx__row" :class="{ 'is-done': isDone(sub), 'is-pending': pending[sub._id] }">
                    <input
                        type="checkbox"
                        class="ah-check"
                        :checked="isDone(sub)"
                        :disabled="!canSetStatus || pending[sub._id]"
                        :aria-label="sub.TaskName"
                        @change="toggle(sub, $event.target.checked)"
                    />
                    <button type="button" class="stx__name" :title="sub.TaskName" @click="open(sub)">{{ sub.TaskName }}</button>
                    <span v-if="assignee(sub)" class="ah-avatar ah-avatar--sm" :title="assignee(sub).Employee_Name">
                        <img v-if="assignee(sub).Employee_profileImageURL" :src="assignee(sub).Employee_profileImageURL" :alt="assignee(sub).Employee_Name" />
                        <template v-else>{{ initials(assignee(sub).Employee_Name) }}</template>
                    </span>
                    <span class="ah-mono stx__hours">{{ hours(sub.totalEstimatedTime) }}</span>
                </div>
            </div>
            <p v-else-if="!createSubTask" class="stx__empty">{{ $t('MembersV2.no_subtasks') }}</p>

            <div v-if="subTasksList && subTasksList.length" class="stx__ai-list">
                <label v-for="(sub, index) in subTasksList" :key="'ai-sub-' + index" class="stx__ai-row">
                    <input type="checkbox" class="ah-check" v-model="sub.isSelected" />
                    <span>✦ {{ sub.title }}</span>
                </label>
                <div class="stx__ai-actions">
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="subTasksList = []">{{ $t('MembersV2.cancel') }}</button>
                    <button
                        v-if="selectedAiCount"
                        type="button"
                        class="ah-btn ah-btn--primary ah-btn--sm"
                        @click="createSubTasks()"
                    >{{ `${$t('general.Create')} ${selectedAiCount}` }}</button>
                </div>
            </div>
            <template v-if="isSpinnerSuggest">
                <Skelaton v-for="i in 3" :key="'ai-skel-' + i" class="stx__skeleton" />
            </template>
            <p v-if="isError" class="ah-field__error">{{ $t('Toast.something_went_wrong') }}</p>

            <button v-if="canCreate && !createSubTask" type="button" class="stx__add" @click="createSubTask = true">
                <span class="stx__add-plus">+</span>{{ $t('MembersV2.add_subtask') }}
                <span class="stx__add-hint">· <span class="ah-kbd">Tab</span> {{ $t('MembersV2.add_subtask_hint') }} <span class="ah-kbd">↵</span> {{ $t('MembersV2.add_subtask_hint_end') }}</span>
            </button>
        </template>

        <CreateTask
            v-if="createSubTask"
            :sprint="{ ...task.sprintArray, id: task.sprintId, folderId: task.folderObjId }"
            :taskId="task._id"
            :project="project"
            :assigneeOptions="task.AssigneeUserId"
            :considerWidth="false"
            class="stx__create"
            @cancel="createSubTask = false"
        />
        <SpinnerComp :is-spinner="isSpinner" />
    </section>
</template>

<script setup>
// PACKAGES
import { computed, defineProps, inject, nextTick, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

// COMPONENTS
import CreateTask from "@/components/atom/CreateTask/CreateTask.vue";
import SpinnerComp from "@/components/atom/SpinnerComp/SpinnerComp";
import Skelaton from "@/components/atom/Skelaton/AiSkelaton.vue";

// UTILS
import taskClass from "@/utils/TaskOperations";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { useAiApiFunction } from "@/composable/aiHelper";
import { openTask } from "@/components/organisms/TaskDetailOverlay/useTaskOverlay";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

const { t } = useI18n();
const { checkPermission, checkApps, debouncerWithPromise, debounce } = useCustomComposable();

// PROPS
const props = defineProps({
    task: {
        type: Object,
        required: true
    },
    parentAssignee: {
        type: Array,
        default: () => []
    },
    subTasksArray: {
        type: Array,
        default: () => []
    },
    isMainSpinner: {
        type: Boolean,
        default: false
    }
});

const createSubTask = ref(false);
const collapsed = ref(false);
const subTasks = ref(props.subTasksArray);
const skip = ref(0);
const limit = ref(35);
const project = inject("selectedProject");
const subTasksList = ref([]);
const isSpinner = ref(false);
const isSpinnerSuggest = ref(false);
const isError = ref(false);
const pending = reactive({});
const optimistic = reactive({});

const companyId = inject("$companyId");
const userId = inject("$userId");
const $toast = useToast();
const { getUser } = useGetterFunctions();
const { getters, commit } = useStore();
const { generateAiRequestForFunction } = useAiApiFunction();

const companyOwner = computed(() => getters["settings/companyOwnerDetail"]);
const taskDetailGetter = computed(() => getters["projectData/gettaskDetailData"]);

const canCreate = computed(() => checkPermission("task.sub_task_create", project.value?.isGlobalPermission) === true);
const canSetStatus = computed(() => checkPermission("task.task_status", project.value?.isGlobalPermission) === true);
const canUseAi = computed(() => checkApps("AI", project.value) && canCreate.value);

const visibleSubTasks = computed(() => subTasks.value.filter((sub) => sub && (sub.deletedStatusKey === 0 || sub.deletedStatusKey === undefined)));
const selectedAiCount = computed(() => subTasksList.value.filter((x) => x.isSelected === true).length);

function statusType(sub) {
    if (optimistic[sub._id]) return optimistic[sub._id];
    return sub?.status?.type || sub?.statusType || "";
}

function isDone(sub) {
    return statusType(sub) === "close";
}

const rollup = computed(() => {
    const list = visibleSubTasks.value;
    const total = list.length;
    const done = list.filter(isDone).length;
    const minutes = list.reduce((acc, s) => acc + (Number(s.totalEstimatedTime) || 0), 0);
    const doneMinutes = list.filter(isDone).reduce((acc, s) => acc + (Number(s.totalEstimatedTime) || 0), 0);
    return { total, done, minutes, doneMinutes, percent: total ? Math.round((done / total) * 100) : 0 };
});

const rollupText = computed(() => {
    const base = t("MembersV2.subtasks_count", { done: rollup.value.done, total: rollup.value.total });
    if (!rollup.value.minutes) return base;
    const asHours = (minutes) => Math.round((Number(minutes) || 0) / 60);
    return `${base} · ${t("MembersV2.subtasks_hours", { done: asHours(rollup.value.doneMinutes), total: asHours(rollup.value.minutes) })}`;
});

function hours(minutes) {
    const total = Number(minutes) || 0;
    if (!total) return "—";
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
}

function assignee(sub) {
    const id = sub?.AssigneeUserId?.[0];
    return id ? getUser(id) : null;
}

function initials(name) {
    return String(name || "?").trim().charAt(0).toUpperCase();
}

function open(sub) {
    openTask({
        companyId: companyId.value,
        projectId: sub.ProjectID || props.task.ProjectID,
        sprintId: sub.sprintId || props.task.sprintId,
        folderId: sub.folderObjId || props.task.folderObjId || "",
        taskId: sub._id
    });
}

function pickStatus(done) {
    const statuses = project.value?.taskStatusData || [];
    if (done) return statuses.find((s) => s.type === "close");
    return statuses.find((s) => s.type === "open") || statuses.find((s) => s.type !== "close");
}

// The parent rollup moves the moment the box is ticked; the server answer (and the
// socket echo) is what finally settles it, and a failure puts the old type back.
function toggle(sub, done) {
    const next = pickStatus(done);
    if (!next) return;
    const previousType = statusType(sub);
    optimistic[sub._id] = next.type;
    pending[sub._id] = true;
    const user = getUser(userId.value);
    const current = (project.value?.taskStatusData || []).find((s) => s.key === sub.statusKey) || {};
    taskClass.updateStatus({
        newStatus: {
            status: { text: next.name, key: next.key, type: next.type, value: next.value },
            statusType: next.type,
            statusKey: next.key
        },
        prevStatus: {
            backColor: current.bgColor,
            color: current.textColor,
            statusName: current.name,
            taskName: sub.TaskName,
            bgColor: next.bgColor,
            textColor: next.textColor,
            taskId: sub._id,
            updatedTaskName: next.name
        },
        projectData: {
            _id: project.value._id,
            CompanyId: project.value.CompanyId,
            lastTaskId: project.value.lastTaskId,
            ProjectName: project.value.ProjectName,
            ProjectCode: project.value.ProjectCode
        },
        task: sub,
        userData: { id: user.id, Employee_Name: user.Employee_Name, companyOwnerId: companyOwner.value?.userId }
    }).catch((error) => {
        console.error("ERROR in subtask status: ", error);
        optimistic[sub._id] = previousType;
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    }).finally(() => {
        delete pending[sub._id];
    });
}

watch(() => visibleSubTasks.value.map((s) => `${s._id}:${s?.status?.type || s?.statusType || ""}`).join("|"), () => {
    visibleSubTasks.value.forEach((s) => {
        if (optimistic[s._id] && optimistic[s._id] === (s?.status?.type || s?.statusType)) delete optimistic[s._id];
    });
});

watch(taskDetailGetter, (newVal) => {
    if (newVal?.fullDocument && Object.keys(newVal?.fullDocument).length) {
        if (newVal.isSubTaskUpdate) {
            const taskIndex = subTasks.value.findIndex((x) => x._id == newVal.fullDocument._id);
            if (!newVal.fullDocument?.deletedStatusKey) {
                if (taskIndex !== -1) {
                    subTasks.value[taskIndex] = { ...subTasks.value[taskIndex], ...newVal.fullDocument };
                } else {
                    subTasks.value.push(newVal.fullDocument);
                }
            }
        }
    } else if (newVal.isSubTaskData) {
        subTasks.value = newVal.data;
    }
});

function getTasks() {
    let queryObj = [
        {
            $match:
            {
                ParentTaskId: props.task._id,
                deletedStatusKey: { $in: [0, undefined] }
            }
        },
        { $sort: { createdAt: -1, _id: 1 } },
        { $skip: skip.value },
        {
            $limit: limit.value,
        }
    ];

    apiRequest('post', `${env.TASK}/find`, { findQuery: queryObj }).then((response) => {
        const res = response.data;
        res.forEach((sub) => {
            const index = subTasks.value.findIndex(item => item._id === sub._id);
            if (index !== -1) {
                subTasks.value[index] = sub;
            } else {
                subTasks.value.push(sub);
            }
        });
    })
    .catch((error) => {
        console.error("Error in getTasks hook: ", error);
    });
}

const onScroll = debounce((e) => {
    const { scrollTop, offsetHeight, scrollHeight } = e.target;
    if ((scrollTop + offsetHeight) >= scrollHeight) {
        skip.value += limit.value;
        getTasks();
    }
}, 50);

function sugestSubTask () {
    if(!isSpinnerSuggest.value){
        isSpinnerSuggest.value = true;
        subTasksList.value = [];
        debouncerWithPromise(1000).then(() => {
            isError.value = false;
            let data = {
                userId: userId.value,
                uniqueUserId: userId.value,
                companyId: companyId.value
            };
            generateAiRequestForFunction(data,props.task.TaskName,props.task.rawDescription,'Create SubTask',true,'single',project.value?.isGlobalPermission).then((result) => {
                if(result.status === true){
                    try {
                        isSpinnerSuggest.value = false;
                        subTasksList.value = JSON.parse(JSON.stringify(result.statusText.data.statusText));
                        subTasksList.value = subTasksList.value.replace(/\n|\r/g, '').trim();
                        subTasksList.value = eval(subTasksList.value);
                        if(isArrayOfObjects(subTasksList.value) == true){
                            subTasksList.value = eval(subTasksList.value).map((x) => ({...x,isSelected: true}));
                        }else{
                            isSpinnerSuggest.value = false;
                            isError.value = true;
                            subTasksList.value = [];
                        }
                    } catch (error) {
                        isSpinnerSuggest.value = false;
                        isError.value = true;
                        subTasksList.value = [];
                        console.error(error,"ERROR IN GENERAE PROMPTS:");
                    }
                }else{
                    if(result.isReachedLimit){
                        $toast.error(t("Toast.Ai_limit_reached"),{position: 'top-right'});
                    }else if(result.isNotAi){
                        $toast.error(result.statusText,{position: 'top-right'});
                    }
                    isSpinnerSuggest.value = false;
                }
            }).catch((error) => {
                isSpinnerSuggest.value = false;
                isError.value = true;
                console.error(error,"ERROR IN GENERAE PROMPTS:");
            });
        });
    }
}

function createSubTasks () {
    let array = subTasksList.value.filter((data) => data.isSelected);
    if(array.length > 0){
        subTasksList.value = [];
        isSpinner.value = true;
        let sprintObj = {
            id: props.task.sprintArray.id,
            name: props.task.sprintArray.name,
        };
        if(props.task.sprintArray.folderId){
            sprintObj.folderId = props.task.sprintArray.folderId;
            sprintObj.folderName = props.task.sprintArray.folderName;
        }

        const projectData = {
            _id: project.value._id,
            CompanyId: companyId.value,
            lastTaskId: project.value.lastTaskId,
            ProjectName: project.value.ProjectName,
            ProjectCode: project.value.ProjectCode
        };
        const user = getUser(userId.value);
        const userData = {
            id: user.id,
            Employee_Name: user.Employee_Name,
            companyOwnerId: companyOwner.value.userId,
        };
        taskClass.createSubTaskWithAi({
            companyId:companyId.value,
            userId: userId.value,
            subTitles: array,
            sprintObj: sprintObj,
            projectData: projectData,
            userData:userData,
            parentTask: {id: props.task._id, ProjectID: props.task.ProjectID},
            type: 'subTask'
        }).then((res) => {
            if(res.status === true){
                let subtaskArray = res.data;
                const showAllTasks = true;
                const pid = props.task.ProjectID;
                const sprintId = props.task.sprintArray.id;
                const snap = '';
                subtaskArray.forEach((x)=>{
                    subTasks.value.push(x);
                    commit("projectData/mutateUpdateFirebaseTasks",{
                        snap,
                        op: "added",
                        pid,
                        sprintId,
                        data: x,
                        showAllTasks,
                        updatedFields: x
                    });
                });
                nextTick(() => {
                    isSpinner.value = false;
                    $toast.success(t(`Toast.task_created_successfully`), {position: "top-right"});
                });
            }
        }).catch((error) => {
            $toast.error(t(`Toast.something_went_wrong`), {position: "top-right"});
            isSpinner.value = false;
            console.error(error);
        });
    }else{
        $toast.error(t(`Toast.Please_select_sub_task.`), {position:"top-right"});
    }
}

function isArrayOfObjects(arr) {
    if (!Array.isArray(arr)) {
        return false;
    }
    return arr.every(item => item !== null && typeof item === 'object');
}
</script>

<style>
@import './style.css';
</style>

<style scoped>
.stx {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 12px 14px;
    border: 1px solid var(--hairline);
    border-radius: 11px;
    background: var(--surface-2);
    color: var(--ink);
    font: 400 12.5px/1.4 var(--font-ui);
}
.stx__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.stx__title { font-weight: 600; }
.stx__rollup { color: var(--ink-3); }
.stx__bar {
    flex: 1;
    max-width: 120px;
    height: 5px;
    border-radius: 99px;
    background: rgba(0, 0, 0, .08);
    margin-left: 6px;
    overflow: hidden;
}
:root[data-theme="dark"] .stx__bar { background: rgba(255, 255, 255, .12); }
.stx__bar-fill { height: 100%; border-radius: 99px; background: var(--brand); transition: width var(--t-state) var(--ease); }
.stx__ai, .stx__link {
    border: 0;
    background: transparent;
    padding: 0;
    font: 600 11.5px/1 var(--font-ui);
    cursor: pointer;
}
.stx__ai { color: var(--agent); }
.stx__ai:disabled { opacity: .55; cursor: not-allowed; }
.stx__link { margin-left: auto; color: var(--brand); }
.stx__ai:hover, .stx__link:hover { text-decoration: underline; }

.stx__list { display: flex; flex-direction: column; gap: 9px; max-height: 320px; overflow-y: auto; }
.stx__row { display: flex; align-items: center; gap: 9px; min-width: 0; }
.stx__row.is-pending { opacity: .6; }
.stx__name {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    padding: 0;
    text-align: left;
    color: var(--ink);
    font: 400 12.5px/1.4 var(--font-ui);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.stx__name:hover { color: var(--brand); }
.stx__row.is-done .stx__name { text-decoration: line-through; color: var(--ink-2); }
.stx__hours { width: 44px; text-align: right; color: var(--ink-3); flex: none; }

.stx__empty { margin: 0; color: var(--ink-2); font-size: 12px; }
.stx__skeleton { height: 30px; border-radius: 8px; }

.stx__ai-list { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; border-top: 1px solid var(--hairline); }
.stx__ai-row { display: flex; align-items: center; gap: 8px; color: var(--ink); cursor: pointer; }
.stx__ai-actions { display: flex; justify-content: flex-end; gap: 8px; }

.stx__add {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--ink-2);
    font: 400 12.5px/1.4 var(--font-ui);
    cursor: pointer;
    text-align: left;
    flex-wrap: wrap;
}
.stx__add-plus { color: var(--brand); font-weight: 600; }
.stx__add:hover { color: var(--ink); }
.stx__add-hint { color: var(--ink-3); display: inline-flex; align-items: center; gap: 4px; }
.stx__create { margin: 0; }
</style>
