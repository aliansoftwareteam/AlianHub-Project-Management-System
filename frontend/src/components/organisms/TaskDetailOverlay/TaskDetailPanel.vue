<template>
    <div class="ah-detail__panel-inner" :class="{ 'is-expanded': expanded, 'is-mobile': isMobile }" @keydown.capture="onKeydownCapture">
        <header class="ah-detail__head">
            <template v-if="isMobile">
                <button type="button" class="ah-detail__icon-btn" :aria-label="$t('TaskPanel.close')" @click="$emit('close')">
                    <ShellIcon name="chevron" :size="16" class="ah-detail__back-icon" />
                </button>
                <div class="ah-detail__crumb ah-detail__crumb--mobile ah-mono">
                    <button v-if="task.TaskKey" type="button" class="ah-detail__key" :aria-label="$t('TaskPanel.copy_id', { key: task.TaskKey })" :title="$t('TaskPanel.copy_id', { key: task.TaskKey })" @click="copyKey">{{ task.TaskKey }}</button>
                    <span v-if="projectData.ProjectName" class="ah-detail__crumb-project"> · {{ projectData.ProjectName }}</span>
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
                <button v-if="task.TaskKey" type="button" class="ah-detail__key ah-mono" :aria-label="$t('TaskPanel.copy_id', { key: task.TaskKey })" :title="$t('TaskPanel.copy_id', { key: task.TaskKey })" @click="copyKey">{{ task.TaskKey }}</button>
            </template>
            <button v-if="task._id" type="button" class="ah-detail__icon-btn ah-detail__copy-link" :aria-label="$t('TaskPanel.copy_link')" :title="$t('TaskPanel.copy_link')" @click="copyLink">
                <ShellIcon name="link" :size="14" />
            </button>
            <div class="ah-detail__head-actions">
                <div v-if="nav" class="ah-detail__nav" role="group" :aria-label="$t('TaskPanel.nav_group')">
                    <button
                        type="button"
                        class="ah-detail__icon-btn"
                        data-nav-dir="prev"
                        :disabled="!nav.prev"
                        :aria-label="$t('TaskPanel.nav_prev')"
                        :title="$t('TaskPanel.nav_prev_hint')"
                        @click="nav.prev && $emit('step', -1)"
                    ><ShellIcon name="chevronDown" :size="15" class="ah-detail__nav-up" /></button>
                    <span v-if="!isMobile" class="ah-detail__nav-pos ah-mono">{{ $t('TaskPanel.nav_position', { n: nav.index + 1, total: nav.total }) }}</span>
                    <button
                        type="button"
                        class="ah-detail__icon-btn"
                        data-nav-dir="next"
                        :disabled="!nav.next"
                        :aria-label="$t('TaskPanel.nav_next')"
                        :title="$t('TaskPanel.nav_next_hint')"
                        @click="nav.next && $emit('step', 1)"
                    ><ShellIcon name="chevronDown" :size="15" /></button>
                </div>
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

        <TaskAgentStrip v-if="stripRun" :run="stripRun" />

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
                    <button
                        v-if="doneStatus"
                        type="button"
                        class="ah-detail__complete"
                        :class="{ 'is-done': isDone }"
                        :aria-pressed="isDone ? 'true' : 'false'"
                        :disabled="!canSetStatus || isSpinner"
                        :aria-busy="statusPending ? 'true' : null"
                        :title="completeHint"
                        @click="toggleDone(!isDone)"
                    ><ShellIcon name="check" :size="13" />{{ $t('TaskPanel.complete') }}</button>
                    <span v-if="priorityName" class="ah-chip ah-chip--warn">{{ priorityName }}</span>
                    <span v-if="task.DueDate" class="ah-chip">{{ formatDay(task.DueDate) }}</span>
                    <button type="button" class="ah-chip ah-detail__chips-more" @click="sheetOpen = true">{{ $t('TaskPanel.properties') }}</button>
                </div>

                <TaskSummaryBlock v-if="task._id && canComment" ref="summaryRef" :taskId="task._id" :enabled="aiUsable" @count="(n) => commentTotal = n" />

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
                        ref="descriptionTabRef"
                        @openSeeAll="activeTab = 'files'"
                        @openDoc="openDoc"
                    >
                        <template #after-description>
                            <div v-if="quickActions.length" class="ah-detail__quick" role="group" :aria-label="$t('TaskPanel.quick_actions')">
                                <button
                                    v-for="action in quickActions"
                                    :key="action.id"
                                    type="button"
                                    class="ah-detail__quick-btn"
                                    :data-action="action.id"
                                    :title="action.hint || null"
                                    @click="runQuickAction(action.id)"
                                ><ShellIcon :name="action.icon" :size="13" />{{ action.label }}</button>
                            </div>
                        </template>
                    </TaskDetailTab>
                    <TaskSubtaskList
                        v-else-if="activeTab === 'subtasks' && task._id && projectData._id"
                        ref="subtaskListRef"
                        :task="task"
                        :project="projectData"
                        :subtasks="subTasks"
                        :isMainSpinner="isSpinner"
                        @open="(sub) => openSubtask(sub)"
                    />
                    <TaskDetailTab
                        v-else-if="activeTab === 'files' && task._id && projectData._id"
                        ref="filesTabRef"
                        :task="task"
                        :subTasksArray="subTasks"
                        :isMainSpinner="isSpinner"
                        :sections="filesSections"
                    />
                    <div v-else-if="activeTab === 'relations' && task._id" class="ah-detail__relations">
                        <LinkedTasks ref="linkedTasksRef" :task="task" />
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
                            :focusComposer="false"
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
                >
                    <template #status>
                        <button
                            v-if="doneStatus && !isMobile"
                            type="button"
                            class="ah-detail__complete ah-detail__complete--icon"
                            :class="{ 'is-done': isDone }"
                            :aria-label="$t('TaskPanel.complete')"
                            :aria-pressed="isDone ? 'true' : 'false'"
                            :disabled="!canSetStatus || isSpinner"
                            :aria-busy="statusPending ? 'true' : null"
                            :title="completeHint"
                            @click="toggleDone(!isDone)"
                        ><ShellIcon name="check" :size="14" :stroke="2.25" /></button>
                    </template>
                </TaskDetailRightSide>
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
        <TaskTrackerHandoff v-if="task._id" ref="trackerRef" :task="task" />
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
import TaskTrackerHandoff from "./TaskTrackerHandoff.vue";
import { showUndoToast } from "@/composable/useUndoToast";
import { useEscapeLayer } from "@/composable/useEscapeLayer";
import TaskSubtaskList from "./TaskSubtaskList.vue";
import TaskTimerChip from "./TaskTimerChip.vue";
import TaskAgentStrip from "./TaskAgentStrip.vue";
import { canControlRun } from "@/views/Ai/agentAccess";

