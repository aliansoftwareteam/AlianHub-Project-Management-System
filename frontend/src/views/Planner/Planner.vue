<template>
    <div class="ah-page planner">
        <ContextSidebar v-if="!isMobile" width="250px" :open="homeState.sidebarOpen" :label="$t('Home.unscheduled')" @close="homeState.sidebarOpen = false">
            <PlannerTray
                :title="$t('Home.unscheduled')"
                :tabs="trayTabs"
                :active="tray"
                :items="trayItems"
                :loading="!work.loaded.value"
                :loadingText="$t('Home.loading')"
                :emptyText="$t('Home.tray_empty')"
                :footer="$t('Home.tray_footer')"
                @tab="tray = $event"
                @select="openTask"
                @dragstart="onDragStart"
                @dragend="dragging = null"
            />
        </ContextSidebar>

        <div class="ah-page__main">
            <header class="ah-toolbar">
                <button type="button" class="ah-tbtn ah-tbtn--icon planner__sidebar-toggle" :title="$t('Home.show_sidebar')" @click="homeState.sidebarOpen = !homeState.sidebarOpen">
                    <ShellIcon name="sidebar" :size="15" />
                </button>
                <div class="ah-toolbar__title">{{ $t('Home.planner') }}</div>
                <span class="ah-toolbar__date planner__range">
                    <button type="button" @click="shift(-1)">‹</button>
                    <button type="button" @click="goToday">{{ rangeLabel }}</button>
                    <button type="button" @click="shift(1)">›</button>
                </span>
                <div class="ah-toolbar__actions">
                    <div class="ah-tabs">
                        <button type="button" class="ah-tab" :class="{ 'is-active': mode === 'week' }" @click="mode = 'week'">{{ $t('Home.week') }}</button>
                        <button type="button" class="ah-tab" :class="{ 'is-active': mode === 'day' }" @click="mode = 'day'">{{ $t('Home.day') }}</button>
                    </div>
                    <router-link class="ah-tbtn planner__cal" :to="calendarTo">
                        <span class="ah-dot" :class="agenda.connected.value ? 'ah-dot--ok' : 'ah-dot--warn'"></span>
                        {{ agenda.connected.value ? $t('Home.calendar_synced') : $t('Home.calendar_not_connected') }}
                    </router-link>
                    <button type="button" class="ah-tbtn planner__hours" @click="toggleHours">{{ $t('Home.working_hours', { from: startHour, to: endHour }) }}</button>
                    <button type="button" class="ah-tbtn ah-tbtn--strong" @click="addFocusNow"><ShellIcon name="plus" :size="13" />{{ $t('Home.focus_block') }}</button>
                </div>
            </header>

            <nav v-if="isMobile" class="planner__days">
                <button
                    v-for="day in weekDays"
                    :key="day.key"
                    type="button"
                    class="planner__day"
                    :class="{ 'is-active': day.key === days[0].key }"
                    @click="anchor = day.date"
                >
                    <span>{{ day.dow }}</span>
                    <span class="ah-mono">{{ day.num }}</span>
                </button>
            </nav>

            <div class="planner__grid-wrap ah-scroll">
                <div class="planner__grid" :style="{ gridTemplateColumns: `44px repeat(${days.length}, minmax(0, 1fr))` }">
                    <div class="planner__corner"></div>
                    <div v-for="d in days" :key="`h-${d.key}`" class="planner__day-head" :class="{ 'is-today': d.isToday }">{{ d.label }}</div>

                    <div class="planner__hours-col" :style="{ height: `${gridHeight}px` }">
                        <span v-for="h in hours" :key="h" class="planner__hour" :style="{ top: `${top(h) + 4}px` }">{{ String(h).padStart(2, '0') }}</span>
                    </div>
                    <div
                        v-for="d in days"
                        :key="d.key"
                        class="planner__col"
                        :class="{ 'is-today': d.isToday, 'is-over': overKey === d.key }"
                        :style="{ height: `${gridHeight}px`, backgroundSize: `100% ${HOUR_PX}px` }"
                        @dragover.prevent="onDragOver($event, d)"
                        @dragleave="onDragLeave(d)"
                        @drop.prevent="onDrop($event, d)"
                        @dblclick="onDoubleClick($event, d)"
                        @click="onColumnClick($event, d)"
                    >
                        <div
                            v-for="item in blocksFor(d)"
                            :key="item.id"
                            class="planner__block"
                            :class="[`planner__block--${item.kind}`, { 'planner__block--done': item.done }]"
                            :style="{ top: `${item.top}px`, height: `${item.height}px` }"
                            :title="item.title"
                            @click.stop="onBlockClick(item)"
                        >
                            {{ item.title || $t('Home.focus') }}
                            <span v-if="item.sub" class="planner__block-sub">{{ item.sub }}</span>
                        </div>
                        <div v-if="overKey === d.key && dragging" class="planner__block planner__block--ghost" :style="{ top: `${ghostTop}px`, height: `${ghostHeight}px` }">
                            {{ dragging.TaskName }}
                            <span class="planner__block-sub">{{ $t('Home.dropping', { range: ghostRange }) }}</span>
                        </div>
                        <div v-if="d.isToday && nowTop !== null" class="planner__now" :style="{ top: `${nowTop}px` }"></div>
                    </div>
                </div>
            </div>

            <div v-if="isMobile" class="planner__sheet">
                <div v-if="pending" class="planner__pick">
                    <span>{{ $t('Provenance.mob_tap_slot', { task: pending.TaskName }) }}</span>
                    <button type="button" class="planner__pick-cancel" @click="pending = null">{{ $t('Provenance.mob_cancel') }}</button>
                </div>
                <PlannerTray
                    :title="$t('Home.unscheduled')"
                    :tabs="trayTabs"
                    :active="tray"
                    :items="trayItems"
                    :selectedId="pending ? pending._id : ''"
                    :loading="!work.loaded.value"
                    :loadingText="$t('Home.loading')"
                    :emptyText="$t('Home.tray_empty')"
                    @tab="tray = $event"
                    @select="pickTask"
                    @dragstart="onDragStart"
                    @dragend="dragging = null"
                />
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
    </div>
