<template>
    <div class="ah-page personal">
        <HomeSidebar :assigned-count="assignedCount" @create-project="createProjectOpen = true" />

        <div class="ah-page__main">
            <header class="ah-toolbar">
                <button type="button" class="ah-tbtn ah-tbtn--icon personal__sidebar-toggle" :title="$t('HomeV2.show_sidebar')" @click="homeState.sidebarOpen = !homeState.sidebarOpen">
                    <ShellIcon name="sidebar" :size="15" />
                </button>
                <div class="ah-toolbar__title">
                    {{ $t('HomeV2.personal_list') }}
                    <span class="personal__only">{{ $t('HomeV2.only_you') }}</span>
                </div>
                <nav class="personal__views" aria-label="Views">
                    <button type="button" class="personal__view" :class="{ 'is-active': view === 'list' }" @click="view = 'list'">{{ $t('HomeV2.list') }}</button>
                    <button type="button" class="personal__view" :class="{ 'is-active': view === 'board' }" @click="view = 'board'">{{ $t('HomeV2.board') }}</button>
                    <router-link class="personal__view" :to="{ name: 'Planner', params: { cid: companyId } }">{{ $t('HomeV2.calendar') }}</router-link>
                    <span class="personal__view personal__view--muted">{{ $t('HomeV2.add_view') }}</span>
                </nav>
                <div class="ah-toolbar__actions">
                    <button type="button" class="ah-tbtn" :class="{ 'is-active': hideDone }" @click="hideDone = !hideDone">{{ $t('HomeV2.filter') }}</button>
                    <button type="button" class="ah-tbtn personal__group" disabled>{{ $t('HomeV2.group_none') }}</button>
                    <button type="button" class="ah-tbtn ah-tbtn--primary" @click="focusAdd">{{ $t('HomeV2.add_task') }}</button>
                </div>
            </header>

            <div class="ah-page__content ah-scroll personal__content">
                <p v-if="personal.loading && !personal.project" class="hc-loading">{{ $t('HomeV2.personal_loading') }}</p>
                <div v-else-if="personal.error" class="ah-empty">{{ $t('HomeV2.personal_failed') }}</div>

                <template v-else>
                    <form class="personal__add" :class="{ 'is-focused': addFocused }" @submit.prevent="submitAdd">
                        <span class="hc-add__plus">+</span>
                        <input
                            ref="addInput"
                            v-model="draft"
                            type="text"
                            :placeholder="$t('HomeV2.new_task_row')"
                            :disabled="adding"
                            maxlength="250"
                            @focus="addFocused = true"
                            @blur="addFocused = false"
                            @keydown.tab.prevent="pickDate"
                        />
                        <span v-if="draftDue" class="hc-row__meta">{{ dueLabel(draftDue, $t) }}</span>
                        <span class="hc-add__hint">{{ $t('HomeV2.add_hint') }}</span>
                        <input ref="dateInput" type="date" class="personal__date" @change="onDraftDate" />
                    </form>

                    <div v-if="view === 'list'" class="hc-card personal__table">
                        <div class="personal__head">
                            <span></span>
                            <span>{{ $t('HomeV2.col_name') }}</span>
                            <span>{{ $t('HomeV2.col_due') }}</span>
                            <span>{{ $t('HomeV2.col_priority') }}</span>
                            <span>{{ $t('HomeV2.col_status') }}</span>
                            <span>{{ $t('HomeV2.col_time') }}</span>
                        </div>
                        <div v-for="task in visibleTasks" :key="task._id" class="personal__row" :class="{ 'is-done': isDone(task) }">
                            <input type="checkbox" class="ah-check hc-row__check" :checked="isDone(task)" :aria-label="task.TaskName" @change="toggleDone(task)" />
                            <button type="button" class="personal__name" @click="openTask(task)">{{ task.TaskName }}</button>
                            <span class="personal__mono" :class="{ 'personal__mono--danger': !isDone(task) && dueBucket(task) === 'overdue' }">{{ task.DueDate ? dueLabel(task.DueDate, $t) : '—' }}</span>
                            <span v-if="!isDone(task)" class="hc-row__prio" :class="priorityMeta(task.Task_Priority).cls" style="width: max-content">{{ $t(priorityMeta(task.Task_Priority).label) }}</span>
                            <span v-else></span>
                            <span class="personal__status">
                                <span class="personal__status-dot" :style="{ background: statusColor(task) }"></span>{{ statusName(task) }}
                            </span>
                            <span class="personal__mono" :class="{ 'personal__mono--faint': !loggedTime(task) }">{{ loggedTime(task) || '—' }}</span>
                        </div>
                        <div v-if="!visibleTasks.length" class="personal__empty">{{ $t('HomeV2.personal_empty') }}</div>
                        <button v-if="visibleTasks.length" type="button" class="personal__new" @click="focusAdd">
                            <span class="hc-add__plus">+</span><span>{{ $t('HomeV2.new_task_row') }}</span>
                        </button>
                    </div>

                    <div v-else class="personal__board ah-scroll">
                        <section
                            v-for="status in statuses"
                            :key="status.key"
                            class="personal__col"
                            :class="{ 'is-over': overStatus === status.key }"
                            @dragover.prevent="overStatus = status.key"
                            @dragleave="overStatus = null"
                            @drop.prevent="onDropStatus(status)"
                        >
                            <div class="personal__col-head">
                                <span class="personal__status-dot" :style="{ background: status.bgColor || 'var(--brand)' }"></span>
                                <span>{{ status.name }}</span>
                                <span class="ah-mono personal__col-count">{{ byStatus(status).length }}</span>
                            </div>
                            <article
                                v-for="task in byStatus(status)"
                                :key="task._id"
                                class="personal__card"
                                draggable="true"
                                @dragstart="onDragStart($event, task)"
                                @click="openTask(task)"
                            >
                                <div class="personal__card-title">{{ task.TaskName }}</div>
                                <div class="personal__card-meta">
                                    <span v-if="priorityMeta(task.Task_Priority).cls" class="hc-row__prio" :class="priorityMeta(task.Task_Priority).cls">{{ $t(priorityMeta(task.Task_Priority).label) }}</span>
                                    <span v-if="task.DueDate" class="personal__mono" :class="{ 'personal__mono--danger': dueBucket(task) === 'overdue' }">{{ dueLabel(task.DueDate, $t) }}</span>
                                </div>
                            </article>
                            <div v-if="!byStatus(status).length" class="personal__col-empty">{{ $t('HomeV2.board_empty') }}</div>
                        </section>
                    </div>

                    <p class="personal__foot">{{ $t('HomeV2.personal_footer') }} {{ $t('HomeV2.personal_footer_short') }}</p>
                </template>
            </div>
        </div>

        <TaskDetail
            v-if="detail.open"
            :companyId="companyId"
            :projectId="detail.projectId"
            :sprintId="detail.sprintId"
            :taskId="detail.taskId"
            :isTaskDetailSideBar="detail.open"
            :zIndex="7"
            @toggleTaskDetail="closeTask"
        />
        <CreateProjectSidebar
            v-if="createProjectOpen"
            :isActiveCreateSidebar="createProjectOpen"
            @click:closeSidebar="createProjectOpen = false"
            @closeSidebar="createProjectOpen = false"
        />
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import moment from "moment";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import TaskDetail from "@/views/TaskDetail/TaskDetail.vue";
import CreateProjectSidebar from "@/components/organisms/CreateProject/CreateProjectSidebar.vue";
import HomeSidebar from "@/components/molecules/Home/HomeSidebar.vue";
import { homeState } from "@/components/molecules/Home/homeState";
import { usePersonalList } from "@/components/molecules/Home/usePersonalList";
import { compareTasks, dueBucket, dueLabel, fmtEstimate, priorityMeta } from "@/components/molecules/Home/homeFormat";
import "@/components/molecules/Home/style.css";
import "./style.css";

