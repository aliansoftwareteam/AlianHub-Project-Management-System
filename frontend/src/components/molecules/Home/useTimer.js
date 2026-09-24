import { computed, reactive } from "vue";
import {
    timerState, startTimer, pauseTimer, resumeTimer, stopTimer, discardTimer, isTimerFor, ensureTimerLoaded
} from "@/components/organisms/TaskDetailOverlay/useTaskTimer";

// Home reads the task panel's per-user timer, in the shape its widgets already use.
const active = computed(() => {
    const entry = timerState.entry;
    if (!entry) return null;
    return {
        taskId: entry.taskId,
        taskName: entry.taskName,
        projectId: entry.projectId,
        projectName: entry.projectName,
        sprintId: entry.sprintId,
        startedAt: entry.startedAt,
        accumulated: entry.accumulatedMs,
        running: !entry.paused,
        firstStartedAt: entry.firstStartedAt
    };
});
const timer = reactive({ active });

const elapsedMs = computed(() => {
    const entry = timerState.entry;
    if (!entry) return 0;
    const running = entry.paused || !entry.startedAt ? 0 : Math.max(0, timerState.now - entry.startedAt);
    return entry.accumulatedMs + running;
});

export function useTimer() {
    ensureTimerLoaded();

    function start(task, project) {
        return startTimer({
            taskId: task._id,
            taskKey: task.TaskKey,
            taskName: task.TaskName,
            projectId: task.ProjectID,
            projectName: project?.ProjectName || task.projectName || "",
            sprintId: task.sprintId
        });
    }

    async function stop() {
        if (!timerState.entry) return null;
        const snapshot = { taskName: timerState.entry.taskName, elapsedMs: elapsedMs.value };
        const result = await stopTimer();
        if (result && !result.logged && !result.tooShort) {
            throw Object.assign(new Error(result.statusText || "log failed"), { code: result.code });
        }
        return { ...snapshot, logged: Boolean(result && result.logged) };
    }

    return { timer, elapsedMs, isTracking: isTimerFor, start, pause: pauseTimer, resume: resumeTimer, stop, clear: discardTimer };
}
