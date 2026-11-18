import { computed, ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

// Reads for the pipeline (28a) and the release screen (28c). The stages, the
// gate and the hard stop are all derived from the registry manifest the server
// returns — nothing about what an agent may do is written down twice.

const manifest = ref({ actions: [], never: [] });
const pipelineTasks = ref([]);
const runs = ref([]);
const proposals = ref([]);
const auditRows = ref([]);
const auditRefusals = ref([]);
const auditDecisions = ref([]);
const auditVisible = ref(true);
const release = ref(null);
const changelog = ref(null);

const ok = (res) => res?.data?.status === true;

export function useShipping() {
    const registryActions = computed(() => manifest.value.actions || []);
    const neverActions = computed(() => manifest.value.never || []);
    const gatedActions = computed(() => registryActions.value.filter((a) => a.gate || a.proposeOnly));

    const loadRegistry = async () => {
        const res = await apiRequest("get", env.AGENT_REGISTRY);
        if (ok(res)) manifest.value = res.data.data || { actions: [], never: [] };
    };

    const loadPipelineTasks = async () => {
        const res = await apiRequest("get", env.AGENT_PIPELINE);
        if (ok(res)) pipelineTasks.value = res.data.data?.tasks || [];
    };

    /* Three audit reads, because the rows sit under three different entities: the
     * task's own actions, the decisions on its proposals, and the refusals — which
     * are workspace-wide, since a refused call never reaches a task. */
    const loadTaskActivity = async (taskId) => {
        const [runRes, proposalRes, auditRes, refusedRes, decidedRes] = await Promise.allSettled([
            apiRequest("get", `${env.AGENT_RUNS}?taskId=${encodeURIComponent(taskId)}&limit=50`),
            apiRequest("get", `${env.AGENT_PROPOSALS}?status=all`),
            apiRequest("get", `${env.AUDIT_LOGS}?entityId=${encodeURIComponent(taskId)}&limit=50`),
            apiRequest("get", `${env.AUDIT_LOGS}?action=agent.action_refused&limit=25`),
            apiRequest("get", `${env.AUDIT_LOGS}?action=agent.proposal_decided&limit=25`)
        ]);
        const rowsOf = (settled) => (settled.status === "fulfilled" && ok(settled.value) ? settled.value.data.data || [] : []);
        runs.value = rowsOf(runRes);
        proposals.value = rowsOf(proposalRes).filter((p) => String(p.taskId || "") === String(taskId));
        auditVisible.value = auditRes.status === "fulfilled" && ok(auditRes.value);
        auditRows.value = rowsOf(auditRes);
        auditRefusals.value = rowsOf(refusedRes);
        auditDecisions.value = rowsOf(decidedRes);
    };

    const loadRelease = async () => {
        const changelogRes = await apiRequest("get", env.GET_CHANGELOG).catch(() => null);
        changelog.value = changelogRes && ok(changelogRes) ? changelogRes.data.data : null;
        const last = (changelog.value?.releases || [])[0];
        const lastAt = last?.publishedAt || last?.date || "";
        const since = lastAt ? `?since=${encodeURIComponent(new Date(lastAt).toISOString())}` : "";
        const res = await apiRequest("get", `${env.AGENT_RELEASE}${since}`);
        if (ok(res)) release.value = res.data.data;
    };

    return {
        manifest, pipelineTasks, runs, proposals, auditRows, auditRefusals, auditDecisions, auditVisible, release, changelog,
        registryActions, neverActions, gatedActions,
        loadRegistry, loadPipelineTasks, loadTaskActivity, loadRelease
    };
}

function elapsed(ms) {
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function runElapsed(run) {
    if (!run) return "";
    const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
    return elapsed(end - new Date(run.startedAt || end).getTime());
}