defineOptions({ name: "PersonalList" });

const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId");
const userId = inject("$userId");

const list = usePersonalList({ companyId, userId });
const { personal, isDone } = list;

const tasks = ref([]);
const view = ref(localStorage.getItem("ah.personal.view") === "board" ? "board" : "list");
const hideDone = ref(false);
const draft = ref("");
const draftDue = ref(null);
const adding = ref(false);
const addFocused = ref(false);
const addInput = ref(null);
const dateInput = ref(null);
const overStatus = ref(null);
const dragging = ref(null);
const createProjectOpen = ref(false);
const detail = ref({ open: false, taskId: "", projectId: "", sprintId: "" });

const statuses = computed(() => personal.project?.taskStatusData || []);
const assignedCount = computed(() => tasks.value.filter((x) => !isDone(x)).length);
const sorted = computed(() => [...tasks.value].sort((a, b) => {
    const ad = isDone(a) ? 1 : 0;
    const bd = isDone(b) ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return compareTasks(a, b, "due");
}));
const visibleTasks = computed(() => (hideDone.value ? sorted.value.filter((x) => !isDone(x)) : sorted.value));

const statusOf = (task) => statuses.value.find((s) => s.key === task.statusKey);
const statusName = (task) => statusOf(task)?.name || task.status?.text || "";
const statusColor = (task) => statusOf(task)?.bgColor || (isDone(task) ? "var(--ok)" : "var(--brand)");
const loggedTime = (task) => fmtEstimate(Number(task.totalLoggedTime || task.loggedTime || 0) ? Math.round(Number(task.totalLoggedTime || task.loggedTime) / 60) : 0);
const byStatus = (status) => sorted.value.filter((x) => x.statusKey === status.key);