</template>

<script setup>
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import moment from "moment";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import ContextSidebar from "@/components/organisms/Shell/ContextSidebar.vue";
import TaskDetail from "@/views/TaskDetail/TaskDetail.vue";
import PlannerTray from "./PlannerTray.vue";
import { homeState } from "@/components/molecules/Home/homeState";
import { useMyWork } from "@/components/molecules/Home/useMyWork";
import { useAgenda } from "@/components/molecules/Home/useAgenda";
import { useTimer } from "@/components/molecules/Home/useTimer";
import { dueBucket, fmtEstimate, fmtShortClock } from "@/components/molecules/Home/homeFormat";
import "@/components/molecules/Home/style.css";
import "./style.css";

defineOptions({ name: "PlannerPage" });

const HOUR_PX = 60;
const router = useRouter();
const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId");
const userId = inject("$userId");
const dateFormat = inject("$dateFormat");

const work = useMyWork({ companyId, userId, dateFormat });
const agenda = useAgenda();
const { timer, elapsedMs } = useTimer();

const anchor = ref(moment());
const mode = ref("week");
const tray = ref("mine");
const startHour = ref(Number(localStorage.getItem("ah.planner.start")) || 9);
const endHour = ref(Number(localStorage.getItem("ah.planner.end")) || 18);
const dragging = ref(null);
const overKey = ref(null);
const ghostTop = ref(0);
const now = ref(moment());
const detail = ref({ open: false, taskId: "", projectId: "", sprintId: "" });
const isMobile = ref(false);
const pending = ref(null);

const hours = computed(() => Array.from({ length: endHour.value - startHour.value }, (_, i) => startHour.value + i));
const gridHeight = computed(() => (endHour.value - startHour.value) * HOUR_PX);
const top = (hour) => (hour - startHour.value) * HOUR_PX;

