<template>
    <div class="ah-detail__panel-inner" :class="{ 'is-expanded': expanded, 'is-mobile': isMobile }" @keydown.capture="onKeydownCapture">
        <header class="ah-detail__head">
            <template v-if="isMobile">
                <button type="button" class="ah-detail__icon-btn" :aria-label="$t('TaskPanel.close')" @click="$emit('close')">
                    <ShellIcon name="chevron" :size="16" class="ah-detail__back-icon" />
                </button>
                <div class="ah-detail__crumb ah-detail__crumb--mobile ah-mono">
                    <span>{{ task.TaskKey }}</span><span v-if="projectData.ProjectName"> · {{ projectData.ProjectName }}</span>
                </div>
            </template>
            <template v-else>
                <span class="ah-detail__dot" aria-hidden="true"></span>
                <nav class="ah-detail__crumb" :aria-label="$t('TaskPanel.breadcrumb')">
                    <Skelaton v-if="isSpinner && !projectData.ProjectName" class="ah-detail__crumb-skeleton" />
                    <template v-else>
                        <button type="button" class="ah-detail__crumb-link" @click="open('project')">{{ projectData.ProjectName }}</button>
                        <template v-if="task.folderObjId && folderName">
                            <span class="ah-detail__crumb-sep">›</span>
                            <button type="button" class="ah-detail__crumb-link" @click="open('folder')">{{ folderName }}</button>
                        </template>
                        <span class="ah-detail__crumb-sep">›</span>
                        <button type="button" class="ah-detail__crumb-link" @click="open('sprint')">{{ sprintName }}</button>
                        <template v-if="task.isParentTask === false && parentTask">
                            <span class="ah-detail__crumb-sep">›</span>
                            <button type="button" class="ah-detail__crumb-link ah-mono" @click="open('parent')">{{ parentTask.TaskKey }}</button>
                        </template>
                    </template>
                </nav>
                <span class="ah-detail__key ah-mono">{{ task.TaskKey }}</span>
            </template>
            <div class="ah-detail__head-actions">
                <button v-if="!isMobile && !expanded" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="$emit('expand')">
                    <ShellIcon name="expand" :size="13" />{{ $t('TaskPanel.expand') }}
                </button>
                <button v-if="!isMobile" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="$emit('minimize')">
                    <ShellIcon name="minimize" :size="13" />{{ $t('TaskPanel.minimize') }}
                </button>
                <TaskDetailAction
                    v-if="task && task._id && projectData._id"
                    class="ah-detail__more"
                    :watchers="task.watchers"
                    :task="task"
                    :isSpinner="isSpinner"
                    @open="(val) => open(val)"
                    @update:watchers="(id, type) => updateWatchers(id, type)"
                    @close="$emit('close')"
                />
                <button v-if="!isMobile" type="button" class="ah-detail__icon-btn" :aria-label="$t('TaskPanel.close')" :title="`${$t('TaskPanel.close')} · Esc`" @click="$emit('close')">
                    <ShellIcon name="x" :size="15" />
                </button>
            </div>
        </header>

        <TaskAgentStrip v-if="agentRun" :run="agentRun" />

        <div class="ah-detail__body">
            <div class="ah-detail__main ah-scroll" ref="mainEl">
                <div class="ah-detail__title-row">
                    <input
                        type="checkbox"
                        class="ah-check ah-detail__done"
                        :checked="isDone"
                        :disabled="!canSetStatus || isSpinner"
                        :aria-label="$t('TaskPanel.mark_done')"
                        :title="isDone ? $t('TaskPanel.reopen') : $t('TaskPanel.mark_done')"
                        @change="toggleDone($event.target.checked)"
                    />
                    <Skelaton v-if="isSpinner && !task.TaskName" class="ah-detail__title-skeleton" />
                    <TaskDetailTitle
                        v-else-if="task.TaskName && projectData._id"
                        class="ah-detail__title"
                        :taskName="task.TaskName"
                        :taskType="task.TaskTypeKey"
                        :favourites="task.favouriteTasks"
                        :userId="user.id"
                        @update:favourite="updateFavourite"
                        @update:taskName="(val) => updateTaskName(val)"
                        @update:taskType="(val) => changeTaskType(val)"
                    />
                </div>

                <div v-if="isMobile && task._id" class="ah-detail__chips">
                    <button type="button" class="ah-chip ah-chip--brand" :style="statusChipStyle" @click="sheetOpen = true">{{ statusName }} ▾</button>
                    <span v-if="priorityName" class="ah-chip ah-chip--warn">{{ priorityName }}</span>
                    <span v-if="task.DueDate" class="ah-chip">{{ formatDay(task.DueDate) }}</span>
                    <button type="button" class="ah-chip ah-detail__chips-more" @click="sheetOpen = true">{{ $t('TaskPanel.properties') }}</button>
                </div>

                <TaskSummaryBlock v-if="task._id && canComment" ref="summaryRef" :taskId="task._id" @count="(n) => commentTotal = n" />

                <div class="ah-detail__tabs" role="tablist">
                    <button
                        v-for="item in tabs"
                        :key="item.id"
                        type="button"
                        role="tab"
                        class="ah-detail__tab"
                        :class="{ 'is-active': activeTab === item.id }"
                        :aria-selected="activeTab === item.id"
                        @click="activeTab = item.id"
                    >
                        {{ item.label }}<span v-if="item.count" class="ah-detail__tab-count ah-mono">{{ item.count }}</span>
                    </button>
                </div>

                <div class="ah-detail__pane" :class="`ah-detail__pane--${activeTab}`">
                    <TaskDetailTab
                        v-if="activeTab === 'description' && task._id && projectData._id"
                        :task="task"
                        :subTasksArray="subTasks"
                        :isMainSpinner="isSpinner"
                        :docsRefreshKey="docsRefreshKey"
                        :sections="descriptionSections"
                        @openSeeAll="activeTab = 'files'"
                        @openDoc="openDoc"
                    />
                    <TaskSubtaskList
                        v-else-if="activeTab === 'subtasks' && task._id && projectData._id"
                        :task="task"
                        :project="projectData"
                        :subtasks="subTasks"
                        :isMainSpinner="isSpinner"
                        @open="(sub) => openSubtask(sub)"
                    />
                    <TaskDetailTab
                        v-else-if="activeTab === 'files' && task._id && projectData._id"
                        :task="task"
                        :subTasksArray="subTasks"
                        :isMainSpinner="isSpinner"
                        :sections="filesSections"
                    />
                    <div v-else-if="activeTab === 'relations' && task._id" class="ah-detail__relations">
                        <LinkedTasks :task="task" />
                        <p class="ah-detail__relations-note ah-small">{{ $t('TaskPanel.relations_note') }}</p>
                    </div>
                </div>

                <section v-if="!isMobile || activeTab === 'activity'" class="ah-detail__activity" ref="activityEl">
                    <div class="ah-detail__activity-head">
                        <span class="ah-label">{{ $t('TaskPanel.activity') }}</span>
                        <div class="ah-tabs">
                            <button v-if="canComment" type="button" class="ah-tab" :class="{ 'is-active': activityView === 'comments' }" @click="activityView = 'comments'">
                                {{ $t('TaskPanel.comments') }}<span v-if="commentTotal" class="ah-detail__tab-count ah-mono">{{ commentTotal }}</span>
                            </button>
                            <button v-if="canSeeHistory" type="button" class="ah-tab" :class="{ 'is-active': activityView === 'history' }" @click="activityView = 'history'">{{ $t('TaskPanel.history') }}</button>
                        </div>
                        <span v-if="aiDrafting" class="ah-detail__drafting ah-small">✦ {{ $t('TaskPanel.ai_drafting') }}</span>
                    </div>
                    <div v-if="activityView === 'comments' && canComment && task._id && projectData._id" class="ah-detail__comments">
                        <Comments
                            :key="`comments-${task._id}`"
                            :taskId="task._id"
                            :parentTaskId="task.ParentTaskId"
                            :sprintId="task.sprintId"
                            :folderId="task.folderObjId || null"
                            :userIds="commentUsers"
                            :watchers="[...(task.watchers || [])]"
                            :title="task.TaskName"
                            :checklistArray="task.checklistArray"
                            :sprintName="task.sprintArray?.name"
                            :folderName="task.sprintArray?.folderName"
                            :productData="productData"
                            :forSupport="isSupportProject"
                            :creator="{ uid: task.Task_Leader, date: task.createdAt }"
                        />
                    </div>
                    <div v-else-if="activityView === 'history' && task._id" class="ah-detail__history">
                        <ActivityLog :dataObj="task" :fromProject="false" :isMainSpinner="isSpinner" />
                    </div>
                </section>

                <div v-if="isMobile && task._id" class="ah-detail__mobile-timer">
                    <TaskTimerChip :task="task" :project="projectData" :canStart="canTrack" :showLabel="true" @logged="refreshLogged" />
                </div>
            </div>

            <aside
                v-if="task._id && (!isMobile || sheetOpen)"
                class="ah-detail__props ah-scroll"
                :class="{ 'ah-detail__sheet': isMobile }"
                :aria-label="$t('TaskPanel.properties')"
            >
                <div v-if="isMobile" class="ah-detail__sheet-head">
                    <span class="ah-detail__sheet-grip" aria-hidden="true"></span>
                    <span class="ah-h3">{{ $t('TaskPanel.properties') }}</span>
                    <button type="button" class="ah-detail__icon-btn" :aria-label="$t('TaskPanel.close')" @click="sheetOpen = false"><ShellIcon name="x" :size="15" /></button>
                </div>
                <TaskDetailRightSide
                    v-if="projectData._id"
                    :task="task"
                    :parentTask="parentTask"
                    :taskStatusIndex="10"
                    :zIndexAssigne="10"
                    :zIndexPriority="10"
                    :zIndexEstimate="10"
                    :isMainSpinner="isSpinner"
                    :clientWidth="clientWidth"
                />
                <div class="ah-detail__prop">
                    <span class="ah-detail__prop-label">{{ $t('TaskPanel.sprint') }}</span>
                    <button type="button" class="ah-detail__prop-link" @click="open('sprint')">{{ sprintName || '—' }}</button>
                </div>
                <div class="ah-detail__prop">
                    <span class="ah-detail__prop-label">{{ $t('TaskPanel.type') }}</span>
                    <span>{{ taskTypeName || '—' }}</span>
                </div>
                <div v-if="checkApps('tags', projectData)" class="ah-detail__prop ah-detail__prop--tags">
                    <span class="ah-detail__prop-label">{{ $t('TaskPanel.tags') }}</span>
                    <div class="ah-detail__tags">
                        <div v-for="(item, index) in tagChipArray" :key="index" class="tagList" @click.stop>
                            <TagChip :data="item" :isBorder="false" :ids="tagIds" :tagsArray="projectData.tagsArray" :prjectGlobalPermission="projectData?.isGlobalPermission" :taskId="task._id" :sprintId="task.sprintId" :taskName="task.TaskName" />
                        </div>
                        <CreateTagPopup
                            v-if="checkPermission('task.task_tag', projectData?.isGlobalPermission) !== null"
                            :task="task"
                            :project="projectData"
                            :isTaskList="false"
                            @send:tagChipArray="(val) => tagChipArray = val"
                            @send:ids="(val) => tagIds = val"
                        />
                    </div>
                </div>

                <div class="ah-detail__prop-group" v-if="checkApps('TimeTracking', projectData)">
                    <div class="ah-detail__prop">
                        <span class="ah-detail__prop-label">{{ $t('TaskPanel.logged') }}</span>
                        <span class="ah-mono">{{ loggedText }}</span>
                    </div>
                    <TaskTimerChip v-if="!isMobile" :task="task" :project="projectData" :canStart="canTrack" @logged="refreshLogged" />
                </div>

                <div class="ah-detail__prop-group">
                    <span class="ah-label">{{ $t('TaskPanel.relations') }}</span>
                    <template v-if="relations.length">
                        <button v-for="item in relations" :key="`rel-${item.taskId}`" type="button" class="ah-detail__relation" @click="openRelated(item)">
                            <span class="ah-detail__relation-type">{{ relationLabel(item.type) }} {{ relationArrow(item.type) }}</span>
                            <span class="ah-mono">{{ item.task?.TaskKey }}</span>
                            <span class="ah-detail__relation-name">{{ item.task?.TaskName || $t('Projects.link_task_unavailable') }}</span>
                        </button>
                    </template>
                    <button v-else type="button" class="ah-detail__prop-link ah-small" @click="activeTab = 'relations'">{{ $t('TaskPanel.no_relations') }}</button>
                </div>

                <div class="ah-detail__foot ah-small">
                    <span v-if="task.createdAt">{{ $t('TaskPanel.created_by', { date: formatDay(task.createdAt), name: leaderName }) }}</span>
                    <span v-if="task.watchers?.length"> · {{ $t('TaskPanel.watched_by', { n: task.watchers.length }) }}</span>
                </div>
            </aside>
            <div v-if="isMobile && sheetOpen" class="ah-detail__sheet-scrim" @click="sheetOpen = false"></div>
        </div>

        <div v-if="isMobile && activeTab !== 'activity' && canComment" class="ah-detail__mobile-compose">
            <button type="button" class="ah-detail__mobile-compose-input" @click="jumpToComposer">{{ $t('TaskPanel.comment_placeholder') }}</button>
            <button type="button" class="ah-detail__mobile-compose-send" :aria-label="$t('TaskPanel.send')" @click="jumpToComposer"><ShellIcon name="chevron" :size="16" class="ah-detail__send-icon" /></button>
        </div>

        <PagesPanel v-if="projectData._id" v-model="showDocs" :projectData="projectData" :openDocId="openDocId" />
    </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";
