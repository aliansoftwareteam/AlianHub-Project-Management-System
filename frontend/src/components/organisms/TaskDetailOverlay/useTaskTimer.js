import { reactive, computed } from "vue";
import moment from "moment";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import Store from "@/store/index";

/* The one running timer per person. The task panel, Home and the Time pages all read and
 * write this entry; `ah.timer` was the key Home and Time used before they shared it. */
const STORAGE_PREFIX = "ah.timer.";
const LEGACY_KEY = "ah.timer";
const TICK_MS = 1000;

export const timerState = reactive({
    userId: "",
    entry: null,
    now: Date.now()
});

let tickHandle = null;

function storageKey() {
    return `${STORAGE_PREFIX}${timerState.userId || "anon"}`;
}

function persist() {
    try {
        if (timerState.entry) localStorage.setItem(storageKey(), JSON.stringify(timerState.entry));
        else localStorage.removeItem(storageKey());
    } catch (_e) { /* storage unavailable */ }
}

function ensureTick() {
    if (tickHandle) return;
    tickHandle = setInterval(() => { timerState.now = Date.now(); }, TICK_MS);
}

function readStored() {
    try {
        const raw = localStorage.getItem(storageKey());
        return raw ? JSON.parse(raw) : null;
    } catch (_e) {
        return null;
    }
}

function takeLegacy() {
    try {
        const raw = localStorage.getItem(LEGACY_KEY);
        if (!raw) return null;
        localStorage.removeItem(LEGACY_KEY);
        const old = JSON.parse(raw);
        if (!old || !old.taskId) return null;
        const running = old.running !== false;
        const startedAt = Number(old.startedAt) || Date.now();
        return {
            taskId: String(old.taskId),
            taskName: old.taskName || "",
            projectId: old.projectId || "",
            projectName: old.projectName || "",
            sprintId: old.sprintId || "",
            description: old.note || "",
            firstStartedAt: Number(old.firstStartedAt) || startedAt,
            startedAt: running ? startedAt : 0,
            accumulatedMs: Number(old.accumulated) || 0,
            paused: !running
        };
    } catch (_e) {
        return null;
    }
}

export function initTimer(userId) {
    timerState.userId = String(userId || "");
    timerState.entry = readStored();
    const legacy = takeLegacy();
    if (!timerState.entry && legacy) {
        timerState.entry = legacy;
        persist();
    }
    ensureTick();
}

export function ensureTimerLoaded() {
    if (timerState.userId) return;
    let userId = "";
    try { userId = localStorage.getItem("userId") || ""; } catch (_e) { /* storage unavailable */ }
    if (userId) initTimer(userId);
}

if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
        if (!timerState.userId || event.key !== storageKey()) return;
        timerState.entry = readStored();
        ensureTick();
    });
}

/* Home and Time start timers without the user details a time log needs; they are filled
 * in from the signed-in user when the timer stops. */
function withUserContext(entry) {
    const getters = Store.getters || {};
    const userId = entry.userId || timerState.userId;
    const user = (getters["users/users"] || []).find((u) => u._id === userId) || {};
    let companyId = entry.companyId || "";
    try { companyId = companyId || localStorage.getItem("selectedCompany") || ""; } catch (_e) { /* storage unavailable */ }
    return {
        ...entry,
        userId,
        companyId,
        userName: entry.userName || user.Employee_Name || "",
        dateFormat: entry.dateFormat || getters["settings/companyDateFormat"]?.dateFormat || "DD/MM/YYYY",
        companyOwnerId: entry.companyOwnerId || getters["settings/companyOwnerDetail"]?._id || "",
        timeZone: entry.timeZone || user.timeZone || user.Time_Zone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeFormat: entry.timeFormat || user.timeFormat || user.Time_Format || "24"
    };
}

export const elapsedSeconds = computed(() => {
    const entry = timerState.entry;
    if (!entry) return 0;
    const running = entry.paused || !entry.startedAt ? 0 : Math.max(0, timerState.now - entry.startedAt);
    return Math.floor((entry.accumulatedMs + running) / 1000);
});

export function formatClock(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function isTimerFor(taskId) {
    return Boolean(timerState.entry) && timerState.entry.taskId === String(taskId);
}

/**
 * One timer per person: starting a second one stops (and logs) the first.
 * Returns the entry that was stopped, so the caller can say so.
 */
export async function startTimer(context) {
    const previous = timerState.entry && timerState.entry.taskId !== String(context.taskId) ? await stopTimer() : null;
    timerState.entry = {
        ...context,
        taskId: String(context.taskId),
        firstStartedAt: Date.now(),
        startedAt: Date.now(),
        accumulatedMs: 0,
        paused: false
    };
    persist();
    ensureTick();
    return previous;
}

export function pauseTimer() {
    const entry = timerState.entry;
    if (!entry || entry.paused) return;
    entry.accumulatedMs += Math.max(0, Date.now() - entry.startedAt);
    entry.startedAt = 0;
    entry.paused = true;
    persist();
}

export function resumeTimer() {
    const entry = timerState.entry;
    if (!entry || !entry.paused) return;
    entry.startedAt = Date.now();
    entry.paused = false;
    persist();
}

function toLogPayload(entry, endedAt) {
    const totalMinutes = Math.max(1, Math.round((entry.accumulatedMs + (entry.paused || !entry.startedAt ? 0 : endedAt - entry.startedAt)) / 60000));
    const start = moment(entry.firstStartedAt);
    const end = moment(endedAt);
    if (!end.isSame(start, "day")) {
        start.set({ hour: Math.max(0, end.hour() - Math.floor(totalMinutes / 60) - 1), minute: end.minute() });
        start.year(end.year()).month(end.month()).date(end.date());
    }
    return {
        logTimeDate: end.format("YYYY-MM-DD"),
        description: entry.description || "Timer",
        startLogTime: start.format("HH:mm"),
        endLogTime: end.format("HH:mm"),
        timeDuration: `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`,
        ticketId: entry.taskId,
        projectId: entry.projectId,
        companyId: entry.companyId,
        userId: entry.userId,
        isEdit: false,
        userName: entry.userName,
        dateFormat: entry.dateFormat,
        timeSheetId: "",
        sprintId: entry.sprintId,
        taskName: entry.taskName,
        companyOwnerId: entry.companyOwnerId,
        projectName: entry.projectName,
        previousLoggedTime: "",
        timeZone: entry.timeZone,
        timeFormat: entry.timeFormat,
        billable: true
    };
}

/**
 * Stops the running timer and writes a manual time log for it. Anything
 * under a minute is discarded rather than logged as zero.
 */
export async function stopTimer() {
    const entry = timerState.entry;
    if (!entry) return null;
    const endedAt = Date.now();
    const elapsedMs = entry.accumulatedMs + (entry.paused || !entry.startedAt ? 0 : endedAt - entry.startedAt);
    timerState.entry = null;
    persist();
    if (elapsedMs < 60000) return { ...entry, logged: false, tooShort: true };
    try {
        const response = await apiRequest("post", env.ADD_TIMELOG, toLogPayload(withUserContext(entry), endedAt));
        return { ...entry, logged: response?.data?.status !== false, statusText: response?.data?.statusText, code: response?.data?.code };
    } catch (error) {
        console.error("ERROR in stopTimer: ", error);
        return { ...entry, logged: false };
    }
}

export function discardTimer() {
    timerState.entry = null;
    persist();
}