const days = computed(() => {
    if (mode.value === "day") {
        const d = moment(anchor.value);
        return [{ key: d.format("YYYY-MM-DD"), date: d, label: d.format("ddd D").toUpperCase(), isToday: d.isSame(moment(), "day") }];
    }
    const monday = moment(anchor.value).startOf("isoWeek");
    return Array.from({ length: 5 }, (_, i) => {
        const d = monday.clone().add(i, "days");
        return { key: d.format("YYYY-MM-DD"), date: d, label: d.format("ddd D").toUpperCase(), isToday: d.isSame(moment(), "day") };
    });
});
const rangeLabel = computed(() => {
    if (mode.value === "day") return moment(anchor.value).format("ddd MMM D").toUpperCase();
    const first = days.value[0].date;
    const last = days.value[days.value.length - 1].date;
    return `${first.format("MMM D")} – ${last.format(first.isSame(last, "month") ? "D" : "MMM D")}`.toUpperCase();
});

const unscheduled = computed(() => work.mine.value.filter((task) => !task.startDate && dueBucket(task) !== "overdue"));
const overdue = computed(() => work.mine.value.filter((task) => dueBucket(task) === "overdue"));
const trayTasks = computed(() => (tray.value === "mine" ? unscheduled.value : overdue.value));

const trayTabs = computed(() => [
    { key: "mine", label: t("Home.mine"), count: unscheduled.value.length },
    { key: "overdue", label: t("Home.overdue_tab"), count: overdue.value.length }
]);

const trayItems = computed(() => trayTasks.value.map((task) => ({
    id: task._id,
    title: task.TaskName,
    danger: tray.value === "overdue",
    meta: tray.value === "overdue"
        ? t("Home.overdue_since", { date: moment(task.DueDate).format("MMM D") })
        : [work.projectOf(task)?.ProjectName, task.totalEstimatedTime ? t("Home.est", { value: fmtEstimate(task.totalEstimatedTime) }) : t("Home.no_estimate")].filter(Boolean).join(" · "),
    task
})));

const weekDays = computed(() => {
    const monday = moment(anchor.value).startOf("isoWeek");
    return Array.from({ length: 7 }, (_, i) => {
        const day = monday.clone().add(i, "days");
        return { key: day.format("YYYY-MM-DD"), date: day, dow: day.format("dd").slice(0, 1), num: day.format("D") };
    });
});

const calendarTo = computed(() => ({ name: router.hasRoute("IntegrationsHub") ? "IntegrationsHub" : "Setting", params: { cid: companyId.value } }));

function estimateMinutes(task) {
    const est = Number(task?.totalEstimatedTime) || 0;
    return est > 0 ? Math.min(est, 8 * 60) : 60;
}

function blocksFor(day) {
    return agenda.itemsFor(day.date, work.openTasks.value).map((item) => {
        const startMin = (item.start.hours() - startHour.value) * 60 + item.start.minutes();
        const durMin = Math.max(30, item.end.diff(item.start, "minutes"));
        const tracking = item.task && timer.active?.taskId === item.task._id;
        return {
            ...item,
            top: Math.max(0, (startMin / 60) * HOUR_PX + 2),
            height: Math.max(24, (durMin / 60) * HOUR_PX - 4),
            done: item.task ? ["done", "close"].includes(item.task.statusType) : false,
            sub: tracking ? t("Home.tracking_short", { time: fmtShortClock(elapsedMs.value) }) : (item.kind === "task" ? work.projectOf(item.task)?.ProjectName : "")
        };
    });
}

const ghostHeight = computed(() => (dragging.value ? (estimateMinutes(dragging.value) / 60) * HOUR_PX - 4 : 0));
const ghostRange = computed(() => {
    if (!dragging.value) return "";
    const begin = ghostStart();
    return `${begin.format("HH:mm")}–${begin.clone().add(estimateMinutes(dragging.value), "minutes").format("HH:mm")}`;
});
function ghostStart(day = days.value.find((d) => d.key === overKey.value)) {
    const slot = Math.round((ghostTop.value / HOUR_PX) * 2) / 2;
    return moment(day ? day.date : anchor.value).startOf("day").add(startHour.value, "hours").add(slot * 60, "minutes");
}

const nowTop = computed(() => {
    const minutes = (now.value.hours() - startHour.value) * 60 + now.value.minutes();
    if (minutes < 0 || minutes > (endHour.value - startHour.value) * 60) return null;
    return (minutes / 60) * HOUR_PX;
});

