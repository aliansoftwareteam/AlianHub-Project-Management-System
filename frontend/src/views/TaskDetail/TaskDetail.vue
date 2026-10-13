<template>
    <TaskDetailOverlay v-if="!overlayState.hostMounted" :agentRun="agentRun" />
</template>

<script setup>
import { onBeforeUnmount, onMounted, watch } from "vue";
import TaskDetailOverlay from "@/components/organisms/TaskDetailOverlay/TaskDetailOverlay.vue";
import { overlayState, openTask, closeTask, onTaskClosed } from "@/components/organisms/TaskDetailOverlay/useTaskOverlay";

/**
 * Compatibility adapter. Hosts that still mount `<TaskDetail>` as a sidebar get
 * the global overlay instead; closing the overlay is reported back through the
 * same `toggleTaskDetail(task, true)` contract they already handle.
 */
defineOptions({ name: "TaskDetailAdapter" });

const props = defineProps({
    companyId: { type: String, default: "" },
    projectId: { type: String, default: "" },
    sprintId: { type: String, default: "" },
    taskId: { type: String, default: "" },
    isTaskDetailSideBar: { type: Boolean, default: false },
    zIndex: { type: Number, default: 7 },
    top: { type: String, default: "" },
    isSupport: { type: Boolean, default: false },
    selectedTask: { type: Object, default: () => ({}) },
    tab: { type: String, default: "" },
    agentRun: { type: Object, default: null }
});
const emit = defineEmits(["toggleTaskDetail", "handleSpinner"]);

function open() {
    if (!props.taskId || !props.projectId) return;
    openTask({
        companyId: props.companyId,
        projectId: props.projectId,
        sprintId: props.sprintId,
        folderId: props.selectedTask?.folderObjId || props.selectedTask?.sprintArray?.folderId || "",
        taskId: props.taskId,
        tab: props.tab
    });
    emit("handleSpinner");
}

const stopListening = onTaskClosed(() => {
    if (props.isTaskDetailSideBar) emit("toggleTaskDetail", { ...props.selectedTask, _id: props.taskId }, true);
});

watch(() => [props.taskId, props.isTaskDetailSideBar], ([taskId, visible]) => {
    if (visible && taskId) open();
});

onMounted(() => {
    if (props.isTaskDetailSideBar) open();
});

onBeforeUnmount(() => {
    stopListening();
    if (overlayState.current?.taskId === props.taskId) closeTask();
});
</script>