import moment from "moment";

import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue";
import TaskDetailTitle from "@/components/molecules/TaskDetailTitle/TaskDetailTitle.vue";
import TaskDetailAction from "@/components/molecules/TaskDetailAction/TaskDetailAction.vue";
import TaskDetailTab from "@/components/molecules/TaskDetailTab/TaskDetailTab.vue";
import TaskDetailRightSide from "@/components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue";
import LinkedTasks from "@/components/organisms/LinkedTasks/LinkedTasks.vue";
import Comments from "@/views/Projects/Comments/Comments.vue";
import ActivityLog from "@/components/templates/ActivityLog/ActivityLog.vue";
import PagesPanel from "@/components/molecules/Pages/PagesPanel.vue";
import TagChip from "@/components/atom/TagChip/TagChip.vue";
import CreateTagPopup from "@/components/molecules/TagList/CreateTagPopup.vue";
import TaskSummaryBlock from "./TaskSummaryBlock.vue";
import TaskSubtaskList from "./TaskSubtaskList.vue";
import TaskTimerChip from "./TaskTimerChip.vue";
import TaskAgentStrip from "./TaskAgentStrip.vue";

import taskClass from "@/utils/TaskOperations";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { dbCollections } from "@/utils/Collections";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { useUpdateTasks } from "@/views/Projects/helper";
import { openTask, setTaskMeta } from "./useTaskOverlay";
import { useRoute, useRouter } from "vue-router";