import taskClass from "@/utils/TaskOperations";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { publicConfig } from "@/config/publicConfig";
import { aiUsable } from "@/composable/aiAvailability";
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
    agentRun: { type: Object, default: null },
    /** Where the task sits in the view it was opened from; null when it came from elsewhere. */
    nav: { type: Object, default: null }
});
const emit = defineEmits(["close", "expand", "minimize", "loaded", "step"]);

const { t } = useI18n();
const $toast = useToast();
const router = useRouter();
const route = useRoute();
const { getters, dispatch, commit } = useStore();
const { getUser, getPriority } = useGetterFunctions();
const { checkPermission, checkApps } = useCustomComposable();
const socket = inject("$socket");
const clientWidth = inject("$clientWidth");
const currentUserId = inject("$userId");

const user = getUser(currentUserId.value) || {};
const isMobile = computed(() => clientWidth.value <= 767);

const task = ref({});
const parentTask = ref(null);
const projectData = ref({});
// projectSlice, not projectData: this ref holds the whole detail payload (subtasks,
// sprints), and the helper forwards what it is given straight into the PATCH body.
// taskTypeCounts rides along because the helper reads the previous type off it.
const { updateTaskByGroup } = useUpdateTasks(computed(() => ({ ...projectSlice(), taskTypeCounts: projectData.value.taskTypeCounts })));
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
useEscapeLayer(sheetOpen, () => { sheetOpen.value = false; });
const trackerRef = ref(null);
const showDocs = ref(false);
const openDocId = ref("");
const docsRefreshKey = ref(0);
const aiDrafting = ref(false);
const summaryRef = ref(null);
const mainEl = ref(null);
const activityEl = ref(null);
const descriptionTabRef = ref(null);
const filesTabRef = ref(null);
const subtaskListRef = ref(null);
const linkedTasksRef = ref(null);
const statusPending = ref(false);

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
const doneStatus = computed(() => (projectData.value?.taskStatusData || []).find((s) => s.type === "close") || null);
const reopenStatus = computed(() => {
    const statuses = projectData.value?.taskStatusData || [];
    return statuses.find((s) => s.type === "open") || statuses.find((s) => s.type !== "close") || null;
});
const completeHint = computed(() => (isDone.value
    ? t("TaskPanel.reopen_hint", { status: reopenStatus.value?.name || "" })
    : t("TaskPanel.complete_hint", { status: doneStatus.value?.name || "" })));

