import { computed, reactive, ref } from "vue";
import moment from "moment";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useGetterFunctions } from "@/composable";

const KEY = "ah.timer";

function load() {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

const timer = reactive({ active: load() });
const now = ref(Date.now());
let ticker = null;

function persist() {
    if (timer.active) localStorage.setItem(KEY, JSON.stringify(timer.active));
    else localStorage.removeItem(KEY);
}

function ensureTicker() {
    if (ticker || !timer.active?.running) return;
    ticker = setInterval(() => { now.value = Date.now(); }, 1000);
}

function stopTicker() {
    if (!ticker) return;
    clearInterval(ticker);
    ticker = null;
}

ensureTicker();

export function useTimer() {
    const { getters } = useStore();
    const { getUser } = useGetterFunctions();

    const elapsedMs = computed(() => {
        const a = timer.active;
        if (!a) return 0;
        return a.accumulated + (a.running ? Math.max(0, now.value - a.startedAt) : 0);
    });

    const isTracking = (taskId) => !!timer.active && timer.active.taskId === taskId;

    function start(task, project) {
        timer.active = {
            taskId: task._id,
            taskName: task.TaskName,
            projectId: task.ProjectID,
            projectName: project?.ProjectName || task.projectName || "",
            sprintId: task.sprintId,
            startedAt: Date.now(),
            accumulated: 0,
            running: true,
            firstStartedAt: Date.now()
        };
        persist();
        now.value = Date.now();
        ensureTicker();
    }

    function pause() {
        const a = timer.active;
        if (!a || !a.running) return;
        a.accumulated += Math.max(0, Date.now() - a.startedAt);
        a.running = false;
        persist();
        stopTicker();
    }

    function resume() {
        const a = timer.active;
        if (!a || a.running) return;
        a.startedAt = Date.now();
        a.running = true;
        persist();
        ensureTicker();
    }

    function clear() {
        timer.active = null;
        persist();
        stopTicker();
    }

    function logPayload(companyId, userId) {
        const a = timer.active;
        const user = getUser(userId);
        const totalMin = Math.max(1, Math.round(elapsedMs.value / 60000));
        const end = moment();
        let begin = end.clone().subtract(totalMin, "minutes");
        if (!begin.isSame(end, "day")) begin = end.clone().startOf("day");
        const duration = end.diff(begin, "minutes");
        const timeDuration = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`;
        return {
            logTimeDate: end.format("YYYY-MM-DD"),
            description: "",
            startLogTime: begin.format("HH:mm"),
            endLogTime: end.format("HH:mm"),
            timeDuration,
            ticketId: a.taskId,
            projectId: a.projectId,
            companyId: companyId,
            userId: userId,
            isEdit: false,
            userName: user.Employee_Name,
            dateFormat: getters["settings/companyDateFormat"]?.dateFormat,
            timeSheetId: "",
            sprintId: a.sprintId,
            taskName: a.taskName,
            companyOwnerId: getters["settings/companyOwnerDetail"]?._id,
            projectName: a.projectName,
            previousLoggedTime: "",
            timeZone: user.timeZone,
            timeFormat: user.timeFormat,
            billable: true
        };
    }

    async function stop({ companyId, userId }) {
        const a = timer.active;
        if (!a) return null;
        pause();
        const snapshot = { taskName: a.taskName, elapsedMs: elapsedMs.value };
        const payload = logPayload(companyId, userId);
        const response = await apiRequest("post", env.ADD_TIMELOG, payload);
        if (response?.data?.status === false) throw new Error(response.data.statusText || "log failed");
        clear();
        return snapshot;
    }

    return { timer, elapsedMs, isTracking, start, pause, resume, stop, clear };
}