defineOptions({ name: "TaskDetailPanel" });

const props = defineProps({
    companyId: { type: String, required: true },
    projectId: { type: String, required: true },
    sprintId: { type: String, default: "" },
    folderId: { type: String, default: "" },
    taskId: { type: String, required: true },
    tab: { type: String, default: "" },
    expanded: { type: Boolean, default: false },
    /** @type {import('vue').PropType<{agentName:string,status:'running'|'review'|'done'|'failed',startedAt?:number|string,summary?:string,onStop?:Function}|null>} */
    agentRun: { type: Object, default: null }
});
const emit = defineEmits(["close", "expand", "minimize", "loaded"]);

const { t } = useI18n();
const $toast = useToast();
const router = useRouter();
const route = useRoute();
const { getters, dispatch, commit } = useStore();
const { getUser, getPriority } = useGetterFunctions();
const { checkPermission, checkApps } = useCustomComposable();
const { updateTaskByGroup } = useUpdateTasks();
const socket = inject("$socket");
const clientWidth = inject("$clientWidth");
const currentUserId = inject("$userId");

const user = getUser(currentUserId.value) || {};
const isMobile = computed(() => clientWidth.value <= 767);

const task = ref({});
const parentTask = ref(null);
const projectData = ref({});
const subTasks = ref([]);
const subTaskLimit = 35;
const fetchedSubtaskCount = ref(null);
const isSpinner = ref(true);
const relations = ref([]);
const loggedMinutes = ref(null);
const commentTotal = ref(0);
const tagChipArray = ref([]);
const tagIds = ref({});
const sheetOpen = ref(false);
const showDocs = ref(false);
const openDocId = ref("");
const docsRefreshKey = ref(0);
const aiDrafting = ref(false);
const summaryRef = ref(null);
const mainEl = ref(null);
const activityEl = ref(null);

