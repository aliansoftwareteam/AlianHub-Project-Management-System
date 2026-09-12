import { computed, ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { i18n } from "@/locales/main";
import { isEngineOff } from "./workflowRun";
import { sortApprovals } from "./workflowApprovals";

// The workflow approvals the AI Inbox shows beside the agents' proposals.
//
// Deciding and reassigning both answer with the approval as it now stands, so
// the row in the list is refreshed from the answer rather than from a reload.

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

export function useWorkflowApprovals() {
    const rows = ref([]);
    const error = ref("");
    const engineOff = ref(false);
    const loaded = ref(false);
    const busy = ref(false);

    const load = async () => {
        error.value = "";
        engineOff.value = false;
        try {
            const data = await request("get", env.WORKFLOW_APPROVALS, null, "Workflows.approvals_load_failed");
            rows.value = Array.isArray(data) ? data : [];
        } catch (e) {
            rows.value = [];
            if (isEngineOff(e)) engineOff.value = true;
            else error.value = e.message;
        } finally {
            loaded.value = true;
        }
    };

    const replace = (approval) => {
        if (!approval) return null;
        rows.value = rows.value.map((row) => (row._id === approval._id ? approval : row));
        return approval;
    };

    const drop = (approval) => {
        rows.value = rows.value.filter((row) => row._id !== approval?._id);
        return approval;
    };

    const post = async (approval, action, body, fallbackKey) => {
        busy.value = true;
        try {
            const data = await request("post", `${env.WORKFLOW_RUNS}/${approval.runId}/steps/${approval.stepId}/${action}`, body, fallbackKey);
            return data?.approval || null;
        } finally {
            busy.value = false;
        }
    };

    /* An answered approval leaves the queue: the inbox is what is still waiting. */
    const decide = async (approval, decision, comment = "") => drop(await post(approval, "decide", { decision, comment }, "Workflows.decide_failed"));

    const reassign = async (approval, toUserId, reason = "") => replace(await post(approval, "reassign", { toUserId, reason }, "Workflows.reassign_failed"));

    return {
        approvals: computed(() => sortApprovals(rows.value)),
        count: computed(() => rows.value.length),
        error,
        engineOff,
        loaded,
        busy,
        load,
        decide,
        reassign
    };
}