function onDragStart(event, task) {
    dragging.value = task;
    event.dataTransfer.setData("application/x-ah-task", task._id);
    event.dataTransfer.effectAllowed = "move";
}
function onDragOver(event, day) {
    if (!dragging.value) return;
    overKey.value = day.key;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = Math.max(0, event.clientY - rect.top);
    ghostTop.value = Math.min(Math.floor(y / (HOUR_PX / 2)) * (HOUR_PX / 2), gridHeight.value - ghostHeight.value);
    event.dataTransfer.dropEffect = "move";
}
function onDragLeave(day) {
    if (overKey.value === day.key) overKey.value = null;
}
async function place(task, begin) {
    if (!task) return;
    const end = begin.clone().add(estimateMinutes(task), "minutes");
    try {
        await work.schedule(task, begin.toDate(), end.toDate());
        $toast.success(t("Home.scheduled", { task: task.TaskName, when: begin.format("ddd HH:mm") }), { position: "top-right" });
    } catch (error) {
        console.error("schedule failed", error);
        $toast.error(t("Home.schedule_failed"), { position: "top-right" });
    }
}

function onDrop(event, day) {
    const task = dragging.value;
    const begin = ghostStart(day);
    overKey.value = null;
    dragging.value = null;
    place(task, begin);
}

/* Touch has no drag-and-drop, so on a phone a tray card is picked up with one
 * tap and dropped with a second on the hour it belongs to. Same landing. */
function pickTask(task) {
    pending.value = pending.value && pending.value._id === task._id ? null : task;
}
function onColumnClick(event, day) {
    const task = pending.value;
    if (!task) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = Math.max(0, event.clientY - rect.top);
    const slot = Math.round((Math.min(y, gridHeight.value) / HOUR_PX) * 2) / 2;
    pending.value = null;
    place(task, moment(day.date).startOf("day").add(startHour.value, "hours").add(slot * 60, "minutes"));
}

function onDoubleClick(event, day) {
    const rect = event.currentTarget.getBoundingClientRect();
    const slot = Math.floor((event.clientY - rect.top) / (HOUR_PX / 2)) / 2;
    agenda.addFocus(moment(day.date).startOf("day").add(startHour.value + slot, "hours"), 1);
}
function addFocusNow() {
    const begin = moment().add(1, "hour").startOf("hour");
    agenda.addFocus(begin, 2);
}
function onBlockClick(item) {
    if (item.removable) agenda.removeFocus(item.id);
    else if (item.task) openTask(item.task);
}

function shift(delta) {
    anchor.value = moment(anchor.value).add(delta, mode.value === "day" ? "day" : "week");
}
const goToday = () => { anchor.value = moment(); };
function toggleHours() {
    const presets = [[9, 18], [8, 17], [10, 19], [7, 22]];
    const idx = presets.findIndex(([a, b]) => a === startHour.value && b === endHour.value);
    const [a, b] = presets[(idx + 1) % presets.length];
    startHour.value = a;
    endHour.value = b;
    localStorage.setItem("ah.planner.start", String(a));
    localStorage.setItem("ah.planner.end", String(b));
}

function openTask(task) {
    detail.value = { open: true, taskId: task._id, projectId: task.ProjectID, sprintId: task.sprintId };
}
function closeTask() {
    detail.value = { open: false, taskId: "", projectId: "", sprintId: "" };
    work.fetchOpen().catch(() => {});
}

/* One day at a time under 768px (24d) — the week grid does not survive 375px. */
function syncViewport() {
    isMobile.value = window.innerWidth <= 768;
    if (isMobile.value) mode.value = "day";
}

let clock = null;
onMounted(() => {
    syncViewport();
    window.addEventListener("resize", syncViewport);
    work.fetchOpen().catch((error) => console.error("planner tasks failed", error));
    agenda.load().catch(() => {});
    clock = setInterval(() => { now.value = moment(); }, 60000);
});
onUnmounted(() => {
    window.removeEventListener("resize", syncViewport);
    clearInterval(clock);
});
</script>