const quickActions = computed(() => {
    const global = projectData.value?.isGlobalPermission;
    const list = [];
    if (task.value?.isParentTask !== false && checkPermission("task.sub_task_create", global) === true) {
        list.push({ id: "subtask", icon: "plus", label: t("TaskPanel.action_subtask"), hint: "" });
    }
    list.push({ id: "relate", icon: "link", label: t("TaskPanel.action_relate"), hint: t("TaskPanel.action_relate_hint") });
    if (checkPermission("task.task_checklist", global) === true) {
        list.push({ id: "checklist", icon: "checkSquare", label: t("TaskPanel.action_checklist"), hint: t("TaskPanel.action_checklist_hint") });
    }
    if (checkPermission("task.task_attachments", global) === true) {
        list.push({ id: "attach", icon: "file", label: t("TaskPanel.action_attach"), hint: t("TaskPanel.action_attach_hint") });
    }
    return list;
});
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

/* The actor's own socket room does not echo taskUpdate back, so push the change
   through the same mutations the listener uses and the list rows update at once. */
function reflectOwnUpdate(updatedFields) {
    task.value = { ...task.value, ...updatedFields };
    const payload = { snap: {}, op: "modified", pid: String(task.value.ProjectID || props.projectId), sprintId: String(task.value.sprintId || props.sprintId), data: { ...task.value }, updatedFields };
    commit("projectData/mutateUpdateFirebaseTasks", payload);
    commit("projectData/mutateMongoUpdatedTask", payload);
    commit("projectData/mutateTypesenseTableTasks", payload);
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
        reflectOwnUpdate({ TaskName: val });
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
    updateTaskByGroup(task.value, status, 4)
    .then(() => reflectOwnUpdate({ TaskType: status.value, TaskTypeKey: status.key }))
    .catch((error) => console.error("ERROR in changeTaskType: ", error));
}

function toggleDone(done) {
    const statuses = projectData.value?.taskStatusData || [];
    const next = done ? doneStatus.value : reopenStatus.value;
    const current = statuses.find((s) => s.key === task.value.statusKey) || {};
    setStatus(next, current);
}

function setStatus(next, current, { undoing = false } = {}) {
    if (!next || statusPending.value) return;
    statusPending.value = true;
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
        reflectOwnUpdate({ status: { text: next.name, key: next.key, type: next.type, value: next.value }, statusType: next.type, statusKey: next.key });
        if (undoing) $toast.success(t("TaskPanel.change_undone"), { position: "top-right" });
        else if (current.key) showUndoToast({ message: t("Toast.Status_updated_successfully"), undo: () => setStatus(current, next, { undoing: true }) });
        else $toast.success(t("Toast.Status_updated_successfully"), { position: "top-right" });
    }).catch(() => {
        $toast.error(t("Toast.Status_not_updated"), { position: "top-right" });
    }).finally(() => {
        statusPending.value = false;
    });
}

async function copyText(text, successKey) {
    try {
        await navigator.clipboard.writeText(text);
        $toast.success(t(successKey), { position: "top-right" });
    } catch (error) {
        console.error("ERROR copying to the clipboard: ", error);
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    }
}

function copyKey() {
    if (task.value?.TaskKey) copyText(task.value.TaskKey, "Toast.Task_Key_is_Copied_to_clipboard");
}

function copyLink() {
    const folderId = task.value?.folderObjId || props.folderId;
    const params = { cid: props.companyId, id: props.projectId, sprintId: task.value?.sprintId || props.sprintId, taskId: props.taskId };
    if (folderId) params.folderId = folderId;
    const { href } = router.resolve({ name: folderId ? "ProjectFolderSprintTask" : "ProjectSprintTask", params });
    copyText(new URL(href, window.location.href).toString(), "Toast.Link_is_Copied_to_clipboard");
}

