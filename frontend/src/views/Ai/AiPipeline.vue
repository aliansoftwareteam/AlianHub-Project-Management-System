<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('Pipeline.title') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <label v-if="tasks.length" class="pipe-pick">
                    <span class="ah-label">{{ $t('Pipeline.pick_task') }}</span>
                    <select v-model="taskId" class="ah-input pipe-pick__select">
                        <option v-for="row in tasks" :key="row._id" :value="row._id">
                            {{ row.taskKey ? `${row.taskKey} · ${row.name}` : row.name }}
                        </option>
                    </select>
                </label>
            </div>

            <div class="ai-page__body ah-scroll">
                <p class="ai-lead">{{ $t('Pipeline.lead') }}</p>

                <div v-if="loading" class="ah-empty">{{ $t('Pipeline.loading') }}</div>

                <div v-else-if="!tasks.length" class="ah-card ah-card__body pipe-empty">
                    <h3 class="ah-h3">{{ $t('Pipeline.empty_title') }}</h3>
                    <p class="ah-small">{{ $t('Pipeline.empty_body') }}</p>
                    <router-link class="ah-btn ah-btn--primary ah-btn--sm" :to="{ name: 'AiHub', params: { cid: companyId } }">
                        {{ $t('Pipeline.empty_cta') }}
                    </router-link>
                </div>

                <template v-else>
                    <div class="pipe-task ah-card">
                        <div class="ah-card__body pipe-task__body">
                            <span class="ah-mono pipe-task__key">{{ task.taskKey || $t('Pipeline.no_key') }}</span>
                            <strong class="pipe-task__name">{{ task.name }}</strong>
                            <span v-if="task.status" class="ah-chip">{{ task.status }}</span>
                            <span class="ah-mono pipe-task__meta">{{ $t('Pipeline.activity_meta', { runs: task.runs, proposals: task.proposals }) }}</span>
                            <button v-if="task.sprintId" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="openThisTask">
                                {{ $t('Pipeline.open_task') }}
                            </button>
                        </div>
                    </div>

                    <div class="pipe-grid">
                        <section
                            v-for="stage in stages"
                            :key="stage.n"
                            class="pipe-stage"
                            :class="[`pipe-stage--${stage.tone}`, { 'is-stop': stage.beyondRegistry, 'is-idle': !stage.reached }]"
                        >
                            <div v-if="stage.beyondRegistry" class="pipe-stage__stop ah-label">{{ $t('Pipeline.hard_stop') }}</div>
                            <header class="pipe-stage__head">
                                <span class="pipe-stage__n">{{ stage.n }}</span>
                                <h3 class="ah-h3">{{ stage.title }}</h3>
                            </header>
                            <div class="pipe-stage__bar"></div>
                            <p class="pipe-stage__body">{{ stage.body }}</p>

                            <div class="pipe-actor" :class="`pipe-actor--${stage.tone}`">
                                <div>{{ stage.actor }}</div>
                                <div>{{ stage.actorDetail }}</div>
                            </div>

                            <div v-if="stage.keys && stage.keys.length" class="pipe-keys">
                                <span v-for="key in stage.keys" :key="key" class="ah-chip ah-chip--mono ah-chip--danger">{{ key }}</span>
                            </div>

                            <ul v-if="stage.evidence.length" class="pipe-evidence">
                                <li v-for="(row, i) in stage.evidence" :key="i" class="pipe-evidence__row">
                                    <span class="ah-avatar" :class="row.agent ? 'ah-avatar--agent ah-avatar--sm' : 'ah-avatar--sm'">
                                        <ShellIcon :name="row.agent ? 'agent' : 'user'" :size="10" />
                                    </span>
                                    <span class="pipe-evidence__text">
                                        <strong>{{ row.who }}</strong>
                                        <span v-if="row.agent" class="ah-chip ah-chip--agent ah-chip--mono pipe-tag">{{ $t('Pipeline.agent_tag') }}</span>
                                        {{ row.what }}
                                    </span>
                                    <span v-if="row.at" class="ah-mono pipe-evidence__at">{{ row.at }}</span>
                                </li>
                            </ul>
                            <p v-else class="pipe-none">{{ stage.none }}</p>

                            <div v-if="stage.audit.length" class="pipe-audit">
                                <div class="ah-label">{{ $t('Pipeline.audit') }}</div>
                                <div v-for="row in stage.audit" :key="row._id" class="pipe-audit__row ah-mono">
                                    {{ row.line }}
                                </div>
                            </div>
                        </section>
                    </div>

                    <p v-if="!auditVisible" class="pipe-none pipe-audit-note">{{ $t('Pipeline.audit_restricted') }}</p>

                    <div class="pipe-notes">
                        <div class="pipe-note">
                            <strong>{{ $t('Pipeline.note_a_title') }}</strong>
                            {{ $t('Pipeline.note_a_body') }}
                        </div>
                        <div class="pipe-note">
                            <strong>{{ $t('Pipeline.note_b_title') }}</strong>
                            {{ $t('Pipeline.note_b_body') }}
                            <router-link v-if="hasIntegrationsRoute" :to="{ name: 'IntegrationsHub', params: { cid: companyId } }">{{ $t('Pipeline.note_b_link') }}</router-link>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { openTask } from "@/components/organisms/TaskDetailOverlay/useTaskOverlay";