const activeTab = ref(props.tab === "activity" && isMobile.value ? "activity" : "description");
const activityView = ref("comments");
let debounceTimeout = null;

const companyOwner = computed(() => getters["settings/companyOwnerDetail"]);
const taskDetailGetter = computed(() => getters["projectData/gettaskDetailData"]);
const users = computed(() => getters["settings/companyUsers"]?.map((x) => x.userId));

const canComment = computed(() => checkPermission("task.task_comment", projectData.value?.isGlobalPermission) === true);
const canSeeHistory = computed(() => checkPermission("task.task_activity_log", projectData.value?.isGlobalPermission) === true);
const canSetStatus = computed(() => checkPermission("task.task_status", projectData.value?.isGlobalPermission) === true);
const canTrack = computed(() => (task.value?.AssigneeUserId || []).includes(currentUserId.value) && !isDone.value);
const isSupportProject = computed(() => process.env.VUE_APP_SUPPORT_PROJECTID === projectData.value._id);
const productData = computed(() => ({
    customerId: task.value?.customField?.[process.env.VUE_APP_CUSTOMFIELDID]?.fieldValue,
    productName: task.value?.customField?.[process.env.VUE_APP_CUSTOMFIELDPRODUCTID]?.fieldValue
}));

const isDone = computed(() => (task.value?.status?.type || task.value?.statusType) === "close");
const statusName = computed(() => task.value?.status?.text || projectData.value?.taskStatusData?.find((s) => s.key === task.value?.statusKey)?.name || "");
const statusChipStyle = computed(() => {
    const status = projectData.value?.taskStatusData?.find((s) => s.key === task.value?.statusKey);
    return status?.bgColor ? { background: status.bgColor, color: status.textColor } : {};
});
const priorityName = computed(() => (task.value?.Task_Priority ? getPriority(task.value.Task_Priority)?.name : ""));
const taskTypeName = computed(() => projectData.value?.taskTypeCounts?.find((x) => x.key === task.value?.TaskTypeKey)?.name || "");
const leaderName = computed(() => getUser(task.value?.Task_Leader)?.Employee_Name || "");
const sprintData = computed(() => {
    if (!projectData.value || !task.value) return null;
    return task.value.folderObjId
        ? projectData.value?.sprintsfolders?.[task.value.folderObjId]?.sprintsObj?.[task.value.sprintId]
        : projectData.value?.sprintsObj?.[task.value.sprintId];
});
const sprintName = computed(() => task.value?.sprintArray?.name || sprintData.value?.name || task.value?.sprintName || "");
const folderName = computed(() => task.value?.sprintArray?.folderName || sprintData.value?.folderName || task.value?.folderName || "");

