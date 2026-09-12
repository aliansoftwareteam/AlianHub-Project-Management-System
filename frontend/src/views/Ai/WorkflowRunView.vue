<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('Workflows.run_title') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <router-link v-if="!engineOff" class="ah-btn ah-btn--ghost ah-btn--sm" :to="lineageLink" data-test="lineage-link">{{ $t('Workflows.lineage_open') }}</router-link>
                <button v-if="!engineOff" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="refresh" @click="load">{{ $t('Workflows.refresh') }}</button>
            </div>

            <div class="ai-page__body ah-scroll">
                <EmptyState v-if="engineOff" data-test="engine-off" :title="$t('Workflows.engine_off_title')" :message="$t('Workflows.engine_off_body')" />
                <div v-else-if="error" class="ah-field__error" data-test="error">{{ error }}</div>
                <div v-else-if="!loaded" class="ah-empty">{{ $t('Workflows.loading') }}</div>
                <template v-else-if="run">
                    <div class="wf-run__head" data-test="run-head">
                        <span class="ah-h3">{{ run.name || run.workflowId }}</span>
                        <span class="ah-chip" :class="runChip" data-test="run-status">{{ $t(`Workflows.status_${runStatus}`) }}</span>
                        <span class="ah-small" data-test="run-totals">{{ $t('Workflows.run_totals', { settled: totals.settled, total: totals.total }) }}</span>
                        <span class="ah-mono ah-small" data-test="run-cost">{{ $t('Workflows.cost_usd', { usd: totals.costUsd.toFixed(2) }) }}</span>
                    </div>

                    <div v-if="blocked" class="wf-blocked" :class="{ 'wf-blocked--terminal': blocked.terminal }" data-test="blocked">
                        <span class="ah-label">{{ $t(blocked.terminal ? 'Workflows.blocked_title' : 'Workflows.waiting_title') }}</span>
                        <span v-if="blocked.terminal" class="ah-chip ah-chip--danger" data-test="blocked-code">{{ $t(`Workflows.blocked_${blocked.code}`) }}</span>
                        <p class="wf-blocked__reason" data-test="blocked-reason">{{ blocked.reason }}</p>
                        <p class="ah-small" data-test="blocked-step">{{ $t('Workflows.blocked_at_step', { stepId: blocked.stepId }) }}</p>
                        <p v-if="!blocked.terminal && blocked.also > 0" class="ah-small" data-test="blocked-also">{{ $t('Workflows.waiting_also', { n: blocked.also }) }}</p>
                    </div>

                    <ul class="wf-graph" data-test="graph">
                        <li v-for="node in nodes" :key="node.step.stepId" class="wf-graph__node">
                            <WorkflowStepRow :step="node.step">
                                <button
                                    v-if="canManage && resumable(node.step)"
                                    type="button"
                                    class="ah-btn ah-btn--secondary ah-btn--sm"
                                    :disabled="Boolean(busy)"
                                    data-test="control-resume"
                                    @click="apply('resume', node.step.stepId)"
                                >{{ $t('Workflows.control_resume') }}</button>
                            </WorkflowStepRow>

                            <div v-if="node.tally" class="wf-fan" data-test="fan-group">
                                <span class="ah-small" data-test="fan-tally">{{ tallyLine(node.tally) }}</span>
                                <button
                                    v-if="node.expandable"
                                    type="button"
                                    class="ah-btn ah-btn--ghost ah-btn--sm"
                                    :aria-expanded="node.expanded ? 'true' : 'false'"
                                    data-test="fan-toggle"
                                    @click="toggleChildren(node.step.stepId)"
                                >{{ node.expanded ? $t('Workflows.fan_collapse') : $t('Workflows.fan_expand', { n: node.hidden }) }}</button>
                            </div>

                            <ul v-if="node.shown.length" class="wf-graph__children">
                                <li v-for="child in node.shown" :key="child.stepId">
                                    <WorkflowStepRow :step="child" child />
                                    <WorkflowFailedStep
                                        v-if="child.status === 'failed'"
                                        :step="child"
                                        :can-manage="canManage"
                                        :busy="Boolean(busy)"
                                        @control="(action) => apply(action, child.stepId)"
                                    />
                                </li>
                            </ul>

                            <WorkflowLoopCounter
                                v-if="node.step.type === 'loop'"
                                :step="node.step"
                                :can-manage="canManage"
                                :busy="Boolean(busy)"
                                @stop="stopLoop(node.step.stepId)"
                            />

                            <WorkflowFailedStep
                                v-if="node.step.status === 'failed'"
                                :step="node.step"
                                :can-manage="canManage"
                                :busy="Boolean(busy)"
                                @control="(action) => apply(action, node.step.stepId)"
                            />
                        </li>
                    </ul>

                    <p v-if="!canManage" class="ah-small wf-run__read-only" data-test="run-read-only">{{ $t('Workflows.read_only') }}</p>
                </template>
                <EmptyState v-else data-test="not-found" :title="$t('Workflows.not_found_title')" :message="$t('Workflows.not_found_body')" />
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import AiSidebar from "./AiSidebar.vue";
import WorkflowStepRow from "./WorkflowStepRow.vue";
import WorkflowFailedStep from "./WorkflowFailedStep.vue";
import WorkflowLoopCounter from "./WorkflowLoopCounter.vue";
import { useAgentAccess } from "./agentAccess";
import { useWorkflowRun } from "./useWorkflowRun";
import { recoveryControlOf, runStatusOf } from "./workflowRun";

defineOptions({ name: "WorkflowRunView" });

const props = defineProps({ runId: { type: String, default: "" } });

const route = useRoute();
const { t } = useI18n();
const $toast = useToast();
const { canManage } = useAgentAccess();

const runId = () => props.runId || String(route.params.id || "");
const { run, error, engineOff, loaded, busy, nodes, blocked, totals, load, control, toggleChildren } = useWorkflowRun(runId);

const lineageLink = computed(() => ({ name: "WorkflowLineage", params: { cid: route.params.cid, id: runId() } }));

const runStatus = computed(() => runStatusOf(run.value));
const RUN_CHIPS = { success: "ah-chip--ok", failed: "ah-chip--danger", blocked: "ah-chip--danger", running: "ah-chip--brand", queued: "ah-chip--warn", stopped: "ah-chip--dark" };
const runChip = computed(() => RUN_CHIPS[runStatus.value] || "ah-chip--dark");

const resumable = (step) => recoveryControlOf(step) === "resume";

const TALLY_PARTS = ["success", "failed", "running", "pending", "skipped", "stopped"];
const tallyLine = (tally) => t("Workflows.fan_tally", {
    n: tally.total,
    parts: TALLY_PARTS.filter((key) => tally[key] > 0).map((key) => t(`Workflows.tally_${key}`, { n: tally[key] })).join(t("Workflows.tally_separator"))
});

const apply = async (action, stepId, reason = "") => {
    try {
        await control(action, stepId, reason);
        $toast.success(t(`Workflows.applied_${action}`), { position: "top-right" });
    } catch (e) {
        $toast.error(e.message, { position: "top-right" });
    }
};

/* Stopping a loop is skipping the step it is re-entering: the engine has no
 * other way to end a bounded re-entry early, and the skip carries who asked. */
const stopLoop = (stepId) => apply("skip", stepId, t("Workflows.loop_stop_reason"));

onMounted(load);
</script>

<style>
@import "./style.css";
@import "./workflow.css";
</style>