import AiSidebar from "./AiSidebar.vue";
import { useShipping, runElapsed } from "./useShipping";

// 28a — one task through five stages. Stages 4 and 5 are not written here: the
// gate and the hard stop are read from the registry manifest, so removing
// deploy.staging or adding deploy.production changes this screen by itself.
defineOptions({ name: "AiPipeline" });

const { t } = useI18n();
const router = useRouter();
const companyId = inject("$companyId");
const {
    pipelineTasks: tasks, runs, proposals, auditRows, auditRefusals, auditDecisions, auditVisible,
    neverActions, gatedActions, loadRegistry, loadPipelineTasks, loadTaskActivity
} = useShipping();

const taskId = ref("");
const loading = ref(true);

const hasIntegrationsRoute = computed(() => router.hasRoute("IntegrationsHub"));
const task = computed(() => tasks.value.find((row) => row._id === taskId.value) || tasks.value[0] || {});

const at = (value) => (value ? moment(value).format("D MMM HH:mm") : "");
const auditAction = (row) => String(row?.meta?.action || "");
const auditFor = (keys) => (auditVisible.value ? auditRows.value : [])
    .filter((row) => keys.some((key) => auditAction(row).startsWith(key)))
    .slice(0, 4)
    .map((row) => ({ _id: String(row._id), line: `${at(row.createdAt)} · ${row.actorName || ""} · ${auditAction(row) || row.action}` }));

const auditLine = (row, what) => ({ _id: String(row._id), line: `${at(row.createdAt)} · ${row.actorName || ""} · ${what}` });

const gatedKeys = computed(() => gatedActions.value.map((a) => a.key));
const gatedProposals = computed(() => proposals.value.filter((p) => p.gate || (p.changes || []).some((c) => gatedKeys.value.includes(c.action))));
const workRuns = computed(() => runs.value.filter((r) => r.taskId === task.value._id));
const linkRows = computed(() => (auditVisible.value ? auditRows.value : []).filter((row) => auditAction(row) === "task.link"));

const proposalOutcome = (p) => {
    if (p.status === "pending") return t("Pipeline.awaiting", { gate: gateLabel(p.gate) });
    return t("Pipeline.decided", { status: p.status, at: at(p.decidedAt) });
};

const gateLabel = (gate) => (gate === "owner_admin" ? t("Pipeline.gate_owner_admin") : gate || t("Pipeline.gate_human"));

