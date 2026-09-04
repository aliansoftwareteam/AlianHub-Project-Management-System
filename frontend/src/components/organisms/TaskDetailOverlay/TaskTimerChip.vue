<template>
    <div class="ah-timer" :class="{ 'is-running': runningHere, 'is-paused': runningHere && entry.paused, 'is-idle': !runningHere }">
        <template v-if="runningHere">
            <div class="ah-timer__clock-wrap">
                <span v-if="showLabel" class="ah-timer__label ah-mono">{{ $t('TaskPanel.tracking') }}</span>
                <span class="ah-timer__clock">{{ clock }}</span>
            </div>
            <button v-if="entry.paused" type="button" class="ah-timer__btn" @click="resumeTimer">{{ $t('TaskPanel.resume') }}</button>
            <button v-else type="button" class="ah-timer__btn" @click="pauseTimer">{{ $t('TaskPanel.pause') }}</button>
            <button type="button" class="ah-timer__btn ah-timer__btn--stop" :title="$t('TaskPanel.stop_and_log')" @click="stop">
                <ShellIcon name="check" :size="13" />
            </button>
        </template>
        <template v-else>
            <button type="button" class="ah-timer__start" :disabled="!canStart" :title="elsewhereTitle" @click="start">
                <ShellIcon name="play" :size="13" />
                <span>{{ $t('TaskPanel.start_timer') }}</span>
                <span v-if="entry" class="ah-timer__elsewhere ah-mono">{{ entry.taskKey }} · {{ clock }}</span>
            </button>
        </template>
    </div>
</template>

<script setup>
import { computed, inject } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useGetterFunctions } from "@/composable";
import { timerState, elapsedSeconds, formatClock, startTimer, pauseTimer, resumeTimer, stopTimer, isTimerFor } from "./useTaskTimer";

defineOptions({ name: "TaskTimerChip" });

const props = defineProps({
    task: { type: Object, required: true },
    project: { type: Object, default: () => ({}) },
    canStart: { type: Boolean, default: true },
    showLabel: { type: Boolean, default: false }
});
const emit = defineEmits(["logged"]);

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const userId = inject("$userId");
const companyId = inject("$companyId");

const entry = computed(() => timerState.entry);
const runningHere = computed(() => isTimerFor(props.task?._id));
const clock = computed(() => formatClock(elapsedSeconds.value));
// A disabled button with no reason reads as broken. Say why: a timer elsewhere, or not assigned here.
const elsewhereTitle = computed(() => entry.value ? t("TaskPanel.timer_running_elsewhere", { key: entry.value.taskKey || "" }) : (!props.canStart ? t("TaskPanel.timer_assignee_only") : ""));

async function start() {
    const user = getUser(userId.value) || {};
    const stopped = await startTimer({
        taskId: props.task._id,
        taskKey: props.task.TaskKey,
        taskName: props.task.TaskName,
        projectId: props.task.ProjectID,
        projectName: props.project?.ProjectName || "",
        sprintId: props.task.sprintId,
        companyId: companyId.value,
        userId: userId.value,
        userName: user.Employee_Name || "",
        dateFormat: getters["settings/companyDateFormat"]?.dateFormat || "DD/MM/YYYY",
        companyOwnerId: getters["settings/companyOwnerDetail"]?._id || "",
        timeZone: user.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeFormat: user.timeFormat || "24",
        description: t("TaskPanel.timer_log_description")
    });
    if (stopped) {
        $toast.info(t("TaskPanel.timer_stopped_previous", { key: stopped.taskKey || "" }), { position: "top-right" });
        if (stopped.logged) emit("logged", stopped);
    }
}

async function stop() {
    const result = await stopTimer();
    if (!result) return;
    if (result.logged) {
        $toast.success(t("TaskPanel.timer_logged"), { position: "top-right" });
        emit("logged", result);
    } else if (result.statusText) {
        $toast.error(result.statusText, { position: "top-right" });
    } else {
        $toast.info(t("TaskPanel.timer_too_short"), { position: "top-right" });
    }
}
</script>
