<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('Ai.inbox') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <span v-if="undo" class="ah-chip ah-chip--ok">
                    {{ $t('Ai.approved') }}
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="onUndo">{{ $t('Ai.undo') }}</button>
                </span>
            </div>

            <AiModelNotice />
            <div class="ai-inbox" :class="{ 'ai-inbox--detail': selected || selectedApproval || selectedReport }">
                <div class="ai-inbox__list ah-scroll">
                    <div class="ai-inbox__tabs">
                        <div class="ah-tabs">
                            <button v-for="tab in tabs" :key="tab.key" type="button" class="ah-tab" :class="{ 'is-active': view === tab.key }" @click="switchView(tab.key)">
                                {{ $t(tab.label) }}<span v-if="tab.count" class="ai-side__count ah-mono">{{ tab.count }}</span>
                            </button>
                        </div>
                        <select v-if="view !== 'approvals' && view !== 'reports' && proposals.length > 1" v-model="sortOrder" class="ah-input ai-inbox__sort" :aria-label="$t('Ai.sort_by')" data-test="inbox-sort">
                            <option value="newest">{{ $t('Ai.sort_newest') }}</option>
                            <option value="oldest">{{ $t('Ai.sort_oldest') }}</option>
                        </select>
                    </div>

                    <template v-if="view === 'approvals'">
                        <EmptyState v-if="approvalsEngineOff" data-test="approvals-engine-off" :title="$t('Workflows.engine_off_title')" :message="$t('Workflows.engine_off_body')" />
                        <div v-else-if="!approvalsLoaded" class="ah-empty" style="margin:14px">{{ $t('Ai.loading') }}</div>
                        <EmptyState v-else-if="approvalsError" :title="$t('Ai.load_failed')" :message="approvalsError" :action-label="$t('Ai.retry')" @action="loadApprovals" />
                        <EmptyState v-else-if="!approvals.length" data-test="approvals-empty" :title="$t('Workflows.approvals_empty_title')" :message="$t('Workflows.approvals_empty_body')" :action-label="$t('Ai.back_to_waiting')" @action="switchView('pending')" />
                        <WorkflowApprovalRow
                            v-for="approval in approvals"
                            v-else
                            :key="approval._id"
                            :approval="approval"
                            :active="selectedApproval && selectedApproval._id === approval._id"
                            @pick="selectedApproval = approval"
                        />
                    </template>

                    <template v-else-if="view === 'reports'">
                        <div v-if="!reportsLoaded" class="ah-empty" style="margin:14px">{{ $t('Ai.loading') }}</div>
                        <EmptyState v-else-if="reportsError" :title="$t('Ai.load_failed')" :message="reportsError" :action-label="$t('Ai.retry')" @action="loadReports" />
                        <EmptyState v-else-if="!reports.length" data-test="reports-empty" :title="$t('Ai.reports_empty_title')" :message="$t('Ai.reports_empty_body')" :action-label="$t('Ai.reports_empty_action')" @action="$router.push({ name: 'AgentTeammates', params: { cid: companyId } })" />
                        <button
                            v-for="r in reports"
                            v-else
                            :key="r._id"
                            type="button"
                            class="ai-item"
                            :class="{ 'is-active': selectedReport && selectedReport._id === r._id }"
                            data-test="report-row"
                            @click="selectedReport = r"
                        >
                            <div class="ai-item__top">
                                <span class="ai-item__agent">{{ r.agentName }}</span>
                                <span v-if="r.status !== 'done'" class="ah-chip ah-chip--mono">{{ runStatusLabel(r.status) }}</span>
                                <span class="ai-item__time ah-mono">{{ shortTime(r.slotAt || r.startedAt) }}</span>
                            </div>
                            <div class="ai-item__what">{{ $t(`Ai.report_${(r.report && r.report.key) || 'daily_briefing'}`) }}</div>
                            <div v-if="r.report && r.report.summary" class="ai-item__why">{{ r.report.summary }}</div>
                        </button>
                    </template>

                    <div v-else-if="loading" class="ah-empty" style="margin:14px">{{ $t('Ai.loading') }}</div>
                    <EmptyState v-else-if="loadError" :title="$t('Ai.load_failed')" :message="loadError" :action-label="$t('Ai.retry')" @action="switchView(view)" />
                    <div v-else-if="!proposals.length && view === 'pending'" class="ai-done">
                        <p class="ah-h3">{{ $t('Ai.queue_clear') }}</p>
                        <p class="ah-small">{{ $t('Ai.queue_clear_body', { approved: counts.doneByAi || 0, declined: counts.declined || 0 }) }}</p>
                    </div>
                    <EmptyState v-else-if="!proposals.length" :title="$t(view === 'done' ? 'Ai.empty_done_title' : 'Ai.empty_declined_title')" :message="$t(view === 'done' ? 'Ai.empty_done_body' : 'Ai.empty_declined_body')" />

                    <button
                        v-for="p in sortedProposals"
                        v-else
                        :key="p._id"
                        type="button"
                        class="ai-item"
                        :class="{ 'is-active': selected && selected._id === p._id }"
                        @click="selected = p"
                    >
                        <div class="ai-item__top">
                            <span class="ai-item__agent">{{ p.agentName }}</span>
                            <span v-if="p.gate" class="ah-chip ah-chip--warn" data-test="proposal-gate">{{ gateChip(p.gate) }}</span>
                            <span v-if="p.taint" class="ah-chip ah-chip--warn ah-chip--mono" data-test="proposal-tainted">{{ $t('Audit.tainted') }}</span>
                            <span v-if="p.status !== 'pending'" class="ah-chip ah-chip--mono">{{ $t(`Ai.status_${p.status}`) }}</span>
                            <span v-if="waitingDaysOf(p)" class="ah-chip ah-chip--warn" data-test="proposal-waiting">{{ t('Ai.waiting_days', { n: waitingDaysOf(p) }, waitingDaysOf(p)) }}</span>
                            <span class="ai-item__time ah-mono">{{ shortTime(p.createdAt) }}</span>
                        </div>
                        <div class="ai-item__what">{{ titleOf(p) }}</div>
                        <div class="ai-item__why">{{ whyOf(p) }}</div>
                    </button>
                </div>

                <WorkflowApprovalDetail
                    v-if="view === 'approvals' && selectedApproval"
                    :approval="selectedApproval"
                    :busy="approvalsBusy"
                    :error="approvalError"
                    @back="selectedApproval = null"
                    @decide="onDecideApproval"
                    @reassign="onReassignApproval"
                />

                <AgentReportDetail v-else-if="view === 'reports' && selectedReport" :report="selectedReport" @back="selectedReport = null" />

                <div v-else-if="view === 'reports'" class="ai-detail ai-detail__empty">
                    <span class="ah-small">{{ $t('Ai.report_pick_one') }}</span>
                </div>

                <div v-else-if="view === 'approvals'" class="ai-detail ai-detail__empty">
                    <span class="ah-small">{{ $t('Workflows.approval_pick_one') }}</span>
                </div>

                <div v-else-if="!selected" class="ai-detail ai-detail__empty">
                    <span class="ah-small">{{ $t('Ai.pick_one') }}</span>
                </div>

                <div v-else class="ai-detail ah-scroll">
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm ai-back" @click="selected = null">
                        <ShellIcon name="chevronLeft" :size="14" />{{ $t('Ai.back_to_queue') }}
                    </button>

                    <div class="ai-detail__crumb">
                        <span>{{ selected.agentName }}</span>
                        <span v-if="selected.runId">· {{ $t('Ai.run_n', { n: String(selected.runId).slice(-4) }) }}</span>
                        <span v-if="selectedSkillSource">· <span data-test="proposal-skill-source">{{ selectedSkillSource }}</span></span>
                        <span>· {{ shortTime(selected.createdAt) }}</span>
                    </div>
                    <h2 class="ai-detail__what">{{ titleOf(selected) }}</h2>

                    <div class="ah-label">{{ $t('Ai.why') }}</div>
                    <p class="ai-detail__why">{{ whyOf(selected) }}</p>

                    <div class="ah-label">{{ changesLabel }}</div>
                    <div v-if="selected.batch" class="ai-batch">
                        <IntentPreview :preview="selected.batch" @open-task="openBatchTask" />
                        <span v-if="!allReversible" class="ah-chip ah-chip--warn ai-batch__mark" data-test="batch-permanent">{{ $t('Ai.not_reversible') }}</span>
                    </div>
                    <template v-for="(change, i) in selected.batch ? [] : editable" :key="i">
                        <div class="ai-change">
                            <ShellIcon :name="change.reversible ? 'check' : 'alert'" :size="14" :class="change.reversible ? 'ah-muted' : ''" />
                            <span class="ai-change__label">{{ changeLabel(t, change) }}</span>
                            <span v-if="!change.reversible" class="ah-chip ah-chip--warn">{{ $t('Ai.not_reversible') }}</span>
                            <button v-if="editing" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="editable.splice(i, 1)">{{ $t('Ai.drop') }}</button>
                        </div>
                        <SlackPostPreview v-if="change.action === SLACK_POST" :change="change" :delivery="slackDeliveryOf(change)" />
                    </template>

                    <div v-if="selected.gate" class="auth__banner auth__banner--warn" style="margin-top:14px">
                        <ShellIcon name="shield" :size="15" />
                        <span>{{ canDecide || lockedByRights ? $t('Ai.gate_note') : $t('Ai.gate_locked') }}</span>
                    </div>

                    <div v-if="lockedByRights" class="auth__banner auth__banner--warn ai-locked" data-test="rights-locked">
                        <ShellIcon name="shield" :size="15" />
                        <span>{{ $t('Ai.rights_locked') }}</span>
                    </div>

                    <div v-if="selected.taint" class="auth__banner auth__banner--warn" style="margin-top:14px" data-test="taint-reason">
                        <ShellIcon name="alert" :size="15" />
                        <span>{{ $t('Audit.tainted_reason') }} <span class="ah-small" data-test="taint-sources">{{ taintLine(selected.taint) }}</span></span>
                    </div>

                    <div v-if="error" class="ah-field__error" style="margin-top:12px">{{ error }}</div>

                    <div v-if="selected.status === 'pending' && canDecide && !declining" class="ai-actions">
                        <button type="button" class="ah-btn ah-btn--primary" :disabled="busy || !editable.length" @click="onApprove">{{ $t('Ai.approve') }}</button>
                        <button v-if="!selected.batch" type="button" class="ah-btn ah-btn--secondary" :disabled="busy" data-test="edit-then-approve" @click="editing = !editing">
                            {{ editing ? $t('Ai.done_editing') : $t('Ai.edit_then_approve') }}
                        </button>
                        <button type="button" class="ah-btn ah-btn--ghost" :disabled="busy" data-test="decline" @click="openDecline">{{ $t('Ai.decline') }}</button>
                    </div>
                    <div v-else-if="selected.status === 'pending' && canDecline && !declining" class="ai-actions">
                        <button type="button" class="ah-btn ah-btn--secondary" :disabled="busy" data-test="decline" @click="openDecline">{{ $t('Ai.decline') }}</button>
                    </div>
                    <div v-else-if="selected.status === 'pending' && canDecline" class="ai-decline" data-test="decline-reason">
                        <div class="ah-label">{{ $t('Ai.decline_reason_title') }}</div>
                        <p class="ah-small ai-decline__lead">{{ $t('Ai.decline_reason_lead') }}</p>
                        <div class="ai-decline__chips" role="group" :aria-label="$t('Ai.decline_reason_title')">
                            <button v-for="key in DECLINE_REASONS" :key="key" type="button" class="ah-chip ai-decline__chip" :class="{ 'is-on': declineReason === key }" :aria-pressed="declineReason === key" :data-reason="key" @click="pickReason(key)">{{ $t(`Ai.decline_reason_${key}`) }}</button>
                        </div>
                        <input v-model.trim="declineNote" type="text" class="ah-input ai-decline__note" maxlength="200" :placeholder="$t('Ai.decline_reason_placeholder')" :aria-label="$t('Ai.decline_reason_other')" data-test="decline-note" @input="declineReason = ''" />
                        <div class="ai-actions ai-decline__actions">
                            <button type="button" class="ah-btn ah-btn--primary" :disabled="busy || !declineReasonValue" data-test="decline-send" @click="onDecline(declineReasonValue)">{{ $t('Ai.decline') }}</button>
                            <button type="button" class="ah-btn ah-btn--ghost" :disabled="busy" data-test="decline-cancel" @click="declining = false">{{ $t('Ai.cancel') }}</button>
                            <button type="button" class="ai-decline__skip" :disabled="busy" data-test="decline-skip" @click="onDecline('')">{{ $t('Ai.decline_no_reason') }}</button>
                        </div>
                    </div>
                    <p v-else-if="selected.status !== 'pending'" class="ah-small" style="margin-top:14px">{{ decidedLine }}</p>

                    <p class="ai-cost">{{ costLine }}</p>
                    <AiFeedback :key="selected._id" class="ai-detail__feedback" feature="agent_run" kind="proposal" :item-id="String(selected._id)" />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import AiModelNotice from '@/components/molecules/AiUnavailable/AiModelNotice.vue';
