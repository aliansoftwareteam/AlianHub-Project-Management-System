import { ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { reasonOf } from "./useAgents";

/* The reports scheduled agents delivered to the viewer, newest first. */
export function useAgentReports() {
    const reports = ref([]);
    const loaded = ref(false);
    const error = ref("");

    const load = async () => {
        error.value = "";
        try {
            const res = await apiRequest("get", `${env.AGENT_REPORTS}?limit=30`);
            if (!res?.data?.status) throw new Error(res?.data?.statusText || "");
            reports.value = res.data.data || [];
        } catch (e) {
            error.value = reasonOf(e, "Ai.load_failed");
            reports.value = [];
        } finally {
            loaded.value = true;
        }
    };

    return { reports, loaded, error, load };
}
