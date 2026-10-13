<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('Workflows.lineage_title') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <router-link v-if="!engineOff" class="ah-btn ah-btn--ghost ah-btn--sm" :to="runLink" data-test="lineage-run-link">{{ $t('Workflows.lineage_back_to_run') }}</router-link>
                <button v-if="!engineOff" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="refresh" @click="load">{{ $t('Workflows.refresh') }}</button>
            </div>

            <div class="ai-page__body ah-scroll">
                <EmptyState v-if="engineOff" data-test="engine-off" :title="$t('Workflows.engine_off_title')" :message="$t('Workflows.engine_off_body')" />
                <div v-else-if="error" class="ah-field__error" data-test="error">{{ error }}</div>
                <div v-else-if="!loaded" class="ah-empty">{{ $t('Workflows.loading') }}</div>
                <template v-else-if="run">
                    <div class="wf-run__head" data-test="lineage-head">
                        <span class="ah-h3">{{ run.name || run.workflowId }}</span>
                        <span class="ah-small" data-test="lineage-lead">{{ $t('Workflows.lineage_lead', { n: chain.length }) }}</span>
                    </div>

                    <ol class="wf-chain" data-test="chain">
                        <li v-for="link in chain" :key="link.step.stepId" class="wf-chain__link" :data-step="link.step.stepId">
                            <div class="wf-chain__from" data-test="chain-edges">
                                <span v-if="!link.edges.length" class="ah-small wf-chain__start" data-test="chain-start">{{ $t('Workflows.lineage_starts_here') }}</span>
                                <span v-for="edge in link.edges" :key="`${edge.from}:${edge.field || ''}`" class="wf-chain__edge" data-test="chain-edge">
                                    <span class="ah-mono">{{ edge.from }}</span>
                                    <ShellIcon name="chevronRight" :size="12" />
                                    <span class="ah-chip ah-chip--mono" :class="{ 'ah-chip--warn': edge.field && !edge.produced }" data-test="chain-edge-result">{{ edgeLabel(edge) }}</span>
                                </span>
                            </div>

                            <WorkflowStepRow :step="link.step">
                                <span class="ah-small wf-chain__who" data-test="chain-accountable">{{ accountableLabel(link.accountable) }}</span>
                            </WorkflowStepRow>

                            <div v-if="link.tally" class="wf-fan" data-test="chain-fan">
                                <span class="ah-small" data-test="chain-fan-tally">{{ tallyLine(link.tally) }}</span>
                                <button
                                    v-if="link.expandable"
                                    type="button"
                                    class="ah-btn ah-btn--ghost ah-btn--sm"
                                    :aria-expanded="link.expanded ? 'true' : 'false'"
                                    data-test="chain-fan-toggle"
                                    @click="toggleChildren(link.step.stepId)"
                                >{{ link.expanded ? $t('Workflows.fan_collapse') : $t('Workflows.fan_expand', { n: link.hidden }) }}</button>
                            </div>

                            <ul v-if="link.shown.length" class="wf-graph__children">
                                <li v-for="child in link.shown" :key="child.step.stepId">
                                    <WorkflowStepRow :step="child.step" child>
                                        <span class="ah-small wf-chain__who" data-test="chain-child-accountable">{{ accountableLabel(child.accountable) }}</span>
                                    </WorkflowStepRow>
                                </li>
                            </ul>
                        </li>
                    </ol>

                    <p class="ah-small wf-run__read-only" data-test="lineage-read-only">{{ $t('Workflows.lineage_read_only') }}</p>
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
import { useStore } from "vuex";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AiSidebar from "./AiSidebar.vue";
import WorkflowStepRow from "./WorkflowStepRow.vue";
import { useWorkflowRun } from "./useWorkflowRun";
import { useAgents } from "./useAgents";
import { chainOf } from "./workflowLineage";

defineOptions({ name: "WorkflowLineageView" });

const props = defineProps({ runId: { type: String, default: "" } });

const route = useRoute();
const { t } = useI18n();
const { getters } = useStore();

const runId = () => props.runId || String(route.params.id || "");
const { run, steps, error, engineOff, loaded, expanded, load, toggleChildren } = useWorkflowRun(runId);

const { agents, loadAgents } = useAgents();

const chain = computed(() => chainOf(steps.value, run.value, { expanded: expanded.value }));

const runLink = computed(() => ({ name: "WorkflowRun", params: { cid: route.params.cid, id: runId() } }));

const nameOfUser = (userId) => {
    if (!userId) return "";
    const person = (getters["users/users"] || []).find((user) => String(user._id) === String(userId));
    return person?.Employee_Name || "";
};

const nameOfAgent = (agentId) => {
    if (!agentId) return "";
    const agent = agents.value.find((a) => String(a._id) === String(agentId));
    return agent?.name || "";
};

const edgeLabel = (edge) => {
    if (!edge.field) return t("Workflows.lineage_edge_handoff");
    if (!edge.produced) return t("Workflows.lineage_edge_missing", { field: edge.field });
    return edge.value === ""
        ? t("Workflows.lineage_edge_field", { field: edge.field })
        : t("Workflows.lineage_edge_value", { field: edge.field, value: edge.value });
};

/* Who answers for the step, said as a person would say it: the approver once
 * there is one, the owner while there is not, the agent and the person who put
 * it to work, and the rule when nobody did. */
const accountableLabel = (who) => {
    if (who.kind === "agent") {
        const agent = nameOfAgent(who.agentId) || t("Workflows.lineage_an_agent");
        const person = nameOfUser(who.userId);
        return person ? t("Workflows.lineage_agent_for", { agent, person }) : t("Workflows.lineage_agent", { agent });
    }
    if (who.kind === "automation") {
        return t("Workflows.lineage_automation", { rule: who.ruleName || t("Workflows.lineage_a_rule") });
    }
    if (who.system) return t("Workflows.lineage_by_deadline");
    const person = nameOfUser(who.userId);
    if (who.decided) return t("Workflows.lineage_decided_by", { person: person || t("Workflows.lineage_somebody") });
    if (who.forRun) return person ? t("Workflows.lineage_run_by", { person }) : t("Workflows.lineage_run_unowned");
    if (person) return t("Workflows.lineage_owned_by", { person });
    return who.role ? t("Workflows.lineage_owned_by_role", { role: who.role }) : t("Workflows.lineage_unowned");
};

const TALLY_PARTS = ["success", "failed", "running", "pending", "skipped", "stopped"];
const tallyLine = (tally) => t("Workflows.fan_tally", {
    n: tally.total,
    parts: TALLY_PARTS.filter((key) => tally[key] > 0).map((key) => t(`Workflows.tally_${key}`, { n: tally[key] })).join(t("Workflows.tally_separator"))
});

/* The agent list is only for turning an id into a name: a run whose agents
 * cannot be fetched still draws its chain. */
onMounted(() => Promise.all([load(), loadAgents().catch(() => {})]));
</script>

<style>
@import "./style.css";
@import "./workflow.css";
</style>