async function runQuickAction(id) {
    if (id === "checklist") {
        descriptionTabRef.value?.addChecklist?.();
        return;
    }
    const tabFor = { subtask: "subtasks", relate: "relations", attach: "files" };
    activeTab.value = tabFor[id];
    await nextTick();
    if (id === "subtask") subtaskListRef.value?.startCreate?.();
    else if (id === "relate") linkedTasksRef.value?.startAdding?.();
    else if (id === "attach") filesTabRef.value?.attachFile?.();
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
        case "tracker":
            trackerRef.value?.start();
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
        const rows = response?.data?.data;
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
    if (!aiUsable.value || !/^\/ai(\s|$)/i.test(target.value || "")) return;
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

/* The strip reads the open run on this task; a parent may still hand one in
 * (agentRun) and that wins, since it already knows more than the poll does. */
const STRIP_STATUS = { running: "running", queued: "running", waiting_approval: "review" };
const AGENT_RUN_POLL_MS = 15000;
const liveRun = ref(null);
let agentRunPoll = null;
const SESSION_STRIP_STATUS = { offered: "running", active: "running", completed: "done", failed: "failed", revoked: "failed", unresponsive: "failed" };
const OPEN_SESSION_STATES = ["offered", "active"];
const ENDED_SESSION_SHOWN_MS = 60 * 60 * 1000;
const liveSession = ref(null);
let agentSessionPoll = null;
const sessionRun = computed(() => {
    const session = liveSession.value;
    if (!session) return null;
    return { agentName: session.clientName, status: SESSION_STRIP_STATUS[session.state] || "running", startedAt: session.firstActivityAt || session.createdAt, session, onStop: null };
});
const stripRun = computed(() => props.agentRun || liveRun.value || sessionRun.value);
const mayStopRun = (run) => canControlRun(run, { userId: currentUserId?.value ?? currentUserId, roleType: getters["settings/companyUserDetail"]?.roleType });

async function stopAgentRun(runId) {
    try {
        const res = await apiRequest("post", `${env.AGENT_RUNS}/${runId}/stop`, {});
        if (!res?.data?.status) throw new Error(res?.data?.statusText || t("TaskPanel.agent_stop_failed"));
        $toast.success(t("TaskPanel.agent_stopped"), { position: "top-right" });
    } catch (error) {
        $toast.error(error?.response?.data?.statusText || error.message, { position: "top-right" });
    }
    await loadAgentRun();
}

async function loadAgentRun() {
    try {
        const res = await apiRequest("get", `${env.AGENT_RUNS}?status=open&taskId=${encodeURIComponent(props.taskId)}&limit=5`);
        const run = (res?.data?.status ? res.data.data || [] : [])[0];
        liveRun.value = run
            ? { agentName: run.agentName, status: STRIP_STATUS[run.status] || "running", startedAt: run.startedAt, onStop: run.status === "running" && mayStopRun(run) ? () => stopAgentRun(run._id) : null }
            : null;
    } catch (error) {
        liveRun.value = null;
    }
    clearTimeout(agentRunPoll);
    if (liveRun.value) agentRunPoll = setTimeout(loadAgentRun, AGENT_RUN_POLL_MS);
}

const shownSession = (rows) => rows.find((row) => OPEN_SESSION_STATES.includes(row.state))
    || rows.find((row) => row.endedAt && Date.now() - new Date(row.endedAt).getTime() < ENDED_SESSION_SHOWN_MS)
    || null;

function scheduleSessionPoll() {
    clearTimeout(agentSessionPoll);
    if (liveSession.value && OPEN_SESSION_STATES.includes(liveSession.value.state)) agentSessionPoll = setTimeout(loadAgentSessions, AGENT_RUN_POLL_MS);
}

/* The socket relay pushes each change as it happens; the poll only covers a dropped socket. */
async function loadAgentSessions() {
    if (!publicConfig.agentSessions) return;
    try {
        const res = await apiRequest("get", `${env.AGENT_SESSIONS}?taskId=${encodeURIComponent(props.taskId)}`);
        liveSession.value = shownSession(res?.data?.status ? res.data.data || [] : []);
    } catch (error) {
        liveSession.value = null;
    }
    scheduleSessionPoll();
}

function onAgentSession(session) {
    if (!session || String(session.taskId) !== String(props.taskId)) return;
    liveSession.value = session;
    scheduleSessionPoll();
}

onMounted(async () => {
    loadTask();
    loadAgentRun();
    loadAgentSessions();
    if (socket?.value?.on) socket.value.on("taskDetail_agentSession", onAgentSession);
    document.addEventListener("visibilitychange", visibilityHandler);
    if (socket?.value?.on) socket.value.on("commentInsert", onCommentInsert);
    dispatch("projectData/getTaskDetailSnapShot", { taskId: props.taskId }).catch((error) => console.error(error));
});

onBeforeUnmount(() => {
    commit("projectData/setTaskDetailData", {});
    commit("projectData/setTaskdetailPayloadId", {});
    ["taskDetail_taskUpdate", "taskDetail_taskDelete", "taskDetail_taskInsert"].forEach((event) => socket?.value?.off?.(event));
    socket?.value?.off?.("commentInsert", onCommentInsert);
    socket?.value?.off?.("taskDetail_agentSession", onAgentSession);
    socket?.value?.emit?.("leaveTaskDetail", `taskDetail_${props.taskId}**${socket.value.id}`);
    clearTimeout(debounceTimeout);
    clearTimeout(agentRunPoll);
    clearTimeout(agentSessionPoll);
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
