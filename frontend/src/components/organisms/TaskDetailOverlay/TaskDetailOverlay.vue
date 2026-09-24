<template>
    <Transition name="ah-detail">
        <div v-if="overlayState.open && overlayState.current" class="ah-detail" :class="{ 'is-expanded': isExpanded }">
            <div v-if="!isExpanded" class="ah-detail__scrim" @click="closeTask()"></div>
            <div ref="panelRef" class="ah-detail__panel" role="dialog" :aria-modal="isExpanded ? 'false' : 'true'" :aria-label="$t('TaskPanel.dialog_label')" tabindex="-1" :style="{ width: panelWidth }">
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
                    :nav="overlayState.nav"
                    @step="step"
                    @close="closeTask()"
                    @expand="expandTask()"
                    @minimize="minimizeTask()"
                />
            </div>
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
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import TaskDetailPanel from "./TaskDetailPanel.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { initTimer } from "./useTaskTimer";
import { useFocusTrap } from "@/composable/useFocusTrap";
import {
    overlayState, isExpanded, bindRouter, openTask, closeTask, expandTask, minimizeTask,
    restoreTask, dismissMinimized, stepTask, restoreFromSequence, TASK_QUERY_KEY
} from "./useTaskOverlay";
import { navKeyDirection } from "./taskNavigation";
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

const panelRef = ref(null);
useFocusTrap(panelRef, computed(() => overlayState.open && Boolean(overlayState.current) && !isExpanded.value));

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
    if (restoreFromSequence(taskId, companyId.value)) return;
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

/* The panel is keyed by task, so the control that had focus is replaced; put focus on
 * its twin in the new panel, or on the dialog itself so the trap keeps holding it. */
async function step(direction) {
    const panel = panelRef.value;
    const active = document.activeElement;
    const navDir = panel && panel.contains(active) ? active.getAttribute("data-nav-dir") : null;
    if (!stepTask(direction)) return;
    await nextTick();
    await nextTick();
    const root = panelRef.value;
    if (!root) return;
    const twin = navDir ? root.querySelector(`[data-nav-dir="${navDir}"]:not([disabled])`) : null;
    const fallback = navDir ? root.querySelector("[data-nav-dir]:not([disabled])") : null;
    const target = twin || fallback;
    if (target) target.focus({ preventScroll: true });
    else root.focus({ preventScroll: true });
}

function onNavKey(event) {
    const panel = panelRef.value;
    if (!panel || !overlayState.nav) return;
    const target = event.target;
    if (target && target !== document.body && !panel.contains(target)) return;
    const direction = navKeyDirection(event);
    if (!direction) return;
    event.preventDefault();
    step(direction);
}

function onKeydown(event) {
    if (!overlayState.open) return;
    if (event.key !== "Escape") {
        onNavKey(event);
        return;
    }
    const target = event.target;
    if (target && (target.closest?.(".sidebar-main, .modal, .swal2-container") || target.isContentEditable)) return;
    closeTask();
}

// Expanding releases the trap, which hands focus back to the row now hidden behind the page.
watch(isExpanded, (expanded) => {
    if (!expanded) return;
    nextTick(() => {
        const root = panelRef.value;
        if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
    });
});
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