const subtaskCompletion = computed(() => {
    const valid = subTasks.value.filter((s) => s && (s.deletedStatusKey === 0 || s.deletedStatusKey === undefined));
    const loadedTotal = valid.length;
    const loadedCompleted = valid.filter((s) => (s?.status?.type || s?.statusType) === "close").length;
    const fetched = fetchedSubtaskCount.value;
    const trueTotal = Math.max(loadedTotal, Number(task.value?.subTasks) || 0, (fetched && fetched.total) || 0);
    if (loadedTotal >= trueTotal) return { total: loadedTotal, completed: loadedCompleted };
    if (fetched && fetched.total) return fetched;
    return { total: trueTotal, completed: loadedCompleted };
});

const tabs = computed(() => {
    const list = [];
    if (isMobile.value && canComment.value) list.push({ id: "activity", label: t("TaskPanel.activity") });
    list.push({ id: "description", label: t("TaskPanel.description") });
    if (task.value?.isParentTask !== false && checkPermission("task.sub_task_create", projectData.value?.isGlobalPermission) !== null) {
        const c = subtaskCompletion.value;
        list.push({ id: "subtasks", label: t("TaskPanel.subtasks"), count: c.total ? `${c.completed}/${c.total}` : "" });
    }
    if (checkPermission("task.task_attachments", projectData.value?.isGlobalPermission) !== null) {
        list.push({ id: "files", label: t("TaskPanel.files"), count: task.value?.attachments?.length || "" });
    }
    list.push({ id: "relations", label: t("TaskPanel.relations_tab"), count: relations.value.length || "" });
    return list;
});

const descriptionSections = { tags: false, subtasks: false, linkedTasks: false, attachments: false };
const filesSections = { tags: false, description: false, subtasks: false, linkedTasks: false, linkedDocs: false, epic: false, customFields: false, checklist: false, attachments: true };

const commentUsers = computed(() => {
    if (sprintData.value?.private) return Array.from(new Set([...(sprintData.value?.AssigneeUserId || []), ...(task.value.watchers || [])]));
    if (projectData.value?.isPrivateSpace) return [...(projectData.value?.AssigneeUserId || [])];
    return [...(users.value || [])];
});

const loggedText = computed(() => {
    const minutes = loggedMinutes.value;
    if (minutes === null) return "…";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
});

function formatDay(value) {
    const date = value?.seconds ? new Date(value.seconds * 1000) : new Date(value);
    return moment(date).format("ddd MMM D");
}

function userData() {
    return { id: user.id, name: user.Employee_Name, Employee_Name: user.Employee_Name, companyOwnerId: companyOwner.value?.userId };
}
function projectSlice() {
    return {
        _id: projectData.value._id,
        CompanyId: projectData.value.CompanyId,
        lastTaskId: projectData.value.lastTaskId,
        ProjectName: projectData.value.ProjectName,
        ProjectCode: projectData.value.ProjectCode
    };
}

function updateTaskName(val) {
    if (!val?.trim()?.length) return;
    taskClass.updateTaskName({
        firebaseObj: { TaskName: val },
        projectData: projectSlice(),
        taskData: task.value,
        obj: { previousTaskName: task.value.TaskName, userName: user.Employee_Name },
        userData: userData()
    }).then(() => {
        $toast.success(t("Toast.Task_name_updated_successfully"), { position: "top-right" });
    }).catch((err) => console.error(err));
}

