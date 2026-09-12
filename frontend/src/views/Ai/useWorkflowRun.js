import { computed, ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { i18n } from "@/locales/main";
import { blockedOf, groupSteps, isEngineOff, runTotalsOf } from "./workflowRun";

// One workflow run, loaded and controlled. The four step controls are the same
// request with a different verb, and every one of them answers with the run and
// its steps, so applying a control is also the refresh.

const ENGINE_OFF = 503;

/* The service layer rejects on any non-2xx, and the status matters here: 503 is
 * the engine being off rather than the request being wrong, and the view shows
 * that as a state rather than as an error. */
const request = async (type, endpoint, body, fallbackKey) => {
    let res;
    try {
        res = await apiRequest(type, endpoint, body);
    } catch (error) {
        const status = Number(error?.response?.status) || 0;
        const message = error?.response?.data?.statusText || error?.response?.data?.message || error?.message || i18n.global.t(fallbackKey);
        throw Object.assign(new Error(message), { status });
    }
    if (res?.data?.status !== true) {
        throw Object.assign(new Error(res?.data?.statusText || res?.data?.message || i18n.global.t(fallbackKey)), { status: 0 });
    }
    return res.data.data;
};

export const CONTROLS = Object.freeze(["retry", "skip", "resume", "compensate"]);

export function useWorkflowRun(runId) {
    const run = ref(null);
    const steps = ref([]);
    const error = ref("");
    const engineOff = ref(false);
    const loaded = ref(false);
    const busy = ref("");
    const expanded = ref([]);

    const id = () => String(typeof runId === "function" ? runId() : (runId?.value ?? runId));

    const take = (data) => {
        run.value = data?.run || null;
        steps.value = Array.isArray(data?.steps) ? data.steps : [];
    };

    const load = async () => {
        error.value = "";
        engineOff.value = false;
        try {
            take(await request("get", `${env.WORKFLOW_RUNS}/${id()}`, null, "Workflows.load_failed"));
        } catch (e) {
            if (isEngineOff(e)) engineOff.value = true;
            else error.value = e.message;
        } finally {
            loaded.value = true;
        }
    };

    const control = async (action, stepId, reason = "") => {
        if (!CONTROLS.includes(action)) throw new Error(`unknown control ${action}`);
        busy.value = `${stepId}:${action}`;
        try {
            const data = await request("post", `${env.WORKFLOW_RUNS}/${id()}/steps/${stepId}/${action}`, { reason }, "Workflows.control_failed");
            if (action === "compensate") await load();
            else take(data);
            return data;
        } finally {
            busy.value = "";
        }
    };

    const toggleChildren = (stepId) => {
        const key = String(stepId);
        expanded.value = expanded.value.includes(key) ? expanded.value.filter((s) => s !== key) : [...expanded.value, key];
    };

    return {
        run,
        steps,
        error,
        engineOff,
        loaded,
        busy,
        expanded,
        nodes: computed(() => groupSteps(steps.value, { expanded: expanded.value })),
        blocked: computed(() => blockedOf(run.value, steps.value)),
        totals: computed(() => runTotalsOf(steps.value)),
        load,
        control,
        toggleChildren,
        ENGINE_OFF
    };
}
