import { ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useAgents } from "./useAgents";

// The extra reads the teammate, picker and routing screens need on top of
// useAgents: the raw run list (fit is computed from run history, and useAgents
// only keeps the summary the rail needs) and the routable task list.

const runs = ref([]);
const routable = ref([]);

const ok = (res) => res?.data?.status === true;

export function useParity() {
    const { agents, registryManifest, loadAgents, loadRegistry, loadSummary } = useAgents();

    const loadRuns = async (query = "?limit=200") => {
        const res = await apiRequest("get", `${env.AGENT_RUNS}${query}`);
        if (ok(res)) runs.value = res.data.data || [];
    };

    const loadRoutable = async (projectId = "") => {
        const res = await apiRequest("get", `${env.AGENT_ROUTABLE}${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`);
        if (ok(res)) routable.value = res.data.data || [];
    };

    const startRun = async ({ agentId, taskId, note, trigger }) => {
        const res = await apiRequest("post", env.AGENT_RUNS, { agentId, taskId, note, trigger: trigger || "manual" });
        if (!ok(res)) throw new Error(res?.data?.statusText || "The run did not start.");
        await Promise.all([loadRuns(), loadSummary()]);
        return res.data.data;
    };

    const stopRun = async (runId) => {
        const res = await apiRequest("post", `${env.AGENT_RUNS}/${runId}/stop`, {});
        if (!ok(res)) throw new Error(res?.data?.statusText || "That run could not be stopped.");
        await Promise.all([loadRuns(), loadSummary()]);
        return res.data.data;
    };

    return { agents, registryManifest, runs, routable, loadAgents, loadRegistry, loadRuns, loadRoutable, startRun, stopRun };
}
