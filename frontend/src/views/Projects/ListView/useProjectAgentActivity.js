import { ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

/* Agent activity for the rows of one project (handoff 28b): a live run puts the
 * dark border and strip on the row, a pending proposal puts the "✦ agent: …"
 * line on it. Module-level state so every group shares one pair of requests.
 * Nothing renders when there is nothing to show. */
const runsByTask = ref({});
const proposalsByTask = ref({});
const loadedFor = ref("");

const ok = (res) => res?.data?.status === true;

async function load(projectId) {
    if (!projectId || loadedFor.value === String(projectId)) return;
    loadedFor.value = String(projectId);
    try {
        const [runs, proposals] = await Promise.all([
            apiRequest("get", `${env.AGENT_RUNS}?projectId=${encodeURIComponent(projectId)}&status=open&limit=50`),
            apiRequest("get", `${env.AGENT_PROPOSALS}?status=pending`)
        ]);
        const runMap = {};
        (ok(runs) ? runs.data.data : []).forEach((run) => {
            if (run?.taskId) runMap[String(run.taskId)] = run;
        });
        runsByTask.value = runMap;

        const proposalMap = {};
        (ok(proposals) ? proposals.data.data : []).forEach((proposal) => {
            if (proposal?.taskId && String(proposal.projectId || projectId) === String(projectId)) {
                proposalMap[String(proposal.taskId)] = proposal;
            }
        });
        proposalsByTask.value = proposalMap;
    } catch (_error) {
        runsByTask.value = {};
        proposalsByTask.value = {};
    }
}

export function useProjectAgentActivity() {
    return {
        load,
        runFor: (taskId) => runsByTask.value[String(taskId)] || null,
        proposalFor: (taskId) => proposalsByTask.value[String(taskId)] || null
    };
}
