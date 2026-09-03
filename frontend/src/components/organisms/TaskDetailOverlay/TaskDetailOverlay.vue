<template>
    <Transition name="ah-detail">
        <div v-if="overlayState.open && overlayState.current" class="ah-detail" :class="{ 'is-expanded': isExpanded }">
            <div v-if="!isExpanded" class="ah-detail__scrim" @click="closeTask()"></div>
            <aside class="ah-detail__panel" role="dialog" aria-modal="false" :aria-label="$t('TaskPanel.dialog_label')" :style="{ width: panelWidth }">
                <TaskDetailPanel
                    :key="overlayState.current.taskId"
                    :companyId="overlayState.current.companyId"
                    :projectId="overlayState.current.projectId"
                    :sprintId="overlayState.current.sprintId"
                    :folderId="overlayState.current.folderId"
                    :taskId="overlayState.current.taskId"
                    :tab="overlayState.tab"
                    :expanded="isExpanded"
                    :agentRun="agentRun"
                    @close="closeTask()"
                    @expand="expandTask()"
                    @minimize="minimizeTask()"
                />
            </aside>
        </div>
    </Transition>

    <div v-if="overlayState.minimized.length" class="ah-tray" :aria-label="$t('TaskPanel.tray_label')">
        <div v-for="item in overlayState.minimized" :key="item.taskId" class="ah-tray__chip">
            <button type="button" class="ah-tray__open" :title="item.taskName" @click="restoreTask(item.taskId)">
                <span class="ah-mono">{{ item.taskKey || '…' }}</span>
                <span class="ah-tray__name">{{ item.taskName || $t('TaskPanel.untitled') }}</span>
                <ShellIcon name="chevron" :size="12" class="ah-tray__caret" />
            </button>
            <button type="button" class="ah-tray__dismiss" :aria-label="$t('TaskPanel.close')" @click="dismissMinimized(item.taskId)"><ShellIcon name="x" :size="11" /></button>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import TaskDetailPanel from "./TaskDetailPanel.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { initTimer } from "./useTaskTimer";
import {
    overlayState, isExpanded, bindRouter, openTask, closeTask, expandTask, minimizeTask,
    restoreTask, dismissMinimized, TASK_QUERY_KEY
} from "./useTaskOverlay";
import "./style.css";

defineOptions({ name: "TaskDetailOverlay" });

defineProps({
    /** Set by the host when an agent run is in progress for the open task; the panel renders a strip for it. */
    agentRun: { type: Object, default: null }
});

const route = useRoute();
const router = useRouter();
const companyId = inject("$companyId");
const userId = inject("$userId");
const clientWidth = inject("$clientWidth");

bindRouter(router, route);

const panelWidth = computed(() => {
    if (isExpanded.value || clientWidth.value < 1024) return "100%";
    return "var(--detail-w)";
});

let wasExpanded = false;
function openFromRoute() {
    const taskId = route.params?.taskId ? String(route.params.taskId) : "";
    if (!taskId) {
        if (wasExpanded && overlayState.open) closeTask({ keepRoute: true });
        wasExpanded = false;
        return;
    }
    wasExpanded = true;
    openTask({
        companyId: route.params.cid || companyId.value,
        projectId: route.params.id,
        sprintId: route.params.sprintId,
        folderId: route.params.folderId || "",
        taskId,
        tab: route.query?.detailTab === "comment" ? "activity" : ""
    });
}

function restoreFromQuery() {
    const taskId = route.query?.[TASK_QUERY_KEY];
    if (!taskId || route.params?.taskId || overlayState.current?.taskId === taskId) return;
    apiRequest("get", `${env.TASK}/${taskId}`).then((response) => {
        const task = response?.data;
        if (!task || !task._id) return;
        openTask({
            companyId: companyId.value,
            projectId: task.ProjectID,
            sprintId: task.sprintId,
            folderId: task.folderObjId || "",
            taskId: task._id
        });
    }).catch((error) => console.error("ERROR restoring task overlay: ", error));
}

function onKeydown(event) {
    if (event.key !== "Escape" || !overlayState.open) return;
    const target = event.target;
    if (target && (target.closest?.(".sidebar-main, .modal, .swal2-container") || target.isContentEditable)) return;
    closeTask();
}

watch(() => route.params?.taskId, openFromRoute);
watch(() => route.query?.[TASK_QUERY_KEY], (value) => { if (value) restoreFromQuery(); });

onMounted(() => {
    overlayState.hostMounted += 1;
    initTimer(userId.value);
    document.addEventListener("keydown", onKeydown);
    openFromRoute();
    restoreFromQuery();
});
onBeforeUnmount(() => {
    overlayState.hostMounted -= 1;
    document.removeEventListener("keydown", onKeydown);
});
</script>
