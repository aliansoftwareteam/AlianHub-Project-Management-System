<template>
    <div v-if="allowed" class="ah-page home">
        <HomeSidebar :assigned-count="work.assignedCount.value" @create-project="createProjectOpen = true" />

        <div class="ah-page__main">
            <header class="ah-toolbar">
                <button type="button" class="ah-tbtn ah-tbtn--icon home__sidebar-toggle" :title="$t('HomeV2.show_sidebar')" @click="homeState.sidebarOpen = !homeState.sidebarOpen">
                    <ShellIcon name="sidebar" :size="15" />
                </button>
                <div class="ah-toolbar__title">{{ $t('HomeV2.today_overdue') }}</div>
                <span class="ah-toolbar__date">{{ todayLabel }}</span>
                <div class="ah-toolbar__actions">
                    <StatusChip />
                    <router-link v-if="router.hasRoute('Dashboards')" class="ah-tbtn ah-tbtn--strong home__manage" :to="{ name: 'Dashboards', params: { cid: companyId } }">{{ $t('HomeV2.manage_cards') }}</router-link>
                    <div class="ah-pop-anchor" @click.stop>
                        <button type="button" class="ah-tbtn ah-tbtn--primary" :aria-expanded="newOpen" aria-haspopup="menu" @click="newOpen = !newOpen">{{ $t('HomeV2.new') }}</button>
                        <transition name="ah-fade">
                            <div v-if="newOpen" class="ah-pop" role="menu">
                                <button type="button" class="ah-pop__item" role="menuitem" @click="focusAdd"><ShellIcon name="plus" :size="14" /><span>{{ $t('HomeV2.new_task') }}</span></button>
                                <button v-if="canCreateProject" type="button" class="ah-pop__item" role="menuitem" @click="newOpen = false; createProjectOpen = true"><ShellIcon name="projects" :size="14" /><span>{{ $t('HomeV2.new_project') }}</span></button>
                                <button type="button" class="ah-pop__item" role="menuitem" @click="newOpen = false; openPanel('reminders')"><ShellIcon name="reminder" :size="14" /><span>{{ $t('HomeV2.new_reminder') }}</span></button>
                            </div>
                        </transition>
                    </div>
                    <button type="button" class="ah-tbtn ah-tbtn--icon home__planner-toggle" :class="{ 'is-active': homeState.plannerOpen }" :title="homeState.plannerOpen ? $t('HomeV2.hide_planner') : $t('HomeV2.show_planner')" @click="homeState.plannerOpen = !homeState.plannerOpen">
                        <ShellIcon name="panel" :size="15" />
                    </button>
                </div>
            </header>

            <div class="ah-page__body">
                <div class="ah-page__content ah-scroll home__content">
                    <SetupChecklist
                        v-if="showChecklist"
                        :company-name="companyName"
                        :title="isOwnerOrAdmin ? '' : $t('HomeV2.member_setup_title')"
                        :steps="checklistSteps"
                        @action="onChecklistAction"
                        @dismiss="dismissChecklist"
                    />
                    <ConfirmationSidebar
                        v-if="confirmRemoveSample"
                        v-model="confirmRemoveSample"
                        :title="$t('ProjectsV2.remove_sample')"
                        :message="$t('ProjectsV2.remove_sample_confirm')"
                        confirmationString="remove"
                        acceptButtonClass="btn-danger"
                        :acceptButton="$t('ProjectsV2.remove_sample')"
                        :showSpinner="onboarding.removingSample.value"
                        @confirm="removeSampleConfirmed"
                    />
                    <div class="home__grid">
                        <MyWorkCard
                            ref="myWorkCard"
                            :work="work"
                            :tracking-id="timer.active?.taskId || ''"
                            :first-run="firstRun"
                            :sample-project="sampleProject"
                            :show-add="firstRun || route.query.filter === 'assigned'"
                            :adding="adding"
                            @complete="onComplete"
                            @reopen="onReopen"
                            @open="openTask"
                            @timer="onTimer"
                            @set-date="onSetDate"
                            @add="onAdd"
                            @open-project="goProject"
                        />
                        <div class="home__side">
                            <AgendaCard :day="agendaDay" :items="agendaItems" :connected="agenda.connected.value" :first-run="firstRun" @shift="shiftAgenda" />
                            <section v-if="firstRun && !timer.active" class="hc-card">
                                <div class="hc-personal__title">{{ $t('HomeV2.personal_list') }}</div>
                                <p class="hc-hint" style="margin: 0">{{ $t('HomeV2.personal_hint') }}</p>
                                <router-link class="hc-personal__open" :to="{ name: 'PersonalList', params: { cid: companyId } }">{{ $t('HomeV2.open') }}</router-link>
                            </section>
                            <TimerChip />
                        </div>
                    </div>
                </div>
                <PlannerPanel
                    v-if="homeState.plannerOpen"
                    class="home__planner"
                    :day="agendaDay"
                    :items="agendaItems"
                    @close="homeState.plannerOpen = false"
                    @select="(d) => agendaDay = d"
                    @schedule="onSchedule"
                    @remove-focus="agenda.removeFocus"
                />
            </div>
        </div>

        <input ref="dateInput" type="date" class="home__date-input" @change="onDatePicked" />

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
    <div v-else class="ah-denied">{{ $t('HomeV2.access_denied') }}</div>