async function load() {
    try {
        tasks.value = await list.fetchTasks();
    } catch (error) {
        console.error("personal list failed", error);
    }
}

function focusAdd() {
    addInput.value?.focus();
}

function pickDate() {
    const input = dateInput.value;
    if (!input) return;
    input.value = moment(draftDue.value || undefined).format("YYYY-MM-DD");
    if (typeof input.showPicker === "function") input.showPicker();
    else input.click();
}
function onDraftDate(event) {
    draftDue.value = event.target.value ? moment(event.target.value, "YYYY-MM-DD").endOf("day").toDate() : null;
    addInput.value?.focus();
}

async function submitAdd() {
    const name = draft.value.trim();
    if (name.length < 3) return;
    adding.value = true;
    try {
        const created = await list.createTask(name, draftDue.value);
        tasks.value = [created, ...tasks.value];
        draft.value = "";
        draftDue.value = null;
    } catch (error) {
        console.error("create failed", error);
        $toast.error(t("HomeV2.task_update_failed"), { position: "top-right" });
    } finally {
        adding.value = false;
        addInput.value?.focus();
    }
}

async function applyStatus(task, status) {
    if (!status || task.statusKey === status.key) return;
    const previous = { statusKey: task.statusKey, statusType: task.statusType, status: task.status };
    patch(task, { statusKey: status.key, statusType: status.type, status: { text: status.name, key: status.key, type: status.type, value: status.value } });
    try {
        await list.setStatus(task, status);
    } catch (error) {
        console.error("status failed", error);
        patch(task, previous);
        $toast.error(t("HomeV2.task_update_failed"), { position: "top-right" });
    }
}
function patch(task, fields) {
    tasks.value = tasks.value.map((x) => (x._id === task._id ? { ...x, ...fields } : x));
}
const toggleDone = (task) => applyStatus(task, isDone(task) ? list.defaultStatus() : list.doneStatus());

function onDragStart(event, task) {
    dragging.value = task;
    event.dataTransfer.setData("text/plain", task._id);
    event.dataTransfer.effectAllowed = "move";
}
function onDropStatus(status) {
    overStatus.value = null;
    if (dragging.value) applyStatus(dragging.value, status);
    dragging.value = null;
}

function openTask(task) {
    detail.value = { open: true, taskId: task._id, projectId: task.ProjectID, sprintId: task.sprintId };
}
function closeTask() {
    detail.value = { open: false, taskId: "", projectId: "", sprintId: "" };
    load();
}

onMounted(() => {
    list.ensure().then(load).catch(() => {});
});
</script>
