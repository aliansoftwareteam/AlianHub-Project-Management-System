import { computed, ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { shellState } from "@/components/organisms/Shell/shellState";

const AUTONOMY = [
    { level: 0, key: "L0", label: "Assist" },
    { level: 1, key: "L1", label: "Suggest" },
    { level: 2, key: "L2", label: "Act in bounds" },
    { level: 3, key: "L3", label: "Scheduled" },
    { level: 4, key: "L4", label: "Lifecycle" }
];

const agents = ref([]);
const proposals = ref([]);
const counts = ref({});
const runSummary = ref({});
const spend = ref({});
const registryManifest = ref({ actions: [], never: [] });
const loading = ref(false);
const lastError = ref("");

const ok = (res) => res?.data?.status === true;
const rows = (res) => (ok(res) ? res.data.data : []);

export function autonomyOf(level) {
    return AUTONOMY.find((a) => a.level === Number(level)) || AUTONOMY[0];
}

export function useAgents() {
    const running = computed(() => Number(runSummary.value.running || 0));
    const waiting = computed(() => Number(counts.value.pending || 0));

    const loadAgents = async () => {
        const res = await apiRequest("get", env.AGENTS);
        agents.value = rows(res);
    };

    const loadProposals = async (bucket = "pending") => {
        const query = bucket === "pending" ? "?status=pending" : `?status=all&bucket=${encodeURIComponent(bucket)}`;
        const res = await apiRequest("get", `${env.AGENT_PROPOSALS}${query}`);
        if (!ok(res)) return;
        proposals.value = res.data.data || [];
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
            lastError.value = error?.response?.data?.statusText || error.message;
        } finally {
            loading.value = false;
        }
    };

    const decide = async (id, verb, body = {}) => {
        const res = await apiRequest("post", `${env.AGENT_PROPOSALS}/${id}/${verb}`, body);
        if (!ok(res)) throw new Error(res?.data?.statusText || "That did not go through.");
        return res.data.data;
    };

    const setPaused = async (agentId, paused) => {
        await apiRequest("post", `${env.AGENTS}/${agentId}/${paused ? "pause" : "resume"}`, {});
        await loadAgents();
    };

    const pauseAll = async () => {
        await apiRequest("post", env.AGENT_PAUSE_ALL, {});
        await Promise.all([loadAgents(), loadSummary()]);
    };

    // Runs still open, by agent — so a card can offer Stop instead of leaving a stuck
    // run to sit in every "n running" count.
    const activeRuns = ref({});
    const loadActiveRuns = async () => {
        try {
            const res = await apiRequest("get", `${env.AGENT_RUNS}?limit=50`);
            const rows = ok(res) ? (res.data.data || []) : [];
            const map = {};
            rows.filter((r) => ["running", "queued", "waiting_approval"].includes(r.status)).forEach((r) => { (map[r.agentId] = map[r.agentId] || []).push(r._id); });
            activeRuns.value = map;
        } catch (e) { activeRuns.value = {}; }
    };
    const stopActive = async (agentId) => {
        const ids = activeRuns.value[agentId] || [];
        for (const id of ids) {
            // eslint-disable-next-line no-await-in-loop
            await apiRequest("post", `${env.AGENT_RUNS}/${id}/stop`, {});
        }
        await loadActiveRuns();
        await loadSummary();
    };

    const runNow = async (agentId) => {
        const res = await apiRequest("post", env.AGENT_RUNS, { agentId, trigger: "manual" });
        if (!ok(res)) throw new Error(res?.data?.statusText || "The run did not start.");
        await loadSummary();
        await loadActiveRuns();
        return res.data.data;
    };

    const saveAgent = async (agent) => {
        const res = agent._id
            ? await apiRequest("put", `${env.AGENTS}/${agent._id}`, agent)
            : await apiRequest("post", env.AGENTS, agent);
        if (!ok(res)) throw new Error(res?.data?.statusText || "The agent was not saved.");
        await loadAgents();
        return res.data.data;
    };

    return {
        agents, proposals, counts, runSummary, spend, registryManifest, loading, lastError,
        running, waiting, AUTONOMY,
        loadAll, loadAgents, loadProposals, loadSummary, loadSpend, loadRegistry,
        decide, setPaused, pauseAll, runNow, saveAgent, activeRuns, loadActiveRuns, stopActive
    };
}