</template>

<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import moment from "moment";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { openPanel } from "@/components/organisms/Shell/shellState";
import TaskDetail from "@/views/TaskDetail/TaskDetail.vue";
import CreateProjectSidebar from "@/components/organisms/CreateProject/CreateProjectSidebar.vue";
import HomeSidebar from "@/components/molecules/Home/HomeSidebar.vue";
import MyWorkCard from "@/components/molecules/Home/MyWorkCard.vue";
import AgendaCard from "@/components/molecules/Home/AgendaCard.vue";
import PlannerPanel from "@/components/molecules/Home/PlannerPanel.vue";
import TimerChip from "@/components/molecules/Home/TimerChip.vue";
import SetupChecklist from "@/components/molecules/Home/SetupChecklist.vue";
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue";
import { useOnboardingChecklist } from "@/composable/useOnboardingChecklist";
import StatusChip from "@/components/molecules/Home/StatusChip.vue";
import { homeState } from "@/components/molecules/Home/homeState";
import { useMyWork } from "@/components/molecules/Home/useMyWork";
import { useTimer } from "@/components/molecules/Home/useTimer";
import { useAgenda } from "@/components/molecules/Home/useAgenda";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import "@/components/molecules/Home/style.css";
import "./style.css";

defineOptions({ name: "TodayOverdue" });

const route = useRoute();
const router = useRouter();
const { getters } = useStore();
const { t } = useI18n();
const $toast = useToast();
const { checkPermission } = useCustomComposable();
const { getUser } = useGetterFunctions();
const companyId = inject("$companyId");
const userId = inject("$userId");
const dateFormat = inject("$dateFormat");

const allowed = computed(() => checkPermission("project") !== null && checkPermission("task.task_list") !== null);
const canCreateProject = computed(() => checkPermission("project.project_create") === true);

const work = useMyWork({ companyId, userId, dateFormat });
const { timer, isTracking, start, pause, stop } = useTimer();
const agenda = useAgenda();

const myWorkCard = ref(null);
const dateInput = ref(null);
const newOpen = ref(false);
const createProjectOpen = ref(false);
const adding = ref(false);
const agendaDay = ref(moment());
const detail = ref({ open: false, taskId: "", projectId: "", sprintId: "" });
const pendingDateTask = ref(null);

const todayLabel = computed(() => moment().format("ddd MMM D"));
const projects = computed(() => getters["projectData/projects"]?.data || []);
const companyName = computed(() => getters["settings/selectedCompany"]?.Cst_CompanyName || "");
const sampleProject = computed(() => projects.value[0] || null);

const mainTour = inject("$mainTour", null);
const onboarding = useOnboardingChecklist({
    openCreateProject: () => { createProjectOpen.value = true; },
    startTour: (which) => mainTour?.value?.startTour?.(which),
    routeVersion: () => route.fullPath
});
const { steps: checklistSteps, show: showChecklist, complete: checklistComplete, isOwnerOrAdmin, dismiss: dismissChecklist } = onboarding;
const firstRun = computed(() => projects.value.length <= 1 || !checklistComplete.value);
const confirmRemoveSample = ref(false);

const agendaItems = computed(() => agenda.itemsFor(agendaDay.value, work.mine.value));

function shiftAgenda(delta) {
    agendaDay.value = delta === 0 ? moment() : moment(agendaDay.value).add(delta, "day");
}

function onChecklistAction(key) {
    if (!onboarding.onAction(key)) confirmRemoveSample.value = true;
}

