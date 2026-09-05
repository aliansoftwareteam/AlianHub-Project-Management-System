import { ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { i18n } from "@/locales/main";
import { useAgents, reasonOf } from "./useAgents";

// The extra reads the teammate, picker and routing screens need on top of
// useAgents: the raw run list (fit is computed from run history, and useAgents
// only keeps the summary the rail needs) and the routable task list.

const runs = ref([]);
const routable = ref([]);

const ok = (res) => res?.data?.status === true;

const post = async (endpoint, body, fallbackKey) => {
    let res;
    try {
        res = await apiRequest("post", endpoint, body);
    } catch (error) {
        throw new Error(reasonOf(error, fallbackKey));
    }
    if (!ok(res)) throw new Error(res?.data?.statusText || res?.data?.message || i18n.global.t(fallbackKey));
    return res.data.data;
};

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

    /* spendCapUsd and notifyMe are the picker's "also set" options; the run
     * carries them so the server can honour them without a second call. */
    const startRun = async ({ agentId, taskId, note, trigger, spendCapUsd, notifyMe }) => {
        const body = { agentId, taskId, note, trigger: trigger || "manual" };
        if (Number(spendCapUsd) > 0) body.spendCapUsd = Number(spendCapUsd);
        if (notifyMe !== undefined) body.notifyMe = Boolean(notifyMe);
        const run = await post(env.AGENT_RUNS, body, "Ai.run_failed");
        await Promise.all([loadRuns(), loadSummary()]);
        return run;
    };

    const stopRun = async (runId) => {
        const run = await post(`${env.AGENT_RUNS}/${runId}/stop`, {}, "Ai.stop_failed");
        await Promise.all([loadRuns(), loadSummary()]);
        return run;
    };

    return { agents, registryManifest, runs, routable, loadAgents, loadRegistry, loadRuns, loadRoutable, startRun, stopRun };
}