import { computed, inject, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import AiFeedback from "@/components/molecules/AiFeedback/AiFeedback.vue";
import IntentPreview from "@/components/molecules/IntentPreview/IntentPreview.vue";
import { intentSummary } from "@/components/molecules/IntentPreview/intentLines";
import { openTask } from "@/components/organisms/TaskDetailOverlay/useTaskOverlay";
import { dropProjects, showProjects } from "@/composable/approvedProjects";
import { madeProjectIds, trashedProjectIds } from "@/composable/approvedProjectIds";
import AiSidebar from "./AiSidebar.vue";
import WorkflowApprovalRow from "./WorkflowApprovalRow.vue";
import SlackPostPreview from "./SlackPostPreview.vue";
import WorkflowApprovalDetail from "./WorkflowApprovalDetail.vue";
import AgentReportDetail from "./AgentReportDetail.vue";
import { useAgentReports } from "./useAgentReports";
import { useWorkflowApprovals } from "./useWorkflowApprovals";
import { useAgents, reasonOf } from "./useAgents";
import { DECLINE_REASONS } from "./episodeText";
import { taintSourcesLine, taintSourcesOf } from "./taintText";
import { skillSourceLabel } from "./skillSourceText";
import { proposalTitle, sortProposals, waitingDaysOf } from "./plainLabels";
import { useAgentAccess } from "./agentAccess";
import { changeLabel } from "./agentActionLabels";
import { plainReason } from "./auditWords";

defineOptions({ name: "AiInboxPage" });

const GATE_OWNER_ADMIN = "owner_admin";
const LOCKED_BY_RIGHTS = "own_rights";

const { t, te } = useI18n();
const store = useStore();
const companyId = inject("$companyId", null);
const { canManage, userId, mayUndo } = useAgentAccess();
const $toast = useToast();
const { proposals, counts, loadProposals, loadSummary, decide } = useAgents();
const plain = (reason) => plainReason(t, te, reason);
const whyOf = (proposal) => plain(proposal.why);
const {
    approvals,
    count: approvalCount,
    error: approvalsError,
    engineOff: approvalsEngineOff,
    loaded: approvalsLoaded,
    busy: approvalsBusy,
    load: loadApprovals,
    decide: decideApproval,
    reassign: reassignApproval
} = useWorkflowApprovals();

const route = useRoute();
const { reports, loaded: reportsLoaded, error: reportsError, load: loadReports } = useAgentReports();
const selectedReport = ref(null);
const runStatusLabel = (status) => (te(`Ai.run_status_${status}`) ? t(`Ai.run_status_${status}`) : status);

const view = ref("pending");
const sortOrder = ref("newest");
const loading = ref(true);
const loadError = ref("");
const selected = ref(null);
const selectedApproval = ref(null);
const approvalError = ref("");
const editing = ref(false);
const editable = ref([]);
const busy = ref(false);
const error = ref("");
const undo = ref(null);
const declining = ref(false);
const declineReason = ref("");
const declineNote = ref("");

const pickReason = (key) => {
    declineReason.value = declineReason.value === key ? "" : key;
    declineNote.value = "";
};
const declineReasonValue = computed(() => declineReason.value || declineNote.value.slice(0, 200));

/* The server says whether a waiting proposal is the reader's to approve; a row without its word falls back to the owner-or-admin rule. */
const canDecide = computed(() => {
    const p = selected.value;
    if (!p) return true;
    return typeof p.locked === "boolean" ? !p.locked : p.gate !== GATE_OWNER_ADMIN || canManage.value;
});
const canDecline = computed(() => canDecide.value || selected.value?.mayDecline === true);
const lockedByRights = computed(() => selected.value?.status === "pending" && selected.value?.lockedWhy === LOCKED_BY_RIGHTS);
const taintLine = (marker) => taintSourcesLine(t, taintSourcesOf(marker));
const selectedSkillSource = computed(() => skillSourceLabel(t, selected.value?.skillSource));
const sortedProposals = computed(() => sortProposals(proposals.value, sortOrder.value));
const gateChip = (gate) => t(gate === GATE_OWNER_ADMIN ? "Ai.gate_chip_owner_admin" : "Ai.gate_chip");
// A connected agent's batch is filed under a count of changes; its card says how many tasks and what changes on them.
const titleOf = (p) => intentSummary(t, p.batch) || proposalTitle(t, p);
const allReversible = computed(() => editable.value.length > 0 && editable.value.every((c) => c.reversible));
const openBatchTask = (task) => openTask({ companyId: companyId?.value, projectId: task.projectId, sprintId: task.sprintId, folderId: task.folderId || "", taskId: task.taskId });

const tabs = computed(() => [
    { key: "pending", label: "Ai.waiting", count: counts.value.waiting || 0 },
    { key: "approvals", label: "Workflows.approvals_tab", count: approvalCount.value },
    { key: "reports", label: "Ai.reports_tab", count: 0 },
    { key: "done", label: "Ai.done_by_ai", count: counts.value.doneByAi || 0 },
    { key: "declined", label: "Ai.declined", count: counts.value.declined || 0 }
]);

const decidedLine = computed(() => {
    const p = selected.value || {};
    return t("Ai.decided_line", { status: t(`Ai.status_${p.status || "pending"}`), at: p.decidedAt ? moment(p.decidedAt).fromNow() : "" });
});

const SLACK_POST = "slack.message.post";
const slackDeliveryOf = (change) => (selected.value?.delivery || [])[editable.value.filter((c) => c.action === SLACK_POST).indexOf(change)] || null;

const changesLabel = computed(() => {
    const list = editable.value;
    const all = allReversible.value;
    const unit = list.length === 1 ? t("Ai.action_one") : t("Ai.action_other");
    return t("Ai.what_changes", { n: list.length, unit, note: all ? t("Ai.all_reversible") : t("Ai.some_permanent") });
});

const costLine = computed(() => {
    const c = selected.value?.cost || {};
    if (!c.tokens && !c.usd) return t("Ai.logged_to_audit");
    return t("Ai.cost_line", { tokens: c.tokens || 0, usd: Number(c.usd || 0).toFixed(2) });
});

const shortTime = (at) => {
    if (!at) return "";
    const m = moment(at);
    return m.isSame(moment(), "day") ? m.format("H:mm") : m.fromNow();
};

watch(selectedApproval, () => { approvalError.value = ""; });

watch(selected, (p) => {
    editing.value = false;
    declining.value = false;
    error.value = "";
    editable.value = p ? (p.changes || []).map((c) => ({ ...c })) : [];
});

/* "Loading" is for the first read of a view. After a decision the rows that are left stay on screen while the list is read again. */
const reload = async ({ inPlace = false } = {}) => {
    if (!inPlace) loading.value = true;
    loadError.value = "";
    try {
        await loadProposals(view.value);
    } catch (e) {
        loadError.value = reasonOf(e, "Ai.load_failed");
    } finally {
        loading.value = false;
    }
};

const switchView = async (key) => {
    view.value = key;
    selected.value = null;
    selectedApproval.value = null;
    selectedReport.value = null;
    if (key === "reports") return loadReports();
    await (key === "approvals" ? loadApprovals() : reload());
};

const onDecideApproval = async ({ approval, decision }) => {
    approvalError.value = "";
    try {
        await decideApproval(approval, decision);
        selectedApproval.value = null;
        $toast.success(t(decision === "approved" ? "Workflows.approval_approved" : "Workflows.approval_rejected"), { position: "top-right" });
    } catch (e) {
        approvalError.value = e.message;
    }
};

const onReassignApproval = async ({ approval, toUserId, reason }) => {
    approvalError.value = "";
    try {
        selectedApproval.value = await reassignApproval(approval, toUserId, reason);
        $toast.success(t("Workflows.approval_reassigned"), { position: "top-right" });
    } catch (e) {
        approvalError.value = e.message;
    }
};

const afterDecision = async (message) => {
    const id = selected.value._id;
    selected.value = null;
    await Promise.all([reload({ inPlace: true }), loadSummary().catch(() => {})]);
    if (message) $toast.success(message, { position: "top-right" });
    return id;
};

const onApprove = async () => {
    busy.value = true;
    error.value = "";
    try {
        const original = selected.value.changes || [];
        const changed = editable.value.length !== original.length;
        const out = await decide(selected.value._id, "approve", changed ? { changes: editable.value } : {});
        const unapplied = (out?.applied || []).filter((a) => !a.ok);
        showProjects(store, madeProjectIds(out));
        const id = await afterDecision(unapplied.length ? "" : t("Ai.applied"));
        if (unapplied.length) $toast.error(t("Ai.applied_with_failures", { n: unapplied.length, error: plain(unapplied[0].error) }), { position: "top-right" });
        if (out?.undoUntil && mayUndo({ decidedBy: out.decidedBy || userId.value })) {
            undo.value = { id, until: new Date(out.undoUntil).getTime() };
            setTimeout(() => { if (undo.value && undo.value.id === id) undo.value = null; }, Math.max(0, new Date(out.undoUntil).getTime() - Date.now()));
        }
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
};

const openDecline = () => {
    declineReason.value = "";
    declineNote.value = "";
    error.value = "";
    declining.value = true;
};

const onDecline = async (reason = "") => {
    busy.value = true;
    error.value = "";
    try {
        await decide(selected.value._id, "decline", reason ? { reason } : {});
        declining.value = false;
        await afterDecision(t("Ai.declined_done"));
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
};

const onUndo = async () => {
    const id = undo.value?.id;
    undo.value = null;
    if (!id) return;
    try {
        dropProjects(store, trashedProjectIds(await decide(id, "undo", {})));
        await Promise.all([reload({ inPlace: true }), loadSummary().catch(() => {})]);
        $toast.success(t("Ai.undone"), { position: "top-right" });
    } catch (e) {
        $toast.error(e.message, { position: "top-right" });
    }
};

/* The approvals are loaded on arrival whatever tab is open, because the tab's
 * count is the only sign a workflow is waiting on somebody. With the engine off
 * the load answers 503 and the count is simply nought. */
const openLinkedReport = async (id) => {
    view.value = "reports";
    await loadReports();
    selectedReport.value = reports.value.find((r) => String(r._id) === String(id)) || null;
};

onMounted(() => Promise.all([reload(), loadApprovals(), route?.query?.report ? openLinkedReport(route.query.report) : null]));
</script>

<style>
@import "./style.css";
@import "./workflow.css";
.ai-back { display: none; }
.ah-input.ai-inbox__sort { width: auto; height: 28px; margin-top: 8px; }
@media (max-width: 900px) { .ai-back { display: inline-flex; margin-bottom: 10px; } }
.ai-decline { margin-top: 18px; padding: 12px 14px; border: 1px solid var(--hairline); border-radius: 9px; background: var(--surface); display: flex; flex-direction: column; gap: 8px; }
.ai-decline__lead { margin: 0; }
.ai-decline__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ai-decline__chip { border: 1px solid transparent; cursor: pointer; }
.ai-decline__chip.is-on { background: var(--brand-tint); color: var(--brand); border-color: var(--brand); }
.ah-input.ai-decline__note { max-width: 420px; height: 32px; }
.ai-decline__actions { margin-top: 4px; align-items: center; }
.ai-decline__skip { border: 0; background: transparent; color: var(--ink-2); font: var(--text-small); cursor: pointer; text-decoration: underline; padding: 0 4px; }
.ai-detail__feedback { margin-top: 12px; }
.ai-locked { margin-top: 14px; }
.ai-batch { display: flex; flex-direction: column; gap: 6px; margin-bottom: 7px; min-width: 0; }
.ai-batch__mark { align-self: flex-start; }
</style>