async function removeSampleConfirmed() {
    try {
        await onboarding.removeSample();
        $toast.success(t("ProjectsV2.remove_sample_done"), { position: "top-right" });
    } catch (error) {
        console.error("remove sample failed", error);
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    } finally {
        confirmRemoveSample.value = false;
    }
}

watch(() => timer.active, (now, before) => {
    if (before && !now) onboarding.mark("log_time");
});

function openTask(task) {
    detail.value = { open: true, taskId: task._id, projectId: task.ProjectID, sprintId: task.sprintId };
}
function closeTask() {
    detail.value = { open: false, taskId: "", projectId: "", sprintId: "" };
    work.fetchOpen().catch(() => {});
}
function goProject(project) {
    onboarding.mark("open_project");
    router.push({ name: "Project", params: { cid: companyId.value, id: project._id } });
}

async function onComplete(task) {
    try {
        await work.complete(task);
        onboarding.mark("complete_task");
        $toast.success(t("HomeV2.task_done"), { position: "top-right" });
    } catch (error) {
        console.error("complete failed", error);
        $toast.error(t("HomeV2.task_update_failed"), { position: "top-right" });
    }
}
async function onReopen(task) {
    try {
        await work.reopen(task);
    } catch (error) {
        console.error("reopen failed", error);
        $toast.error(t("HomeV2.task_update_failed"), { position: "top-right" });
    }
}

async function onTimer(task) {
    if (isTracking(task._id)) {
        if (timer.active.running) pause();
        return;
    }
    if (timer.active) {
        const previous = timer.active.taskName;
        try {
            await stop({ companyId: companyId.value, userId: userId.value });
            $toast.info(t("HomeV2.timer_switched", { task: previous }), { position: "top-right" });
        } catch (error) {
            console.error("timer stop failed", error);
            $toast.error(t("HomeV2.timer_log_failed"), { position: "top-right" });
            return;
        }
    }
    start(task, work.projectOf(task));
}

function onSetDate(task) {
    pendingDateTask.value = task;
    const input = dateInput.value;
    if (!input) return;
    input.value = moment().format("YYYY-MM-DD");
    if (typeof input.showPicker === "function") input.showPicker();
    else input.click();
}
async function onDatePicked(event) {
    const task = pendingDateTask.value;
    const value = event.target.value;
    pendingDateTask.value = null;
    if (!task || !value) return;
    try {
        await work.setDueDate(task, moment(value, "YYYY-MM-DD").endOf("day").toDate());
    } catch (error) {
        console.error("due date failed", error);
        $toast.error(t("HomeV2.task_update_failed"), { position: "top-right" });
    }
}

async function onAdd(name) {
    adding.value = true;
    try {
        await work.addPersonalTask(name, moment().endOf("day").toDate());
        $toast.success(t("HomeV2.task_added"), { position: "top-right" });
    } catch (error) {
        console.error("add failed", error);
        $toast.error(t("HomeV2.task_update_failed"), { position: "top-right" });
    } finally {
        adding.value = false;
    }
}

function focusAdd() {
    newOpen.value = false;
    myWorkCard.value?.focusAdd();
}

async function onSchedule({ taskId, start: begin, end }) {
    const task = work.openTasks.value.find((x) => x._id === taskId);
    if (!task) return;
    try {
        await work.schedule(task, begin.toDate(), end.toDate());
        $toast.success(t("HomeV2.scheduled", { task: task.TaskName, when: begin.format("ddd HH:mm") }), { position: "top-right" });
    } catch (error) {
        console.error("schedule failed", error);
        $toast.error(t("HomeV2.schedule_failed"), { position: "top-right" });
    }
}

const closePops = () => { newOpen.value = false; };
const onVisible = () => { if (document.visibilityState === "visible") work.fetchOpen().catch(() => {}); };

onMounted(() => {
    const me = getUser(userId.value, "all") || {};
    onboarding.load();
    if (me.presence) homeState.presence = { ...homeState.presence, ...me.presence };
    work.fetchOpen().catch((error) => console.error("my work failed", error));
    agenda.load().catch(() => {});
    document.addEventListener("click", closePops);
    document.addEventListener("visibilitychange", onVisible);
});
onUnmounted(() => {
    document.removeEventListener("click", closePops);
    document.removeEventListener("visibilitychange", onVisible);
});
watch(() => homeState.refreshKey, () => work.fetchOpen().catch(() => {}));
</script>
