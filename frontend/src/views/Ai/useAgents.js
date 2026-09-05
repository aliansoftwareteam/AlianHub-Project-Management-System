import { computed, ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { i18n } from "@/locales/main";
import { shellState } from "@/components/organisms/Shell/shellState";

// The server clamps autonomy to L3; a fourth rung would promise a level no agent can reach.
const AUTONOMY = [
    { level: 0, key: "L0", label: "Assist" },
    { level: 1, key: "L1", label: "Suggest" },
    { level: 2, key: "L2", label: "Act in bounds" },
    { level: 3, key: "L3", label: "Scheduled" }
];

const INBOX_VIEWS = Object.freeze({
    pending: { query: "?status=pending", statuses: ["pending"] },
    done: { query: "?status=all&limit=200", statuses: ["approved", "edited"] },
    declined: { query: "?status=declined", statuses: ["declined"] }
});

const agents = ref([]);
const proposals = ref([]);
const counts = ref({});
const runSummary = ref({});
const spend = ref({});
const registryManifest = ref({ actions: [], never: [] });
const loading = ref(false);
const lastError = ref("");
const activeRuns = ref({});

const ok = (res) => res?.data?.status === true;
const rows = (res) => (ok(res) ? res.data.data : []);

/* The service layer rejects on any non-2xx, so the API's own refusal ("Agent is
 * paused", "Spend cap reached") lives on error.response — never on res.data. */
export const reasonOf = (error, fallbackKey) => error?.response?.data?.statusText
    || error?.response?.data?.message
    || (error?.message && !/^Request failed with status code/.test(error.message) ? error.message : "")
    || i18n.global.t(fallbackKey);

const request = async (type, endpoint, body, fallbackKey) => {
    let res;
    try {
        res = await apiRequest(type, endpoint, body);
    } catch (error) {
        throw new Error(reasonOf(error, fallbackKey));
    }
    if (!ok(res)) throw new Error(res?.data?.statusText || res?.data?.message || i18n.global.t(fallbackKey));
    return res.data;
};

export const refusalCount = (run) => (Array.isArray(run?.refusals) ? run.refusals.length : Number(run?.refusals || 0));

export const NEW_AGENT_DEFAULTS = Object.freeze({
    autonomy: 1,
    spendCapUsd: 30,
    allowedActions: Object.freeze(["task.comment", "tasks.search", "task.get"])
});

const OPEN_RUN = ["queued", "running"];

/* GET /runs/:id answers { run, audit }; older callers hand in the bare run. */
export const runOf = (payload) => {
    if (!payload) return null;
    if (payload.run && typeof payload.run === "object") return { ...payload.run, audit: payload.audit || [] };
    return payload;
};

/* A run can be reverted by an owner/admin or by whoever started it, once it has
 * stopped touching things and only while the undo window is open. When the
 * payload carries no windowEndsAt the server is left to decide. */
export const canRevertRun = (run, { userId, privileged, now = Date.now() } = {}) => {
    if (!run || run.revertedAt || OPEN_RUN.includes(run.status)) return false;
    if (run.windowEndsAt && new Date(run.windowEndsAt).getTime() <= now) return false;
    return Boolean(privileged) || (Boolean(userId) && String(run.startedBy || "") === String(userId));
};

export function autonomyOf(level) {
    return AUTONOMY.find((a) => a.level === Number(level)) || AUTONOMY[0];
}

export function useAgents() {
    const running = computed(() => Number(runSummary.value.running || 0));
    const waiting = computed(() => Number(counts.value.waiting || 0));

    const loadAgents = async () => {
        const res = await apiRequest("get", env.AGENTS);
        agents.value = rows(res);
    };

    const loadProposals = async (view = "pending") => {
        const spec = INBOX_VIEWS[view] || INBOX_VIEWS.pending;
        const res = await apiRequest("get", `${env.AGENT_PROPOSALS}${spec.query}`);
        if (!ok(res)) return;
        proposals.value = (res.data.data || []).filter((p) => spec.statuses.includes(p.status));
        counts.value = res.data.counts || {};
    };

    const loadSummary = async () => {
        const res = await apiRequest("get", `${env.AGENT_RUNS}/summary`);
        if (!ok(res)) return;
        runSummary.value = res.data.data || {};
        shellState.agentsRunning = Number(runSummary.value.running || 0);
    };

    const loadSpend = async () => {
        const res = await apiRequest("get", env.AGENT_SPEND);
        if (ok(res)) spend.value = res.data.data || {};
    };

    const loadRegistry = async () => {
        const res = await apiRequest("get", env.AGENT_REGISTRY);
        if (ok(res)) registryManifest.value = res.data.data || { actions: [], never: [] };
    };

    const loadAll = async () => {
        loading.value = true;
        lastError.value = "";
        try {
            await Promise.all([loadAgents(), loadProposals(), loadSummary(), loadSpend(), loadRegistry()]);
        } catch (error) {
            lastError.value = reasonOf(error, "Ai.load_failed");
        } finally {
            loading.value = false;
        }
    };

    const decide = async (id, verb, body = {}) => (await request("post", `${env.AGENT_PROPOSALS}/${id}/${verb}`, body, "Ai.decision_failed")).data;

    const setPaused = async (agentId, paused) => {
        await request("post", `${env.AGENTS}/${agentId}/${paused ? "pause" : "resume"}`, {}, paused ? "Ai.pause_failed" : "Ai.resume_failed");
        await loadAgents();
    };

    const pauseAll = async () => {
        await request("post", env.AGENT_PAUSE_ALL, {}, "Ai.pause_failed");
        await Promise.all([loadAgents(), loadSummary()]);
    };

    const loadActiveRuns = async () => {
        try {
            const res = await apiRequest("get", `${env.AGENT_RUNS}?status=open&limit=50`);
            const map = {};
            rows(res).forEach((r) => { (map[r.agentId] = map[r.agentId] || []).push(r._id); });
            activeRuns.value = map;
        } catch (e) { activeRuns.value = {}; }
    };

    const stopActive = async (agentId) => {
        const ids = activeRuns.value[agentId] || [];
        for (const id of ids) {
            // eslint-disable-next-line no-await-in-loop
            await request("post", `${env.AGENT_RUNS}/${id}/stop`, {}, "Ai.stop_failed");
        }
        await loadActiveRuns();
        await loadSummary();
    };

    const runNow = async (agentId, taskId, extra = {}) => {
        const out = await request("post", env.AGENT_RUNS, { agentId, taskId, trigger: "manual", ...extra }, "Ai.run_failed");
        await loadSummary();
        await loadActiveRuns();
        return out.data;
    };

    const saveAgent = async (agent) => {
        const out = agent._id
            ? await request("put", `${env.AGENTS}/${agent._id}`, agent, "Ai.save_failed")
            : await request("post", env.AGENTS, agent, "Ai.save_failed");
        await loadAgents();
        return out.data;
    };

    const deleteAgent = async (agentId) => {
        await request("delete", `${env.AGENTS}/${agentId}`, undefined, "Ai.delete_failed");
        await loadAgents();
    };

    const loadRun = async (runId) => runOf((await request("get", `${env.AGENT_RUNS}/${runId}`, undefined, "Ai.run_load_failed")).data);

    const revertRun = async (runId) => (await request("post", `${env.AGENT_RUNS}/${runId}/revert`, {}, "Ai.revert_failed")).data;

    return {
        agents, proposals, counts, runSummary, spend, registryManifest, loading, lastError,
        running, waiting, AUTONOMY,
        loadAll, loadAgents, loadProposals, loadSummary, loadSpend, loadRegistry,
        decide, setPaused, pauseAll, runNow, saveAgent, deleteAgent, activeRuns, loadActiveRuns, stopActive,
        loadRun, revertRun
    };
}