function updateFavourite() {
    taskClass.markAsFavourite({
        companyId: projectData.value.CompanyId,
        projectId: projectData.value._id,
        sprintId: props.sprintId,
        taskData: task.value,
        userId: user.id
    }).then((res) => {
        if (res.status === 200) $toast.success(res.statusText, { position: "top-right" });
        else $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    }).catch((error) => {
        console.error("ERROR in markAsFavourite: ", error);
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    });
}

function updateWatchers(userId, type) {
    taskClass.updateWatcher({
        companyId: projectData.value.CompanyId,
        projectId: projectData.value._id,
        sprintId: props.sprintId,
        taskId: props.taskId,
        userId,
        watchers: task.value?.watchers,
        add: type === "add",
        userData: { id: user.id, Employee_Name: user.Employee_Name, companyOwnerId: companyOwner.value?.userId },
        employeeName: getUser(userId)?.Employee_Name
    }).then(() => {
        $toast.success(t(`Toast.${type === "add" ? "Watcher_added_successfully" : "Watcher_removed_successfully"}`), { position: "top-right" });
    }).catch((error) => console.error("ERROR in updateWatcher: ", error));
}

function changeTaskType(status) {
    const index = projectData.value.taskTypeCounts?.findIndex((x) => x.key === task.value.TaskTypeKey);
    if (index === -1 || index === undefined) return;
    updateTaskByGroup(task.value, status, 4);
}

function toggleDone(done) {
    const statuses = projectData.value?.taskStatusData || [];
    const next = done ? statuses.find((s) => s.type === "close") : (statuses.find((s) => s.type === "open") || statuses.find((s) => s.type !== "close"));
    if (!next) return;
    const current = statuses.find((s) => s.key === task.value.statusKey) || {};
    taskClass.updateStatus({
        newStatus: { status: { text: next.name, key: next.key, type: next.type, value: next.value }, statusType: next.type, statusKey: next.key },
        prevStatus: {
            backColor: current.bgColor, color: current.textColor, statusName: current.name,
            taskName: task.value.TaskName, bgColor: next.bgColor, textColor: next.textColor,
            taskId: task.value._id, updatedTaskName: next.name
        },
        projectData: projectSlice(),
        task: task.value,
        userData: userData()
    }).then(() => {
        $toast.success(t("Toast.Status_updated_successfully"), { position: "top-right" });
    }).catch(() => {
        $toast.error(t("Toast.Status_not_updated"), { position: "top-right" });
    });
}

function open(val) {
    const query = { ...route.query };
    delete query.detailTab;
    delete query.task;
    const base = { cid: props.companyId, id: props.projectId };
    switch (val) {
        case "project":
            emit("close");
            router.push({ name: "Project", params: base, query });
            break;
        case "sprint":
            emit("close");
            router.push(task.value.folderObjId
                ? { name: "ProjectFolderSprint", params: { ...base, sprintId: props.sprintId, folderId: task.value.folderObjId }, query }
                : { name: "ProjectSprint", params: { ...base, sprintId: props.sprintId }, query });
            break;
        case "folder":
            if (task.value.folderObjId) {
                emit("close");
                router.push({ name: "ProjectFolder", params: { ...base, folderId: task.value.folderObjId }, query });
            }
            break;
        case "parent":
            if (parentTask.value) {
                openTask({
                    companyId: props.companyId,
                    projectId: props.projectId,
                    sprintId: parentTask.value.sprintId || props.sprintId,
                    folderId: parentTask.value.folderObjId || "",
                    taskId: parentTask.value._id
                });
            }
            break;
        case "filesLinks":
            activeTab.value = "files";
            break;
        default:
            break;
    }
}

function openSubtask(sub) {
    openTask({
        companyId: props.companyId,
        projectId: sub.ProjectID || props.projectId,
        sprintId: sub.sprintId || props.sprintId,
        folderId: sub.folderObjId || "",
        taskId: sub._id
    });
}

function openRelated(item) {
    const related = item.task;
    if (!related || !related._id) return;
    openTask({
        companyId: props.companyId,
        projectId: related.ProjectID || props.projectId,
        sprintId: related.sprintId || props.sprintId,
        folderId: related.folderObjId || "",
        taskId: related._id
    });
}

function relationLabel(type) {
    const keys = {
        blocks: "Projects.relation_blocks",
        blocked_by: "Projects.relation_blocked_by",
        duplicates: "Projects.relation_duplicates",
        duplicated_by: "Projects.relation_duplicated_by",
        relates_to: "Projects.relation_relates_to"
    };
    return keys[type] ? t(keys[type]).toLowerCase() : type;
}
function relationArrow(type) {
    if (type === "blocks" || type === "duplicates") return "→";
    if (type === "blocked_by" || type === "duplicated_by") return "←";
    return "↔";
}