const stages = computed(() => {
    const gated = gatedActions.value;
    const never = neverActions.value;
    const shipBlocked = never.filter((key) => /deploy|merge|git/i.test(key));

    const stage1 = {
        n: 1,
        tone: "brand",
        title: t("Pipeline.s1_title"),
        body: t("Pipeline.s1_body"),
        actor: t("Pipeline.actor_person"),
        actorDetail: task.value.taskKey ? `${task.value.taskKey} → ${runs.value[0]?.agentName || t("Pipeline.unassigned_agent")}` : "",
        reached: Boolean(task.value._id),
        beyondRegistry: false,
        none: t("Pipeline.s1_none"),
        evidence: task.value._id
            ? [{ agent: false, who: t("Pipeline.brief_written"), what: t("Pipeline.status_now", { status: task.value.status || task.value.statusType || "—" }), at: at(task.value.createdAt) }]
            : [],
        audit: auditFor(["task.update", "task.assign"])
    };

    const stage2 = {
        n: 2,
        tone: "ink",
        title: t("Pipeline.s2_title"),
        body: t("Pipeline.s2_body"),
        actor: t("Pipeline.actor_agent"),
        actorDetail: workRuns.value[0]?.skill || "",
        reached: workRuns.value.length > 0,
        beyondRegistry: false,
        none: t("Pipeline.s2_none"),
        evidence: workRuns.value.slice(0, 4).map((run) => ({
            agent: true,
            who: run.agentName,
            what: t("Pipeline.run_line", { status: run.status, elapsed: runElapsed(run), usd: Number(run.spend?.usd || 0).toFixed(2) }),
            at: at(run.startedAt)
        })),
        audit: auditFor(["task.status.set", "timelog", "subtask.create", "task.comment"])
    };

    const stage3 = {
        n: 3,
        tone: "ink",
        title: t("Pipeline.s3_title"),
        body: t("Pipeline.s3_body"),
        actor: t("Pipeline.actor_agent"),
        actorDetail: t("Pipeline.link_action"),
        reached: linkRows.value.length > 0,
        beyondRegistry: false,
        none: t("Pipeline.s3_none"),
        evidence: linkRows.value.slice(0, 4).map((row) => ({
            agent: true,
            who: row.actorName || "",
            what: t("Pipeline.linked", { what: row.meta?.params?.label || row.meta?.params?.url || row.entityName || "" }),
            at: at(row.createdAt)
        })),
        audit: auditFor(["task.link"])
    };

    const stage4 = {
        n: 4,
        tone: "warn",
        title: t("Pipeline.s4_title"),
        body: gated.length
            ? t("Pipeline.s4_body", { actions: gated.map((a) => a.key).join(", "), gate: gateLabel(gated[0].gate) })
            : t("Pipeline.s4_body_none"),
        actor: gated.length ? t("Pipeline.actor_proposes") : t("Pipeline.actor_none"),
        actorDetail: gated.length ? t("Pipeline.human_approves") : "",
        reached: gatedProposals.value.length > 0,
        beyondRegistry: false,
        none: gated.length ? t("Pipeline.s4_none") : t("Pipeline.s4_none_registry"),
        evidence: gatedProposals.value.slice(0, 4).map((p) => ({
            agent: true,
            who: p.agentName,
            what: `${p.what} — ${proposalOutcome(p)}`,
            at: at(p.createdAt)
        })),
        audit: auditDecisions.value
            .filter((row) => gatedProposals.value.some((p) => String(p._id) === String(row.entityId)))
            .slice(0, 4)
            .map((row) => auditLine(row, `${row.meta?.decision || ""} ${row.meta?.agentName || ""}`.trim()))
    };

    const stage5 = {
        n: 5,
        tone: "danger",
        title: t("Pipeline.s5_title"),
        body: shipBlocked.length
            ? t("Pipeline.s5_body", { keys: shipBlocked.join(", ") })
            : t("Pipeline.s5_body_reachable"),
        actor: t("Pipeline.actor_person_only"),
        actorDetail: t("Pipeline.attempts_logged"),
        reached: true,
        beyondRegistry: shipBlocked.length > 0,
        none: t("Pipeline.s5_none", { n: never.length }),
        keys: never,
        evidence: [],
        audit: auditRefusals.value
            .filter((row) => never.some((key) => String(row.meta?.action || "").startsWith(key.replace(/\*$/, ""))))
            .slice(0, 4)
            .map((row) => auditLine(row, `refused ${row.meta?.action || ""}`))
    };

    return [stage1, stage2, stage3, stage4, stage5];
});

const openThisTask = () => openTask({
    companyId,
    projectId: task.value.projectId,
    sprintId: task.value.sprintId,
    folderId: task.value.folderId,
    taskId: task.value._id
});

watch(taskId, async (id) => {
    if (!id) return;
    await loadTaskActivity(id);
});

onMounted(async () => {
    await Promise.all([loadRegistry(), loadPipelineTasks()]);
    taskId.value = tasks.value[0]?._id || "";
    loading.value = false;
});
</script>

<style>
@import "./style.css";
@import "./shipping.css";
</style>
