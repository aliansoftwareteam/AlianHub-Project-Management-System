import { computed, reactive } from "vue";
import { openRuns, proposals as pendingProposals, subscribeAgentFeed } from "@/views/Ai/agentFeed";

/**
 * Agent activity scoped to one project (handoff 28b, surfaces 2 and 3): the dark
 * header chip, and the per-card run strip / proposal line. Nothing renders when
 * there is no data. It filters the shared agent feed, so a project page sends no
 * agent request of its own and switching project costs none.
 */
const state = reactive({ projectId: "" });
let release = null;

const inProject = (row) => Boolean(state.projectId) && String(row.projectId || "") === state.projectId;
const ofTask = (taskId) => (row) => String(row.taskId || "") === String(taskId);

const runs = computed(() => openRuns.value.filter(inProject));
const proposals = computed(() => pendingProposals.value.filter(inProject));

const summary = computed(() => {
    if (!state.projectId) return null;
    const now = Date.now();
    const running = runs.value.filter((r) => r.status === "running");
    return {
        running: running.length,
        waitingApproval: runs.value.filter((r) => r.status === "waiting_approval").length,
        agents: new Set(runs.value.map((r) => String(r.agentId))).size,
        elapsedMs: running.reduce((sum, r) => sum + Math.max(0, now - new Date(r.startedAt || now).getTime()), 0),
        spendUsd: Math.round(runs.value.reduce((sum, r) => sum + Number(r.spendUsd || 0), 0) * 100) / 100
    };
});

export function useProjectAgents() {
    const start = (projectId) => {
        const id = String(projectId || "");
        if (!id || state.projectId === id) return;
        state.projectId = id;
        if (!release) release = subscribeAgentFeed({ proposals: true, claims: true });
    };

    const stop = () => {
        release?.();
        release = null;
        state.projectId = "";
    };

    const openRunFor = (taskId) => runs.value.find(ofTask(taskId)) || null;
    const runFor = (taskId) => runs.value.find((r) => r.status === "running" && ofTask(taskId)(r)) || null;
    const proposalFor = (taskId) => proposals.value.find(ofTask(taskId)) || null;

    return { state, start, stop, runFor, openRunFor, proposalFor, summary };
}

export function elapsedClock(startedAt) {
    const ms = Math.max(0, Date.now() - new Date(startedAt || Date.now()).getTime());
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