function openDoc(doc) {
    if (!doc || !doc._id) return;
    openDocId.value = String(doc._id);
    showDocs.value = true;
}
watch(showDocs, (isOpen, wasOpen) => {
    if (wasOpen && !isOpen) docsRefreshKey.value += 1;
});

function fetchRelations() {
    if (!task.value?._id) return;
    apiRequest("post", "/api/v2/tasks/relations", { action: "list", taskId: task.value._id }).then((response) => {
        relations.value = response.data?.status ? (response.data.data || []) : [];
    }).catch((error) => console.error("ERROR in fetch task relations: ", error));
}

function refreshLogged() {
    if (!task.value?._id) return;
    apiRequest("post", env.MONGO_OPRATION, {
        dbName: props.companyId,
        collection: dbCollections.TIMESHEETS,
        methodName: "aggregate",
        dataObj: [[{ $match: { TicketID: task.value._id } }, { $group: { _id: null, total: { $sum: "$LogTimeDuration" } } }]]
    }).then((response) => {
        const rows = response?.data?.statusText;
        loggedMinutes.value = Array.isArray(rows) && rows[0] ? Number(rows[0].total) || 0 : 0;
    }).catch((error) => {
        console.error("ERROR in logged time: ", error);
        loggedMinutes.value = 0;
    });
}

