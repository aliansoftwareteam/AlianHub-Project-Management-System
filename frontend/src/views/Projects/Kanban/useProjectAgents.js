import { computed, reactive } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

/**
 * Agent activity scoped to one project (handoff 28b, surfaces 2 and 3): the dark
 * header chip, and the per-card run strip / proposal line. Nothing renders when
 * there is no data.
 */
const state = reactive({ projectId: "", runs: [], proposals: [], summary: null });
let poller = null;

const ok = (res) => res?.data?.status === true;

async function fetchOnce(projectId) {
    const [runsRes, proposalsRes] = await Promise.allSettled([
        apiRequest("get", `${env.AGENT_RUNS}?status=open&projectId=${encodeURIComponent(projectId)}`),
        apiRequest("get", `${env.AGENT_PROPOSALS}?status=pending`)
    ]);
    if (state.projectId !== projectId) return;
    if (runsRes.status === "fulfilled" && ok(runsRes.value)) {
        state.runs = runsRes.value.data.data || [];
        state.summary = runsRes.value.data.summary || null;
    }
    if (proposalsRes.status === "fulfilled" && ok(proposalsRes.value)) {
        state.proposals = (proposalsRes.value.data.data || []).filter((p) => String(p.projectId || "") === String(projectId));
    }
}

export function useProjectAgents() {
    const start = (projectId) => {
        const id = String(projectId || "");
        if (!id || state.projectId === id) return;
        state.projectId = id;
        state.runs = [];
        state.proposals = [];
        state.summary = null;
        fetchOnce(id).catch(() => {});
        if (poller) clearInterval(poller);
        poller = setInterval(() => fetchOnce(state.projectId).catch(() => {}), 30000);
    };

    const stop = () => {
        if (poller) clearInterval(poller);
        poller = null;
        state.projectId = "";
    };

    const runFor = (taskId) => state.runs.find((r) => String(r.taskId || "") === String(taskId) && r.status === "running") || null;
    const proposalFor = (taskId) => state.proposals.find((p) => String(p.taskId || "") === String(taskId)) || null;

    const summary = computed(() => state.summary);

    return { state, start, stop, runFor, proposalFor, summary };
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