function fetchSubtaskCount() {
    const parentId = task.value?._id;
    if (!parentId) { fetchedSubtaskCount.value = null; return; }
    const totalCount = Number(task.value?.subTasks) || 0;
    const mayBeIncomplete = totalCount > subTaskLimit || (totalCount === 0 && subTasks.value.length >= subTaskLimit);
    if (!mayBeIncomplete) { fetchedSubtaskCount.value = null; return; }
    apiRequest("post", `${env.TASK}/find`, {
        findQuery: [
            { $match: { ParentTaskId: String(parentId), deletedStatusKey: { $in: [0, undefined] } } },
            { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$statusType", "close"] }, 1, 0] } } } }
        ]
    }).then((response) => {
        const row = response?.data && response.data[0];
        if (row) fetchedSubtaskCount.value = { total: Number(row.total) || 0, completed: Number(row.completed) || 0 };
    }).catch((error) => console.error("ERROR in fetchSubtaskCount: ", error));
}

function getParentTask() {
    if (!task.value?.ParentTaskId) { parentTask.value = null; return; }
    apiRequest("get", `${env.TASK}/${task.value.ParentTaskId}`).then((response) => {
        if (response?.status === 200 && response?.data) parentTask.value = response.data;
    }).catch((error) => console.error("error in getting the parent task", error));
}

function indexSprintsAndFolders(id, sprintsResult, foldersResult) {
    const sprints = {};
    const folders = {};
    (foldersResult || []).forEach((folder) => {
        if (folder.projectId !== id) return;
        folders[folder._id] = { folderId: folder._id, name: folder.name, sprintsObj: {}, deletedStatusKey: folder.deletedStatusKey, legacyId: folder?.legacyId || "", id: folder._id, _id: folder._id };
    });
    (sprintsResult || []).forEach((sprint) => {
        if (sprint.projectId !== id) return;
        sprint.id = sprint._id;
        if (sprint.folderId && folders[sprint.folderId]) {
            sprint.folderName = folders[sprint.folderId].name;
            folders[sprint.folderId].sprintsObj[sprint._id] = sprint;
        } else if (!sprint.folderId) {
            sprints[sprint._id] = sprint;
        }
    });
    return { sprints, folders };
}

function loadTask() {
    const queryParams = new URLSearchParams({ taskId: props.taskId, projectId: props.projectId, subTaskLimit }).toString();
    apiRequest("get", `${env.TASK_DATA}?${queryParams}`).then((res) => {
        if (res.status !== 200 || !res.data.length) return;
        const response = res.data[0];
        const { sprints, folders } = indexSprintsAndFolders(response._id, response.sprintsObj, response.sprintsfolders);
        response.sprintsObj = sprints;
        response.sprintsfolders = folders;
        projectData.value = response;
        task.value = response.tasks[0] || {};
        subTasks.value = response.subtasks || [];
        isSpinner.value = false;
        commit("projectData/setTaskDetailData", { isSubTaskData: true, data: subTasks.value });
        fetchSubtaskCount();
        getParentTask();
        fetchRelations();
        refreshLogged();
        setTaskMeta(props.taskId, { taskKey: task.value.TaskKey, taskName: task.value.TaskName });
        emit("loaded", task.value);
        if (!projectData.value?.isGlobalPermission && !(getters["settings/projectRules"] && Object.keys(getters["settings/projectRules"])?.length > 0)) {
            dispatch("settings/setProjectRules", { pid: props.projectId }).catch((error) => console.error("ERROR in get project rules", error));
        }
    }).catch((error) => console.error(error));
}

watch(taskDetailGetter, (newVal) => {
    if (!newVal) return;
    const { fullDocument, updatedFields, isSubTaskUpdate } = newVal;
    if (fullDocument && Object.keys(fullDocument).length) {
        if (!isSubTaskUpdate) task.value = { ...task.value, ...fullDocument };
        loadTask();
    }
    const deleted = updatedFields?.deletedStatusKey === 1 || updatedFields?.deletedStatusKey === 2;
    if (deleted && (fullDocument?._id === props.taskId || fullDocument?.isParentTask)) {
        $toast.info(t(updatedFields.deletedStatusKey === 1 ? "Toast.Task_deleted_successfully" : "Toast.Task_archived_successfully"), { position: "top-right" });
        emit("close");
        return;
    }
    if (updatedFields && Object.keys(updatedFields).includes("remainingHours")) {
        task.value = { ...task.value, remainingHours: updatedFields.remainingHours };
        refreshLogged();
    }
    if (updatedFields && "relations" in updatedFields) fetchRelations();
});

watch(() => task.value?.TaskName, (name) => {
    if (name) setTaskMeta(props.taskId, { taskKey: task.value.TaskKey, taskName: name });
});

watch(() => props.tab, (value) => {
    if (value === "activity") {
        if (isMobile.value) activeTab.value = "activity";
        else nextTick(() => activityEl.value?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } else if (value && tabs.value.some((item) => item.id === value)) {
        activeTab.value = value;
    }
}, { immediate: true });

watch(isMobile, (mobile) => {
    if (!mobile && activeTab.value === "activity") activeTab.value = "description";
});

function jumpToComposer() {
    activeTab.value = "activity";
    activityView.value = "comments";
    nextTick(() => document.getElementById("message-box")?.focus());
}

async function draftWithAi(textarea) {
    const intent = textarea.value.replace(/^\/ai\s*/i, "").trim();
    aiDrafting.value = true;
    try {
        const response = await apiRequest("post", env.AI_WRITE_DESCRIPTION, {
            title: task.value.TaskName || "",
            taskType: "comment",
            existingDescription: "",
            intent: intent || t("TaskPanel.ai_default_intent"),
            answers: [],
            mode: "rewrite"
        });
        const payload = response?.data || {};
        const draft = payload.status === true ? (payload.data?.description || payload.data?.questions?.join("\n") || "") : "";
        if (!draft) {
            $toast.error(payload.statusText || t("AI.ai_failed"), { position: "top-right" });
            return;
        }
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(textarea, draft);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.focus();
    } catch (error) {
        $toast.error(error?.response?.data?.statusText || t("AI.ai_failed"), { position: "top-right" });
    } finally {
        aiDrafting.value = false;
    }
}

function onKeydownCapture(event) {
    const target = event.target;
    if (!target || target.id !== "message-box" || event.key !== "Enter" || event.shiftKey) return;
    if (!/^\/ai(\s|$)/i.test(target.value || "")) return;
    event.preventDefault();
    event.stopPropagation();
    if (!aiDrafting.value) draftWithAi(target);
}

function visibilityHandler() {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => { if (!document.hidden) loadTask(); }, 1000);
}

function onCommentInsert(data) {
    if (String(data?.fullDocument?.taskId || "") === String(props.taskId)) summaryRef.value?.refresh?.();
}

onMounted(async () => {
    loadTask();
    document.addEventListener("visibilitychange", visibilityHandler);
    if (socket?.value?.on) socket.value.on("commentInsert", onCommentInsert);
    dispatch("projectData/getTaskDetailSnapShot", { taskId: props.taskId }).catch((error) => console.error(error));
});

onBeforeUnmount(() => {
    commit("projectData/setTaskDetailData", {});
    commit("projectData/setTaskdetailPayloadId", {});
    ["taskDetail_taskUpdate", "taskDetail_taskDelete", "taskDetail_taskInsert"].forEach((event) => socket?.value?.off?.(event));
    socket?.value?.off?.("commentInsert", onCommentInsert);
    socket?.value?.emit?.("leaveTaskDetail", `taskDetail_${props.taskId}**${socket.value.id}`);
    clearTimeout(debounceTimeout);
    document.removeEventListener("visibilitychange", visibilityHandler);
});

provide("selectedProject", projectData);
provide("subtaskCompletion", subtaskCompletion);
provide("showArchived", ref(false));
provide("isSupport", ref(false));
provide("isRouteRequired", false);
provide("showLoader", ref(false));
provide("progress", ref(0));
provide("toggleTaskDetail", (target) => {
    if (target && target._id) openSubtask(target);
});
</script>
